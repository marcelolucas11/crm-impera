import { PASTA } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { criarBanco05 } from './banco-05.js';

test('banco da versão 0.5: as migrações novas rodam sem perder nada', async () => {
  criarBanco05(path.join(PASTA, 'crm.db'));
  const db = await import('../src/db.js');
  const { aplicarMigracoes } = await import('../src/migrar.js');
  db.abrirBanco();
  const contar = (t) => db.get(`SELECT count(*) n FROM ${t}`).n;
  const antes = Object.fromEntries(['users', 'leads', 'lead_events', 'wa_contacts', 'wa_messages', 'wa_photos', 'integration_state', 'stages'].map((t) => [t, contar(t)]));
  const log = console.log;
  console.log = () => {};
  const { MIGRACOES } = await import('./ajuda.js');
  try { aplicarMigracoes(MIGRACOES); } finally { console.log = log; }
  for (const [t, n] of Object.entries(antes)) assert.equal(contar(t), n, `tabela ${t} perdeu linhas`);
  assert.ok(db.get("SELECT 1 AS ok FROM schema_migrations WHERE name = '006_whatsapp_web.sql'"));
  // Dados antigos intactos
  assert.equal(db.get("SELECT body FROM wa_messages WHERE wa_id = 'M2'").body, 'Olá Maria!');
  assert.equal(db.get("SELECT status FROM wa_messages WHERE wa_id = 'M2'").status, 4);
  // Colunas e tabelas novas existem
  assert.equal(db.get("SELECT starred_at FROM wa_messages WHERE wa_id = 'M1'").starred_at, null);
  assert.equal(contar('wa_chats'), 0);
  assert.equal(contar('wa_stickers'), 0);

  // Religar tudo na subida: a conversa do João (lead 2, sem ligação) passa a ser dele
  const { religarTudo } = await import('../src/modules/whatsapp/ligacao.js');
  assert.equal(religarTudo(), 1);
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE wa_id = 'M3'").lead_id, 2);
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE wa_id = 'M4'").lead_id, null);

  // A lista de conversas funciona com o banco antigo
  const { listarConversas } = await import('../src/modules/whatsapp/conversas.js');
  const { conversas } = listarConversas();
  assert.equal(conversas.length, 3);
  assert.deepEqual(conversas.map((c) => c.chave).sort(), ['l:1', 'l:2', 't:5541900001111']);
});
