// Motor do organizador do kanban:
//  - Varredura a cada X minutos: só olha leads do kanban (em andamento) com mensagem nova desde a última varredura.
//    Sinais sem IA (mensagem enviada, PDF "Proposta comercial…", Calendly) rodam sempre; a IA só é chamada quando há
//    mensagem nova que não seja da própria Alice ou da saudação automática. Só avança: nunca volta etapa.
//  - "Organizar tudo": lê os leads dos últimos X dias (antigos e novos), monta uma prévia e você aplica.
//    Depois disso a varredura continua normal, só com as conversas novas.
//  - Limite de gasto por dia: ao bater, a varredura para até a meia-noite (fuso da IA).
import { get, all, run } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { meiaNoiteNoFuso } from '../ia/protecao.js';
import { lerConfig, salvarInterno, fusoDoDia } from './config.js';
import { sinaisFixos, marcosAlcancados, decidirDestino, moverLead, etapasAbertas } from './etapas.js';
import { avaliarLead, temDadosParaLer } from './avaliacao.js';

const MIN = 60000;
let relogio = null;
let rodando = false;
let tarefa = null; // "Organizar tudo"

// Mensagem que mexe na leitura da IA: qualquer uma, menos as da própria IA e da saudação automática
const RELEVANTE_PARA_IA = `NOT (m.from_me = 1 AND COALESCE(CASE WHEN json_valid(m.extra) THEN json_extract(m.extra, '$.origem') END, '') IN ('ia', 'disparo'))`;

const EVENTOS_QUE_PEDEM_LEITURA = ['form_submitted', 'form_partial', 'form_completed', 'form_resubmitted', 'meeting_scheduled', 'meeting_rescheduled', 'meeting_canceled'];
export const maxEventoId = () => get('SELECT COALESCE(max(id), 0) AS n FROM lead_events')?.n || 0;
export const maxMsgId = () => get('SELECT COALESCE(max(id), 0) AS n FROM wa_messages')?.n || 0;

export function gastoHoje(agoraMs = Date.now()) {
  const desde = new Date(meiaNoiteNoFuso(agoraMs, fusoDoDia())).toISOString();
  return get("SELECT COALESCE(sum(custo_usd), 0) AS v FROM organizador_uso WHERE modo = 'varredura' AND created_at >= ?", [desde]).v;
}

function avisar(dados = {}) {
  emitir('organizador', dados);
}

/**
 * Marca como pendentes os leads (em andamento) com mensagem nova desde o cursor e avança o cursor.
 * Devolve { comIa: Set(leadId), soRegras: Set(leadId) }.
 */
export function marcarPendentes(cfg = lerConfig()) {
  const desde = Math.max(cfg.cursor_msg_id || 0, cfg.inicio_msg_id || 0);
  // Teto lido antes: mensagens que chegarem durante a leitura ficam para a próxima varredura
  const teto = maxMsgId();
  const novas = all(
    `SELECT m.id, m.lead_id, (${RELEVANTE_PARA_IA}) AS relevante FROM wa_messages m
       JOIN leads l ON l.id = m.lead_id JOIN stages s ON s.id = l.stage_id
      WHERE m.id > ? AND m.id <= ? AND s.kind = 'open' AND m.chat_jid NOT LIKE '%@g.us' AND m.type <> 'chamada'`, [desde, teto]
  );
  const soRegras = new Set();
  const agora = new Date().toISOString();
  for (const m of novas) {
    if (m.relevante) run('UPDATE leads SET ia_pendente_desde = COALESCE(ia_pendente_desde, ?) WHERE id = ?', [agora, m.lead_id]);
    else soRegras.add(m.lead_id);
  }
  // Formulário preenchido/atualizado e reunião marcada, remarcada ou cancelada no Calendly também pedem nova leitura
  // (é assim que o lead que ainda não conversou ganha o termômetro)
  const desdeEv = cfg.cursor_evento_id ?? maxEventoId();
  const tetoEv = maxEventoId();
  const eventos = all(
    `SELECT DISTINCT e.lead_id FROM lead_events e JOIN leads l ON l.id = e.lead_id JOIN stages s ON s.id = l.stage_id
      WHERE e.id > ? AND e.id <= ? AND s.kind = 'open' AND e.type IN (${EVENTOS_QUE_PEDEM_LEITURA.map(() => '?').join(', ')})`,
    [desdeEv, tetoEv, ...EVENTOS_QUE_PEDEM_LEITURA]
  );
  for (const e of eventos) run('UPDATE leads SET ia_pendente_desde = COALESCE(ia_pendente_desde, ?) WHERE id = ?', [agora, e.lead_id]);
  // Mensagens de grupos e de quem não é lead também avançam o cursor (não precisam ser lidas de novo)
  if (teto > desde || tetoEv !== cfg.cursor_evento_id) salvarInterno({ cursor_msg_id: Math.max(teto, desde), cursor_evento_id: tetoEv });
  return { soRegras };
}

