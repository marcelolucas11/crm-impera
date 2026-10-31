// Revisão dos atendimentos da IA: ninguém em "IA atendendo" pode ficar sem resposta.
// O modelo e o WhatsApp são falsos: nada sai da máquina.
import { prepararBanco, limparBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const { salvarConfig } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const motor = await import('../src/modules/ia/motor.js');
const protecao = await import('../src/modules/ia/protecao.js');
const revisao = await import('../src/modules/ia/revisao.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { inicio: '00:00', fim: '23:59' }]));
let enviadas = [];

const enviarFalso = async (numeroId, destino, dados) => {
  enviadas.push({ destino, ...dados });
  const jid = destino.jid || get('SELECT jid FROM wa_contacts WHERE lead_id = ?', [destino.leadId])?.jid || 'x@s.whatsapp.net';
  run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
       VALUES (1, ?, ?, ?, 1, 'texto', ?, ?, ?)`, [destino.leadId || null, jid, `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: dados.origem })]);
};
motor.definirDependencias({
  esperar: async () => {},
  aleatorio: () => 0,
  digitando: async () => {},
  numeroDisponivel: async () => 1,
  virarLead: async () => ({ leadId: null }),
  enviar: async (numeroId, destino, dados) => {
    enviadas.push({ destino, ...dados });
    const jid = destino.jid || get('SELECT jid FROM wa_contacts WHERE lead_id = ?', [destino.leadId])?.jid || 'x@s.whatsapp.net';
    run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
         VALUES (1, ?, ?, ?, 1, 'texto', ?, ?, ?)`, [destino.leadId || null, jid, `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: dados.origem })]);
  },
});
definirChamadaFalsa(async () => ({ texto: JSON.stringify({ mensagens: ['Oi! Sou a Alice, da Impera.'], acao: 'responder' }), uso: { input_tokens: 10, output_tokens: 5 } }));

let seq = 0;
function msg(jid, texto, { deMim = false, extra = null, segundosAtras = 0 } = {}) {
  seq++;
  const ts = new Date(Date.now() - segundosAtras * 1000).toISOString();
  return Number(run(`INSERT INTO wa_messages (instance_id, chat_jid, wa_id, from_me, type, body, timestamp, extra) VALUES (1, ?, ?, ?, 'texto', ?, ?, ?)`,
    [jid, `R${seq}`, deMim ? 1 : 0, texto, ts, extra]).lastInsertRowid);
}

async function preparar(extra = {}) {
  await limparBanco();
  exec('DELETE FROM ia_sugestoes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: true, modo: 'automatico', horario: SEMPRE, automatico_fora_horario: true, espera_agrupar_seg: 3, intervalo_leads_min_seg: 0, intervalo_leads_max_seg: 0, ...extra });
  protecao.zerarProtecao();
  motor.definirDependencias({ enviar: enviarFalso, prazoEnvioMs: 90000 });
  enviadas = [];
}

// Conversa que a IA atende e já respondeu uma vez
async function conversaAtendida(jid) {
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?) ON CONFLICT(jid) DO NOTHING', [jid, jid.split('@')[0], 'Maria']);
  msg(jid, 'oi, vi o anúncio', { segundosAtras: 60 });
  const c = motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid });
  await motor.processarConversa(c.id);
  assert.equal(enviadas.length, 1);
  return get('SELECT * FROM ia_conversas WHERE id = ?', [c.id]);
}

