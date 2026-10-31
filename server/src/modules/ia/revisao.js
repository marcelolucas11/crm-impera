// Revisão dos atendimentos da IA: confere quem está em "IA atendendo" e se ficou alguém sem resposta.
//
// Por que existe: a IA reage a eventos (mensagem chegando ao vivo, cadastro novo). Mensagens que chegam enquanto o CRM
// está reiniciando/atualizando ou o WhatsApp está reconectando são gravadas depois ("offline") e não acordam a IA. Um
// reinício no meio de um atendimento também pode deixar a conversa "ativa" sem nada agendado. Nesses casos o lead fica
// esperando para sempre.
//
// A revisão roda sozinha (1,5 min depois de ligar o servidor e a cada 5 min) e também pelo botão "Revisar agora":
//  - lê todas as conversas com status "ativa";
//  - vê se a última mensagem da conversa é do lead (ou, no formulário/fila, se a 1ª mensagem nunca saiu);
//  - se a conversa não está agendada nem sendo atendida, volta o ponteiro de leitura para antes das mensagens sem
//    resposta e agenda a IA para retomar de onde parou (as travas de proteção e o horário continuam valendo);
//  - se alguém da equipe já respondeu, marca "Equipe assumiu"; se já tentou retomar 3 vezes em 6 h, passa para a equipe;
//  - solta QUALQUER atendimento preso há mais de 10 min (para o "um lead por vez" não travar a fila inteira) — antes só
//    soltava se a conversa presa tivesse mensagem do lead sem resposta, e uma conversa "em dia" presa congelava tudo;
//  - acha conversa "na fila" cuja hora já passou e ninguém atendeu (relógio parado) e destrava;
//  - conta quem a IA ainda não abordou ("IA irá atender") e diz por que está esperando (travas de proteção, horário).
import { get, all, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { lerConfig } from './config.js';
import { registrar } from './cliente.js';
import { dentroDoHorario } from './horario.js';
import { bloqueioAgora } from './protecao.js';
import {
  contatoDaConversa, historicoDaConversa, teveContatoHumano, atualizar, passarParaHumano, emAtendimento, soltarAtendimento,
  iaJaFalou, verificarPendentes,
} from './motor.js';

const DA_FILA = ['fila', 'fila_whatsapp'];
export const MAX_RETOMADAS = 3;
// Conversa "na fila" cuja hora passou há mais que isto sem ninguém atender = relógio parado
const ATRASO_FILA_MS = 3 * 60000;
const JANELA_RETOMADAS_MS = 6 * 3600000;
const ATENDIMENTO_TRAVADO_MS = 10 * 60000;
const PRIMEIRA_REVISAO_MS = 90 * 1000;
const INTERVALO_REVISAO_MS = 5 * 60000;

let ultimaRevisao = null;

/**
 * Situação de uma conversa ativa. Devolve null se está em dia (a última mensagem é nossa) ou
 * { pendentes: [mensagens do lead sem resposta], desde, primeiraMensagem, contato }.
 */
function semResposta(conversa) {
  const contato = contatoDaConversa(conversa);
  const historico = historicoDaConversa(contato);
  // Ligada à mão: a IA só responde o que o lead mandou depois de ligada
  const considerado = conversa.origem === 'manual'
    ? historico.filter((m) => m.from_me || new Date(m.timestamp).getTime() >= new Date(conversa.ativada_em).getTime())
    : historico;
  // Mensagens do lead depois da nossa última
  const pendentes = [];
  for (let i = considerado.length - 1; i >= 0 && !considerado[i].from_me; i--) pendentes.unshift(considerado[i]);
  // A IA ainda não abriu a conversa (formulário, fila, WhatsApp): a 1ª mensagem dela está devendo, mesmo que a última
  // mensagem da conversa seja a saudação automática dos Disparos
  if (conversa.origem !== 'manual' && !iaJaFalou(conversa, contato)) {
    return { pendentes, desde: pendentes[0]?.timestamp || conversa.ativada_em, primeiraMensagem: true, contato };
  }
  if (!pendentes.length) return null;
  return { pendentes, desde: pendentes[0].timestamp, primeiraMensagem: false, contato };
}

// Por que a IA está esperando para falar com esta conversa agora (travas de proteção, horário da fila)
function motivoDaEspera(cfg, c) {
  if (!cfg.ativo) return 'A IA está desligada';
  if (DA_FILA.includes(c.origem) && !c.mensagens_ia && !dentroDoHorario(cfg)) return 'Lead da fila: a 1ª mensagem espera o horário comercial';
  const automatico = cfg.modo === 'automatico' || (!dentroDoHorario(cfg) && cfg.automatico_fora_horario);
  if (!automatico) return null;
  const trava = bloqueioAgora(cfg, c);
  return trava ? `${trava.motivo} — libera por volta de ${new Date(trava.ate).toLocaleTimeString('pt-BR', { timeZone: cfg.fuso, hour: '2-digit', minute: '2-digit' })}` : null;
}

function retomadasRecentes(conversaId) {
  const desde = new Date(Date.now() - JANELA_RETOMADAS_MS).toISOString();
  return get("SELECT count(*) AS n FROM ia_registro WHERE conversa_id = ? AND tipo = 'retomada' AND created_at >= ?", [conversaId, desde]).n;
}

function nomeDe(c) {
  const lead = c.lead_id ? get('SELECT name FROM leads WHERE id = ?', [c.lead_id])?.name : null;
  const contato = c.jid ? get('SELECT COALESCE(name, push_name) AS n FROM wa_contacts WHERE jid = ?', [c.jid])?.n : null;
  return lead || contato || null;
}

/**
 * Lê todas as conversas em "IA atendendo" e devolve como está cada uma que tem lead sem resposta.
 * situacao: parada (ninguém vai responder — a revisão corrige) | agendada | atendendo_agora | travada | aguardando_aprovacao
 */
export function diagnosticar() {
  const cfg = lerConfig();
  const ativas = all("SELECT * FROM ia_conversas WHERE status = 'ativa' ORDER BY id");
  const atendendo = new Map(emAtendimento().map((a) => [a.id, a.desde]));
  const lista = [];
  let iraAtender = 0;
  for (const c of ativas) {
    const s = semResposta(c);
    if (s?.primeiraMensagem) iraAtender++;
    if (!s) continue;
    const sugestao = get("SELECT 1 AS ok FROM ia_sugestoes WHERE conversa_id = ? AND status = 'pendente' LIMIT 1", [c.id]);
    let situacao;
    if (sugestao) situacao = 'aguardando_aprovacao';
    else if (atendendo.has(c.id)) situacao = Date.now() - atendendo.get(c.id) > ATENDIMENTO_TRAVADO_MS ? 'travada' : 'atendendo_agora';
    // Hora vencida há minutos e ninguém sendo atendido = relógio parado (com fila andando, atraso é só a vez de cada um)
    else if (c.proxima_em) situacao = !atendendo.size && Date.now() - new Date(c.proxima_em).getTime() > ATRASO_FILA_MS ? 'atrasada' : 'agendada';
    else situacao = 'parada';
    lista.push({
      conversa_id: c.id, chave: c.chave, lead_id: c.lead_id, phone: c.phone, nome: nomeDe(c), origem: c.origem,
      situacao, proxima_em: c.proxima_em, sem_resposta_desde: s.desde, mensagens_sem_resposta: s.pendentes.length,
      primeira_mensagem: s.primeiraMensagem, ultima_mensagem: s.pendentes.at(-1)?.body?.slice(0, 140) || null,
      motivo_espera: ['agendada', 'atrasada'].includes(situacao) ? motivoDaEspera(cfg, c) : null,
      retomadas: retomadasRecentes(c.id),
      _s: s, _c: c,
    });
  }
  const proxima = lista.filter((p) => p.proxima_em).map((p) => p.proxima_em).sort()[0] || null;
  return { total_ativas: ativas.length, ira_atender: iraAtender, atendendo: ativas.length - iraAtender, proxima, lista };
}

const publico = ({ _s, _c, ...resto }) => resto;

/** Revisa e corrige: retoma as conversas paradas de onde pararam. origem: 'automatica' | nome de quem clicou */
export async function revisarAtendimentos({ origem = 'automatica' } = {}) {
  const cfg = lerConfig();
  const resultado = {
    em: agora(), origem, ativa: cfg.ativo, conversas_ativas: 0, ira_atender: 0, atendendo: 0, retomadas: 0, equipe_assumiu: 0,
    passadas_para_equipe: 0, soltas: 0, destravadas: 0, na_fila: 0, aguardando_aprovacao: 0, proxima: null, motivo_espera: null, pendencias: [],
  };
  if (!cfg.ativo) {
    ultimaRevisao = resultado;
    return resultado;
  }
  // 1) Solta todo atendimento preso há mais de 10 min — com "um lead por vez", um só preso parava a fila inteira
  for (const { id, desde } of emAtendimento()) {
    if (Date.now() - desde <= ATENDIMENTO_TRAVADO_MS) continue;
    soltarAtendimento(id);
    resultado.soltas++;
    registrar(id, 'revisao', 'Atendimento preso há mais de 10 min foi solto pela revisão');
    console.log(`[ia] revisão: soltou o atendimento preso da conversa #${id}`);
  }
  // 2) Equipe já falou com o lead (ex.: pelo celular com o CRM fora): a IA sai, esteja a conversa na fila ou não
  for (const c of all("SELECT * FROM ia_conversas WHERE status = 'ativa'")) {
    if (!teveContatoHumano(contatoDaConversa(c), c.ativada_em)) continue;
    atualizar(c.id, { status: 'humano', motivo: 'Equipe assumiu a conversa', proxima_em: null });
    registrar(c.id, 'humano_assumiu', 'Visto na revisão');
    resultado.equipe_assumiu++;
  }

  const diag = diagnosticar();
  Object.assign(resultado, { conversas_ativas: diag.total_ativas, ira_atender: diag.ira_atender, atendendo: diag.atendendo });
  let ordem = 0;
  for (const item of diag.lista) {
    const { _s: s, _c: c } = item;
    if (item.situacao === 'atrasada') {
      // A hora passou e ninguém atendeu: o relógio estava parado (atendimento preso, já solto acima). Chama de novo já.
      atualizar(c.id, { proxima_em: new Date(Date.now() + 3000 + ordem * 3000).toISOString() });
      registrar(c.id, 'revisao', 'Estava na fila com a hora vencida e ninguém atendeu: chamada de novo pela revisão');
      resultado.destravadas++;
      ordem++;
      resultado.pendencias.push({ ...publico(item), situacao: 'retomada' });
      continue;
    }
    if (item.situacao !== 'parada') {
      if (item.situacao === 'agendada' || item.situacao === 'atendendo_agora') resultado.na_fila++;
      if (item.situacao === 'aguardando_aprovacao') resultado.aguardando_aprovacao++;
      resultado.pendencias.push(publico(item));
      continue;
    }
    if (item.retomadas >= MAX_RETOMADAS) {
      await passarParaHumano(c, { motivo: `A IA tentou retomar ${MAX_RETOMADAS} vezes e não conseguiu responder — responda você` });
      resultado.passadas_para_equipe++;
      continue;
    }
    // Volta o ponteiro de leitura para antes das mensagens sem resposta, para a IA lê-las de novo
    const campos = { proxima_em: new Date(Date.now() + 5000 + ordem * 3000).toISOString() };
    if (s.pendentes.length) {
      const primeira = Math.min(...s.pendentes.map((m) => m.id));
      if (c.ultima_lida_id >= primeira) campos.ultima_lida_id = primeira - 1;
    }
    atualizar(c.id, campos);
    const detalhe = s.primeiraMensagem
      ? 'Primeira mensagem não tinha saído: a IA vai mandar agora'
      : `${s.pendentes.length} mensagem(ns) do lead sem resposta desde ${new Date(s.desde).toLocaleString('pt-BR')}`;
    registrar(c.id, 'retomada', `${detalhe}${origem === 'automatica' ? '' : ` (revisão pedida por ${origem})`}`);
    console.log(`[ia] revisão: retomando conversa #${c.id} (${c.chave}) — ${detalhe}`);
    emitir('ia', { conversa: c.id, chave: c.chave });
    resultado.retomadas++;
    ordem++;
    resultado.pendencias.push({ ...publico(item), situacao: 'retomada', proxima_em: campos.proxima_em, retomadas: item.retomadas + 1 });
  }
  const naFila = resultado.pendencias.filter((p) => p.proxima_em && ['agendada', 'retomada', 'atendendo_agora'].includes(p.situacao));
  resultado.proxima = naFila.map((p) => p.proxima_em).sort()[0] || null;
  resultado.motivo_espera = naFila.find((p) => p.motivo_espera)?.motivo_espera || null;
  if (resultado.retomadas || resultado.equipe_assumiu || resultado.passadas_para_equipe || resultado.soltas || resultado.destravadas) {
    emitir('ia', { revisao: true });
    // Não espera os 3 s do relógio: já chama quem ficou pronto
    verificarPendentes().catch(() => {});
  }
  ultimaRevisao = resultado;
  return resultado;
}

/** Estado para a tela: pendências de agora + resultado da última revisão */
export function estadoRevisao() {
  const d = diagnosticar();
  return {
    conversas_ativas: d.total_ativas, ira_atender: d.ira_atender, atendendo: d.atendendo, proxima: d.proxima,
    pendencias: d.lista.map(publico), ultima_revisao: ultimaRevisao,
  };
}

// ------------------------------------------------------------------ relógio

let primeira = null;
let periodica = null;

export function iniciarRevisao() {
  if (periodica) return;
  const rodar = () => revisarAtendimentos().catch((err) => console.error('[ia] revisão:', err.message));
  // Espera o WhatsApp reconectar e gravar as mensagens que chegaram com o CRM fora antes da primeira revisão
  primeira = setTimeout(rodar, PRIMEIRA_REVISAO_MS);
  periodica = setInterval(rodar, INTERVALO_REVISAO_MS);
  primeira.unref?.();
  periodica.unref?.();
}

export function pararRevisao() {
  clearTimeout(primeira);
  clearInterval(periodica);
  primeira = null;
  periodica = null;
}
