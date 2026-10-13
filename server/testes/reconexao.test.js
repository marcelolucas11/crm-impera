// Reconexão do WhatsApp com socket falso: versão do WhatsApp Web recusada, desconexão pelo celular
// e conexão de um número novo depois disso. Nada sai para o WhatsApp.
import { prepararBanco } from './ajuda.js';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

let db;
let ger;
let inst;
let consultasVersao = 0;
const criados = []; // { id, versao, sock }

const libFalsa = async () => {
  const real = await import('baileys');
  return {
    ...real,
    fetchLatestWaWebVersion: async () => {
      consultasVersao++;
      return { version: [2, 3000, 2000000000 + consultasVersao], isLatest: true };
    },
  };
};

function socketFalso() {
  return { ev: new EventEmitter(), user: { id: '5511900000000:3@s.whatsapp.net' }, logout: async () => {}, end: () => {} };
}

const fechar = (sock, statusCode, message = 'Connection Terminated') =>
  sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { message, output: { statusCode } } } });
const ultimo = (id) => criados.filter((c) => c.id === id).at(-1);
const esperar = (ms = 30) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  db = await prepararBanco();
  ger = await import('../src/modules/whatsapp/gerenciador.js');
  inst = await import('../src/modules/whatsapp/instancias.js');
  const lib = await libFalsa();
  ger.definirFabricaSocket(async (id, _lib, opcoes = {}) => {
    const sock = socketFalso();
    criados.push({ id, versao: opcoes.versao, sock });
    return { sock, saveCreds: async () => {} };
  }, lib);
});

test('conecta com a versão atual do WhatsApp Web e só consulta de novo quando o WhatsApp recusa', async () => {
  const id = ger.criarNumero('Comercial');
  await ger.conectar(id);
  assert.deepEqual(ultimo(id).versao, [2, 3000, 2000000001]);
  assert.equal(consultasVersao, 1);

  // O WhatsApp fecha a conexão na abertura (antes do QR code): versão recusada
  fechar(ultimo(id).sock, 428);
  const e = inst.estado(id);
  assert.equal(e.status, 'reconectando');
  assert.match(e.erro, /Atualizando a versão/);
  clearTimeout(e.timer);
  await ger.conectar(id);
  assert.equal(consultasVersao, 2, 'consultou a versão de novo');
  assert.deepEqual(ultimo(id).versao, [2, 3000, 2000000002]);

  // Agora o WhatsApp aceita e manda o QR code
  ultimo(id).sock.ev.emit('connection.update', { qr: 'QR-1' });
  assert.equal(e.status, 'aguardando_qr');
  assert.equal(e.qr, 'QR-1');
  await ger.desconectar(id);
});

test('desconectado pelo celular: apaga a sessão e um número novo conecta normalmente', async () => {
  const id = ger.criarNumero('Vendas');
  await ger.conectar(id);
  const sock = ultimo(id).sock;
  sock.ev.emit('connection.update', { connection: 'open' });
  const pasta = path.join(process.env.WHATSAPP_SESSOES, `numero-${id}`);
  fs.writeFileSync(path.join(pasta, 'creds.json'), '{}');
  assert.equal(inst.estado(id).status, 'conectado');

  // Celular → Aparelhos conectados → Desconectar
  fechar(sock, 401, 'Connection Failure');
  assert.equal(inst.estado(id).status, 'desconectado');
  assert.ok(!fs.existsSync(pasta), 'sessão apagada');
  // Salvamento atrasado da sessão antiga não recria a pasta nem derruba o servidor
  sock.ev.emit('creds.update', {});
  await esperar();
  assert.ok(!fs.existsSync(pasta));

  // Número novo
  const novo = ger.criarNumero('marcelo');
  await ger.conectar(novo);
  ultimo(novo).sock.ev.emit('connection.update', { qr: 'QR-NOVO' });
  assert.equal(inst.estado(novo).status, 'aguardando_qr');
  // E o mesmo número desconectado pode ler o QR code de novo
  await ger.conectar(id);
  ultimo(id).sock.ev.emit('connection.update', { qr: 'QR-DE-NOVO' });
  assert.equal(inst.estado(id).status, 'aguardando_qr');
  await ger.desconectar(novo);
  await ger.desconectar(id);
});

test('WHATSAPP_VERSAO no .env fixa a versão', async () => {
  process.env.WHATSAPP_VERSAO = '2.3000.123';
  try {
    const id = ger.criarNumero('Fixo');
    await ger.conectar(id);
    assert.deepEqual(ultimo(id).versao, [2, 3000, 123]);
    await ger.desconectar(id);
  } finally {
    delete process.env.WHATSAPP_VERSAO;
  }
});

test('falha ao consultar a versão não impede a conexão', async () => {
  const lib = await libFalsa();
  ger.esquecerVersao();
  const versao = await ger.versaoWhatsApp({ ...lib, fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 1], isLatest: false, error: new Error('sem internet') }) });
  assert.deepEqual(versao, [2, 3000, 1]);
  db.run('SELECT 1');
});