/** Leads em "Reunião agendada" (ou antes) cuja reunião do Calendly já passou: só regra, sem IA */
function leadsComReuniaoPassada() {
  try {
    const limite = new Date(Date.now() - 15 * MIN).toISOString();
    return all(
      `SELECT DISTINCT c.lead_id AS id FROM calendly_events c JOIN leads l ON l.id = c.lead_id JOIN stages s ON s.id = l.stage_id
        WHERE c.status = 'active' AND s.kind = 'open' AND COALESCE(c.end_time, c.start_time) < ? AND c.start_time > ?`,
      [limite, new Date(Date.now() - 30 * 86400000).toISOString()]
    ).map((r) => r.id);
  } catch { return []; }
}

/** Aplica no lead o que os sinais (e a leitura da IA, se houver) indicam. Devolve a movimentação ou null. */
export function aplicarAoLead(leadId, { ia = null, cfg, modo = 'varredura' }) {
  const lead = get('SELECT id, stage_id, ia_vetos FROM leads WHERE id = ?', [leadId]);
  if (!lead) return null;
  const etapas = etapasAbertas();
  const marcos = marcosAlcancados({ fixos: sinaisFixos(leadId), ia, criterios: cfg.criterios, etapas });
  const destino = decidirDestino({ lead, marcos, modo, etapas });
  if (!destino) return null;
  const id = moverLead({ leadId, destino, modo });
  return id ? { id, lead_id: leadId, de: destino.de.name, para: destino.etapa.name, motivo: destino.motivo } : null;
}

/** Uma varredura. Chamada pelo relógio; também pelo botão "Varrer agora". */
export async function varrer() {
  const cfg = lerConfig();
  if (!cfg.ativo) return { pulou: 'desligado' };
  if (rodando) return { pulou: 'rodando' };
  if (tarefa?.estado === 'analisando' || tarefa?.estado === 'aplicando') return { pulou: 'organizando' };
  rodando = true;
  const resultado = { em: new Date().toISOString(), avaliados: 0, movidos: 0, pendentes: 0, gasto: 0, erro: null, limite: false };
  try {
    const { soRegras } = marcarPendentes(cfg);
    // 1) Regras sem IA: quem teve mensagem nova só nossa e quem teve reunião do Calendly encerrada
    for (const id of new Set([...soRegras, ...leadsComReuniaoPassada()])) {
      if (aplicarAoLead(id, { cfg })) resultado.movidos++;
    }
    // 2) IA para quem teve conversa nova, dentro do limite do dia
    const pendentes = all(
      `SELECT l.id FROM leads l JOIN stages s ON s.id = l.stage_id
        WHERE l.ia_pendente_desde IS NOT NULL AND s.kind = 'open' ORDER BY l.ia_pendente_desde LIMIT ?`, [cfg.max_leads_rodada]
    );
    // Pendentes que foram para Fechado/Perdido não precisam mais de leitura
    run("UPDATE leads SET ia_pendente_desde = NULL WHERE ia_pendente_desde IS NOT NULL AND stage_id IN (SELECT id FROM stages WHERE kind <> 'open')");
    for (const { id } of pendentes) {
      if (resultado.limite || gastoHoje() >= cfg.limite_diario_usd) {
        // Limite do dia: a leitura fica para depois da meia-noite, mas as regras sem IA valem agora
        resultado.limite = true;
        if (aplicarAoLead(id, { cfg })) resultado.movidos++;
        continue;
      }
      const { resultado: ia, custo, ultimaId } = await avaliarLead(id, { cfg, modo: 'varredura' });
      resultado.avaliados++;
      resultado.gasto += custo;
      if (aplicarAoLead(id, { ia, cfg })) resultado.movidos++;
      run('UPDATE leads SET ia_pendente_desde = NULL, ia_msg_id = MAX(COALESCE(ia_msg_id, 0), ?) WHERE id = ?', [ultimaId, id]);
    }
  } catch (err) {
    resultado.erro = err.message;
    console.error('[organizador] varredura:', err.message);
  } finally {
    rodando = false;
    resultado.pendentes = get("SELECT count(*) AS n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.ia_pendente_desde IS NOT NULL AND s.kind = 'open'").n;
    salvarInterno({ ultima_varredura: resultado });
    if (resultado.movidos || resultado.avaliados) avisar({ varredura: true, movidos: resultado.movidos });
  }
  return resultado;
}

