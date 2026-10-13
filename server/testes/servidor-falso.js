// Liga o CRM com números de WhatsApp FALSOS (nada sai para o WhatsApp de verdade) — para testar a interface.
// Uso (sempre com banco temporário):
//   DB_FILE=/tmp/x/crm.db FILES_DIR=/tmp/x/arquivos WHATSAPP_SESSOES=/tmp/x/sessoes SESSION_SECRET=... node testes/servidor-falso.js
// O que é "enviado" só aparece no log como [falso].
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

if (!process.env.DB_FILE || !process.env.WHATSAPP_SESSOES) {
  console.error('Defina DB_FILE e WHATSAPP_SESSOES para pastas temporárias.');
  process.exit(1);
}

const ger = await import('../src/modules/whatsapp/gerenciador.js');
const segundos = () => Math.floor(Date.now() / 1000);

ger.definirFabricaSocket(async (id) => {
  const ev = new EventEmitter();
  const sock = {
    ev,
    user: { id: `551190000000${id - 1}:1@s.whatsapp.net`, lid: `9999999999${id}@lid`, name: 'Teste' },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    authState: { keys: { set: async () => {} } },
    sendMessage: async (jid, conteudo, opcoes) => {
      console.log(`[falso #${id}] para ${jid}:`, JSON.stringify(conteudo).slice(0, 160));
      return { key: { remoteJid: jid, fromMe: true, id: opcoes?.messageId }, message: { conversation: conteudo.text || '' }, messageTimestamp: segundos() };
    },
    relayMessage: async () => 'ok',
    readMessages: async () => {},
    onWhatsApp: async (...nums) => nums.map((n) => ({ jid: `${n}@s.whatsapp.net`, exists: true })),
    fetchMessageHistory: async () => 'ok',
    presenceSubscribe: async (jid) => {
      setTimeout(() => ev.emit('presence.update', { id: jid, presences: { [jid]: { lastKnownPresence: 'unavailable', lastSeen: segundos() - 600 } } }), 300);
    },
    sendPresenceUpdate: async () => {},
    chatModify: async () => {},
    rejectCall: async () => {},
    createCallLink: async (tipo) => `EXEMPLO${tipo === 'video' ? 'VID' : 'VOZ'}123`,
    resyncAppState: async () => {},
    groupMetadata: async () => ({ subject: 'Grupo' }),
    profilePictureUrl: async () => { const e = new Error('item-not-found'); e.data = 404; throw e; },
    updateMediaMessage: async (m) => m,
    logout: async () => {},
    end: () => {},
  };
  setTimeout(() => ev.emit('connection.update', { connection: 'open' }), 200);
  return { sock, saveCreds: () => {} };
});

// Sessões falsas para os números conectarem sozinhos ao ligar
for (const id of [1, 2]) {
  const pasta = path.join(process.env.WHATSAPP_SESSOES, `numero-${id}`);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'creds.json'), '{}');
}

await import('../src/index.js');

// Uma chamada de exemplo tocando 4 s depois de ligar (só se pedido)
if (process.env.CHAMADA_EXEMPLO === '1') {
  setTimeout(async () => {
    const { instancias } = await import('../src/modules/whatsapp/instancias.js');
    const e = instancias.get(1);
    e?.sock?.ev.emit('call', [{ id: 'CHAMADA-EXEMPLO', from: '5521987650002@s.whatsapp.net', status: 'offer', isVideo: true, date: new Date(), offline: false }]);
  }, 4000);
}