test('mensagem que chegou com o CRM fora (sem acordar a IA) é achada e respondida de onde parou', async () => {
  await preparar();
  const c = await conversaAtendida('5511900000001@s.whatsapp.net');
  // Chega "offline": gravada, mas sem o gancho → nada agendado
  msg(c.jid, 'quanto custa?');
  assert.equal(get('SELECT proxima_em FROM ia_conversas WHERE id = ?', [c.id]).proxima_em, null);

  const antes = revisao.estadoRevisao();
  assert.equal(antes.pendencias.length, 1);
  assert.equal(antes.pendencias[0].situacao, 'parada');
  assert.equal(antes.pendencias[0].mensagens_sem_resposta, 1);

  const r = await revisao.revisarAtendimentos();
  assert.equal(r.retomadas, 1);
  run("UPDATE ia_conversas SET proxima_em = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), c.id]);
  const feito = await motor.processarConversa(c.id);
  assert.equal(feito.feito, 'enviada');
  assert.equal(enviadas.length, 2);
  assert.equal(revisao.estadoRevisao().pendencias.length, 0);
});

test('reinício no meio do atendimento (ponteiro já avançou, resposta não saiu): volta o ponteiro e responde', async () => {
  await preparar();
  const c = await conversaAtendida('5511900000002@s.whatsapp.net');
  const id = msg(c.jid, 'e como funciona?');
  // Simula: a IA leu (ponteiro avançou, proxima_em zerado) e o servidor caiu antes de enviar
  run('UPDATE ia_conversas SET ultima_lida_id = ?, proxima_em = NULL WHERE id = ?', [id, c.id]);
  assert.equal((await motor.processarConversa(c.id)).feito, 'sem_novidade');

  await revisao.revisarAtendimentos();
  assert.ok(get('SELECT ultima_lida_id FROM ia_conversas WHERE id = ?', [c.id]).ultima_lida_id < id);
  assert.equal((await motor.processarConversa(c.id)).feito, 'enviada');
});

test('lead do formulário cuja 1ª mensagem nunca saiu é retomado', async () => {
  await preparar();
  run("INSERT INTO ia_conversas (chave, phone, origem, status) VALUES ('t:5511900000003', '5511900000003', 'yayforms', 'ativa')");
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.retomadas, 1);
  assert.equal(r.pendencias[0].primeira_mensagem, true);
});

test('conversa em dia, agendada ou com sugestão pendente não é mexida', async () => {
  await preparar();
  const c = await conversaAtendida('5511900000004@s.whatsapp.net');
  assert.equal((await revisao.revisarAtendimentos()).retomadas, 0); // em dia
  msg(c.jid, 'oi?');
  const quando = new Date(Date.now() + 60000).toISOString();
  run('UPDATE ia_conversas SET proxima_em = ? WHERE id = ?', [quando, c.id]);
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.retomadas, 0);
  assert.equal(r.pendencias[0].situacao, 'agendada');
  assert.equal(get('SELECT proxima_em FROM ia_conversas WHERE id = ?', [c.id]).proxima_em, quando);
});

test('equipe respondeu pelo celular com o CRM fora: a IA sai da conversa', async () => {
  await preparar();
  const c = await conversaAtendida('5511900000005@s.whatsapp.net');
  msg(c.jid, 'pode me ligar?');
  msg(c.jid, 'te ligo já', { deMim: true });
  msg(c.jid, 'ok');
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.equipe_assumiu, 1);
  assert.equal(get('SELECT status FROM ia_conversas WHERE id = ?', [c.id]).status, 'humano');
});

test('depois de 3 retomadas sem sucesso, passa para a equipe', async () => {
  await preparar();
  const c = await conversaAtendida('5511900000006@s.whatsapp.net');
  msg(c.jid, 'alô?');
  for (let i = 0; i < revisao.MAX_RETOMADAS; i++) {
    assert.equal((await revisao.revisarAtendimentos()).retomadas, 1);
    run('UPDATE ia_conversas SET proxima_em = NULL WHERE id = ?', [c.id]); // a retomada "falhou"
  }
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.passadas_para_equipe, 1);
  assert.equal(get('SELECT status FROM ia_conversas WHERE id = ?', [c.id]).status, 'aguardando_humano');
});

test('IA desligada: a revisão não mexe em nada', async () => {
  await preparar();
  const c = await conversaAtendida('5511900000007@s.whatsapp.net');
  msg(c.jid, 'oi');
  salvarConfig({ ativo: false });
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.retomadas, 0);
});

// ------------------------------------------------------------------ 0.18.0: "IA irá atender" e fila travada

test('saudação automática dos Disparos não faz a IA achar que já falou: conta como "irá atender" e a 1ª mensagem sai', async () => {
  await preparar();
  const jid = '5511900000010@s.whatsapp.net';
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?)', [jid, '5511900000010', 'Ana']);
  msg(jid, 'Olá! Recebemos seu cadastro.', { deMim: true, extra: JSON.stringify({ origem: 'disparo' }), segundosAtras: 120 });
  const id = Number(run("INSERT INTO ia_conversas (chave, phone, jid, origem, status) VALUES ('t:5511900000010', '5511900000010', ?, 'yayforms', 'ativa')", [jid]).lastInsertRowid);

  const antes = revisao.estadoRevisao();
  assert.equal(antes.ira_atender, 1);
  assert.equal(antes.pendencias[0].primeira_mensagem, true);
  assert.equal(antes.pendencias[0].situacao, 'parada');

  assert.equal((await revisao.revisarAtendimentos()).retomadas, 1);
  assert.equal((await motor.processarConversa(id)).feito, 'enviada');
  assert.equal(enviadas.length, 1);
  const depois = revisao.estadoRevisao();
  assert.equal(depois.ira_atender, 0);
  assert.equal(depois.atendendo, 1);
  assert.equal(depois.pendencias.length, 0);
});

