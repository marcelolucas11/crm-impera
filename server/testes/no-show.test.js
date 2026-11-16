// No-show: o lead agendou a reunião e não apareceu. Botão da ficha, coluna "No-show", organizador e Calendly.
import { prepararBanco, limparBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, tx, exec } = await import('../src/db.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const leads = await import('../src/modules/leads/service.js');
const { aplicarEvento } = await import('../src/modules/calendly/sincronizar.js');
const cfgMod = await import('../src/modules/organizador/config.js');
const motor = await import('../src/modules/organizador/motor.js');
const etapas = await import('../src/modules/organizador/etapas.js');

let respostaIa = {};
definirChamadaFalsa(async () => {
  const base = {
    reuniao_agendada: { sim: false }, reuniao_realizada: { sim: false }, proposta_escrita: { sim: false },
    criterios: [{ id: 'qualificado', atende: false }], temperatura: 40, resumo: '', objecao: 'nenhuma',
  };
  return { texto: JSON.stringify({ ...base, ...respostaIa }), uso: { input_tokens: 100, output_tokens: 50 } };
});

const etapa = (papel) => get('SELECT id, name FROM stages WHERE role = ?', [papel]);
const etapaDoLead = (id) => get('SELECT s.name FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [id]).name;
const horas = (h) => new Date(Date.now() + h * 3600000).toISOString();

let n = 0;
function reuniao(leadId, { inicio = horas(-3), fim = horas(-2), status = 'active' } = {}) {
  n++;
  const uri = `https://api.calendly.com/scheduled_events/NS${n}`;
  run('INSERT INTO calendly_events (uri, lead_id, event_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?)', [uri, leadId, 'Pré Contratação', inicio, fim, status]);
  return uri;
}

function novoLead(nome, papel = 'reuniao') {
  return Number(run('INSERT INTO leads (name, phone, stage_id) VALUES (?, ?, ?)', [nome, '5511988887777', etapa(papel).id]).lastInsertRowid);
}

async function preparar() {
  await limparBanco();
  exec('DELETE FROM organizador_movimentos; DELETE FROM organizador_uso; DELETE FROM ia_conversas;');
  respostaIa = {};
  motor._zerarTarefa();
  cfgMod.salvarConfig({ ativo: true, limite_diario_usd: 2 }, { maxMsgId: motor.maxMsgId() });
}

test('marcar no-show leva para a coluna No-show, marca a reunião perdida e registra no histórico', async () => {
  await preparar();
  const id = novoLead('Carlos');
  const uri = reuniao(id);
  assert.equal(tx(() => leads.marcarNoShow(id, null)), true);
  assert.equal(etapaDoLead(id), 'No-show');
  const l = leads.buscarLead(id);
  assert.ok(l.noshow_since);
  assert.equal(get('SELECT no_show FROM calendly_events WHERE uri = ?', [uri]).no_show, 1);
  const ev = get("SELECT data FROM lead_events WHERE lead_id = ? AND type = 'no_show_on'", [id]);
  assert.match(ev.data, /Pré Contratação/);
  // Marcar de novo não duplica nada
  tx(() => leads.marcarNoShow(id, null));
  assert.equal(get("SELECT count(*) n FROM lead_events WHERE lead_id = ? AND type = 'no_show_on'", [id]).n, 1);
});

test('organizador: reunião perdida não conta como feita — o lead fica em No-show', async () => {
  await preparar();
  const id = novoLead('Carlos');
  reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  const fixos = etapas.sinaisFixos(id);
  assert.equal(fixos.reuniao_feita, null);
  assert.ok(fixos.no_show);
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
  // "Organizar tudo" também mantém em No-show
  const marcos = etapas.marcosAlcancados({ fixos, ia: null, criterios: [] });
  const destino = etapas.decidirDestino({ lead: get('SELECT * FROM leads WHERE id = ?', [id]), marcos, modo: 'organizar' });
  assert.equal(destino, null);
});

function linkMeet(leadId, quando = new Date().toISOString()) {
  n++;
  run(
    `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp)
     VALUES (NULL, ?, '5511988887777@s.whatsapp.net', ?, 1, 'texto', ?, ?)`,
    [leadId, `M${n}`, 'Entra aqui: https://meet.google.com/abc-defg-hij', quando]
  );
}

test('organizador: depois do no-show, a IA dizer que a reunião aconteceu NÃO tira do No-show', async () => {
  await preparar();
  const id = novoLead('Carlos');
  reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  const marcos = etapas.marcosAlcancados({
    fixos: etapas.sinaisFixos(id), criterios: [],
    ia: { reuniao_realizada: { sim: true, motivo: 'fizeram chamada no WhatsApp', trecho: 'como falamos na chamada' } },
  });
  assert.equal(etapas.decidirDestino({ lead: get('SELECT * FROM leads WHERE id = ?', [id]), marcos }), null);
});

test('organizador: link do Meet mandado ANTES de marcar no-show não tira do No-show; depois tira', async () => {
  await preparar();
  const id = novoLead('Carlos');
  reuniao(id);
  linkMeet(id, horas(-3));
  tx(() => leads.marcarNoShow(id, null));
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
  linkMeet(id, new Date(Date.now() + 1000).toISOString());
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Aguardando proposta');
});

test('arrastar para a coluna No-show vale como no-show: a varredura não devolve para Aguardando proposta', async () => {
  await preparar();
  const id = novoLead('Carlos');
  reuniao(id);
  const de = etapa('reuniao').id;
  run('UPDATE leads SET stage_id = ?, stage_changed_at = ? WHERE id = ?', [etapa('no_show').id, new Date().toISOString(), id]);
  tx(() => leads.noShowAoMoverAMao(id, de, etapa('no_show').id, null));
  assert.ok(leads.buscarLead(id).noshow_since);
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
  // Desfazer devolve para onde estava antes de arrastar
  tx(() => leads.sairDoNoShow(id, { motivo: 'desfeito' }));
  assert.equal(etapaDoLead(id), 'Reunião agendada');
});

test('lead que já estava na coluna No-show (sem marcação) também não volta sem prova', async () => {
  await preparar();
  const id = novoLead('Carlos', 'no_show');
  reuniao(id);
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
});

test('arrastar para fora da coluna No-show tira o no-show e a varredura não remarca', async () => {
  await preparar();
  const id = novoLead('Carlos');
  reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  run('UPDATE leads SET stage_id = ? WHERE id = ?', [etapa('reuniao').id, id]);
  tx(() => leads.noShowAoMoverAMao(id, etapa('no_show').id, etapa('reuniao').id, null));
  assert.equal(leads.buscarLead(id).noshow_since, null);
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Reunião agendada');
});

test('desfazer no-show devolve o lead para a etapa de antes', async () => {
  await preparar();
  const id = novoLead('Carlos');
  const uri = reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  tx(() => leads.sairDoNoShow(id, { motivo: 'desfeito' }));
  assert.equal(etapaDoLead(id), 'Reunião agendada');
  assert.equal(leads.buscarLead(id).noshow_since, null);
  assert.equal(get('SELECT no_show FROM calendly_events WHERE uri = ?', [uri]).no_show, 0);
  // Sem link do Meet nem ligação a reunião não conta como feita, mas a varredura não remarca o no-show desfeito à mão
  assert.equal(etapas.sinaisFixos(id).reuniao_feita, null);
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Reunião agendada');
});

test('desfazer não puxa de volta um lead que alguém já moveu para outra coluna', async () => {
  await preparar();
  const id = novoLead('Carlos');
  reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  run('UPDATE leads SET stage_id = ? WHERE id = ?', [etapa('proposta').id, id]);
  tx(() => leads.sairDoNoShow(id, { motivo: 'desfeito' }));
  assert.equal(etapaDoLead(id), 'Proposta enviada');
});

test('lead em Fechado/Perdido: marca o no-show sem mexer na etapa', async () => {
  await preparar();
  const perdido = get("SELECT id FROM stages WHERE kind = 'lost'").id;
  const id = Number(run('INSERT INTO leads (name, stage_id) VALUES (?, ?)', ['Perdido', perdido]).lastInsertRowid);
  tx(() => leads.marcarNoShow(id, null));
  assert.equal(get('SELECT stage_id FROM leads WHERE id = ?', [id]).stage_id, perdido);
  assert.ok(leads.buscarLead(id).noshow_since);
});

test('Calendly: reagendou depois do no-show → sai do no-show e volta para Reunião agendada', async () => {
  await preparar();
  const id = novoLead('Carlos');
  const perdida = reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  aplicarEvento(
    { uri: 'https://api.calendly.com/scheduled_events/NOVA', name: 'Pré Contratação', start_time: horas(24), end_time: horas(25), status: 'active' },
    { name: 'Carlos', phone: '5511988887777', email: null, respostas: [], utm: {} }
  );
  assert.equal(etapaDoLead(id), 'Reunião agendada');
  assert.equal(leads.buscarLead(id).noshow_since, null);
  // A reunião perdida continua perdida: quando a nova passar, só ela conta
  assert.equal(get('SELECT no_show FROM calendly_events WHERE uri = ?', [perdida]).no_show, 1);
  assert.equal(etapas.sinaisFixos(id).reuniao_feita, null);
  assert.match(get("SELECT data FROM lead_events WHERE lead_id = ? AND type = 'no_show_off'", [id]).data, /reagendou/);
});

test('Calendly: a mesma reunião remarcada para depois também tira do no-show', async () => {
  await preparar();
  const id = novoLead('Carlos');
  const uri = reuniao(id);
  tx(() => leads.marcarNoShow(id, null));
  aplicarEvento(
    { uri, name: 'Pré Contratação', start_time: horas(48), end_time: horas(49), status: 'active' },
    { name: 'Carlos', phone: '5511988887777', email: null, respostas: [], utm: {} }
  );
  assert.equal(etapaDoLead(id), 'Reunião agendada');
  assert.equal(get('SELECT no_show FROM calendly_events WHERE uri = ?', [uri]).no_show, 0);
});

test('Calendly: sincronizar de novo a reunião perdida (sem mudança) não tira do no-show', async () => {
  await preparar();
  const id = novoLead('Carlos');
  const inicio = horas(-3);
  const uri = reuniao(id, { inicio });
  tx(() => leads.marcarNoShow(id, null));
  aplicarEvento(
    { uri, name: 'Pré Contratação', start_time: inicio, end_time: horas(-2), status: 'active' },
    { name: 'Carlos', phone: '5511988887777', email: null, respostas: [], utm: {} }
  );
  assert.equal(etapaDoLead(id), 'No-show');
  assert.ok(leads.buscarLead(id).noshow_since);
});
