// Cria um banco como o da versão 0.5 (migrações 001–005) com dados de exemplo — para testar a atualização.
// Uso nos testes: criarBanco05(arquivo). Também dá para rodar direto: node testes/banco-05.js caminho/crm.db
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRACOES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function criarBanco05(arquivo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`);
  for (const f of fs.readdirSync(MIGRACOES).filter((f) => /^00[1-5]_.+\.sql$/.test(f)).sort()) {
    db.exec(fs.readFileSync(path.join(MIGRACOES, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  db.exec(`
    INSERT INTO users (id, name, email, password_hash, role) VALUES (1, 'Admin', 'admin@exemplo.com', 'x', 'admin');
    INSERT INTO wa_instances (id, name, phone) VALUES (1, 'Comercial', '5511900000000');
    INSERT INTO leads (id, name, phone, email, source, stage_id, created_at) VALUES
      (1, 'Maria Exemplo', '5511987654321', 'maria@exemplo.com', 'yayforms', 1, '2026-09-01T12:00:00.000Z'),
      (2, 'João Exemplo', '5521912345678', NULL, 'manual', 2, '2026-09-10T12:00:00.000Z'),
      (3, 'Sem WhatsApp', '5531933332222', NULL, 'calendly', 1, '2026-09-20T12:00:00.000Z');
    INSERT INTO lead_events (lead_id, type, data) VALUES (1, 'created', '{"origem":"yayforms"}'), (2, 'note', '{"texto":"ligar amanhã"}');
    INSERT INTO wa_contacts (jid, phone, lead_id, push_name, name) VALUES
      ('5511987654321@s.whatsapp.net', '5511987654321', 1, 'Maria', 'Maria Agenda'),
      ('5521912345678@s.whatsapp.net', '5521912345678', NULL, 'João', NULL),
      ('5541900001111@s.whatsapp.net', '5541900001111', NULL, 'Desconhecido', NULL);
    INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, status, read_at) VALUES
      (1, 1, '5511987654321@s.whatsapp.net', 'M1', 0, 'texto', 'Oi, vi o anúncio', '2026-09-01T12:05:00.000Z', NULL, '2026-09-01T12:06:00.000Z'),
      (1, 1, '5511987654321@s.whatsapp.net', 'M2', 1, 'texto', 'Olá Maria!', '2026-09-01T12:07:00.000Z', 4, NULL),
      (1, NULL, '5521912345678@s.whatsapp.net', 'M3', 0, 'texto', 'Bom dia', '2026-09-11T09:00:00.000Z', NULL, NULL),
      (1, NULL, '5541900001111@s.whatsapp.net', 'M4', 0, 'imagem', '📷 Foto', '2026-09-12T09:00:00.000Z', NULL, NULL);
    INSERT INTO wa_photos (jid, path, checked_at) VALUES ('5511987654321@s.whatsapp.net', NULL, '2026-10-01T00:00:00.000Z');
    INSERT INTO integration_state (name, data) VALUES ('calendly', '{"ultima":"2026-10-01"}');
  `);
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  criarBanco05(path.resolve(process.argv[2] || 'crm-05.db'));
  console.log('Banco 0.5 de exemplo criado.');
}
