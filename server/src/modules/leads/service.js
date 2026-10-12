// Regras de negócio dos leads, reaproveitadas por outros módulos (ex.: Yay! Forms, WhatsApp)
import { query } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento } from '../../events.js';

// $1 = horas de follow-up. Calcula a última atividade e se o lead está atrasado.
export const BASE_LEADS = `
  SELECT
    l.id, l.name, l.phone, l.email, l.company, l.source, l.stage_id, l.owner_id, l.notes,
    l.last_contact_at, l.stage_changed_at, l.created_at, l.updated_at,
    l.extra->>'formulario' AS form_name,
    s.name AS stage_name, s.kind AS stage_kind,
    u.name AS owner_name,
    COALESCE(l.last_contact_at, l.created_at) AS last_activity_at,
    (s.kind = 'open'
      AND COALESCE(l.last_contact_at, l.created_at) < now() - ($1::numeric * interval '1 hour')) AS followup_overdue
  FROM leads l
  JOIN stages s ON s.id = l.stage_id
  LEFT JOIN users u ON u.id = l.owner_id`;

export async function buscarLead(id, executor = { query }) {
  const { rows } = await executor.query(
    `SELECT b.*, l.extra FROM (${BASE_LEADS} WHERE l.id = $2) b JOIN leads l ON l.id = b.id`,
    [config.followupHours, id]
  );
  return rows[0] || null;
}

export async function primeiraEtapa(executor = { query }) {
  const { rows } = await executor.query(
    "SELECT id FROM stages WHERE kind = 'open' ORDER BY position, id LIMIT 1"
  );
  return rows[0]?.id;
}

// Procura um lead existente pelo telefone ou e-mail (evita duplicados)
export async function encontrarExistente({ phone, email }, executor = { query }) {
  if (!phone && !email) return null;
  const { rows } = await executor.query(
    `SELECT id FROM leads
      WHERE ($1::text IS NOT NULL AND phone = $1)
         OR ($2::text IS NOT NULL AND lower(email) = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [phone || null, email || null]
  );
  return rows[0]?.id || null;
}

export async function criarLead(dados, { userId = null, executor = { query } } = {}) {
  const stageId = dados.stage_id || (await primeiraEtapa(executor));
  const { rows } = await executor.query(
    `INSERT INTO leads (name, phone, email, company, source, stage_id, owner_id, notes, extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
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
  const id = rows[0].id;
  await registrarEvento({ leadId: id, userId, type: 'created', data: { origem: dados.source || 'manual' } }, executor);
  return id;
}
