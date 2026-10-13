import { prepararBanco, limparBanco, socketFalso, segundos } from './ajuda.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let db;
let lib;
before(async () => {
  db = await prepararBanco();
  lib = await import('baileys');
  db.run("INSERT OR IGNORE INTO wa_instances (id, name) VALUES (1, 'Comercial')");
});
beforeEach(limparBanco);

test('voto de enquete: o CRM cifra como o WhatsApp e decifra votos recebidos', async () => {
  const { gravarMensagem } = await import('../src/modules/whatsapp/recebimento.js');
  const { cifrarVoto } = await import('../src/modules/whatsapp/envio.js');
  const sock = socketFalso();
  const segredo = crypto.randomBytes(32);
  const jid = '5511912345678@s.whatsapp.net';
  const enquete = {
    key: { remoteJid: jid, fromMe: true, id: 'ENQ1' },
    message: {
      pollCreationMessageV3: { name: 'Melhor horário?', options: [{ optionName: 'Manhã' }, { optionName: 'Tarde' }], selectableOptionsCount: 1 },
      messageContextInfo: { messageSecret: segredo },
    },
    messageTimestamp: segundos(0),
  };
  await gravarMensagem(1, sock, lib, enquete, 'ao_vivo');
  const linha = db.get("SELECT type, extra FROM wa_messages WHERE wa_id = 'ENQ1'");
  assert.equal(linha.type, 'enquete');
  assert.deepEqual(JSON.parse(linha.extra).opcoes, ['Manhã', 'Tarde']);

  // O contato vota "Tarde"
  const voto = cifrarVoto(lib, { segredo, msgId: 'ENQ1', autor: '5511900000000@s.whatsapp.net', votante: jid, opcoes: ['Tarde'] });
  await gravarMensagem(1, sock, lib, {
    key: { remoteJid: jid, fromMe: false, id: 'VOTO1' },
    message: { pollUpdateMessage: { pollCreationMessageKey: { remoteJid: jid, fromMe: true, id: 'ENQ1' }, vote: voto, senderTimestampMs: Date.now() } },
    messageTimestamp: segundos(0),
    pushName: 'Contato',
  }, 'ao_vivo');
  const extra = JSON.parse(db.get("SELECT extra FROM wa_messages WHERE wa_id = 'ENQ1'").extra);
  assert.deepEqual(extra.votos[jid], ['Tarde']);
  // O voto não vira mensagem na conversa
  assert.equal(db.get("SELECT count(*) n FROM wa_messages WHERE wa_id = 'VOTO1'").n, 0);
});

test('figurinhas favoritas do celular: a ação do app state é lida pelo logger do número', async () => {
  const { loggerComFigurinhas, listarFigurinhas } = await import('../src/modules/whatsapp/figurinhas.js');
  const log = await loggerComFigurinhas(1);
  // Exatamente como o Baileys chama em processSyncAction
  log.trace({
    syncAction: {
      syncAction: { value: { stickerAction: { isFavorite: true, mediaKey: Buffer.alloc(32), directPath: '/v/t62/abc', mimetype: 'image/webp', width: 512, height: 512, isLottie: true } } },
      index: ['favoriteSticker', 'HASHDAFIGURINHA'],
    },
    initialSync: true,
  }, 'processing sync action');
  const f = db.get("SELECT phone_favorite, origin, media FROM wa_stickers WHERE hash = 'cel:HASHDAFIGURINHA'");
  assert.equal(f.phone_favorite, 1);
  assert.equal(f.origin, 'celular');
  assert.equal(JSON.parse(f.media).directPath, '/v/t62/abc');
  assert.equal(listarFigurinhas().favoritas.length, 1);
  // Desfavoritada no celular
  log.trace({ syncAction: { syncAction: { value: { stickerAction: { isFavorite: false } } }, index: ['favoriteSticker', 'HASHDAFIGURINHA'] } }, 'processing sync action');
  assert.equal(db.get("SELECT phone_favorite FROM wa_stickers WHERE hash = 'cel:HASHDAFIGURINHA'").phone_favorite, 0);
});

test('a mesma figurinha recebida duas vezes é guardada uma vez (recentes)', async () => {
  const { registrarFigurinha, listarFigurinhas } = await import('../src/modules/whatsapp/figurinhas.js');
  const buffer = Buffer.from('RIFF....WEBPVP8 teste');
  const a = registrarFigurinha({ buffer, usadaEm: '2026-10-01T00:00:00.000Z' });
  const b = registrarFigurinha({ buffer, usadaEm: '2026-10-05T00:00:00.000Z' });
  assert.equal(a, b);
  const r = listarFigurinhas().recentes;
  assert.equal(r.length, 1);
  assert.equal(r[0].last_used_at, '2026-10-05T00:00:00.000Z');
});
