// O que cada etapa significa para o organizador, sinais que não precisam de IA e a movimentação do lead.
// Regras de ouro: a IA nunca toca em etapas finais (Fechado/Perdido), nunca leva o lead para trás na varredura
// automática e nunca leva de novo para uma etapa de onde alguém desfez uma movimentação dela.
import { get, all, run, tx } from '../../db.js';
import { registrarEvento, lerJson } from '../../events.js';

// Marcos do funil, na ordem natural. O "qualificado" e os critérios personalizados vêm da leitura da IA.
// no_show: botão "Não compareceu", arrastar para a coluna ou automático quando a reunião passa sem prova
// (link do Google Meet ou ligação atendida no WhatsApp). A IA nunca marca no-show pela leitura da conversa.
export const PAPEIS = ['entrada', 'contato', 'qualificado', 'reuniao', 'no_show', 'aguardando_proposta', 'proposta'];

export function etapasAbertas() {
  return all("SELECT id, name, position, role, color FROM stages WHERE kind = 'open' ORDER BY position, id");
}

export function etapaPorPapel(papel, etapas = etapasAbertas()) {
  return etapas.find((s) => s.role === papel) || null;
}

const MIN = 60000;
// Quanto depois do início a reunião do Calendly é considerada feita, quando o evento não tem horário de fim
const DURACAO_PADRAO_MS = 60 * MIN;
// Margem depois do fim da reunião antes de marcar no-show (sem prova)
const MARGEM_REUNIAO_MS = 15 * MIN;

// Nome do arquivo sem acento, minúsculo e com separadores virando espaço
export function normalizarNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9]+/, '')
    .trim();
}

/** PDF de proposta: documento PDF cujo nome começa com "Proposta comercial" (qualquer outro PDF é ignorado) */
export function ehPdfDeProposta({ type, media_name, media_mime, body }) {
  const nome = media_name || (type === 'documento' ? body : '') || '';
  const pdf = /pdf/i.test(media_mime || '') || /\.pdf\s*$/i.test(nome);
  return type === 'documento' && pdf && normalizarNome(nome).startsWith('proposta comercial');
}

// Prova de que a reunião aconteceu de verdade: link do Google Meet na conversa do lead ou ligação ATENDIDA no WhatsApp
// (chamada perdida, recusada ou não atendida não conta). Sem prova, o horário da reunião passar = no-show.
const LINK_MEET = '%meet.google.com/%';
const CHAMADA_ATENDIDA = new Set(['atendida', 'atendida_em_outro_aparelho']);
// A prova vale a partir de 2 h antes do início da reunião (link mandado um pouco antes, ligação adiantada)
export const ANTES_DA_REUNIAO_MS = 2 * 60 * MIN;

export function fimDaReuniao(e) {
  return e.end_time ? Date.parse(e.end_time) : Date.parse(e.start_time) + DURACAO_PADRAO_MS;
}
export const MARGEM_NO_SHOW_MS = MARGEM_REUNIAO_MS;

/** Link do Meet ou ligação atendida com o lead (conversa individual) a partir de `desde` (ISO). Devolve { motivo, quando } ou null. */
export function provaDeReuniao(leadId, desde = null) {
  const filtro = desde ? ' AND timestamp >= ?' : '';
  const base = `FROM wa_messages WHERE lead_id = ? AND deleted_at IS NULL AND chat_jid NOT LIKE '%@g.us'${filtro}`;
  const params = desde ? [leadId, desde] : [leadId];
  // O link que vai no lembrete automático da reunião (Alice) não prova nada: ele sai antes de a reunião acontecer
  const link = get(
    `SELECT timestamp ${base} AND type <> 'chamada'
       AND COALESCE(CASE WHEN json_valid(extra) THEN json_extract(extra, '$.origem') END, '') <> 'lembrete'
       AND (lower(COALESCE(body, '')) LIKE ? OR lower(COALESCE(legenda, '')) LIKE ?) ORDER BY timestamp LIMIT 1`,
    [...params, LINK_MEET, LINK_MEET]
  );
  const chamadas = all(`SELECT timestamp, extra ${base} AND type = 'chamada' ORDER BY timestamp`, params);
  const atendida = chamadas.find((c) => CHAMADA_ATENDIDA.has(lerJson(c.extra, {})?.resultado));
  const provas = [];
  if (link) provas.push({ motivo: 'Link do Google Meet enviado na conversa', quando: link.timestamp });
  if (atendida) {
    const d = Number(lerJson(atendida.extra, {})?.duracao) || 0;
    provas.push({ motivo: `Ligação atendida no WhatsApp${d ? ` (${Math.max(1, Math.round(d / 60))} min)` : ''}`, quando: atendida.timestamp });
  }
  return provas.sort((a, b) => a.quando.localeCompare(b.quando))[0] || null;
}

