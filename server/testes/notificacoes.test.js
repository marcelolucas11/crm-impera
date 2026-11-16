// Notificações do app (PWA): aviso de reunião agendada, nicho do lead, aparelhos, teste e lista de reuniões.
import { prepararBanco, limparBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const envio = await import('../src/modules/notificacoes/envio.js');
const { avisarReuniaoAgendada } = await import('../src/modules/notificacoes/index.js');
const { nichoDoLead, salvarConfigNotificacoes, perguntasConhecidas } = await import('../src/modules/reunioes/nicho.js');
const { listarReunioes } = await import('../src/modules/reunioes/index.js');
const webpush = (await import('web-push')).default;

const horas = (h) => new Date(Date.now() + h * 3600000).toISOString();
const etapa = () => get('SELECT id FROM stages ORDER BY position LIMIT 1').id;
let n = 0;

function lead(nome, respostas = []) {
  return Number(run('INSERT INTO leads (name, phone, stage_id, extra) VALUES (?, ?, ?, ?)',
    [nome, '5511999990000', etapa(), JSON.stringify({ respostas })]).lastInsertRowid);
}
function reuniao(leadId, { inicio = horas(24), agendada = horas(-0.1), notificado = null, status = 'active' } = {}) {
  n++;
  const uri = `https://api.calendly.com/scheduled_events/N${n}`;
  run(`INSERT INTO calendly_events (uri, lead_id, event_name, start_time, end_time, status, booked_at, notificado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uri, leadId, 'Pré contratação', inicio, horas(25), status, agendada, notificado]);
  return uri;
}
function usuario(nome, role = 'admin', permissoes = '{}') {
  return Number(run('INSERT INTO users (name, email, password_hash, role, permissoes) VALUES (?, ?, ?, ?, ?)',
    [nome, `${nome.toLowerCase()}${n++}@t.com`, 'x', role, permissoes]).lastInsertRowid);
}
function aparelho(userId, endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`) {
  return Number(run('INSERT INTO push_inscricoes (user_id, endpoint, p256dh, auth, aparelho) VALUES (?, ?, ?, ?, ?)',
    [userId, endpoint, 'BPx'.padEnd(87, 'a'), 'abcdefghijklmnop', 'iPhone (app)']).lastInsertRowid);
}

let enviados = [];
let respostaFalsa = () => ({ statusCode: 201 });
envio._definirEnvioFalso(async (insc, corpo) => {
  enviados.push({ insc, aviso: JSON.parse(corpo) });
  const r = respostaFalsa(insc);
  if (r instanceof Error) throw r;
  return r;
});

async function preparar() {
  await limparBanco();
  exec('DELETE FROM calendly_events; DELETE FROM push_inscricoes; DELETE FROM users;');
  envio._esquecerChaves();
  enviados = [];
  respostaFalsa = () => ({ statusCode: 201 });
}

test('nicho: usa a pergunta de nicho e ignora "experiência no nicho"', async () => {
  await preparar();
  const extra = { respostas: [
    { pergunta: 'Tem experiência no nicho?', resposta: 'Mais de 3 anos' },
    { pergunta: 'Qual é o seu nicho?', resposta: 'Rifas de motos' },
  ] };
  assert.equal(nichoDoLead(extra, { pergunta: '' }), 'Rifas de motos');
  assert.equal(nichoDoLead({ respostas: [{ pergunta: 'Tem experiência no nicho?', resposta: 'Sim' }] }, { pergunta: '' }), null);
  // Pergunta escolhida à mão vale mais que a detecção automática
  assert.equal(nichoDoLead({ respostas: [{ pergunta: 'O que você sorteia?', resposta: 'Carros' }, { pergunta: 'Segmento', resposta: 'Rifas' }] },
    { pergunta: 'O que você sorteia?' }), 'Carros');
  // Nicho que a Alice levantou no Instagram
  assert.equal(nichoDoLead({ entrevista_instagram: { nicho: 'Ações premiadas' } }, { pergunta: '' }), 'Ações premiadas');
});

test('perguntas conhecidas: a de nicho vem primeiro', async () => {
  await preparar();
  lead('A', [{ pergunta: 'Qual seu nome?', resposta: 'A' }, { pergunta: 'Qual o seu nicho?', resposta: 'Rifas' }]);
  lead('B', [{ pergunta: 'Qual seu nome?', resposta: 'B' }]);
  const p = perguntasConhecidas();
  assert.equal(p[0].pergunta, 'Qual o seu nicho?');
  assert.equal(p[0].nicho, true);
});

test('reunião nova avisa todos os aparelhos uma única vez, com nome, horário e nicho', async () => {
  await preparar();
  salvarConfigNotificacoes({ ligado: true, pergunta_nicho: '' });
  const u1 = usuario('Marcelo');
  const u2 = usuario('Sócio');
  aparelho(u1); aparelho(u1); aparelho(u2);
  const id = lead('Karoline', [{ pergunta: 'Qual o seu nicho?', resposta: 'Rifas' }]);
  const uri = reuniao(id);
  await avisarReuniaoAgendada({ leadId: id, uri });
  assert.equal(enviados.length, 3);
  const aviso = enviados[0].aviso;
  assert.equal(aviso.titulo, 'Nova reunião agendada');
  assert.equal(aviso.nome, 'Karoline');
  assert.equal(aviso.nicho, 'Rifas');
  assert.equal(aviso.lead_id, id);
  assert.match(aviso.corpo, /Karoline — .* às \d{2}:\d{2}\nNicho: Rifas/);
  assert.equal(aviso.url, `./#kanban/reuniao/${id}`);
  // Segunda vez (outra sincronização): não repete
  await avisarReuniaoAgendada({ leadId: id, uri });
  assert.equal(enviados.length, 3);
  assert.ok(get('SELECT notificado_em FROM calendly_events WHERE uri = ?', [uri]).notificado_em);
});

test('não avisa reunião agendada há muito tempo (carga antiga) nem quando está desligado', async () => {
  await preparar();
  aparelho(usuario('Marcelo'));
  const id = lead('Antigo');
  await avisarReuniaoAgendada({ leadId: id, uri: reuniao(id, { agendada: horas(-24 * 10) }) });
  assert.equal(enviados.length, 0);
  salvarConfigNotificacoes({ ligado: false });
  await avisarReuniaoAgendada({ leadId: id, uri: reuniao(id) });
  assert.equal(enviados.length, 0);
  salvarConfigNotificacoes({ ligado: true });
});

test('quem não vê o kanban não recebe o automático; aparelho que sumiu (410) sai da lista', async () => {
  await preparar();
  const admin = usuario('Marcelo');
  const semKanban = usuario('Estagiário', 'member', JSON.stringify({ kanban: false }));
  const vivo = aparelho(admin);
  const morto = aparelho(admin);
  aparelho(semKanban);
  respostaFalsa = (insc) => {
    if (insc.id !== morto) return { statusCode: 201 };
    const e = new Error('Gone'); e.statusCode = 410; e.body = 'push subscription has unsubscribed or expired.'; return e;
  };
  const id = lead('Juliana');
  const r = await avisarReuniaoAgendada({ leadId: id, uri: reuniao(id) });
  assert.equal(enviados.length, 2); // o do estagiário não vai
  assert.equal(r.resultados.find((x) => x.id === vivo).ok, true);
  assert.equal(r.resultados.find((x) => x.id === morto).removido, true);
  assert.equal(get('SELECT count(*) AS c FROM push_inscricoes WHERE id = ?', [morto]).c, 0);
  // Histórico do envio para o painel de teste
  assert.equal(envio.historico()[0].ok, 1);
});

test('teste: aviso montado a partir de um lead que já agendou, marcado como teste', async () => {
  await preparar();
  const id = lead('Bruno Pickups', [{ pergunta: 'Ramo de atuação', resposta: 'Rifas de caminhonetes' }]);
  reuniao(id, { inicio: horas(-48) });
  const proxima = reuniao(id, { inicio: horas(5) });
  const aviso = envio.montarAvisoReuniao({ leadId: id, teste: true });
  assert.equal(aviso.uri, proxima); // a próxima reunião, não a que passou
  assert.equal(aviso.teste, true);
  assert.match(aviso.titulo, /^Teste/);
  assert.equal(aviso.nicho, 'Rifas de caminhonetes');
  assert.match(aviso.tag, /^teste-/);
  assert.equal(envio.montarAvisoReuniao({ leadId: lead('Sem reunião') }), null);
});

test('inscrição: só aceita serviços de push conhecidos', () => {
  const chaves = { p256dh: 'B'.padEnd(87, 'x'), auth: 'abcdefghijklmnop' };
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-by3p.notify.windows.com/w/?token=x']) {
    assert.equal(envio.validarInscricao({ endpoint: ok, keys: chaves }).endpoint, ok);
  }
  for (const ruim of ['http://fcm.googleapis.com/x', 'https://exemplo.com/push', 'https://fcm.googleapis.com.exemplo.com/x', 'https://169.254.169.254/latest']) {
    assert.throws(() => envio.validarInscricao({ endpoint: ruim, keys: chaves }));
  }
  assert.throws(() => envio.validarInscricao({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: '<script>', auth: 'x' } }));
});

