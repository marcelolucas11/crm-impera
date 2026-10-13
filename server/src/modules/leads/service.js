// Regras de negócio dos leads, reaproveitadas por outros módulos (ex.: Yay! Forms, WhatsApp)
import { get, all, run } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento, lerJson } from '../../events.js';
import { variantesTelefone } from '../../util.js';
import { ligarConversasDoLead } from '../whatsapp/ligacao.js';

// 1º parâmetro (?) = horas de follow-up. Calcula a última atividade e se o lead está atrasado.
export const BASE_LEADS = `
  SELECT
    l.id, l.name, l.phone, l.email, l.company, l.source, l.stage_id, l.owner_id, l.notes, l.extra,
    l.last_contact_at, l.first_contact_at, l.stage_changed_at, l.created_at, l.updated_at, l.form_started_at,
    l.waiting_since, l.waiting_note, wu.name AS waiting_by_name,
    l.closing_since, l.closing_note, cu.name AS closing_by_name,
    json_extract(l.extra, '$.formulario') AS form_name,
    json_extract(l.extra, '$.respostas') AS form_answers,
    json_extract(l.extra, '$.parcial') AS form_partial,
    (SELECT m.timestamp FROM wa_messages m WHERE m.lead_id = l.id ORDER BY m.timestamp DESC LIMIT 1) AS last_msg_at,
    (SELECT m.from_me FROM wa_messages m WHERE m.lead_id = l.id ORDER BY m.timestamp DESC LIMIT 1) AS last_msg_from_me,
    l.notif_cleared_at,
    (SELECT max(m.timestamp) FROM wa_messages m WHERE m.lead_id = l.id AND m.from_me = 0 AND m.type <> 'chamada') AS last_in_at,
    (SELECT max(m.timestamp) FROM wa_messages m WHERE m.lead_id = l.id AND m.from_me = 1 AND m.type <> 'chamada') AS last_out_at,
    s.name AS stage_name, s.kind AS stage_kind,
    u.name AS owner_name,
    COALESCE(l.last_contact_at, l.created_at) AS last_activity_at,
    (s.kind = 'open'
      AND (julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?) AS followup_overdue,
    (SELECT count(*) FROM wa_messages m WHERE m.lead_id = l.id AND m.from_me = 0 AND m.read_at IS NULL) AS unread_count,
    (SELECT min(c.start_time) FROM calendly_events c
      WHERE c.lead_id = l.id AND c.status = 'active' AND c.start_time > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS next_meeting_at
  FROM leads l
  JOIN stages s ON s.id = l.stage_id
  LEFT JOIN users u ON u.id = l.owner_id
  LEFT JOIN users wu ON wu.id = l.waiting_by
  LEFT JOIN users cu ON cu.id = l.closing_by`;

// Notificação do cartão: o lead mandou mensagem depois da nossa última resposta
// e depois da última vez que alguém limpou o aviso à mão. Responder pelo WhatsApp apaga sozinho.
export function semResposta(row) {
  const entrada = row.last_in_at;
  if (!entrada) return false;
  if (row.last_out_at && row.last_out_at >= entrada) return false;
  if (row.notif_cleared_at && row.notif_cleared_at >= entrada) return false;
  return true;
}

// Ajusta tipos vindos do SQLite (0/1 → booleano, texto JSON → objeto)
export function mapearLead(row, { comExtra = false } = {}) {
  if (!row) return null;
  const { extra, form_answers, ...resto } = row;
  const respostas = lerJson(form_answers);
  const lead = {
    ...resto,
    followup_overdue: Boolean(row.followup_overdue),
    last_msg_from_me: row.last_msg_from_me == null ? null : Boolean(row.last_msg_from_me),
    sem_resposta: semResposta(row),
    form_partial: Boolean(row.form_partial),
    respostas: Array.isArray(respostas) ? respostas.map((r) => ({ pergunta: r.pergunta, resposta: r.resposta })) : [],
  };
  if (comExtra) lead.extra = lerJson(extra);
  return lead;
}

