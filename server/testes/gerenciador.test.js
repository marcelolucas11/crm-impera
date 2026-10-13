// Fluxo completo com um socket falso do Baileys (nenhum número real é conectado e nada sai para o WhatsApp)
import { prepararBanco, limparBanco, criarLeadDireto, mensagem, segundos } from './ajuda.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

let db;
let lib;
let ger;
let envio;
let conversas;
let sock;
const enviados = [];

function criarSocketFalso() {
  const ev = new EventEmitter();
  return {
    ev,
    user: { id: '5511900000000:3@s.whatsapp.net', lid: '99999999999999@lid' },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    sendMessage: async (jid, conteudo, opcoes) => {
      enviados.push({ jid, conteudo, opcoes });
      return { key: { remoteJid: jid, fromMe: true, id: opcoes?.messageId }, message: { conversation: conteudo.text || '' }, messageTimestamp: segundos(0) };
    },
    readMessages: async () => {},
    onWhatsApp: async (...nums) => nums.map((n) => ({ jid: `${n}@s.whatsapp.net`, exists: true })),
    fetchMessageHistory: async () => 'pedido',
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async () => {},
    chatModify: async () => {},
    rejectCall: async () => {},
    createCallLink: async () => 'TOKEN123',
    groupMetadata: async () => ({ subject: 'Grupo' }),
    logout: async () => {},
    end: () => {},
  };
}

before(async () => {
  db = await prepararBanco();
  lib = await import('baileys');
  ger = await import('../src/modules/whatsapp/gerenciador.js');
  envio = await import('../src/modules/whatsapp/envio.js');
  conversas = await import('../src/modules/whatsapp/conversas.js');
  db.run("INSERT OR IGNORE INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  ger.definirFabricaSocket(async () => {
    sock = criarSocketFalso();
    return { sock, saveCreds: () => {} };
  });
  await ger.conectar(1);
  sock.ev.emit('connection.update', { connection: 'open' });
});
beforeEach(async () => { await limparBanco(); enviados.length = 0; });

const esperar = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('mensagem nova ao vivo entra como não lida e liga ao lead', async () => {
  const lead = await criarLeadDireto({ nome: 'Cliente', telefone: '5511987654321' });
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [mensagem({ jid: '551187654321@s.whatsapp.net', texto: 'Quero saber o preço' })] });
  await esperar();
  const m = db.get('SELECT lead_id, read_at FROM wa_messages');
  assert.equal(m.lead_id, lead);
  assert.equal(m.read_at, null);
  const { conversas: lista } = conversas.listarConversas();
  assert.equal(lista[0].chave, `l:${lead}`);
  assert.equal(lista[0].nao_lidas, 1);
});

test('envio pelo CRM: grava, manda para o WhatsApp e zera o follow-up', async () => {
  const lead = await criarLeadDireto({ nome: 'Cliente', telefone: '5511987654321' });
  const r = await envio.enviar(1, { leadId: lead }, { texto: 'Olá! Tudo bem?' }, null);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].conteudo.text, 'Olá! Tudo bem?');
  const m = db.get('SELECT status, from_me, lead_id FROM wa_messages WHERE id = ?', [r.id]);
  assert.equal(m.status, 2);
  assert.equal(m.lead_id, lead);
  assert.ok(db.get('SELECT last_contact_at FROM leads WHERE id = ?', [lead]).last_contact_at);
});

test('estado da conversa: arquivar, fixar, favoritar e ocultar sem apagar nada', async () => {
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [mensagem({ jid: '5511911112222@s.whatsapp.net', texto: 'oi' })] });
  await esperar();
  const chave = 't:5511911112222';
  await conversas.definirEstado(chave, { arquivada: true });
  assert.equal(conversas.listarConversas().conversas.length, 0);
  assert.equal(conversas.listarConversas().arquivadas, 1);
  assert.equal(conversas.listarConversas({ filtro: 'arquivadas' }).conversas.length, 1);
  await conversas.definirEstado(chave, { arquivada: false, fixada: true, favorita: true });
  const c = conversas.listarConversas({ filtro: 'favoritas' }).conversas[0];
  assert.ok(c.fixada);
  await conversas.definirEstado(chave, { oculta: true });
  assert.equal(conversas.listarConversas().conversas.length, 0);
  assert.equal(db.get('SELECT count(*) n FROM wa_messages').n, 1);
  // Mensagem nova faz a conversa voltar
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [mensagem({ jid: '5511911112222@s.whatsapp.net', texto: 'voltei' })] });
  await esperar();
  assert.equal(conversas.listarConversas().conversas.length, 1);
});

