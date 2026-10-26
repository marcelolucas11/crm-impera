import { prepararBanco } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = await prepararBanco();
const { aplicarEvento, dadosDoConvidado } = await import('../src/modules/calendly/sincronizar.js');
const leads = await import('../src/modules/leads/service.js');

const etapas = db.all("SELECT id FROM stages WHERE kind = 'open' ORDER BY position, id");
assert.ok(etapas.length >= 2);
db.run("UPDATE stages SET role = NULL");
db.run("UPDATE stages SET role = 'entrada' WHERE id = ?", [etapas[0].id]);
db.run("UPDATE stages SET role = 'reuniao' WHERE id = ?", [etapas[1].id]);

const ID_A = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const ID_B = 'b1b2c3d4e5f6a7b8c9d0e1f3';

// Lead do Yay! Forms (só nome e telefone) + o webhook guardado, como acontece de verdade
function leadDoForm(nome, telefone, respostaId) {
  const id = leads.criarLead({ name: nome, phone: telefone, source: 'yayforms', extra: { resposta_id: respostaId, parcial: false } });
  db.run("INSERT INTO webhook_events (source, payload, status, lead_id) VALUES ('yayforms', ?, 'processed', ?)", [JSON.stringify({ response: { id: respostaId } }), id]);
  return id;
}

let seq = 0;
const evento = (extra = {}) => {
  seq++;
  return {
    uri: `https://api.calendly.com/scheduled_events/ID${seq}`, name: 'Diagnóstico', status: 'active',
    start_time: new Date(Date.now() + 2 * 86400000).toISOString(), end_time: new Date(Date.now() + 2 * 86400000 + 1800000).toISOString(),
    updated_at: new Date().toISOString(), created_at: '2026-10-26T15:55:00.000000Z', location: { join_url: 'https://meet.test/x' }, ...extra,
  };
};
const convidado = (nome, email, tracking = {}, extra = {}) =>
  dadosDoConvidado([{ status: 'active', name: nome, email, created_at: '2026-10-26T15:56:10.000000Z', tracking, questions_and_answers: [], ...extra }]);

test('dois "João": o ID da resposta decide qual lead é, sem olhar o nome', () => {
  const joao1 = leadDoForm('João', '5511911111111', ID_A);
  const joao2 = leadDoForm('João', '5511922222222', ID_B);
  const total = db.get('SELECT count(*) n FROM leads').n;

  const r = aplicarEvento(evento(), convidado('João', 'joao@gmail.com', { utm_term: ID_B }));
  assert.equal(r.novoLead, false);
  assert.equal(db.get('SELECT count(*) n FROM leads').n, total, 'não cria lead novo');
  const ev = db.get('SELECT lead_id, booked_at, yay_response_id FROM calendly_events ORDER BY created_at DESC, rowid DESC LIMIT 1');
  assert.equal(ev.lead_id, joao2);
  assert.equal(ev.yay_response_id, ID_B);
  assert.equal(ev.booked_at, '2026-10-26T15:56:10.000000Z', 'guarda quando a pessoa agendou');
  assert.equal(leads.buscarLead(joao2).stage_id, etapas[1].id, 'o lead pula para a etapa de reunião');
  assert.equal(leads.buscarLead(joao2).meetings_active, 1);
  assert.equal(leads.buscarLead(joao1).meetings_active, 0);
  assert.equal(leads.buscarLead(joao1).stage_id, etapas[0].id);
  // o e-mail que só existia no Calendly passa a constar no lead do formulário
  assert.equal(leads.buscarLead(joao2).email, 'joao@gmail.com');
});

test('sem ID no link: continua achando por telefone ou e-mail', () => {
  const maria = leadDoForm('Maria', '5511933333333', 'c1b2c3d4e5f6a7b8c9d0e1f4');
  const r = aplicarEvento(evento(), convidado('Maria S.', 'maria@x.com', {}, { text_reminder_number: '+55 11 93333-3333' }));
  assert.equal(r.novoLead, false);
  assert.equal(db.get('SELECT lead_id FROM calendly_events ORDER BY rowid DESC LIMIT 1').lead_id, maria);
});

test('ID inválido (curto ou com espaço) é ignorado e não quebra nada', () => {
  assert.equal(convidado('X', 'x@x.com', { utm_term: 'abc' }).respostaId, null);
  assert.equal(convidado('X', 'x@x.com', { utm_term: 'tem espaco no meio aqui' }).respostaId, null);
  assert.equal(convidado('X', 'x@x.com', { utm_term: ID_A }).respostaId, ID_A);
});

test('reunião ligada antes a um lead só do Calendly passa para o lead do formulário quando o ID aparece', () => {
  const doForm = leadDoForm('Ana', '5511944444444', 'd1b2c3d4e5f6a7b8c9d0e1f5');
  // 1ª leitura: sem ID (versão antiga do link) → cria um lead de origem Calendly
  const ev = evento();
  const r1 = aplicarEvento(ev, convidado('Ana Paula', 'ana@outro.com'));
  assert.equal(r1.novoLead, true);
  const soCalendly = db.get('SELECT lead_id FROM calendly_events WHERE uri = ?', [ev.uri]).lead_id;
  assert.notEqual(soCalendly, doForm);
  // 2ª leitura: agora o ID vem junto → religa ao lead do formulário
  const r2 = aplicarEvento(ev, convidado('Ana Paula', 'ana@outro.com', { utm_term: 'd1b2c3d4e5f6a7b8c9d0e1f5' }));
  assert.equal(r2.religado, true);
  assert.equal(db.get('SELECT lead_id FROM calendly_events WHERE uri = ?', [ev.uri]).lead_id, doForm);
  assert.equal(leads.buscarLead(doForm).meetings_active, 1);
  assert.equal(leads.buscarLead(doForm).stage_id, etapas[1].id);
});

test('lista de leads traz a última reunião mesmo depois de passar', () => {
  const id = leadDoForm('Pedro', '5511955555555', 'e1b2c3d4e5f6a7b8c9d0e1f6');
  aplicarEvento(evento({ start_time: new Date(Date.now() - 3 * 86400000).toISOString() }), convidado('Pedro', 'pedro@x.com', { utm_term: 'e1b2c3d4e5f6a7b8c9d0e1f6' }));
  const l = leads.buscarLead(id);
  assert.equal(l.meetings_active, 1);
  assert.equal(l.next_meeting_at, null);
  assert.ok(l.last_meeting_at);
});
