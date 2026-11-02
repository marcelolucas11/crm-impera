// O que cada etapa significa para o organizador, sinais que não precisam de IA e a movimentação do lead.
// Regras de ouro: a IA nunca toca em etapas finais (Fechado/Perdido), nunca leva o lead para trás na varredura
// automática e nunca leva de novo para uma etapa de onde alguém desfez uma movimentação dela.
import { get, all, run, tx } from '../../db.js';
import { registrarEvento, lerJson } from '../../events.js';

// Marcos do funil, na ordem natural. O "qualificado" e os critérios personalizados vêm da leitura da IA.
export const PAPEIS = ['entrada', 'contato', 'qualificado', 'reuniao', 'aguardando_proposta', 'proposta'];

export function etapasAbertas() {
  return all("SELECT id, name, position, role, color FROM stages WHERE kind = 'open' ORDER BY position, id");
}

export function etapaPorPapel(papel, etapas = etapasAbertas()) {
  return etapas.find((s) => s.role === papel) || null;
}

const MIN = 60000;
// Quanto depois do início a reunião do Calendly é considerada feita, quando o evento não tem horário de fim
const DURACAO_PADRAO_MS = 60 * MIN;
// Margem depois do fim antes de mover para "Aguardando proposta"
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

/**
 * Sinais do lead que saem do banco, sem gastar IA.
 * Devolve { contato, proposta, reuniao, reuniao_feita } — cada um { motivo } ou null.
 */
export function sinaisFixos(leadId, agoraMs = Date.now()) {
  const s = { contato: null, proposta: null, reuniao: null, reuniao_feita: null };
  const nossa = get(
    `SELECT id FROM wa_messages WHERE lead_id = ? AND from_me = 1 AND type <> 'chamada' AND deleted_at IS NULL
       AND chat_jid NOT LIKE '%@g.us' LIMIT 1`, [leadId]
  );
  const lead = get('SELECT first_contact_at FROM leads WHERE id = ?', [leadId]);
  if (nossa || lead?.first_contact_at) s.contato = { motivo: 'Já houve mensagem enviada para o lead' };

  const docs = all(
    `SELECT type, media_name, media_mime, body, timestamp FROM wa_messages
      WHERE lead_id = ? AND from_me = 1 AND type = 'documento' AND deleted_at IS NULL ORDER BY timestamp`, [leadId]
  );
  const pdf = docs.find(ehPdfDeProposta);
  if (pdf) s.proposta = { motivo: `PDF enviado: ${pdf.media_name || pdf.body}` };

  let eventos = [];
  try {
    eventos = all("SELECT start_time, end_time FROM calendly_events WHERE lead_id = ? AND status = 'active' ORDER BY start_time", [leadId]);
  } catch { /* sem Calendly */ }
  if (eventos.length) s.reuniao = { motivo: 'Reunião agendada pelo Calendly' };
  const feita = eventos.find((e) => {
    const fim = e.end_time ? Date.parse(e.end_time) : Date.parse(e.start_time) + DURACAO_PADRAO_MS;
    return Number.isFinite(fim) && fim + MARGEM_REUNIAO_MS < agoraMs;
  });
  if (feita) s.reuniao_feita = { motivo: 'O horário da reunião do Calendly já passou (sem cancelamento)' };
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
  if (fixos.reuniao_feita) add(papel('aguardando_proposta'), fixos.reuniao_feita.motivo, 'regra');
  if (fixos.proposta) add(papel('proposta'), fixos.proposta.motivo, 'regra');

  if (ia) {
    const sinal = (x) => (x?.sim && String(x.trecho || '').trim() ? x : null);
    let x;
    if ((x = sinal(ia.reuniao_agendada))) add(papel('reuniao'), `IA: ${x.motivo || 'reunião combinada na conversa'}`, 'ia', x.trecho);
    if ((x = sinal(ia.reuniao_realizada))) add(papel('aguardando_proposta'), `IA: ${x.motivo || 'reunião já aconteceu'}`, 'ia', x.trecho);
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