// ------------------------------------------------------------------ "Organizar tudo"

/** Leads em andamento com atividade nos últimos N dias (entrada, mudança de etapa ou mensagem) */
export function leadsDoPeriodo(dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  return all(
    `SELECT l.id, l.name, l.stage_id, l.ia_vetos FROM leads l JOIN stages s ON s.id = l.stage_id
      WHERE s.kind = 'open' AND (l.created_at >= ? OR l.stage_changed_at >= ?
        OR EXISTS (SELECT 1 FROM wa_messages m WHERE m.lead_id = l.id AND m.timestamp >= ?))
      ORDER BY l.created_at DESC`, [desde, desde, desde]
  );
}


export function estadoTarefa() {
  if (!tarefa) return null;
  const { itens, ...resto } = tarefa;
  return { ...resto, itens };
}

/**
 * Começa a análise do "Organizar tudo" em segundo plano. Nada é movido aqui: no fim fica uma prévia.
 *  dias: período · limiteUsd: teto de gasto desta organização (não conta no limite diário da varredura)
 */
export function iniciarOrganizacao({ dias, limiteUsd, userId = null }) {
  if (tarefa && ['analisando', 'aplicando'].includes(tarefa.estado)) throw new Error('Já existe uma organização em andamento');
  const cfg = lerConfig();
  const leads = leadsDoPeriodo(dias);
  tarefa = {
    id: Date.now(), estado: 'analisando', dias, limite_usd: limiteUsd, total: leads.length, feitos: 0, gasto: 0, erros: 0,
    sem_mudanca: 0, itens: [], iniciada_em: new Date().toISOString(), terminada_em: null, erro: null, parou_no_limite: false, por: userId,
  };
  const minha = tarefa;
  (async () => {
    const etapas = etapasAbertas();
    for (const l of leads) {
      if (minha !== tarefa || minha.estado !== 'analisando') return; // cancelada
      if (minha.gasto >= limiteUsd) { minha.parou_no_limite = true; break; }
      try {
        let ia = null;
        let ultimaId = 0;
        if (temDadosParaLer(l.id)) {
          const r = await avaliarLead(l.id, { cfg, modo: 'organizar' });
          ia = r.resultado;
          ultimaId = r.ultimaId;
          minha.gasto += r.custo;
        }
        const lead = get('SELECT id, name, stage_id, ia_vetos, ia_temperatura FROM leads WHERE id = ?', [l.id]);
        if (!lead) continue;
        const marcos = marcosAlcancados({ fixos: sinaisFixos(l.id), ia, criterios: cfg.criterios, etapas });
        const destino = decidirDestino({ lead, marcos, modo: 'organizar', etapas });
        if (ultimaId) run('UPDATE leads SET ia_msg_id = MAX(COALESCE(ia_msg_id, 0), ?), ia_pendente_desde = NULL WHERE id = ?', [ultimaId, l.id]);
        if (destino) {
          minha.itens.push({
            lead_id: l.id, nome: lead.name || '(sem nome)', temperatura: lead.ia_temperatura,
            de: { id: destino.de.id, nome: destino.de.name }, para: { id: destino.etapa.id, nome: destino.etapa.name },
            direcao: destino.direcao, motivo: destino.motivo, trecho: destino.trecho || null, origem: destino.origem,
            // Voltar etapa desfaz o que alguém fez: vem desmarcado na prévia, você confere e marca se concordar
            marcado: destino.direcao === 'avanca',
          });
        } else minha.sem_mudanca++;
      } catch (err) {
        minha.erros++;
        minha.ultimo_erro = err.message;
        // Erro da API que não passa sozinho (chave, créditos, modelo): para tudo
        if (err.tipo && ['chave', 'creditos', 'modelo', 'workspace'].includes(err.tipo)) { minha.erro = err.message; break; }
      }
      minha.feitos++;
      avisar({ organizar: true });
    }
    if (minha === tarefa && minha.estado === 'analisando') {
      minha.estado = minha.erro && !minha.itens.length ? 'erro' : 'pronta';
      minha.terminada_em = new Date().toISOString();
      avisar({ organizar: true });
    }
  })().catch((err) => {
    if (minha === tarefa) { minha.estado = 'erro'; minha.erro = err.message; avisar({ organizar: true }); }
  });
  return estadoTarefa();
}

