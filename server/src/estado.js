// Guarda pequenas informações de estado das integrações (conta conectada, última sincronização, erros)
import { get, run } from './db.js';
import { lerJson } from './events.js';

export function lerEstado(nome) {
  return lerJson(get('SELECT data FROM integration_state WHERE name = ?', [nome])?.data);
}

export function salvarEstado(nome, dados) {
  const atual = lerEstado(nome);
  const novo = { ...atual, ...dados };
  run(
    `INSERT INTO integration_state (name, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [nome, JSON.stringify(novo), new Date().toISOString()]
  );
  return novo;
}
