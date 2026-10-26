import { prepararBanco } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = await prepararBanco();
const leads = await import('../src/modules/leads/service.js');
const { calcularEstatisticas } = await import('../src/modules/estatisticas/index.js');

const etapa = db.get('SELECT id FROM stages ORDER BY position LIMIT 1').id;

function lead(nome, { source = 'yayforms', parcial = false } = {}) {
  const extra = JSON.stringify({ parcial, formulario: 'Form teste' });
  return Number(db.run('INSERT INTO leads (name, source, stage_id, extra) VALUES (?, ?, ?, ?)', [nome, source, etapa, extra]).lastInsertRowid);
}

let n = 0;
function reuniao(leadId, { status = 'active', diasDepois = -3 } = {}) {
  n++;
  const inicio = new Date(Date.now() + diasDepois * 86400000).toISOString();
  db.run(
    'INSERT INTO calendly_events (uri, lead_id, event_name, start_time, status) VALUES (?, ?, ?, ?, ?)',
    [`https://api.calendly.com/scheduled_events/T${n}`, leadId, 'Diagnóstico', inicio, status]
  );
}

test('lista de leads informa quem agendou (inclusive reunião passada) e quem cancelou', () => {
  const agendouPassada = lead('Agendou e já passou');
  const agendouFutura = lead('Agendou para depois');
  const cancelou = lead('Cancelou');
  const nada = lead('Só preencheu');
  reuniao(agendouPassada, { diasDepois: -5 });
  reuniao(agendouFutura, { diasDepois: 4 });
  reuniao(cancelou, { status: 'canceled', diasDepois: 2 });

  const por = (id) => leads.buscarLead(id);
  assert.equal(por(agendouPassada).meetings_active, 1);
  assert.equal(por(agendouPassada).next_meeting_at, null, 'reunião passada não é "próxima"');
  assert.equal(por(agendouFutura).meetings_active, 1);
  assert.ok(por(agendouFutura).next_meeting_at);
  assert.equal(por(cancelou).meetings_active, 0);
  assert.equal(por(cancelou).meetings_canceled, 1);
  assert.equal(por(nada).meetings_active, 0);
  assert.equal(por(nada).meetings_canceled, 0);
});

test('funil do formulário: iniciaram, completaram, agendaram e quem completou sem agendar', () => {
  // Banco do teste anterior: 4 leads do Yay! Forms completos, 2 deles com reunião ativa
  const parcialQueAgendou = lead('Parcial que agendou', { parcial: true });
  const parcialSemReuniao = lead('Parcial sem reunião', { parcial: true });
  reuniao(parcialQueAgendou, { diasDepois: 1 });
  lead('Veio do calendly', { source: 'calendly' }); // não entra no funil do formulário

  const { funil_forms: f } = calcularEstatisticas({ dias: 30 });
  assert.equal(f.iniciaram, 6);
  assert.equal(f.completaram, 4);
  assert.equal(f.completaram_e_agendaram, 2);
  assert.equal(f.completaram_sem_agendar, 2); // "Cancelou" e "Só preencheu"
  assert.equal(f.parciais_que_agendaram, 1);
  assert.equal(f.agendaram, 3);
  assert.equal(f.taxa_conclusao, 66.7);
  assert.equal(f.taxa_agendamento, 50);
  assert.ok(parcialSemReuniao);
});