/** Aplica a prévia: move os leads marcados (os ids que vierem; sem lista = os marcados por padrão) */
export function aplicarOrganizacao(leadIds = null) {
  if (!tarefa || tarefa.estado !== 'pronta') throw new Error('Não há prévia pronta para aplicar');
  tarefa.estado = 'aplicando';
  const escolhidos = leadIds ? new Set(leadIds.map(Number)) : new Set(tarefa.itens.filter((i) => i.marcado).map((i) => i.lead_id));
  let movidos = 0;
  let pulados = 0;
  try {
    for (const item of tarefa.itens) {
      if (!escolhidos.has(item.lead_id)) continue;
      const atual = get('SELECT stage_id FROM leads WHERE id = ?', [item.lead_id]);
      // Se alguém mexeu no lead depois da prévia, respeita
      if (!atual || atual.stage_id !== item.de.id) { pulados++; item.resultado = 'mudou'; continue; }
      const etapa = get("SELECT id, name, position FROM stages WHERE id = ? AND kind = 'open'", [item.para.id]);
      if (!etapa) { pulados++; item.resultado = 'etapa'; continue; }
      const id = moverLead({ leadId: item.lead_id, destino: { etapa, motivo: item.motivo, trecho: item.trecho, origem: item.origem }, modo: 'organizar' });
      if (id) { movidos++; item.resultado = 'movido'; } else { pulados++; item.resultado = 'pulado'; }
    }
  } finally {
    tarefa.estado = 'concluida';
    tarefa.aplicada_em = new Date().toISOString();
    tarefa.movidos = movidos;
    tarefa.pulados = pulados;
    avisar({ organizar: true, varredura: true, movidos });
  }
  return estadoTarefa();
}

export function cancelarOrganizacao() {
  if (tarefa && tarefa.estado === 'analisando') {
    tarefa.estado = 'cancelada';
    tarefa.terminada_em = new Date().toISOString();
  } else tarefa = null;
  avisar({ organizar: true });
  return estadoTarefa();
}

// ------------------------------------------------------------------ relógio

let ultimaRodada = 0;

export function iniciarRelogio() {
  if (relogio) return;
  relogio = setInterval(() => {
    const cfg = lerConfig();
    if (!cfg.ativo) return;
    if (Date.now() - ultimaRodada < cfg.intervalo_min * MIN - 5000) return;
    ultimaRodada = Date.now();
    varrer().catch((err) => console.error('[organizador]', err.message));
  }, 30000);
  relogio.unref?.();
}

export function pararRelogio() {
  clearInterval(relogio);
  relogio = null;
}

// Para os testes
export function _zerarTarefa() { tarefa = null; }
