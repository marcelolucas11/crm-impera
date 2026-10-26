import { prepararBanco } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = await prepararBanco();
const t = await import('../src/modules/calendly/token.js');
const TOKEN = 'eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0';

const fetchOriginal = globalThis.fetch;
const simular = (status, corpo = {}) => { globalThis.fetch = async (url, op) => { simular.ultimo = { url, op }; return { ok: status < 400, status, json: async () => corpo }; }; };
test.after(() => { globalThis.fetch = fetchOriginal; });

test('token colado na tela: confere com o Calendly, guarda e não aparece em nenhuma resposta', async () => {
  assert.equal(t.montarStatus().configurado, false);
  simular(200, { resource: { uri: 'https://api.calendly.com/users/U1', name: 'Marcelo', email: 'm@x.com' } });
  const conta = await t.conectarComToken(`  Bearer ${TOKEN}\n`);
  assert.deepEqual(conta, { nome: 'Marcelo', email: 'm@x.com' });
  assert.equal(simular.ultimo.op.headers.Authorization, `Bearer ${TOKEN}`, 'limpa espaços e o prefixo Bearer');
  assert.equal(t.tokenCalendly(), TOKEN);

  const status = t.montarStatus();
  assert.equal(status.configurado, true);
  assert.equal(status.origem_token, 'painel');
  assert.equal(status.token_final, `••••${TOKEN.slice(-4)}`);
  assert.equal(status.conta.nome, 'Marcelo');
  assert.ok(!JSON.stringify(status).includes(TOKEN.slice(0, 30)), 'o token inteiro nunca vai para a tela');
});

test('token recusado pelo Calendly não é guardado e o anterior continua valendo', async () => {
  simular(401);
  await assert.rejects(() => t.conectarComToken('x'.repeat(40)), /recusou/);
  assert.equal(t.tokenCalendly(), TOKEN);
});

test('texto que não parece token é rejeitado sem nem chamar o Calendly', async () => {
  let chamou = false;
  globalThis.fetch = async () => { chamou = true; return { ok: true, status: 200, json: async () => ({}) }; };
  await assert.rejects(() => t.conectarComToken('curto'), /não parece um token/);
  await assert.rejects(() => t.conectarComToken('"cola com aspas e espaço"'), /não parece um token/);
  assert.equal(chamou, false);
});

test('desconectar apaga o token e a conta guardados', () => {
  t.removerToken();
  const status = t.montarStatus();
  assert.equal(status.configurado, false);
  assert.equal(status.conta, null);
  assert.equal(t.tokenCalendly(), '');
});
