// Importação do histórico sem precisar de clique: celular que para de responder (tela bloqueada)
// faz a importação esperar e continuar sozinha, sem pular conversas nem parar como "interrompida".
process.env.WHATSAPP_HISTORICO_INTERVALO_MS = '1';
process.env.WHATSAPP_HISTORICO_ESPERA_MS = '80';
process.env.WHATSAPP_HISTORICO_PAUSAS_MS = '100,100,100,5000';

import { prepararBanco, limparBanco, mensagem } from './ajuda.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

let db;
let lib;
let ger;
let hist;
let sock;

function criarSocketFalso() {
  return {
    ev: new EventEmitter(),
    user: { id: '5511900000000:3@s.whatsapp.net', lid: '99999999999999@lid' },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    fetchMessageHistory: async () => 'pedido',
    groupMetadata: async () => ({ subject: 'Grupo' }),
    end: () => {},
  };
}

before(async () => {
  db = await prepararBanco();
  lib = await import('baileys');
  ger = await import('../src/modules/whatsapp/gerenciador.js');
  hist = await import('../src/modules/whatsapp/historico.js');
  db.run("INSERT OR IGNORE INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  ger.definirFabricaSocket(async () => {
    sock = criarSocketFalso();
    return { sock, saveCreds: () => {} };
  });
  await ger.conectar(1);
  sock.ev.emit('connection.update', { connection: 'open' });
});
beforeEach(async () => { await limparBanco(); });

const esperar = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const ON_DEMAND = () => lib.proto.HistorySync.HistorySyncType.ON_DEMAND;

test('celular bloqueado no meio: espera, continua sozinho e termina sem clique', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  sock.ev.emit('messaging-history.set', { messages: [mensagem({ jid, diasAtras: 10 })], syncType: lib.proto.HistorySync.HistorySyncType.RECENT });
  await esperar(100);

  let pedidos = 0;
  const fases = new Set();
  sock.fetchMessageHistory = async () => {
    pedidos++;
    fases.add(hist.progressoDe(1)?.fase);
    // Pedidos 1 a 4: celular bloqueado, não responde. Depois responde normalmente.
    if (pedidos <= 4) return;
    setTimeout(() => sock.ev.emit('messaging-history.set', {
      messages: pedidos === 5 ? [mensagem({ jid, diasAtras: 40 })] : [],
      syncType: ON_DEMAND(),
    }), 5);
  };

  const olhar = setInterval(() => fases.add(hist.progressoDe(1)?.fase), 10);
  const p = await hist.importarHistorico(1);
  clearInterval(olhar);
  assert.equal(p.fase, 'concluido');
  assert.equal(p.erro, null);
  assert.ok(pedidos >= 6, `repetiu os pedidos sem resposta (${pedidos})`);
  assert.ok(fases.has('aguardando_celular'), 'mostrou na tela que estava esperando o celular');
  assert.equal(db.get('SELECT count(*) n FROM wa_messages').n, 2, 'a mensagem de 40 dias entrou');
  assert.equal(db.get('SELECT history_done FROM wa_chats WHERE jid = ?', [jid])?.history_done, 1);
});

test('mensagem enviada pelo celular acorda a importação antes do fim da pausa', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  sock.ev.emit('messaging-history.set', { messages: [mensagem({ jid, diasAtras: 10 })], syncType: lib.proto.HistorySync.HistorySyncType.RECENT });
  await esperar(100);
  let pedidos = 0;
  sock.fetchMessageHistory = async () => {
    pedidos++;
    if (pedidos <= 5) return; // sem resposta: as pausas crescem até a de 5 s
    setTimeout(() => sock.ev.emit('messaging-history.set', { messages: [], syncType: ON_DEMAND() }), 5);
  };
  const inicio = Date.now();
  const promessa = hist.importarHistorico(1);
  await esperar(1500);
  assert.equal(hist.progressoDe(1).fase, 'aguardando_celular');
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [mensagem({ jid, deMim: true, texto: 'oi' })] });
  const p = await promessa;
  assert.equal(p.fase, 'concluido');
  assert.ok(Date.now() - inicio < 4000, 'não esperou a pausa inteira');
});
