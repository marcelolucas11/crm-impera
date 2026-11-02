// "Criar com IA" do Organizador: lê conversas + variáveis do formulário e escreve o prompt do critério.
// O modelo é falso: nada sai da máquina.
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const ger = await import('../src/modules/organizador/gerador.js');
const av = await import('../src/modules/organizador/avaliacao.js');

let pedidos = [];
let resposta = '';
definirChamadaFalsa(async (corpo) => {
  pedidos.push(corpo);
  return { texto: resposta, uso: { input_tokens: 50000, output_tokens: 4000 }, parada: 'end_turn' };
});

let seq = 0;
function msg(leadId, texto, { deMim = false, diasAtras = 0, origem = null } = {}) {
  seq++;
  run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra) VALUES (1, ?, ?, ?, ?, 'texto', ?, ?, ?)`, [
    leadId, `55119${leadId}@s.whatsapp.net`, `G${seq}`, deMim ? 1 : 0, texto,
    new Date(Date.now() - diasAtras * 86400000 + seq).toISOString(), origem ? JSON.stringify({ origem }) : null,
  ]);
}

async function leadDoForm(nome, { papel = null, kind = null, parcial = false, respostas = [] } = {}) {
  const id = await criarLeadDireto({ nome, telefone: `55119880${String(++seq).padStart(5, '0')}` });
  const extra = { parcial, respostas: respostas.map(([titulo, valor], i) => ({ id: `q${i}`, titulo, valor, tipo: 'text' })) };
  run("UPDATE leads SET source = 'yayforms', extra = ? WHERE id = ?", [JSON.stringify(extra), id]);
  const st = papel ? get('SELECT id FROM stages WHERE role = ?', [papel]) : kind ? get('SELECT id FROM stages WHERE kind = ?', [kind]) : null;
  if (st) run('UPDATE leads SET stage_id = ? WHERE id = ?', [st.id, id]);
  return id;
}

async function preparar() {
  await limparBanco();
  exec('DELETE FROM ia_registro; DELETE FROM wa_instances;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  ger._paraTeste.reiniciar();
  pedidos = [];
  resposta = '';
}

const esperar = async () => {
  for (let i = 0; i < 200 && ger.estadoTarefa().status === 'rodando'; i++) await new Promise((r) => setTimeout(r, 5));
  return ger.estadoTarefa();
};

test('engajamento: conta mensagens e dias do lead, ignora disparos', async () => {
  await preparar();
  const id = await leadDoForm('Teodoro');
  msg(id, 'Mensagem automática', { deMim: true, diasAtras: 3, origem: 'disparo' });
  msg(id, 'Oi', { diasAtras: 3 });
  msg(id, 'Olá! Tudo bem?', { deMim: true, diasAtras: 3 });
  msg(id, 'Tudo, quero começar', { diasAtras: 1 });
  msg(id, 'Pode ser amanhã?', { diasAtras: 1 });
  const e = av.engajamentoDoLead(id);
  assert.equal(e.msgs_lead, 3);
  assert.equal(e.dias_lead, 2);
  assert.equal(e.msgs_equipe, 1);
  assert.equal(e.respondeu_ultima, true);
  assert.match(av.textoDoEngajamento(e), /3 mensagem\(ns\) em 2 dia\(s\)/);
});

test('catálogo: junta as perguntas do formulário com as respostas e marca texto livre', async () => {
  await preparar();
  for (let i = 0; i < 4; i++) {
    await leadDoForm(`Lead${i}`, { respostas: [['Aceita o investimento mínimo em anúncios?', i < 3 ? 'Sim' : 'Não'], ['Nome da empresa', `Empresa ${i}`]] });
  }
  const cat = ger.catalogoDeVariaveis(ger.coletarLeads(60));
  const inv = cat.find((p) => p.titulo.startsWith('Aceita'));
  assert.equal(inv.respondida, 4);
  assert.deepEqual(inv.valores[0], { valor: 'Sim', n: 3 });
  assert.equal(inv.livre, false);
});

test('gera o prompt: manda variáveis, funil, orientações e conversas anonimizadas; separa as notas', async () => {
  await preparar();
  const cliente = await leadDoForm('Severino Andrade', { kind: 'won', respostas: [['Tem experiência no nicho?', 'Mais de 3 anos'], ['Aceita o valor da mão de obra?', 'Sim']] });
  msg(cliente, 'Quero fechar essa semana, meu fone é 11 98888-7777', { diasAtras: 5 });
  msg(cliente, 'Perfeito, te mando a proposta', { deMim: true, diasAtras: 5 });
  const perdido = await leadDoForm('Clodoaldo', { kind: 'lost', parcial: true, respostas: [['Tem experiência no nicho?', 'Quero começar']] });
  msg(perdido, 'Só queria saber o preço', { diasAtras: 4 });
  msg(perdido, 'Claro! Posso te explicar', { deMim: true, diasAtras: 4, origem: 'ia' });
  await leadDoForm('Joaquim');

  resposta = 'DEFINIÇÃO — lead pronto.\nREGRA DE DECISÃO — 3 sinais.\n===NOTAS===\n- "Mais de 3 anos" aparece em quem fechou\n- Parciais se perdem mais';
  ger.iniciarGeracao({ criterioId: 'qualificado', orientacao: 'Quem agenda no Calendly é muito qualificado', dias: 60, modelo: 'claude-opus-5-5' });
  const t = await esperar();
  assert.equal(t.status, 'concluida', t.erro);
  assert.match(t.resultado.prompt, /REGRA DE DECISÃO/);
  assert.ok(!t.resultado.prompt.includes('NOTAS'));
  assert.equal(t.resultado.notas.length, 2);
  assert.equal(t.resultado.leads, 3);
  assert.equal(t.resultado.conversas, 2);

  const corpo = pedidos[0];
  assert.equal(corpo.model, 'claude-opus-5-5');
  assert.ok(corpo.thinking, 'liga o raciocínio');
  const pedido = corpo.messages[0].content;
  assert.match(pedido, /Pergunta: "Tem experiência no nicho\?"/);
  assert.match(pedido, /"Mais de 3 anos" \(1\)/);
  assert.match(pedido, /Quem agenda no Calendly é muito qualificado/);
  assert.match(pedido, /resultado: virou cliente/);
  assert.match(pedido, /resultado: perdido/);
  assert.match(pedido, /formulário PARCIAL/);
  assert.match(pedido, /ALICE: Claro/);
  assert.ok(!pedido.includes('Severino') && !pedido.includes('98888'), 'anonimiza nome e telefone');
  assert.match(corpo.system[0].text, /Yay! Forms/);
});

test('não roda com poucos leads nem com modelo desconhecido; uma por vez', async () => {
  await preparar();
  await leadDoForm('Único');
  ger.iniciarGeracao({ criterioId: 'qualificado', dias: 60, modelo: 'claude-haiku-5-5' });
  const t = await esperar();
  assert.equal(t.status, 'erro');
  assert.match(t.erro, /Poucos leads/);
  assert.throws(() => ger.iniciarGeracao({ criterioId: 'qualificado', modelo: 'gpt-qualquer' }), /Modelo desconhecido/);
  assert.throws(() => ger.iniciarGeracao({ criterioId: 'cnovo', criterioTela: { titulo: '' }, modelo: 'claude-haiku-5-5' }), /Dê um nome/);
});

test('a avaliação do organizador passa a receber o engajamento', async () => {
  await preparar();
  const id = await leadDoForm('Valdemar');
  msg(id, 'Oi, quero contratar', { diasAtras: 1 });
  msg(id, 'Bora!', { deMim: true, diasAtras: 1 });
  let enviado = null;
  definirChamadaFalsa(async (corpo) => { enviado = corpo; return { texto: '{"criterios":[],"temperatura":60}', uso: { input_tokens: 10, output_tokens: 5 } }; });
  const { lerConfig } = await import('../src/modules/organizador/config.js');
  await av.avaliarLead(id, { cfg: lerConfig() });
  assert.match(enviado.messages[0].content, /Engajamento no WhatsApp: o lead mandou 1 mensagem/);
  assert.match(enviado.system[0].text, /régua de TEMPERATURA/);
});

test('lead sem conversa ganha termômetro pelo formulário e pelo Calendly', async () => {
  await preparar();
  const id = await leadDoForm('Florisvaldo', { respostas: [['Tem experiência no nicho?', 'Mais de 3 anos'], ['Aceita o investimento mínimo?', 'Sim']] });
  run("INSERT INTO calendly_events (lead_id, uri, start_time, status) VALUES (?, 'cal-1', ?, 'active')", [id, new Date(Date.now() + 86400000).toISOString()]);
  let enviado = null;
  definirChamadaFalsa(async (corpo) => { enviado = corpo; return { texto: '{"criterios":[],"temperatura":72,"resumo":"Bom perfil"}', uso: { input_tokens: 10, output_tokens: 5 } }; });
  const { lerConfig } = await import('../src/modules/organizador/config.js');
  assert.equal(av.temDadosParaLer(id), true);
  const r = await av.avaliarLead(id, { cfg: lerConfig() });
  assert.equal(r.resultado.temperatura, 72);
  assert.equal(get('SELECT ia_temperatura FROM leads WHERE id = ?', [id]).ia_temperatura, 72);
  const txt = enviado.messages[0].content;
  assert.match(txt, /Tem experiência no nicho\?: Mais de 3 anos/);
  assert.match(txt, /Reuniões no Calendly/);
  assert.match(txt, /ainda não há conversa/);
});

test('lead sem conversa, sem formulário e sem Calendly continua sem leitura (custo zero)', async () => {
  await preparar();
  const id = await criarLeadDireto({ nome: 'Avulso', telefone: '5511977776666' });
  let chamou = false;
  definirChamadaFalsa(async () => { chamou = true; return { texto: '{}', uso: {} }; });
  const { lerConfig } = await import('../src/modules/organizador/config.js');
  const r = await av.avaliarLead(id, { cfg: lerConfig() });
  assert.equal(r.resultado, null);
  assert.equal(chamou, false);
});

test('varredura: formulário novo marca o lead para leitura mesmo sem mensagem', async () => {
  await preparar();
  const cfgMod = await import('../src/modules/organizador/config.js');
  const motor = await import('../src/modules/organizador/motor.js');
  const { registrarEvento } = await import('../src/events.js');
  cfgMod.salvarConfig({ ativo: true }, { maxMsgId: motor.maxMsgId(), maxEventoId: motor.maxEventoId() });
  const id = await leadDoForm('Genésio', { respostas: [['Quer começar quando?', 'Imediatamente']] });
  registrarEvento({ leadId: id, type: 'form_submitted', data: {} });
  motor.marcarPendentes(cfgMod.lerConfig());
  assert.ok(get('SELECT ia_pendente_desde FROM leads WHERE id = ?', [id]).ia_pendente_desde);
});
