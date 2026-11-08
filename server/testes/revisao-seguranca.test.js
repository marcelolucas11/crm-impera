// Revisão de segurança e desempenho (versão 0.27): sobe o CRM de verdade num banco temporário e confere pelo HTTP
// o bloqueio de pedidos de outros sites, o cache das listas, o fim das sessões ao trocar a senha, o limite de
// tentativas nos webhooks e que excluir um lead não apaga as conversas do WhatsApp.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validarConsulta } from '../src/modules/agente/consulta.js';

const SERVIDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-revisao-'));
const PORTA = 39000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORTA}`;
const env = {
  ...process.env,
  DB_FILE: path.join(PASTA, 'crm.db'),
  FILES_DIR: path.join(PASTA, 'arquivos'),
  WHATSAPP_SESSOES: path.join(PASTA, 'sessoes'),
  SESSION_SECRET: 'segredo-de-teste-com-mais-de-16',
  APP_PORT: String(PORTA),
  HOST: '127.0.0.1',
  WHATSAPP_ATIVO: '0',
  YAYFORMS_WEBHOOK_TOKEN: 'token-certo-do-webhook',
  PUBLIC_URL: '',
  BASE_PATH: '',
};
let processo = null;

const node = (args) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { cwd: SERVIDOR, env, stdio: 'pipe' });

async function esperarNoAr() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('o servidor de teste não subiu');
}

const MESMO_SITE = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

async function entrar(email = 'admin@teste.com', senha = 'senha-forte-123') {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: MESMO_SITE, body: JSON.stringify({ email, senha }) });
  assert.equal(r.status, 200, `login ${email}`);
  return r.headers.get('set-cookie').split(';')[0];
}

const pedir = (cookie, caminho, { method = 'GET', body, headers = {} } = {}) =>
  fetch(`${BASE}${caminho}`, { method, headers: { ...MESMO_SITE, cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  node(['src/cli.js', 'criar-usuario', '--admin', '--nome', 'Admin', '--email', 'admin@teste.com', '--senha', 'senha-forte-123']);
  processo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: SERVIDOR, env, stdio: 'ignore' });
  await esperarNoAr();
});

after(() => {
  processo?.kill('SIGKILL');
  fs.rmSync(PASTA, { recursive: true, force: true });
});

test('pedido de outro site (CSRF) é recusado; o da própria tela passa', async () => {
  const corpo = JSON.stringify({ email: 'admin@teste.com', senha: 'senha-forte-123' });
  const deFora = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: corpo });
  assert.equal(deFora.status, 403);
  const mesmoSite = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, body: corpo });
  assert.equal(mesmoSite.status, 403, 'outro subdomínio do mesmo domínio também não passa');
  const origemEstranha = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: 'https://site-malicioso.example', 'content-type': 'application/json' }, body: corpo });
  assert.equal(origemEstranha.status, 403);
  const mesmaOrigem = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: corpo });
  assert.equal(mesmaOrigem.status, 200);
  // Leitura (GET) nunca é bloqueada
  const cookie = mesmaOrigem.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: { cookie, 'sec-fetch-site': 'cross-site' } })).status, 200);
});

test('login: e-mail inexistente e senha errada respondem igual', async () => {
  const tentar = (email, senha) => fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: MESMO_SITE, body: JSON.stringify({ email, senha }) });
  const a = await tentar('ninguem@teste.com', 'qualquer-senha');
  const b = await tentar('admin@teste.com', 'senha-errada');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});

test('kanban e contadores do topo: a mesma versão volta 304 (sem recalcular nem reenviar)', async () => {
  const cookie = await entrar();
  const criado = await pedir(cookie, '/api/leads', { method: 'POST', body: { name: 'Lead do cache', phone: '11988887777' } });
  assert.equal(criado.status, 201);
  const r1 = await pedir(cookie, '/api/leads');
  assert.equal(r1.status, 200);
  const etag = r1.headers.get('etag');
  assert.ok(etag);
  assert.ok((await r1.json()).leads.some((l) => l.name === 'Lead do cache'));
  const r2 = await pedir(cookie, '/api/leads', { headers: { 'if-none-match': etag } });
  assert.equal(r2.status, 304);
  // Mudou um lead: a lista é recalculada na hora
  await pedir(cookie, '/api/leads', { method: 'POST', body: { name: 'Outro lead' } });
  const r3 = await pedir(cookie, '/api/leads', { headers: { 'if-none-match': etag } });
  assert.equal(r3.status, 200);
  assert.ok((await r3.json()).leads.some((l) => l.name === 'Outro lead'));
  const resumo = await (await pedir(cookie, '/api/followup/resumo')).json();
  for (const campo of ['horas', 'atrasados', 'lista', 'aguardando', 'conversas_nao_lidas']) assert.ok(campo in resumo, campo);
});

test('trocar a senha encerra as sessões dos outros aparelhos (o atual continua)', async () => {
  node(['src/cli.js', 'criar-usuario', '--nome', 'Membro', '--email', 'membro@teste.com', '--senha', 'senha-do-membro-1']);
  const aparelhoA = await entrar('membro@teste.com', 'senha-do-membro-1');
  const aparelhoB = await entrar('membro@teste.com', 'senha-do-membro-1');
  const troca = await pedir(aparelhoA, '/api/auth/senha', { method: 'POST', body: { atual: 'senha-do-membro-1', nova: 'senha-nova-do-membro' } });
  assert.equal(troca.status, 200);
  assert.equal((await pedir(aparelhoA, '/api/auth/me')).status, 200);
  assert.equal((await pedir(aparelhoB, '/api/auth/me')).status, 401);
});

test('excluir o lead tira o cartão do kanban mas não apaga as conversas do WhatsApp', async () => {
  const cookie = await entrar();
  const { lead } = await (await pedir(cookie, '/api/leads', { method: 'POST', body: { name: 'Lead com conversa', phone: '11977776666' } })).json();
  const db = new DatabaseSync(env.DB_FILE);
  db.prepare("INSERT INTO wa_messages (lead_id, chat_jid, wa_id, from_me, body, timestamp) VALUES (?, '5511977776666@s.whatsapp.net', 'MSG-EXCLUIR-1', 0, 'oi', ?)")
    .run(lead.id, new Date().toISOString());
  db.close();
  assert.equal((await pedir(cookie, `/api/leads/${lead.id}`, { method: 'DELETE' })).status, 200);
  const leitura = new DatabaseSync(env.DB_FILE, { readOnly: true });
  const msg = leitura.prepare("SELECT lead_id FROM wa_messages WHERE wa_id = 'MSG-EXCLUIR-1'").get();
  leitura.close();
  assert.ok(msg, 'a mensagem continua no banco');
  assert.equal(msg.lead_id, null);
});

test('webhook com token errado: depois de muitas tentativas o endereço fica bloqueado por um tempo', async () => {
  let bloqueado = false;
  for (let i = 0; i < 70 && !bloqueado; i++) {
    const r = await fetch(`${BASE}/webhooks/yayforms/token-errado-${i}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (r.status === 429) bloqueado = true;
    else assert.equal(r.status, 404);
  }
  assert.ok(bloqueado);
});

test('consulta da assistente: nomes entre aspas não escondem tabelas sigilosas', () => {
  const bloqueadas = [
    `SELECT "'" AS x, data AS d FROM integration_state WHERE "'" = "'"`,
    `SELECT "'" AS x, password_hash AS h FROM users WHERE "'" = "'"`,
    'select * from main.sessions',
    'select * from [ig_credenciais]',
    'select texto from agente_mensagens',
    'select 1; delete from leads',
    "select '",
  ];
  for (const sql of bloqueadas) assert.throws(() => validarConsulta(sql), undefined, sql);
  for (const sql of ["select name from leads where name like '%delete%'", "select 'a--b', replace(name, 'a', 'b') from leads -- obs", 'with x as (select 1) select * from x']) {
    assert.doesNotThrow(() => validarConsulta(sql), sql);
  }
});
