// Registro do histórico do lead (lead_events)
import { query } from './db.js';

export async function registrarEvento({ leadId, userId = null, type, data = {} }, client = null) {
  const executor = client || { query };
  await executor.query(
    'INSERT INTO lead_events (lead_id, user_id, type, data) VALUES ($1, $2, $3, $4)',
    [leadId, userId, type, JSON.stringify(data)]
  );
}
