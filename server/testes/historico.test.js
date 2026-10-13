import { prepararBanco, limparBanco, criarLeadDireto, mensagem, socketFalso, segundos } from './ajuda.js';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db;
let lib;
let hist;
let sock;
const RECENT = () => lib.proto.HistorySync.HistorySyncType.RECENT;

before(async () => {
  db = await prepararBanco();
  lib = await import('baileys');
  hist = await import('../src/modules/whatsapp/historico.js');
  db.run("INSERT OR IGNORE INTO wa_instances (id, name) VALUES (1, 'Comercial'), (2, 'Suporte')");
});
beforeEach(async () => {
  await limparBanco();
  sock = socketFalso({ lids: { '777000111@lid': '5511966665555@s.whatsapp.net' } });
});

const contar = (sql, p = []) => db.get(sql, p).n;

test('importa só o que está dentro da janela de 90 dias', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  const messages = [10, 89, 91, 200].map((d) => mensagem({ jid, diasAtras: d, texto: `de ${d} dias` }));
  const r = await hist.aoReceberHistorico(1, sock, lib, { messages, syncType: RECENT(), progress: 50 });
  assert.equal(r.novas, 2);
  assert.deepEqual(db.all('SELECT body FROM wa_messages ORDER BY timestamp').map((m) => m.body), ['de 89 dias', 'de 10 dias']);
});

test('não duplica: o mesmo lote duas vezes (ou por dois números) grava uma vez só', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  const messages = [1, 2, 3].map((d) => mensagem({ jid, diasAtras: d }));
  await hist.aoReceberHistorico(1, sock, lib, { messages, syncType: RECENT() });
  await hist.aoReceberHistorico(1, sock, lib, { messages, syncType: RECENT() });
  await hist.aoReceberHistorico(2, sock, lib, { messages, syncType: RECENT() });
  assert.equal(contar('SELECT count(*) n FROM wa_messages'), 3);
});

test('mensagens antigas entram como lidas (sem contador de mensagem nova)', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  await hist.aoReceberHistorico(1, sock, lib, { messages: [mensagem({ jid, diasAtras: 5 }), mensagem({ jid, diasAtras: 4 })], syncType: RECENT() });
  assert.equal(contar('SELECT count(*) n FROM wa_messages WHERE from_me = 0 AND read_at IS NULL'), 0);
});

test('liga ao lead do formulário (9º dígito e LID) e o último contato reflete o histórico real', async () => {
  const lead = await criarLeadDireto({ nome: 'Formulário', telefone: '5511987654321' });
  const lead2 = await criarLeadDireto({ nome: 'Lid', telefone: '5511966665555' });
  const messages = [
    mensagem({ jid: '551187654321@s.whatsapp.net', diasAtras: 30, texto: 'oi' }),
    mensagem({ jid: '551187654321@s.whatsapp.net', diasAtras: 29, deMim: true, texto: 'olá!' }),
    mensagem({ jid: '551187654321@s.whatsapp.net', diasAtras: 3, deMim: true, texto: 'e aí?' }),
    // Conversa por LID: o telefone vem do mapeamento do celular
    mensagem({ jid: '777000111@lid', diasAtras: 2, deMim: true, texto: 'pelo lid' }),
  ];
  await hist.aoReceberHistorico(1, sock, lib, { messages, syncType: RECENT() });
  assert.equal(contar('SELECT count(*) n FROM wa_messages WHERE lead_id = ?', [lead]), 3);
  assert.equal(contar('SELECT count(*) n FROM wa_messages WHERE lead_id = ?', [lead2]), 1);
  const l = db.get('SELECT last_contact_at, first_contact_at FROM leads WHERE id = ?', [lead]);
  assert.equal(l.last_contact_at, new Date(segundos(3) * 1000).toISOString());
  assert.equal(l.first_contact_at, new Date(segundos(29) * 1000).toISOString());
});

test('mapeamento LID ↔ telefone que chega no lote liga a conversa ao lead', async () => {
  const lead = await criarLeadDireto({ nome: 'Mapa', telefone: '5521988887777' });
  const s = socketFalso();
  await hist.aoReceberHistorico(1, s, lib, {
    messages: [mensagem({ jid: '555000@lid', diasAtras: 1 })],
    lidPnMappings: [{ lid: '555000@lid', pn: '5521988887777@s.whatsapp.net' }],
    syncType: RECENT(),
  });
  assert.equal(db.get("SELECT lead_id FROM wa_messages WHERE chat_jid = '555000@lid'").lead_id, lead);
});

