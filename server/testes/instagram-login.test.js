// Direct pelo login do Instagram (plugin privado/, motor instagrapi): conectar com o cookie, busca da caixa e das
// solicitações, conversa antiga reaproveitada pelo @, envio sem janela de 24 h, webhook ignorado, erros que param ou
// pausam. O motor Python é falso: nada sai da máquina.
import { prepararBanco, limparBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PUBLIC_URL = 'https://crm.exemplo.com/interno';
await prepararBanco();
const { run, get, all, exec } = await import('../src/db.js');
const { salvarEstado } = await import('../src/estado.js');
const graph = await import('../src/modules/instagram/graph.js');
const perfis = await import('../src/modules/instagram/perfis.js');
const direct = await import('../src/modules/instagram/direct.js');
const webhook = await import('../src/modules/instagram/webhook.js');
const privado = await import('../src/modules/instagram/privado/index.js');
const { limparGanchos, aoAcontecer } = await import('../src/ganchos.js');

const IG = '17841400000000001';
const PAGINA = '100000000000001';
const MEU_PK = '5550001';
const COOKIE = `${MEU_PK}%3AAbCdEfGhIjKlMn%3A12%3AAYxyz`;
const agoraUs = (minAtras = 0) => (Date.now() - minAtras * 60000) * 1000;

graph.definirChamadaFalsaMeta(async () => ({ data: [] }));
graph.definirDownloadFalso(async () => ({ buffer: Buffer.from('foto'), mime: 'image/jpeg' }));

// ------------------------------------------------------------------ motor falso
let caixa = [];
let pendentes = [];
let usuarioDoCookie = 'impera';
let erroNoProximo = null;
const pedidos = [];
privado.definirMotorFalso(async (cmd, dados) => {
  pedidos.push({ cmd, ...dados });
  if (erroNoProximo) { const e = erroNoProximo; erroNoProximo = null; throw e; }
  if (cmd === 'entrar') return { pk: MEU_PK, username: usuarioDoCookie };
  if (cmd === 'sair') return {};
  if (cmd === 'inbox') return { threads: dados.pendentes ? pendentes : caixa, meu_pk: MEU_PK };
  if (cmd === 'thread') return { thread: caixa.find((t) => t.thread_id === dados.thread_id) };
  if (cmd === 'enviar_texto' || cmd === 'enviar_arquivo') return { mid: `enviada-${pedidos.length}`, thread_id: dados.thread_id || 't-novo' };
  return {};
});

const thread = ({ id = 't1', pk = '9001', username = 'fulano', itens = [], grupo = false, minAtras = 0 } = {}) => ({
  thread_id: id, grupo, pendente: false, ultima_us: agoraUs(minAtras), tem_mais: false,
  usuarios: [{ pk, username, nome: 'Fulano da Silva', foto: `https://cdn.exemplo/${pk}.jpg`, verificado: false }],
  itens,
});
const item = ({ mid, texto = null, deMim = false, minAtras = 0, ...resto }) => ({
  mid, de_mim: deMim, timestamp_us: agoraUs(minAtras), texto, anexos: [], story: null, nao_suportada: false, reacoes: [], resposta_mid: null, ...resto,
});

async function preparar({ conectar = true } = {}) {
  await limparBanco();
  exec(`DELETE FROM ig_ia_sugestoes; DELETE FROM ig_ia; DELETE FROM ig_mensagens; DELETE FROM ig_conversas; DELETE FROM ig_contatos;
        DELETE FROM ig_registro; DELETE FROM ig_credenciais; DELETE FROM ig_perfis;`);
  run('INSERT INTO ig_perfis (id, ig_id, page_id, username, historico_direct_em) VALUES (1, ?, ?, ?, ?)', [IG, PAGINA, 'impera', new Date().toISOString()]);
  perfis.salvarCredencial(`pagina:${PAGINA}`, { token: 'EAAPAGINA', tipo: 'pagina' });
  caixa = [];
  pendentes = [];
  usuarioDoCookie = 'impera';
  erroNoProximo = null;
  pedidos.length = 0;
  limparGanchos();
  if (conectar) {
    await privado.conectar(1, { sessionid: COOKIE });
    await new Promise((r) => setTimeout(r, 20)); // importação inicial (caixa vazia)
    pedidos.length = 0;
  }
}

// ------------------------------------------------------------------ conectar

test('sessionid: aceita o cookie colado de vários jeitos e recusa o que não é cookie', () => {
  assert.equal(privado.limparSessionid(`sessionid=${COOKIE};`), COOKIE);
  assert.equal(privado.limparSessionid(` "${COOKIE}" `), COOKIE);
  assert.equal(privado.limparSessionid(COOKIE.replace(/%3A/g, ':')), COOKIE);
  assert.throws(() => privado.limparSessionid('abc'), /sessionid/);
  assert.throws(() => privado.limparProxy('proxy.com'), /Proxy inválido/);
  assert.equal(privado.limparProxy(''), null);
  assert.equal(privado.limparProxy('http://u:s@1.2.3.4:8080'), 'http://u:s@1.2.3.4:8080');
});

test('conectar: recusa cookie de outra conta, liga o motor de login no perfil e nunca mostra o cookie', async () => {
  await preparar({ conectar: false });
  usuarioDoCookie = 'outra.conta';
  await assert.rejects(privado.conectar(1, { sessionid: COOKIE }), /@outra\.conta, não do @impera/);
  assert.equal(perfis.motorDoPerfil(1), 'oficial');
  assert.ok(pedidos.some((p) => p.cmd === 'sair' && p.apagar_sessao));

  usuarioDoCookie = 'impera';
  const estado = await privado.conectar(1, { sessionid: COOKIE, proxy: 'http://user:senha@10.0.0.1:3128' });
  assert.equal(perfis.motorDoPerfil(1), 'login');
  assert.equal(estado.ligado, true);
  assert.equal(estado.username, 'impera');
  assert.equal(estado.proxy, 'http://***@10.0.0.1:3128');
  assert.doesNotMatch(JSON.stringify(estado), /AbCdEf|senha/);
  assert.equal(perfis.perfilPublico(perfis.obterPerfil(1)).direct_motor, 'login');
  assert.doesNotMatch(JSON.stringify(perfis.perfilPublico(perfis.obterPerfil(1))), /AbCdEf/);
  assert.ok(get("SELECT 1 AS ok FROM ig_registro WHERE detalhe LIKE 'Direct pelo login ligado%'"));
});

// ------------------------------------------------------------------ busca

test('busca: cria a conversa com @, nome e foto, grava texto/áudio/story/post e avisa a Alice só do que é novo', async () => {
  await preparar();
  const recebidas = [];
  aoAcontecer('instagram:recebida', (d) => recebidas.push(d));
  caixa = [
    thread({
      itens: [
        item({ mid: 'i4', texto: 'Quero anunciar minha ação', minAtras: 1 }),
        item({ mid: 'i3', anexos: [{ tipo: 'audio', url: 'https://cdn.exemplo/a.mp4', mime: 'audio/mp4' }], minAtras: 2 }),
        item({ mid: 'i2', texto: 'Que top!', story: { tipo: 'resposta', url: 'https://cdn.exemplo/story.jpg' }, minAtras: 3 }),
        item({ mid: 'i1', anexos: [{ tipo: 'reel', url: 'https://www.instagram.com/reel/ABC/' }], minAtras: 60 * 24 }),
      ],
    }),
    thread({ id: 'g1', pk: '777', grupo: true, itens: [item({ mid: 'gx', texto: 'grupo' })] }),
  ];
  const r = await privado.sincronizar(1);
  assert.equal(r.conversas, 1);
  assert.equal(r.mensagens, 4);
  const c = get('SELECT * FROM ig_conversas');
  assert.equal(c.igsid, 'p9001');
  assert.equal(c.thread_id, 't1');
  assert.equal(c.nao_lidas, 4);
  const k = get('SELECT * FROM ig_contatos WHERE igsid = ?', ['p9001']);
  assert.equal(k.username, 'fulano');
  assert.equal(k.pk, '9001');
  const tipos = all('SELECT tipo FROM ig_mensagens ORDER BY timestamp').map((m) => m.tipo);
  assert.deepEqual(tipos, ['compartilhamento', 'story_resposta', 'audio', 'texto']);
  // A mensagem de ontem é histórico; as 3 recentes avisam a Alice
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(recebidas.length, 3);
  // Sem prazo para responder
  const janela = direct.janelaDaConversa(c);
  assert.equal(janela.aberta, true);
  assert.equal(janela.sem_limite, true);
  // Grupo não entra
  assert.equal(get('SELECT count(*) AS n FROM ig_conversas').n, 1);

  // Mesma caixa de novo: nada duplica
  const r2 = await privado.sincronizar(1);
  assert.equal(r2.mensagens, 0);
  assert.equal(get('SELECT count(*) AS n FROM ig_mensagens').n, 4);
});

test('busca: quem já falou pela API oficial (mesmo @) continua na mesma conversa', async () => {
  await preparar();
  run('INSERT INTO ig_contatos (perfil_id, igsid, username, atualizado_em) VALUES (1, ?, ?, ?)', ['IGSID-OFICIAL', 'marcelo.c.lucas', new Date().toISOString()]);
  run('INSERT INTO ig_conversas (perfil_id, igsid, ultima_em) VALUES (1, ?, ?)', ['IGSID-OFICIAL', new Date().toISOString()]);
  caixa = [thread({ pk: '4242', username: 'marcelo.c.lucas', itens: [item({ mid: 'x1', texto: 'Teste' })] })];
  await privado.sincronizar(1);
  assert.equal(get('SELECT count(*) AS n FROM ig_conversas').n, 1);
  const c = get('SELECT * FROM ig_conversas');
  assert.equal(c.igsid, 'IGSID-OFICIAL');
  assert.equal(c.thread_id, 't1');
  assert.equal(get('SELECT pk FROM ig_contatos WHERE igsid = ?', ['IGSID-OFICIAL']).pk, '4242');
});

test('busca: solicitações de mensagem entram marcadas como pendentes; mensagem do celular para a Alice', async () => {
  await preparar();
  const humanas = [];
  aoAcontecer('instagram:humana', (d) => humanas.push(d));
  pendentes = [{ ...thread({ id: 'tp', pk: '8080', username: 'desconhecido', itens: [item({ mid: 'p1', texto: 'Oi, vi seu anúncio' })] }), pendente: true }];
  caixa = [thread({ itens: [item({ mid: 'c1', texto: 'Respondi pelo celular', deMim: true })] })];
  salvarEstado('instagram_login_1', { pendentes_em: null }); // a importação inicial já olhou as solicitações agora há pouco
  await privado.sincronizar(1);
  const p = get("SELECT * FROM ig_conversas WHERE thread_id = 'tp'");
  assert.equal(p.pendente, 1);
  const minha = get("SELECT * FROM ig_mensagens WHERE mid = 'c1'");
  assert.equal(minha.de_mim, 1);
  assert.equal(minha.origem, 'celular');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(humanas.length, 1);
  assert.ok(pedidos.some((x) => x.cmd === 'inbox' && x.pendentes));
});

// ------------------------------------------------------------------ envio

test('envio: responde pela conversa do Instagram, sem janela de 24 h, e a busca seguinte não duplica', async () => {
  await preparar();
  caixa = [thread({ itens: [item({ mid: 'v1', texto: 'Oi', minAtras: 60 * 24 * 5 })], minAtras: 60 * 24 * 5 })];
  await privado.sincronizar(1);
  const c = get('SELECT * FROM ig_conversas');
  const msgs = await direct.enviar(c.id, { texto: 'Oi! Tudo certo? Ainda tem interesse?' }, { origem: 'crm' });
  assert.equal(msgs.length, 1);
  const envio = pedidos.find((p) => p.cmd === 'enviar_texto');
  assert.equal(envio.thread_id, 't1');
  assert.equal(envio.sessionid, COOKIE);
  const gravada = get('SELECT * FROM ig_mensagens WHERE de_mim = 1');
  assert.equal(gravada.origem, 'crm');
  // A caixa agora traz a nossa mensagem (mesmo id): continua uma só
  caixa = [thread({ itens: [item({ mid: gravada.mid, texto: 'Oi! Tudo certo? Ainda tem interesse?', deMim: true }), item({ mid: 'v1', texto: 'Oi', minAtras: 60 * 24 * 5 })] })];
  await privado.sincronizar(1);
  assert.equal(get('SELECT count(*) AS n FROM ig_mensagens WHERE de_mim = 1').n, 1);
});

test('envio: arquivo que não é foto, vídeo ou áudio é recusado com explicação', async () => {
  await preparar();
  caixa = [thread({ itens: [item({ mid: 'v1', texto: 'Oi' })] })];
  await privado.sincronizar(1);
  const c = get('SELECT * FROM ig_conversas');
  await assert.rejects(direct.enviar(c.id, { arquivo: { caminho: '/tmp/x.pdf', mime: 'application/pdf', nome: 'x.pdf' } }), /foto, vídeo ou áudio/);
});

// ------------------------------------------------------------------ webhook, erros e relógio

test('webhook: com o Direct pelo login, mensagens do webhook são ignoradas (não duplica)', async () => {
  await preparar();
  await webhook.processarCorpo({ object: 'instagram', entry: [{ id: IG, messaging: [{ sender: { id: '9001' }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: 'oficial.1', text: 'Oi' } }] }] });
  assert.equal(get('SELECT count(*) AS n FROM ig_mensagens').n, 0);
});

