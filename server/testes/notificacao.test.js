import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db;
let svc;
before(async () => {
  db = await prepararBanco();
  svc = await import('../src/modules/leads/service.js');
});
beforeEach(limparBanco);

let seq = 0;
const msg = (leadId, deMim, ts, tipo = 'texto') =>
  db.run('INSERT INTO wa_messages (lead_id, chat_jid, wa_id, from_me, type, body, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [leadId, 'x@s.whatsapp.net', `N${++seq}`, deMim ? 1 : 0, tipo, 'oi', ts]);

test('acende quando o lead manda mensagem e ninguém respondeu', async () => {
  const id = await criarLeadDireto({ nome: 'Ana', telefone: '5511911112222' });
  assert.equal(svc.buscarLead(id).sem_resposta, false);
  msg(id, false, '2026-10-13T10:00:00.000Z');
  assert.equal(svc.buscarLead(id).sem_resposta, true);
});

test('apaga sozinha quando eu respondo e volta se o lead escrever de novo', async () => {
  const id = await criarLeadDireto({ nome: 'Bia', telefone: '5511911113333' });
  msg(id, false, '2026-10-13T10:00:00.000Z');
  msg(id, true, '2026-10-13T10:05:00.000Z');
  assert.equal(svc.buscarLead(id).sem_resposta, false);
  msg(id, false, '2026-10-13T10:10:00.000Z');
  assert.equal(svc.buscarLead(id).sem_resposta, true);
});

test('limpar à mão apaga até chegar mensagem nova do lead; chamadas não contam', async () => {
  const id = await criarLeadDireto({ nome: 'Caio', telefone: '5511911114444' });
  msg(id, false, '2026-10-13T10:00:00.000Z');
  db.run("UPDATE leads SET notif_cleared_at = '2026-10-13T10:01:00.000Z' WHERE id = ?", [id]);
  assert.equal(svc.buscarLead(id).sem_resposta, false);
  msg(id, false, '2026-10-13T10:02:00.000Z', 'chamada');
  assert.equal(svc.buscarLead(id).sem_resposta, false);
  msg(id, false, '2026-10-13T10:03:00.000Z');
  assert.equal(svc.buscarLead(id).sem_resposta, true);
  assert.equal(svc.listarLeads([], []).find((l) => l.id === id).sem_resposta, true);
});
