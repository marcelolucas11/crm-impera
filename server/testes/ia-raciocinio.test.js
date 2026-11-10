// Raciocínio (thinking) dos modelos 5.x nas respostas rápidas da IA: ele vem ligado por padrão e os tokens dele contam
// no max_tokens. Antes, um áudio transcrito fazia o modelo pensar até gastar o limite e a resposta voltava "cortada"
// nas duas tentativas. Aqui a "API da Anthropic" é um servidor local falso: nada sai da máquina.
import { prepararBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const pedidos = [];
let roteiro = []; // funções (corpo) => { status, json } — uma por chamada; vazio = resposta padrão
const servidor = http.createServer((req, res) => {
  let dados = '';
  req.on('data', (c) => { dados += c; });
  req.on('end', () => {
    const corpo = JSON.parse(dados);
    pedidos.push(corpo);
    const passo = roteiro.shift();
    const r = passo ? passo(corpo) : { status: 200, json: resposta('{"mensagens": ["Oi!"], "acao": "responder", "resumo": "ok"}') };
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.json));
  });
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${servidor.address().port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const config = await import('../src/modules/ia/config.js');
const { perguntarModelo, perguntarNoFormato, explicarFalha, FOLGA_RACIOCINIO } = await import('../src/modules/ia/cliente.js');

function resposta(texto, parada = 'end_turn', comPensamento = false) {
  const content = [];
  if (comPensamento) content.push({ type: 'thinking', thinking: '', signature: 'ASSINATURA' });
  if (texto) content.push({ type: 'text', text: texto });
  return { content, stop_reason: parada, usage: { input_tokens: 10, output_tokens: 900 } };
}
const recusa = (mensagem) => () => ({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: mensagem } } });
const pedir = (extra = {}) => perguntarModelo({ sistema: 's', mensagens: [{ role: 'user', content: 'oi' }], maxTokens: 900, ...extra });

test.after(() => servidor.close());

test('Haiku 5.5 (o padrão): raciocínio desligado e o limite de 900 fica todo para a resposta', async () => {
  config.salvarConfig({ modelo_atendimento: 'claude-haiku-5-5' });
  pedidos.length = 0;
  await pedir();
  assert.deepEqual(pedidos[0].thinking, { type: 'disabled' });
  assert.equal(pedidos[0].max_tokens, 900);
  assert.equal(pedidos[0].output_config, undefined);
});

test('Sonnet 5.5 / Opus 5.5 / Fable (não deixam desligar): esforço baixo e folga no limite para o raciocínio', async () => {
  for (const modelo of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']) {
    config.salvarConfig({ modelo_atendimento: modelo });
    pedidos.length = 0;
    await pedir();
    assert.equal(pedidos[0].model, modelo);
    assert.equal(pedidos[0].thinking, undefined, modelo);
    assert.deepEqual(pedidos[0].output_config, { effort: 'low' }, modelo);
    assert.equal(pedidos[0].max_tokens, 900 + FOLGA_RACIOCINIO, modelo);
  }
  config.salvarConfig({ modelo_atendimento: 'claude-haiku-5-5' });
});

test('análises longas (pensar) continuam com raciocínio adaptativo e esforço alto', async () => {
  pedidos.length = 0;
  await pedir({ pensar: true, maxTokens: 16000, modelo: 'claude-opus-5-5' });
  assert.deepEqual(pedidos[0].thinking, { type: 'adaptive' });
  assert.deepEqual(pedidos[0].output_config, { effort: 'high' });
  assert.equal(pedidos[0].max_tokens, 16000);
});

test('se a API recusar desligar o raciocínio, tira o ajuste, usa a folga e lembra para as próximas', async () => {
  pedidos.length = 0;
  roteiro = [recusa('thinking.type "disabled" is not supported for this model')];
  const r = await pedir({ modelo: 'claude-haiku-5-5' });
  assert.equal(r.texto, '{"mensagens": ["Oi!"], "acao": "responder", "resumo": "ok"}');
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].thinking, undefined);
  assert.deepEqual(pedidos[1].output_config, { effort: 'low' });
  assert.equal(pedidos[1].max_tokens, 900 + FOLGA_RACIOCINIO);
  // Próxima chamada já vai sem tentar desligar
  await pedir({ modelo: 'claude-haiku-5-5' });
  assert.equal(pedidos.length, 3);
  assert.equal(pedidos[2].thinking, undefined);
});

test('modelo que não aceita o esforço (ex.: um antigo definido no .env): tira o esforço e segue', async () => {
  pedidos.length = 0;
  roteiro = [recusa('output_config.effort: Extra inputs are not permitted')];
  await pedir({ modelo: 'claude-modelo-antigo' });
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].output_config, undefined);
  assert.equal(pedidos[1].max_tokens, 900 + FOLGA_RACIOCINIO);
});

test('outros erros da API não viram nova tentativa e chegam em português', async () => {
  pedidos.length = 0;
  roteiro = [() => ({ status: 401, json: { error: { message: 'invalid x-api-key' } } })];
  await assert.rejects(pedir({ modelo: 'claude-sonnet-5-5' }), /recusou a chave/);
  assert.equal(pedidos.length, 1);
});

test('limite gasto só pensando (sem texto): a 2ª tentativa ganha folga e o aviso diz que veio vazia', async () => {
  config.salvarConfig({ modelo_atendimento: 'claude-sonnet-5-5' });
  pedidos.length = 0;
  roteiro = [() => ({ status: 200, json: resposta('', 'max_tokens', true) })];
  const r = await perguntarNoFormato({ sistema: 's', mensagens: [{ role: 'user', content: '[o lead mandou um áudio] O que foi falado: "..."' }] });
  assert.equal(r.tentativas, 2);
  assert.deepEqual(r.resposta.mensagens, ['Oi!']);
  assert.equal(pedidos[1].max_tokens, 900 + 2 * FOLGA_RACIOCINIO);
  assert.match(pedidos[1].messages.at(-1).content, /veio vazia/);

  // Nas duas vezes sem texto: a explicação para a equipe não fala mais em "longa demais"
  roteiro = [() => ({ status: 200, json: resposta('', 'max_tokens', true) }), () => ({ status: 200, json: resposta('', 'max_tokens', true) })];
  const r2 = await perguntarNoFormato({ sistema: 's', mensagens: [{ role: 'user', content: 'oi' }] });
  assert.equal(r2.resposta, null);
  assert.match(explicarFalha(r2.parada, r2.texto), /raciocinando/);
  assert.match(explicarFalha('max_tokens', '{"mensagens": ["cort'), /cortada/);
  assert.match(explicarFalha('refusal', ''), /recusou/);
  config.salvarConfig({ modelo_atendimento: 'claude-haiku-5-5' });
});
