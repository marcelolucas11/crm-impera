// Registro do histórico do lead (lead_events)
import { run } from './db.js';

export function registrarEvento({ leadId, userId = null, type, data = {} }) {
  run('INSERT INTO lead_events (lead_id, user_id, type, data) VALUES (?, ?, ?, ?)', [leadId, userId, type, JSON.stringify(data)]);
}

// Lê um campo JSON guardado como texto
export function lerJson(texto, padrao = {}) {
  if (texto === null || texto === undefined) return padrao;
  try { return JSON.parse(texto); } catch { return padrao; }
}