test('chaves VAPID criadas uma vez e o aviso é cifrado no padrão Web Push (aes128gcm)', async () => {
  await preparar();
  const k1 = envio.chavesVapid();
  envio._esquecerChaves();
  assert.deepEqual(envio.chavesVapid(), k1); // continua a mesma depois de religar
  // Aparelho de mentira com chaves reais: o pedido sai assinado e cifrado, sem rede
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const inscricao = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/teste',
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
  const pedido = webpush.generateRequestDetails(inscricao, JSON.stringify({ titulo: 'x' }), {
    vapidDetails: { subject: 'mailto:contato@imperaservices.com', publicKey: k1.publica, privateKey: k1.privada }, TTL: 60,
  });
  assert.equal(pedido.headers['Content-Encoding'], 'aes128gcm');
  assert.match(pedido.headers.Authorization, /^vapid t=.+, k=/);
});

test('lista de reuniões: anteriores e programadas com nome, nicho e etapa', async () => {
  await preparar();
  const a = lead('Carlos', [{ pergunta: 'Qual seu nicho?', resposta: 'Sorteios' }]);
  const b = lead('Caio');
  reuniao(a, { inicio: horas(-30) });
  reuniao(b, { inicio: horas(3) });
  reuniao(b, { inicio: horas(4), status: 'canceled' });
  const lista = listarReunioes({ antes: 30, depois: 30 });
  assert.equal(lista.length, 2);
  assert.equal(lista[0].nome, 'Carlos');
  assert.equal(lista[0].nicho, 'Sorteios');
  assert.equal(lista[1].nome, 'Caio');
  assert.equal(lista[1].nicho, null);
  assert.ok(lista[1].etapa);
});

