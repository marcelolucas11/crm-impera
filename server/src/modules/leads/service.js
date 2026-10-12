// Regras de negócio dos leads, reaproveitadas por outros módulos (ex.: Yay! Forms, WhatsApp)
import { get, all, run } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento, lerJson } from '../../events.js';

// 1º parâmetro (?) = horas de follow-up. Calcula a última atividade e se o lead está atrasado.
export const BASE_LEADS = `
  SELECT
    l.id, l.name, l.phone, l.email, l.company, l.source, l.stage_id, l.owner_id, l.notes, l.extra,
    l.last_contact_at, l.stage_changed_at, l.created_at, l.updated_at,
    json_extract(l.extra, '$.formulario') AS form_name,
    s.name AS stage_name, s.kind AS stage_kind,
    u.name AS owner_name,
    COALESCE(l.last_contact_at, l.created_at) AS last_activity_at,
    (s.kind = 'open'
      AND (julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?) AS followup_overdue
  FROM leads l
  JOIN stages s ON s.id = l.stage_id
  LEFT JOIN users u ON u.id = l.owner_id`;

// Ajusta tipos vindos do SQLite (0/1 → booleano, texto JSON → objeto)
export function mapearLead(row, { comExtra = false } = {}) {
  if (!row) return null;
  const { extra, ...resto } = row;
  const lead = { ...resto, followup_overdue: Boolean(row.followup_overdue) };
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
     ORDER BY followup_overdue DESC,
              CASE WHEN followup_overdue THEN last_activity_at END ASC,
              created_at DESC
     LIMIT 2000`,
    [config.followupHours, ...valores]
  ).map((r) => mapearLead(r));
}

export function primeiraEtapa() {
  return get("SELECT id FROM stages WHERE kind = 'open' ORDER BY position, id LIMIT 1")?.id;
}

// Procura um lead existente pelo telefone ou e-mail (evita duplicados)
export function encontrarExistente({ phone, email }) {
  if (!phone && !email) return null;
  const r = get(
    `SELECT id FROM leads
      WHERE (? IS NOT NULL AND phone = ?)
         OR (? IS NOT NULL AND lower(email) = ?)
      ORDER BY created_at DESC LIMIT 1`,
    [phone || null, phone || null, email || null, email || null]
  );
  return r?.id || null;
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
  return id;
}