test('editar, estrela, apagar para mim e encaminhar', async () => {
  const lead = await criarLeadDireto({ nome: 'Cliente', telefone: '5511987654321' });
  const { id } = await envio.enviar(1, { leadId: lead }, { texto: 'primeira versão' }, null);
  await envio.editar(id, 'versão corrigida');
  assert.equal(enviados.at(-1).conteudo.text, 'versão corrigida');
  assert.ok(enviados.at(-1).conteudo.edit);
  assert.equal(db.get('SELECT body FROM wa_messages WHERE id = ?', [id]).body, 'versão corrigida');
  await envio.estrela(id, true);
  assert.equal(conversas.listarFavoritas().length, 1);
  const res = await envio.encaminhar(id, [{ jid: '5521900001111@s.whatsapp.net' }, { jid: '5521900002222@s.whatsapp.net' }], 1, null);
  assert.equal(res.filter((r) => r.ok).length, 2);
  assert.ok(enviados.at(-1).conteudo.forward);
  envio.ocultarParaMim(id);
  assert.equal(db.get('SELECT hidden_at IS NOT NULL AS h FROM wa_messages WHERE id = ?', [id]).h, 1);
  assert.equal(conversas.mensagensDaConversa(`l:${lead}`).mensagens.length, 0);
});

test('chamada recebida: aviso, recusar e registro na conversa', async () => {
  const lead = await criarLeadDireto({ nome: 'Quem liga', telefone: '5511955556666' });
  const ch = await import('../src/modules/whatsapp/chamadas.js');
  sock.ev.emit('call', [{ id: 'CALL1', from: '5511955556666@s.whatsapp.net', chatId: '5511955556666@s.whatsapp.net', status: 'offer', isVideo: true, date: new Date(), offline: false }]);
  await esperar();
  assert.equal(ch.chamadasAtivas().length, 1);
  assert.equal(ch.chamadasAtivas()[0].chave, `l:${lead}`);
  await ch.recusarChamada('CALL1');
  const m = db.get("SELECT type, body, lead_id FROM wa_messages WHERE wa_id = 'call-CALL1'");
  assert.equal(m.type, 'chamada');
  assert.equal(m.lead_id, lead);
  assert.match(m.body, /recusada/);
  assert.equal(ch.chamadasAtivas().length, 0);
  const link = await ch.criarLinkDeChamada(1, false);
  assert.equal(link.link, 'https://call.whatsapp.com/voice/TOKEN123');
});

test('chamada atendida no celular registra a duração', async () => {
  sock.ev.emit('call', [{ id: 'CALL2', from: '5511977778888@s.whatsapp.net', status: 'offer', isVideo: false, date: new Date(Date.now() - 65000) }]);
  await esperar();
  sock.ev.emit('call', [{ id: 'CALL2', from: '5511977778888@s.whatsapp.net', status: 'accept', date: new Date(Date.now() - 60000) }]);
  sock.ev.emit('call', [{ id: 'CALL2', from: '5511977778888@s.whatsapp.net', status: 'terminate', date: new Date() }]);
  await esperar();
  const m = db.get("SELECT body, extra FROM wa_messages WHERE wa_id = 'call-CALL2'");
  assert.equal(JSON.parse(m.extra).resultado, 'atendida_em_outro_aparelho');
  assert.ok(JSON.parse(m.extra).duracao >= 59);
});

test('importar histórico de número já conectado pede ao celular conversa por conversa', async () => {
  const hist = await import('../src/modules/whatsapp/historico.js');
  const jid = '5511912345678@s.whatsapp.net';
  // O CRM só tem mensagens de 10 dias atrás para cá
  sock.ev.emit('messaging-history.set', { messages: [mensagem({ jid, diasAtras: 10 }), mensagem({ jid, diasAtras: 5 })], syncType: lib.proto.HistorySync.HistorySyncType.RECENT });
  await esperar(100);
  const pedidos = [];
  sock.fetchMessageHistory = async (n, chave, ts) => {
    pedidos.push({ n, chave, ts });
    // O celular responde com mensagens mais antigas na primeira vez; depois, mais nada
    setTimeout(() => sock.ev.emit('messaging-history.set', {
      messages: pedidos.length === 1 ? [mensagem({ jid, diasAtras: 40 }), mensagem({ jid, diasAtras: 95 })] : [],
      syncType: lib.proto.HistorySync.HistorySyncType.ON_DEMAND,
    }), 10);
  };
  process.env.WHATSAPP_HISTORICO_INTERVALO_MS = '1';
  const p = await hist.importarHistorico(1);
  assert.equal(p.fase, 'concluido');
  assert.ok(pedidos.length >= 1);
  assert.equal(pedidos[0].chave.remoteJid, jid);
  assert.ok(pedidos[0].ts > 1e12, 'o horário vai em milissegundos');
  // Fora da janela (95 dias) não entra
  assert.equal(db.get('SELECT count(*) n FROM wa_messages').n, 3);
});
