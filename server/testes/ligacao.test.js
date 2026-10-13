import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db;
let lig;
before(async () => {
  db = await prepararBanco();
  lig = await import('../src/modules/whatsapp/ligacao.js');
});
beforeEach(limparBanco);

const msg = (jid, deMim, ts, waId) =>
  db.run('INSERT INTO wa_messages (chat_jid, wa_id, from_me, type, body, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [jid, waId, deMim ? 1 : 0, 'texto', 'oi', ts]);


test('religarTudo liga conversas soltas ao lead (9º dígito) e atualiza o último contato', async () => {
  const leadId = await criarLeadDireto({ nome: 'Ana', telefone: '5511987654321' });
  // Conta antiga do WhatsApp, sem o 9
  db.run("INSERT INTO wa_contacts (jid, phone) VALUES ('551187654321@s.whatsapp.net', '551187654321')");
  msg('551187654321@s.whatsapp.net', false, '2026-09-01T10:00:00.000Z', 'A1');
  msg('551187654321@s.whatsapp.net', true, '2026-09-02T10:00:00.000Z', 'A2');
  const ligados = lig.religarTudo();
  assert.equal(ligados, 1);
  assert.equal(db.get("SELECT lead_id FROM wa_contacts WHERE jid = '551187654321@s.whatsapp.net'").lead_id, leadId);
  assert.equal(db.get("SELECT count(*) n FROM wa_messages WHERE lead_id = ?", [leadId]).n, 2);
  const l = db.get('SELECT last_contact_at, first_contact_at FROM leads WHERE id = ?', [leadId]);
  assert.equal(l.last_contact_at, '2026-09-02T10:00:00.000Z');
  // Idempotente: rodar de novo não muda nada
  assert.equal(lig.religarTudo(), 0);
});

test('último contato só avança (histórico antigo não volta a data)', async () => {
  const leadId = await criarLeadDireto({ nome: 'Bia', telefone: '5521999990000' });
  db.run("UPDATE leads SET last_contact_at = '2026-10-10T00:00:00.000Z' WHERE id = ?", [leadId]);
  db.run("INSERT INTO wa_contacts (jid, phone) VALUES ('5521999990000@s.whatsapp.net', '5521999990000')");
  msg('5521999990000@s.whatsapp.net', true, '2026-08-01T00:00:00.000Z', 'B1');
  lig.religarTudo();
  assert.equal(db.get('SELECT last_contact_at FROM leads WHERE id = ?', [leadId]).last_contact_at, '2026-10-10T00:00:00.000Z');
});

test('dois leads com o mesmo telefone: liga ao mais recente e registra no histórico, sem apagar ninguém', async () => {
  const antigo = await criarLeadDireto({ nome: 'Antigo', telefone: '5531988887777', criadoEm: '2026-01-01T00:00:00.000Z' });
  const novo = await criarLeadDireto({ nome: 'Novo', telefone: '553188887777', criadoEm: '2026-06-01T00:00:00.000Z' });
  db.run("INSERT INTO wa_contacts (jid, phone) VALUES ('5531988887777@s.whatsapp.net', '5531988887777')");
  msg('5531988887777@s.whatsapp.net', false, '2026-09-01T00:00:00.000Z', 'C1');
  lig.religarTudo();
  assert.equal(db.get("SELECT lead_id FROM wa_contacts WHERE jid = '5531988887777@s.whatsapp.net'").lead_id, novo);
  const ev = db.all("SELECT data FROM lead_events WHERE lead_id = ? AND type = 'whatsapp_duplicado'", [novo]);
  assert.equal(ev.length, 1);
  assert.deepEqual(JSON.parse(ev[0].data).outros, [antigo]);
  assert.equal(db.get('SELECT count(*) n FROM leads').n, 2);
  // Registra uma vez só
  lig.religarTudo();
  db.run("INSERT INTO wa_contacts (jid, phone) VALUES ('553188887777@s.whatsapp.net', '553188887777')");
  lig.religarTudo();
  assert.equal(db.all("SELECT 1 FROM lead_events WHERE lead_id = ? AND type = 'whatsapp_duplicado'", [novo]).length, 1);
});

test('grupos nunca são ligados a lead', async () => {
  await criarLeadDireto({ nome: 'G', telefone: '5511911112222' });
  db.run("INSERT INTO wa_contacts (jid, phone) VALUES ('120363000000000001@g.us', '5511911112222')");
  msg('120363000000000001@g.us', false, '2026-09-01T00:00:00.000Z', 'G1');
  lig.religarTudo();
  assert.equal(db.get("SELECT lead_id FROM wa_contacts WHERE jid = '120363000000000001@g.us'").lead_id, null);
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE wa_id = 'G1'").lead_id, null);
  assert.equal(lig.vincularConversa({ chatJid: '120363000000000001@g.us', phone: '5511911112222' }), null);
});

test('conversa por LID é ligada quando o telefone é conhecido', async () => {
  const leadId = await criarLeadDireto({ nome: 'Lid', telefone: '5541977776666' });
  db.run("INSERT INTO wa_contacts (jid, phone) VALUES ('123456789@lid', '5541977776666')");
  msg('123456789@lid', false, '2026-09-01T00:00:00.000Z', 'L1');
  lig.religarTudo();
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE wa_id = 'L1'").lead_id, leadId);
});

test('conversa já ligada não troca de lead sozinha', async () => {
  const a = await criarLeadDireto({ nome: 'A', telefone: '5511955554444', criadoEm: '2026-01-01T00:00:00.000Z' });
  db.run("INSERT INTO wa_contacts (jid, phone, lead_id) VALUES ('5511955554444@s.whatsapp.net', '5511955554444', ?)", [a]);
  await criarLeadDireto({ nome: 'B', telefone: '5511955554444', criadoEm: '2026-05-01T00:00:00.000Z' });
  lig.religarTudo();
  assert.equal(db.get("SELECT lead_id FROM wa_contacts WHERE jid = '5511955554444@s.whatsapp.net'").lead_id, a);
});

test('lead novo e telefone editado puxam a conversa que já existia', async () => {
  const { criarLead, vincularConversasExistentes } = await import('../src/modules/leads/service.js');
  msg('5551993332222@s.whatsapp.net', true, '2026-09-05T00:00:00.000Z', 'N1');
  const id = db.tx(() => criarLead({ name: 'Form', phone: '555193332222', source: 'yayforms' }));
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE wa_id = 'N1'").lead_id, id);
  assert.equal(db.get('SELECT last_contact_at FROM leads WHERE id = ?', [id]).last_contact_at, '2026-09-05T00:00:00.000Z');

  const outro = await criarLeadDireto({ nome: 'Sem tel', telefone: null });
  msg('5561944443333@s.whatsapp.net', false, '2026-09-06T00:00:00.000Z', 'N2');
  db.run("UPDATE leads SET phone = '5561944443333' WHERE id = ?", [outro]);
  vincularConversasExistentes(outro, '5561944443333');
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE wa_id = 'N2'").lead_id, outro);
});