/**
 * A partir de quando uma prova conta para este lead:
 *  - em no-show marcado à mão: só o que veio depois de marcar (o link mandado antes da reunião perdida não tira do no-show);
 *  - no-show automático: desde 2 h antes da reunião perdida (ligação longa que só é registrada quando termina);
 *  - lead arrastado para a coluna No-show: desde que entrou nela;
 *  - reunião do Calendly marcada: desde 2 h antes da reunião (ligação ou link de antes do agendamento não contam).
 */
export function corteDaProva(leadId, lead = null) {
  lead = lead || get('SELECT l.noshow_since, l.stage_changed_at, s.role FROM leads l LEFT JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [leadId]);
  if (!lead) return null;
  if (lead.noshow_since) {
    const ev = get("SELECT data FROM lead_events WHERE lead_id = ? AND type = 'no_show_on' ORDER BY id DESC LIMIT 1", [leadId]);
    const d = lerJson(ev?.data, {}) || {};
    if (d.auto && d.inicio && Number.isFinite(Date.parse(d.inicio))) return new Date(Date.parse(d.inicio) - ANTES_DA_REUNIAO_MS).toISOString();
    return lead.noshow_since;
  }
  if (lead.role === 'no_show') return lead.stage_changed_at || new Date().toISOString();
  let r = null;
  try {
    r = get("SELECT min(start_time) AS t FROM calendly_events WHERE lead_id = ? AND status = 'active' AND no_show = 0", [leadId]);
  } catch { /* sem Calendly */ }
  return r?.t && Number.isFinite(Date.parse(r.t)) ? new Date(Date.parse(r.t) - ANTES_DA_REUNIAO_MS).toISOString() : null;
}

/**
 * Sinais do lead que saem do banco, sem gastar IA.
 * Devolve { contato, proposta, reuniao, reuniao_feita, no_show, prova } — cada um { motivo } ou null.
 *  reuniao_feita só existe com prova (link do Meet ou ligação atendida) E reunião marcada (Calendly, coluna de reunião
 *  ou no-show). prova sozinha (sem reunião marcada) só conta se a IA também ler que houve reunião combinada.
 */
export function sinaisFixos(leadId) {
  const s = { contato: null, proposta: null, reuniao: null, reuniao_feita: null, no_show: null, prova: null };
  const nossa = get(
    `SELECT id FROM wa_messages WHERE lead_id = ? AND from_me = 1 AND type <> 'chamada' AND deleted_at IS NULL
       AND chat_jid NOT LIKE '%@g.us' LIMIT 1`, [leadId]
  );
  const lead = get(
    'SELECT l.first_contact_at, l.noshow_since, l.stage_changed_at, s.role FROM leads l LEFT JOIN stages s ON s.id = l.stage_id WHERE l.id = ?',
    [leadId]
  );
  if (nossa || lead?.first_contact_at) s.contato = { motivo: 'Já houve mensagem enviada para o lead' };
  if (lead?.noshow_since) s.no_show = { motivo: 'Marcado como no-show: não compareceu à reunião' };

  const docs = all(
    `SELECT type, media_name, media_mime, body, timestamp FROM wa_messages
      WHERE lead_id = ? AND from_me = 1 AND type = 'documento' AND deleted_at IS NULL ORDER BY timestamp`, [leadId]
  );
  const pdf = docs.find(ehPdfDeProposta);
  if (pdf) s.proposta = { motivo: `PDF enviado: ${pdf.media_name || pdf.body}` };

  let eventos = [];
  try {
    eventos = all("SELECT start_time, end_time, no_show FROM calendly_events WHERE lead_id = ? AND status = 'active' ORDER BY start_time", [leadId]);
  } catch { /* sem Calendly */ }
  if (eventos.length) s.reuniao = { motivo: 'Reunião agendada pelo Calendly' };

  // Reunião feita = prova de verdade (Meet ou ligação atendida). O horário do Calendly passar sozinho não conta mais.
  const prova = lead ? provaDeReuniao(leadId, corteDaProva(leadId, lead)) : null;
  if (prova) {
    const temReuniao = eventos.length > 0 || Boolean(lead.noshow_since) || ['reuniao', 'no_show'].includes(lead.role);
    if (temReuniao) s.reuniao_feita = { motivo: prova.motivo };
    else s.prova = { motivo: prova.motivo };
  }
  return s;
}

/**
 * Junta sinais fixos e a leitura da IA e escolhe a etapa mais avançada que o lead já alcançou.
 *  ia: resultado da avaliação (ou null) — { reuniao_agendada, reuniao_realizada, proposta_escrita, criterios: [{ id, atende }] }
 *  criterios: config.criterios
 * Devolve [{ etapa, motivo, trecho, origem }] ordenado da mais avançada para a menos.
 */
export function marcosAlcancados({ fixos, ia, criterios, etapas = etapasAbertas() }) {
  const marcos = [];
  const add = (etapa, motivo, origem, trecho = null) => { if (etapa) marcos.push({ etapa, motivo, origem, trecho }); };
  const papel = (p) => etapaPorPapel(p, etapas);

  if (fixos.contato) add(papel('contato'), fixos.contato.motivo, 'regra');
  if (fixos.reuniao) add(papel('reuniao'), fixos.reuniao.motivo, 'regra');
  if (fixos.no_show) add(papel('no_show'), fixos.no_show.motivo, 'regra');
  if (fixos.reuniao_feita) add(papel('aguardando_proposta'), fixos.reuniao_feita.motivo, 'regra');
  if (fixos.proposta) add(papel('proposta'), fixos.proposta.motivo, 'regra');

  if (ia) {
    const sinal = (x) => (x?.sim && String(x.trecho || '').trim() ? x : null);
    let x;
    if ((x = sinal(ia.reuniao_agendada))) add(papel('reuniao'), `IA: ${x.motivo || 'reunião combinada na conversa'}`, 'ia', x.trecho);
    // A IA sozinha não leva para "Aguardando proposta": precisa de prova (link do Meet ou ligação atendida).
    // Ela só serve para dizer que houve reunião combinada fora do Calendly, quando a prova veio sem reunião marcada.
    if (fixos.prova && !fixos.reuniao_feita && (sinal(ia.reuniao_agendada) || sinal(ia.reuniao_realizada))) {
      add(papel('aguardando_proposta'), fixos.prova.motivo, 'regra');
    }
    if ((x = sinal(ia.proposta_escrita))) add(papel('proposta'), `IA: ${x.motivo || 'proposta enviada por escrito'}`, 'ia', x.trecho);
    for (const r of ia.criterios || []) {
      if (!r?.atende || !String(r.trecho || '').trim()) continue;
      const c = criterios.find((k) => k.id === r.id && k.ativo !== false);
      if (!c) continue;
      const etapa = c.papel ? papel(c.papel) : etapas.find((s) => s.id === c.etapa_id);
      add(etapa, `IA: ${c.titulo}${r.motivo ? ` — ${r.motivo}` : ''}`, 'ia', r.trecho);
    }
  }
  return marcos.sort((a, b) => b.etapa.position - a.etapa.position || b.etapa.id - a.etapa.id);
}

export function vetosDoLead(texto) {
  const v = lerJson(texto, []);
  return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
}

/**
 * Decide para onde o lead vai.
 *  modo 'varredura': só avança (nunca volta) e respeita os vetos.
 *  modo 'organizar': escolhe a etapa certa mesmo que seja anterior (a prévia mostra e você decide); sem marcos → etapa de entrada.
 * Devolve { etapa, motivo, trecho, origem, direcao } ou null (fica onde está).
 */
export function decidirDestino({ lead, marcos, modo = 'varredura', etapas = etapasAbertas() }) {
  const atual = etapas.find((s) => s.id === lead.stage_id);
  if (!atual) return null; // etapa final (ganho/perdido) ou inexistente: a IA não mexe
  const vetos = vetosDoLead(lead.ia_vetos);
  const validos = marcos.filter((m) => !vetos.includes(m.etapa.id));
  let alvo = validos[0] || null;
  if (modo === 'organizar' && !alvo) {
    const entrada = etapaPorPapel('entrada', etapas) || etapas[0];
    if (entrada) alvo = { etapa: entrada, motivo: 'Nada na conversa indica avanço no funil', origem: 'ia', trecho: null };
  }
  if (!alvo || alvo.etapa.id === atual.id) return null;
  const direcao = alvo.etapa.position > atual.position ? 'avanca' : 'volta';
  if (modo !== 'organizar' && direcao === 'volta') return null;
  return { ...alvo, direcao, de: atual };
}

/** Move o lead e registra no histórico e no registro do organizador. Devolve o id da movimentação ou null. */
export function moverLead({ leadId, destino, modo = 'varredura' }) {
  return tx(() => {
    const lead = get('SELECT l.stage_id, s.name, s.kind FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [leadId]);
    if (!lead || lead.kind !== 'open' || lead.stage_id === destino.etapa.id) return null;
    const alvo = get("SELECT id, name, kind FROM stages WHERE id = ?", [destino.etapa.id]);
    if (!alvo || alvo.kind !== 'open') return null;
    const agora = new Date().toISOString();
    run('UPDATE leads SET stage_id = ?, stage_changed_at = ?, updated_at = ? WHERE id = ?', [alvo.id, agora, agora, leadId]);
    const motivo = String(destino.motivo || '').slice(0, 300);
    registrarEvento({ leadId, type: 'stage_changed', data: { de: lead.name, para: alvo.name, motivo: `organizador: ${motivo}`, por: 'ia' } });
    const r = run(
      `INSERT INTO organizador_movimentos (lead_id, de_stage_id, para_stage_id, de_nome, para_nome, origem, modo, motivo, trecho)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [leadId, lead.stage_id, alvo.id, lead.name, alvo.name, destino.origem || 'ia', modo, motivo, destino.trecho ? String(destino.trecho).slice(0, 400) : null]
    );
    return Number(r.lastInsertRowid);
  });
}

/** Desfaz uma movimentação: volta o lead e proíbe a IA de levá-lo de novo para aquela etapa */
export function desfazerMovimento(movId, userId) {
  return tx(() => {
    const m = get('SELECT * FROM organizador_movimentos WHERE id = ?', [movId]);
    if (!m) return { erro: 'Movimentação não encontrada' };
    if (m.desfeito_em) return { erro: 'Esta movimentação já foi desfeita' };
    const lead = get('SELECT stage_id, ia_vetos FROM leads WHERE id = ?', [m.lead_id]);
    if (!lead) return { erro: 'O lead não existe mais' };
    if (lead.stage_id !== m.para_stage_id) return { erro: 'O lead já mudou de etapa depois disso — mova à mão se precisar' };
    const volta = m.de_stage_id ? get('SELECT id, name FROM stages WHERE id = ?', [m.de_stage_id]) : null;
    if (!volta) return { erro: 'A etapa anterior não existe mais' };
    const agora = new Date().toISOString();
    const vetos = [...new Set([...vetosDoLead(lead.ia_vetos), m.para_stage_id])];
    run('UPDATE leads SET stage_id = ?, stage_changed_at = ?, updated_at = ?, ia_vetos = ? WHERE id = ?', [volta.id, agora, agora, JSON.stringify(vetos), m.lead_id]);
    registrarEvento({ leadId: m.lead_id, userId, type: 'stage_changed', data: { de: m.para_nome, para: volta.name, motivo: 'desfez a movimentação do organizador' } });
    run('UPDATE organizador_movimentos SET desfeito_em = ?, desfeito_por = ? WHERE id = ?', [agora, userId, movId]);
    return { ok: true, lead_id: m.lead_id };
  });
}