test('service worker: monta o texto da notificação no fuso do aparelho', () => {
  const codigo = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'public', 'sw.js'), 'utf8');
  const ouvintes = {};
  const mostradas = [];
  const self = {
    addEventListener: (nome, fn) => { ouvintes[nome] = fn; },
    registration: { showNotification: (titulo, op) => { mostradas.push({ titulo, op }); return Promise.resolve(); }, scope: 'https://crm.exemplo.com/interno/' },
    clients: { matchAll: async () => [], openWindow: async () => {}, claim: async () => {} },
    skipWaiting: () => {},
  };
  vm.runInNewContext(codigo, { self, caches: {}, fetch: () => {}, URL, Response, Date, Promise, console });
  const amanha = new Date(Date.now() + 86400000);
  amanha.setHours(14, 30, 0, 0);
  let espera;
  ouvintes.push({ data: { json: () => ({ tipo: 'reuniao', titulo: 'Nova reunião agendada', nome: 'Karoline', nicho: 'Rifas', inicio: amanha.toISOString(), tag: 't1', url: './#kanban/reuniao/7', lead_id: 7 }) }, waitUntil: (p) => { espera = p; } });
  assert.ok(espera);
  assert.equal(mostradas[0].titulo, 'Nova reunião agendada');
  assert.match(mostradas[0].op.body, /^Karoline — amanhã, \d{2}\/\d{2} às 14:30\nNicho: Rifas$/);
  assert.equal(mostradas[0].op.data.lead_id, 7);
});