test('lead que só escreveu pelo WhatsApp e a IA nunca respondeu: a IA abre a conversa mesmo sem mensagem nova', async () => {
  await preparar();
  const jid = '5511900000011@s.whatsapp.net';
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?)', [jid, '5511900000011', 'Rui']);
  const ultima = msg(jid, 'oi', { segundosAtras: 600 });
  // Ponteiro já passou da mensagem (ex.: leitura sem resposta antes de um reinício)
  const id = Number(run("INSERT INTO ia_conversas (chave, phone, jid, origem, status, ultima_lida_id) VALUES ('t:5511900000011', '5511900000011', ?, 'whatsapp', 'ativa', ?)", [jid, ultima]).lastInsertRowid);
  assert.equal((await motor.processarConversa(id)).feito, 'enviada');
});

test('atendimento preso numa conversa "em dia" é solto e a fila volta a andar', async () => {
  await preparar({ um_por_vez: true });
  const presa = await conversaAtendida('5511900000012@s.whatsapp.net'); // em dia (a última mensagem é da IA)
  // Simula um envio que nunca respondeu há 11 min: com "um lead por vez", nada mais anda
  const voltar = Date.now;
  Date.now = () => voltar() - 11 * 60000;
  motor.definirDependencias({ enviar: () => new Promise(() => {}), prazoEnvioMs: 300 });
  run('UPDATE ia_conversas SET proxima_em = ? WHERE id = ?', [new Date(voltar() - 20 * 60000).toISOString(), presa.id]);
  msg(presa.jid, 'e aí?');
  await motor.verificarPendentes();
  Date.now = voltar;
  assert.equal(motor.emAtendimento().length, 1);
  // A conversa presa fica "em dia" de propósito: a IA leu a msg e o ponteiro avançou, mas a mensagem que faltava é do lead
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.soltas, 1);
  assert.equal(motor.emAtendimento().filter((a) => a.id === presa.id && voltar() - a.desde > 10 * 60000).length, 0);
  await new Promise((r) => setTimeout(r, 400)); // deixa o envio preso cair no prazo antes do próximo teste
});

test('conversa na fila com a hora vencida e ninguém atendendo é destravada', async () => {
  await preparar();
  const id = Number(run("INSERT INTO ia_conversas (chave, phone, origem, status, proxima_em) VALUES ('t:5511900000013', '5511900000013', 'fila', 'ativa', ?)",
    [new Date(Date.now() - 30 * 60000).toISOString()]).lastInsertRowid);
  assert.equal(revisao.estadoRevisao().pendencias[0].situacao, 'atrasada');
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.destravadas, 1);
  assert.ok(new Date(get('SELECT proxima_em FROM ia_conversas WHERE id = ?', [id]).proxima_em).getTime() > Date.now() - 5000);
});

test('envio que nunca responde vira erro temporário depois do prazo (não segura o atendimento)', async () => {
  await preparar();
  motor.definirDependencias({ enviar: () => new Promise(() => {}), prazoEnvioMs: 50 });
  const id = Number(run("INSERT INTO ia_conversas (chave, phone, origem, status) VALUES ('t:5511900000014', '5511900000014', 'yayforms', 'ativa')").lastInsertRowid);
  assert.equal((await motor.processarConversa(id)).feito, 'tentar_de_novo');
  assert.ok(get('SELECT proxima_em FROM ia_conversas WHERE id = ?', [id]).proxima_em);
});

test('na revisão, quem a equipe já respondeu sai da IA mesmo estando na fila (agendada)', async () => {
  await preparar();
  const jid = '5511900000015@s.whatsapp.net';
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?)', [jid, '5511900000015', 'Léo']);
  const id = Number(run("INSERT INTO ia_conversas (chave, phone, jid, origem, status, proxima_em, ativada_em) VALUES ('t:5511900000015', '5511900000015', ?, 'fila', 'ativa', ?, ?)",
    [jid, new Date(Date.now() + 3600000).toISOString(), new Date(Date.now() - 60000).toISOString()]).lastInsertRowid);
  msg(jid, 'Oi Léo, aqui é o Marcelo', { deMim: true });
  const r = await revisao.revisarAtendimentos();
  assert.equal(r.equipe_assumiu, 1);
  assert.equal(get('SELECT status FROM ia_conversas WHERE id = ?', [id]).status, 'humano');
});