test('não cria leads sozinho (WHATSAPP_CRIAR_LEADS=0) e grupos nunca viram lead', async () => {
  await hist.aoReceberHistorico(1, sock, lib, {
    messages: [
      mensagem({ jid: '5511900001111@s.whatsapp.net', diasAtras: 1 }),
      mensagem({ jid: '120363000000000009@g.us', diasAtras: 1, participante: '5511900002222@s.whatsapp.net', pushName: 'Membro' }),
    ],
    chats: [{ id: '120363000000000009@g.us', name: 'Grupo da equipe' }],
    syncType: RECENT(),
  });
  assert.equal(contar('SELECT count(*) n FROM leads'), 0);
  const g = db.get("SELECT lead_id, participant_jid, participant_name FROM wa_messages WHERE chat_jid = '120363000000000009@g.us'");
  assert.equal(g.lead_id, null);
  assert.equal(g.participant_jid, '5511900002222@s.whatsapp.net');
  assert.equal(g.participant_name, 'Membro');
  assert.equal(db.get("SELECT name FROM wa_chats WHERE jid = '120363000000000009@g.us'").name, 'Grupo da equipe');
});

test('estado das conversas do celular (arquivada, fixada) é importado', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  await hist.aoReceberHistorico(1, sock, lib, {
    messages: [mensagem({ jid, diasAtras: 1 })],
    chats: [{ id: jid, archived: true, pinned: segundos(0) }],
    syncType: RECENT(),
  });
  const c = db.get('SELECT archived, pinned_at FROM wa_chats WHERE jid = ?', [jid]);
  assert.equal(c.archived, 1);
  assert.ok(c.pinned_at);
});

test('chamada perdida do histórico vira registro na conversa e no histórico do lead', async () => {
  const lead = await criarLeadDireto({ nome: 'Ligou', telefone: '5511933334444' });
  const chamada = {
    key: { remoteJid: '5511933334444@s.whatsapp.net', fromMe: false, id: 'CHAMADA1' },
    messageTimestamp: segundos(1),
    messageStubType: 41,
  };
  await hist.aoReceberHistorico(1, sock, lib, { messages: [chamada], syncType: RECENT() });
  const m = db.get("SELECT type, body, extra, read_at FROM wa_messages WHERE wa_id = 'CHAMADA1'");
  assert.equal(m.type, 'chamada');
  assert.match(m.body, /vídeo perdida/);
  assert.equal(JSON.parse(m.extra).video, true);
  assert.ok(m.read_at);
  assert.equal(contar("SELECT count(*) n FROM lead_events WHERE lead_id = ? AND type = 'whatsapp_call'", [lead]), 1);
});

test('pedido manual ao celular (ON_DEMAND) traz mensagens fora da janela; o automático não', async () => {
  const jid = '5511912345678@s.whatsapp.net';
  const r = await hist.aoReceberHistorico(1, sock, lib, {
    messages: [mensagem({ jid, diasAtras: 120 })],
    syncType: lib.proto.HistorySync.HistorySyncType.ON_DEMAND,
  });
  assert.equal(r.novas, 0);
});

test('lote grande: grava em lotes sem travar o servidor', async () => {
  const messages = [];
  for (let i = 0; i < 6000; i++) messages.push(mensagem({ jid: `55119${String(10000000 + (i % 300)).slice(0, 8)}@s.whatsapp.net`, diasAtras: (i % 80) + 1, deMim: i % 3 === 0 }));
  let ticks = 0;
  const intervalo = setInterval(() => ticks++, 5);
  const inicio = Date.now();
  const r = await hist.aoReceberHistorico(1, sock, lib, { messages, syncType: RECENT(), progress: 100 });
  clearInterval(intervalo);
  assert.equal(r.novas, 6000);
  assert.ok(Date.now() - inicio < 20000, 'deveria levar poucos segundos');
  assert.ok(ticks > 2, 'o servidor precisa continuar respondendo durante a importação');
  const p = hist.progressoDe(1);
  assert.equal(p.fase, 'recebido');
  assert.ok(p.importadas >= 6000);
});