test('erros: sessão derrubada para o perfil (sem insistir); limite pausa 30 min; envio explica', async () => {
  await preparar();
  erroNoProximo = new privado.ErroMotor('login_required', 'login');
  const r = await privado.sincronizar(1);
  assert.equal(r.erro, 'login');
  let e = privado.estadoParaTela(1);
  assert.equal(e.parado, true);
  assert.match(e.erro, /encerrou a sessão/);
  // Parado: o relógio não busca
  pedidos.length = 0;
  privado.passo();
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(pedidos.filter((p) => p.cmd === 'inbox').length, 0);
  // Conectar de novo limpa
  await privado.conectar(1, { sessionid: COOKIE });
  assert.equal(privado.estadoParaTela(1).parado, false);

  erroNoProximo = new privado.ErroMotor('Please wait a few minutes', 'limite');
  await privado.sincronizar(1);
  e = privado.estadoParaTela(1);
  assert.ok(e.pausado_ate);
  assert.equal(e.parado, false);
});

test('relógio: busca os perfis ligados, respeitando o intervalo', async () => {
  await preparar();
  privado.definirIntervalo(1, 30);
  assert.equal(privado.estadoParaTela(1).intervalo_seg, 30);
  privado.passo(Date.now());
  await new Promise((res) => setTimeout(res, 20));
  const primeira = pedidos.filter((p) => p.cmd === 'inbox' && !p.pendentes).length;
  assert.equal(primeira, 1);
  privado.passo(Date.now() + 1000); // antes do intervalo: não busca
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(pedidos.filter((p) => p.cmd === 'inbox' && !p.pendentes).length, 1);
  privado.passo(Date.now() + 60000);
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(pedidos.filter((p) => p.cmd === 'inbox' && !p.pendentes).length, 2);
});

test('desligar: volta o Direct para a API oficial e esquece o cookie', async () => {
  await preparar();
  await privado.desligar(1);
  assert.equal(perfis.motorDoPerfil(1), 'oficial');
  assert.ok(!perfis.lerCredencial('login:1'));
  const c = { perfil_id: 1, ultima_dele_em: null };
  assert.equal(direct.janelaDaConversa(c).aberta, false);
});