export function buscarLead(id) {
  return mapearLead(get(`${BASE_LEADS} WHERE l.id = ?`, [config.followupHours, id]), { comExtra: true });
}

export function listarLeads(filtros, valores) {
  return all(
    `SELECT * FROM (${BASE_LEADS}) AS b
     ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
     ORDER BY (waiting_since IS NOT NULL) DESC,
              CASE WHEN waiting_since IS NOT NULL THEN waiting_since END ASC,
              followup_overdue DESC,
              CASE WHEN followup_overdue THEN last_activity_at END ASC,
              created_at DESC
     LIMIT 2000`,
    [config.followupHours, ...valores]
  ).map((r) => mapearLead(r));
}

// Etapa onde os leads novos entram (marcada como "entrada" no editor de etapas)
export function primeiraEtapa() {
  return (
    get("SELECT id FROM stages WHERE role = 'entrada' AND kind = 'open' LIMIT 1")?.id ||
    get("SELECT id FROM stages WHERE kind = 'open' ORDER BY position, id LIMIT 1")?.id
  );
}

// Registra um contato com o lead (zera o follow-up e guarda o primeiro contato para as estatísticas)
export function registrarContatoLead(leadId, horario = new Date().toISOString()) {
  run(
    `UPDATE leads SET
       last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END,
       first_contact_at = CASE WHEN first_contact_at IS NULL OR first_contact_at > ? THEN ? ELSE first_contact_at END,
       updated_at = ?
     WHERE id = ?`,
    [horario, horario, horario, horario, new Date().toISOString(), leadId]
  );
}

// Liga ao lead as conversas de WhatsApp que já existiam com o mesmo telefone (com e sem o 9º dígito)
export function vincularConversasExistentes(leadId, phone) {
  return ligarConversasDoLead(leadId, phone);
}

// Procura um lead existente pelo telefone (com e sem o 9º dígito) ou e-mail (evita duplicados)
export function encontrarExistente({ phone, email }) {
  const telefones = variantesTelefone(phone);
  const condicoes = [];
  const valores = [];
  if (telefones.length) {
    condicoes.push(`phone IN (${telefones.map(() => '?').join(', ')})`);
    valores.push(...telefones);
  }
  if (email) {
    condicoes.push('lower(email) = ?');
    valores.push(String(email).toLowerCase());
  }
  if (!condicoes.length) return null;
  const r = get(`SELECT id FROM leads WHERE ${condicoes.join(' OR ')} ORDER BY created_at DESC LIMIT 1`, valores);
  return r?.id || null;
}

// Move o lead para a etapa indicada só se ele ainda estiver numa etapa anterior (nunca volta)
export function avancarEtapa(leadId, etapaId, userId = null) {
  const lead = get('SELECT l.stage_id, s.position, s.kind, s.name FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [leadId]);
  const alvo = get('SELECT id, position, name FROM stages WHERE id = ?', [etapaId]);
  if (!lead || !alvo || lead.kind !== 'open' || lead.position >= alvo.position) return false;
  const agoraIso = new Date().toISOString();
  run('UPDATE leads SET stage_id = ?, stage_changed_at = ?, updated_at = ? WHERE id = ?', [alvo.id, agoraIso, agoraIso, leadId]);
  registrarEvento({ leadId, userId, type: 'stage_changed', data: { de: lead.name, para: alvo.name } });
  return true;
}

export function criarLead(dados, { userId = null } = {}) {
  const stageId = dados.stage_id || primeiraEtapa();
  const { lastInsertRowid } = run(
    `INSERT INTO leads (name, phone, email, company, source, stage_id, owner_id, notes, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.name || null,
      dados.phone || null,
      dados.email || null,
      dados.company || null,
      dados.source || 'manual',
      stageId,
      dados.owner_id || null,
      dados.notes || null,
      JSON.stringify(dados.extra || {}),
    ]
  );
  const id = Number(lastInsertRowid);
  registrarEvento({ leadId: id, userId, type: 'created', data: { origem: dados.source || 'manual' } });
  if (dados.phone) vincularConversasExistentes(id, dados.phone);
  return id;
}
