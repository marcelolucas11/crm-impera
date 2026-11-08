// Instagram: permissões, webhook, Direct (janela de 24 h, envio, busca pela API), Alice SDR (entrevista e WhatsApp → lead),
// métricas (conta, publicações), comentários, anúncios, relatórios e ferramentas da assistente pessoal.
// A Meta e o modelo são falsos: nada sai da máquina.
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
process.env.PUBLIC_URL = 'https://crm.exemplo.com/interno';
await prepararBanco();
const { run, get, all, exec } = await import('../src/db.js');
const { salvarEstado } = await import('../src/estado.js');
const graph = await import('../src/modules/instagram/graph.js');
const igConfig = await import('../src/modules/instagram/config.js');
const perfis = await import('../src/modules/instagram/perfis.js');
const direct = await import('../src/modules/instagram/direct.js');
const webhook = await import('../src/modules/instagram/webhook.js');
const sdr = await import('../src/modules/instagram/sdr.js');
const metricas = await import('../src/modules/instagram/metricas.js');
const desempenho = await import('../src/modules/instagram/desempenho.js');
const comentarios = await import('../src/modules/instagram/comentarios.js');
const anuncios = await import('../src/modules/instagram/anuncios.js');
const relatorios = await import('../src/modules/instagram/relatorios.js');
const permissoes = await import('../src/modules/auth/permissoes.js');
const { salvarConfig: salvarConfigIa } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const { limparGanchos, aoAcontecer } = await import('../src/ganchos.js');
const moduloIg = (await import('../src/modules/instagram/index.js')).default;

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { inicio: '00:00', fim: '23:59' }]));
const IG = '17841400000000001';
const PAGINA = '100000000000001';
const SEGREDO = 'a'.repeat(32);

// ------------------------------------------------------------------ Meta falsa
let respostasMeta = {};
const chamadas = [];
graph.definirChamadaFalsaMeta(async ({ metodo, caminho, params, corpo }) => {
  chamadas.push({ metodo, caminho, params, corpo });
  for (const [padrao, resposta] of Object.entries(respostasMeta)) {
    if (new RegExp(padrao).test(`${metodo} ${caminho}`)) return typeof resposta === 'function' ? resposta({ metodo, caminho, params, corpo }) : resposta;
  }
  return { data: [] };
});
graph.definirDownloadFalso(async () => ({ buffer: Buffer.from('arquivo'), mime: 'image/jpeg' }));
let enviadosIg = [];
direct.definirEnvioFalso(async ({ igsid, mensagem }) => {
  enviadosIg.push({ igsid, mensagem });
  return { recipient_id: igsid, message_id: `mid.enviada.${enviadosIg.length}.${Date.now()}` };
});
sdr.definirDependenciasSdr({ esperar: async () => {}, aleatorio: () => 0 });

// Modelo falso (Alice e relatórios)
let respostaModelo = { mensagens: ['Oi!'], acao: 'responder' };
definirChamadaFalsa(async () => ({ texto: JSON.stringify(respostaModelo), uso: { input_tokens: 100, output_tokens: 20 } }));

// Ganchos do módulo (Alice reage às mensagens)
limparGanchos();
moduloIg.register({ get() {}, post() {}, use() {} });

async function preparar({ alice = false } = {}) {
  await limparBanco();
  exec(`DELETE FROM ig_ia_sugestoes; DELETE FROM ig_ia; DELETE FROM ig_mensagens; DELETE FROM ig_conversas; DELETE FROM ig_contatos;
        DELETE FROM ig_posts_diario; DELETE FROM ig_posts; DELETE FROM ig_conta_diaria; DELETE FROM ig_comentarios; DELETE FROM ig_anuncios_diario;
        DELETE FROM ig_anuncios; DELETE FROM ig_anuncios_contas; DELETE FROM ig_relatorios; DELETE FROM ig_registro; DELETE FROM ig_credenciais;
        DELETE FROM ig_perfis; DELETE FROM ia_registro;`);
  salvarEstado('instagram', { app_secret: SEGREDO, app_id: '1234567890' });
  run('INSERT INTO ig_perfis (id, ig_id, page_id, username, seguidores, alice_ativa, historico_direct_em) VALUES (1, ?, ?, ?, ?, ?, ?)', [IG, PAGINA, 'impera', 1000, alice ? 1 : 0, new Date().toISOString()]);
  perfis.salvarCredencial(`pagina:${PAGINA}`, { token: 'EAAPAGINA', tipo: 'pagina' });
  perfis.salvarCredencial('usuario', { token: 'EAAUSUARIO', tipo: 'sistema' });
  salvarConfigIa({ ativo: true, modo: 'automatico', horario: SEMPRE, automatico_fora_horario: true, espera_agrupar_seg: 3 });
  respostasMeta = {
    [`GET \\d+$`]: { name: 'Fulano da Silva', username: 'fulano', follower_count: 120, is_user_follow_business: true },
  };
  chamadas.length = 0;
  enviadosIg = [];
  metricas._zerarRecusadas();
}

const perfil = () => perfis.obterPerfil(1);
const assinar = (corpo) => `sha256=${crypto.createHmac('sha256', SEGREDO).update(corpo).digest('hex')}`;
const eventoMensagem = ({ de = '9001', texto = 'Oi', mid = `m${Math.random()}`, eco = false, ts = Date.now(), extra = {} } = {}) => ({
  object: 'instagram',
  entry: [{ id: IG, time: ts, messaging: [{ sender: { id: eco ? IG : de }, recipient: { id: eco ? de : IG }, timestamp: ts, message: { mid, text: texto, ...(eco ? { is_echo: true } : {}), ...extra } }] }],
});
const esperar = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ permissões

test('permissões: padrão libera o que a equipe já usava e fecha o Instagram; admin pode tudo', () => {
  const membro = permissoes.resolverPermissoes({ role: 'member', permissoes: '{}' });
  assert.equal(membro.kanban, true);
  assert.equal(membro.whatsapp, true);
  assert.equal(membro.instagram, false);
  assert.equal(membro.instagram_desempenho, false);
  assert.equal(membro.leads_excluir, false);
  const liberado = permissoes.resolverPermissoes({ role: 'member', permissoes: JSON.stringify({ instagram: true, whatsapp: false }) });
  assert.equal(liberado.instagram, true);
  assert.equal(liberado.whatsapp, false);
  const admin = permissoes.resolverPermissoes({ role: 'admin', permissoes: JSON.stringify({ instagram: false }) });
  assert.ok(Object.values(admin).every(Boolean));
  assert.deepEqual(permissoes.validarPermissoes({ instagram: 1, invasao: true }), { instagram: true });
});

test('permissões: o middleware barra quem não tem e deixa passar quem tem', () => {
  const mw = permissoes.exigirPermissao('instagram');
  let status = null;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  let passou = false;
  mw({ user: { role: 'member', permissoes: '{}' } }, res, () => { passou = true; });
  assert.equal(passou, false);
  assert.equal(status, 403);
  mw({ user: { role: 'member', permissoes: '{"instagram":true}' } }, res, () => { passou = true; });
  assert.equal(passou, true);
});

// ------------------------------------------------------------------ webhook e Direct

test('webhook: assinatura conferida com a chave secreta do app', async () => {
  await preparar();
  const corpo = Buffer.from(JSON.stringify(eventoMensagem()));
  assert.equal(webhook.assinaturaValida(corpo, assinar(corpo)), true);
  assert.equal(webhook.assinaturaValida(corpo, 'sha256=00'), false);
  assert.equal(webhook.assinaturaValida(corpo, assinar(Buffer.from('outro'))), false);
});

test('webhook: mensagem nova cria a conversa, conta como não lida, abre a janela de 24 h e busca o @ da pessoa', async () => {
  await preparar();
  await webhook.processarCorpo(eventoMensagem({ texto: 'Quero saber mais', mid: 'mid.1' }));
  await esperar();
  const c = get('SELECT * FROM ig_conversas');
  assert.equal(c.igsid, '9001');
  assert.equal(c.nao_lidas, 1);
  assert.ok(direct.janelaDaConversa(c).aberta);
  const m = get('SELECT * FROM ig_mensagens');
  assert.equal(m.texto, 'Quero saber mais');
  assert.equal(m.de_mim, 0);
  const k = get('SELECT * FROM ig_contatos');
  assert.equal(k.username, 'fulano');
  // A mesma mensagem de novo (webhook repetido ou busca pela API) não duplica
  await webhook.processarCorpo(eventoMensagem({ texto: 'Quero saber mais', mid: 'mid.1' }));
  assert.equal(get('SELECT count(*) AS n FROM ig_mensagens').n, 1);
});

test('webhook: resposta a story, anexo e anúncio click-to-Direct', async () => {
  await preparar();
  await webhook.processarCorpo(eventoMensagem({
    texto: 'Que legal!', mid: 'mid.story',
    extra: { reply_to: { story: { url: 'https://cdn/story.jpg', id: 'st1' } }, referral: { ad_id: '555', source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title: 'Rifa 2026' } } },
  }));
  await webhook.processarCorpo(eventoMensagem({ texto: null, mid: 'mid.foto', extra: { attachments: [{ type: 'image', payload: { url: 'https://cdn/foto.jpg' } }] } }));
  await esperar(60);
  const story = get("SELECT * FROM ig_mensagens WHERE mid = 'mid.story'");
  assert.equal(story.tipo, 'story_resposta');
  const conversa = get('SELECT * FROM ig_conversas');
  assert.equal(conversa.anuncio_id, '555');
  assert.equal(conversa.anuncio_titulo, 'Rifa 2026');
  // Com anúncio, a Meta dá 7 dias para responder
  assert.ok(direct.janelaDaConversa({ ...conversa, ultima_dele_em: new Date(Date.now() - 3 * 86400000).toISOString() }).aberta);
  const foto = get("SELECT * FROM ig_mensagens WHERE mid = 'mid.foto'");
  assert.equal(foto.tipo, 'imagem');
  assert.ok(JSON.parse(foto.anexos)[0].local, 'a foto foi baixada para o CRM');
});

test('envio: respeita a janela de 24 h, divide textos longos e zera o "aguardando"', async () => {
  await preparar();
  await webhook.processarCorpo(eventoMensagem({ texto: 'Oi', mid: 'mid.a' }));
  const c = get('SELECT * FROM ig_conversas');
  run('UPDATE ig_conversas SET aguardando_desde = ? WHERE id = ?', [new Date().toISOString(), c.id]);
  const longo = 'palavra '.repeat(300);
  const msgs = await direct.enviar(c.id, { texto: longo }, { userId: null, origem: 'crm' });
  assert.ok(msgs.length >= 2, 'texto longo vira mais de uma mensagem');
  assert.ok(enviadosIg.every((e) => Buffer.byteLength(e.mensagem.text, 'utf8') <= 1000));
  assert.equal(get('SELECT aguardando_desde FROM ig_conversas WHERE id = ?', [c.id]).aguardando_desde, null);
  // Janela fechada: não envia
  run('UPDATE ig_conversas SET ultima_dele_em = ? WHERE id = ?', [new Date(Date.now() - 25 * 3600000).toISOString(), c.id]);
  await assert.rejects(direct.enviar(c.id, { texto: 'oi' }, { origem: 'crm' }), /24 horas/);
});

test('busca pela API de conversas: grava as mensagens e não duplica o que já veio pelo webhook', async () => {
  await preparar();
  await webhook.processarCorpo(eventoMensagem({ de: '7001', texto: 'pelo webhook', mid: 'mid.w1' }));
  run('UPDATE ig_perfis SET sync_direct_em = NULL WHERE id = 1');
  respostasMeta = {
    [`GET ${PAGINA}/conversations`]: { data: [{ id: 'conv1', updated_time: new Date().toISOString().replace('Z', '+0000'), participants: { data: [{ id: IG, username: 'impera' }, { id: '7001', username: 'maria' }] } }] },
    'GET conv1': { messages: { data: [
      { id: 'mid.api2', created_time: new Date().toISOString(), from: { id: '7001', username: 'maria' }, to: { data: [{ id: IG }] }, message: 'pela api' },
      { id: 'mid.w1', created_time: new Date(Date.now() - 60000).toISOString(), from: { id: '7001' }, to: { data: [{ id: IG }] }, message: 'pelo webhook' },
    ] } },
    'GET \\d+$': { username: 'maria' },
  };
  const r = await direct.sincronizarDirect(1);
  assert.equal(r.mensagens, 1);
  assert.equal(get('SELECT count(*) AS n FROM ig_mensagens').n, 2);
  assert.equal(get('SELECT meta_id FROM ig_conversas').meta_id, 'conv1');
});

test('transformar em lead e ligar pelo telefone ao lead que já existe', async () => {
  await preparar();
  await webhook.processarCorpo(eventoMensagem({ de: '8001', texto: 'oi', mid: 'mid.l1' }));
  const c = get('SELECT * FROM ig_conversas');
  const existente = await criarLeadDireto({ nome: 'Cliente WhatsApp', telefone: '5511987654321' });
  const r = direct.ligarAoLead(c.id, { telefone: '(11) 98765-4321' });
  assert.equal(r.leadId, existente, 'mesmo telefone = mesmo lead');
  assert.equal(r.novo, false);
  const extra = JSON.parse(get('SELECT extra FROM leads WHERE id = ?', [existente]).extra);
  assert.equal(extra.instagram.perfil, 'impera');
  assert.equal(get('SELECT lead_id FROM ig_conversas').lead_id, existente);
});

// ------------------------------------------------------------------ Alice SDR

test('Alice: entrevista no Direct e, com o WhatsApp, o lead entra no kanban com o que ela levantou', async () => {
  await preparar({ alice: true });
  respostaModelo = { mensagens: ['Oi! Aqui é a Alice, da Impera Services.', 'Qual é o seu nicho?'], acao: 'responder', eh_lead: true, lead: { nicho: '' }, resumo: 'pessoa nova' };
  await webhook.processarCorpo(eventoMensagem({ de: '9100', texto: 'Oi, vi o anúncio', mid: 'mid.s1' }));
  const c = get('SELECT * FROM ig_conversas');
  assert.equal(get('SELECT status FROM ig_ia WHERE conversa_id = ?', [c.id]).status, 'ativa');
  run('UPDATE ig_ia SET proxima_em = ? WHERE conversa_id = ?', [new Date(Date.now() - 1000).toISOString(), c.id]);
  const r1 = await sdr.processar(c.id);
  assert.equal(r1.feito, 'enviada');
  assert.equal(enviadosIg.length, 2);
  assert.equal(get("SELECT count(*) AS n FROM ig_mensagens WHERE origem = 'ia'").n, 2);

  // A pessoa responde com o nicho e o WhatsApp
  respostaModelo = {
    mensagens: ['Perfeito, obrigada! Um especialista vai te chamar no WhatsApp em breve.'], acao: 'responder', eh_lead: true,
    lead: { nome: 'Carlos', nicho: 'rifas', experiencia: '2 anos', whatsapp: '11912345678' }, resumo: 'Carlos, rifas há 2 anos, quer escalar',
  };
  await webhook.processarCorpo(eventoMensagem({ de: '9100', texto: 'Trabalho com rifas há 2 anos, meu whats é (11) 91234-5678', mid: 'mid.s2' }));
  run('UPDATE ig_ia SET proxima_em = ? WHERE conversa_id = ?', [new Date(Date.now() - 1000).toISOString(), c.id]);
  const r2 = await sdr.processar(c.id);
  assert.equal(r2.feito, 'lead');
  const lead = get('SELECT * FROM leads');
  assert.equal(lead.phone, '5511912345678');
  assert.equal(lead.source, 'instagram');
  assert.ok(lead.waiting_since, 'lead fica como "aguardando minha resposta"');
  const extra = JSON.parse(lead.extra);
  assert.equal(extra.instagram.username, 'fulano');
  assert.ok(extra.respostas.some((x) => x.pergunta === 'Nicho' && x.resposta === 'rifas'));
  assert.equal(get('SELECT status FROM ig_ia WHERE conversa_id = ?', [c.id]).status, 'concluida');
});

test('Alice: para quando a equipe responde pelo app do Instagram', async () => {
  await preparar({ alice: true });
  await webhook.processarCorpo(eventoMensagem({ de: '9200', texto: 'Olá', mid: 'mid.h1' }));
  const c = get('SELECT * FROM ig_conversas');
  assert.equal(get('SELECT status FROM ig_ia WHERE conversa_id = ?', [c.id]).status, 'ativa');
  // Eco de uma mensagem mandada pelo celular (mid que o CRM não conhece)
  await webhook.processarCorpo(eventoMensagem({ de: '9200', texto: 'Oi! Sou o Marcelo', mid: 'mid.h2', eco: true }));
  assert.equal(get('SELECT status FROM ig_ia WHERE conversa_id = ?', [c.id]).status, 'humano');
  assert.equal(get("SELECT origem FROM ig_mensagens WHERE mid = 'mid.h2'").origem, 'celular');
});

test('Alice: não atende conversa antiga nem perfil com a Alice desligada', async () => {
  await preparar({ alice: false });
  await webhook.processarCorpo(eventoMensagem({ de: '9300', texto: 'Oi', mid: 'mid.x1' }));
  assert.equal(get('SELECT count(*) AS n FROM ig_ia').n, 0);
  await preparar({ alice: true });
  // Conversa que já tinha mensagem nossa: equipe já falou
  const conv = direct.garantirConversa(1, '9301');
  run("INSERT INTO ig_mensagens (conversa_id, mid, de_mim, tipo, texto, origem, timestamp) VALUES (?, 'mid.old', 1, 'texto', 'oi', 'celular', ?)", [conv.id, new Date(Date.now() - 86400000).toISOString()]);
  await webhook.processarCorpo(eventoMensagem({ de: '9301', texto: 'voltei', mid: 'mid.x2' }));
  assert.equal(get('SELECT status FROM ig_ia WHERE conversa_id = ?', [conv.id]).status, 'ignorada');
});

test('Alice: acha o WhatsApp no texto mesmo se o modelo esquecer', () => {
  assert.equal(sdr.telefoneNoTexto('meu zap é 11 98888-7777 pode chamar'), '5511988887777');
  assert.equal(sdr.telefoneNoTexto('(21) 3333-4444'), '552133334444');
  assert.equal(sdr.telefoneNoTexto('tenho 2 anos'), null);
});

// ------------------------------------------------------------------ métricas

test('métricas da conta: grava o dia e pula a métrica que a Meta recusa', async () => {
  await preparar();
  let recusou = 0;
  respostasMeta = {
    [`GET ${IG}/insights`]: ({ params }) => {
      const m = params.metric.split(',');
      if (m.includes('reposts')) { recusou++; return { error: { code: 100, message: '(#100) metric[10] must be one of the following values' } }; }
      if (params.breakdown === 'follow_type' && m[0] === 'follows_and_unfollows') return { data: [{ name: 'follows_and_unfollows', total_value: { breakdowns: [{ results: [{ dimension_values: ['FOLLOWER'], value: 12 }, { dimension_values: ['NON_FOLLOWER'], value: 2 }] }] } }] };
      if (params.breakdown) return { data: [] };
      return { data: m.map((n) => ({ name: n, total_value: { value: n === 'views' ? 5000 : n === 'reach' ? 3000 : 10 } })) };
    },
  };
  const dia = metricas.somarDias(metricas.diaNoFuso(), -1);
  await metricas.coletarDiaDaConta(perfil(), dia);
  const l = get('SELECT * FROM ig_conta_diaria WHERE dia = ?', [dia]);
  assert.equal(l.visualizacoes, 5000);
  assert.equal(l.alcance, 3000);
  assert.equal(l.seguiram, 12);
  assert.equal(l.deixaram_de_seguir, 2);
  assert.equal(l.reposts, null);
  // Na segunda vez a métrica recusada nem é pedida
  const antes = recusou;
  await metricas.coletarDiaDaConta(perfil(), metricas.somarDias(dia, -1));
  assert.equal(recusou, antes);
});

test('publicações: lista, guarda as métricas e o painel compara com o período anterior', async () => {
  await preparar();
  const ontem = new Date(Date.now() - 86400000).toISOString().replace('Z', '+0000');
  respostasMeta = {
    [`GET ${IG}/media`]: { data: [
      { id: 'p1', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'Reel campeão', permalink: 'https://instagram.com/p/1', timestamp: ontem, like_count: 50, comments_count: 4, thumbnail_url: 'https://cdn/t1.jpg' },
      { id: 'p2', media_type: 'IMAGE', media_product_type: 'FEED', caption: 'Foto', timestamp: ontem, like_count: 10, comments_count: 1, media_url: 'https://cdn/p2.jpg' },
    ] },
    'GET p1/insights': { data: [{ name: 'views', values: [{ value: 9000 }] }, { name: 'reach', values: [{ value: 7000 }] }, { name: 'total_interactions', values: [{ value: 300 }] }, { name: 'saved', values: [{ value: 40 }] }] },
    'GET p2/insights': { data: [{ name: 'views', values: [{ value: 1000 }] }, { name: 'reach', values: [{ value: 800 }] }, { name: 'total_interactions', values: [{ value: 20 }] }] },
  };
  const r = await metricas.coletarPosts(1);
  assert.equal(r.publicacoes, 2);
  const p1 = get("SELECT * FROM ig_posts WHERE id = 'p1'");
  assert.equal(p1.visualizacoes, 9000);
  assert.equal(p1.produto, 'REELS');
  assert.ok(get("SELECT 1 AS ok FROM ig_posts_diario WHERE post_id = 'p1'"), 'evolução diária guardada');
  run("INSERT INTO ig_conta_diaria (perfil_id, dia, visualizacoes, alcance, interacoes, seguiram, deixaram_de_seguir) VALUES (1, ?, 10000, 8000, 320, 30, 5)", [metricas.somarDias(metricas.diaNoFuso(), -1)]);
  run("INSERT INTO ig_conta_diaria (perfil_id, dia, visualizacoes, alcance, interacoes) VALUES (1, ?, 5000, 4000, 100)", [metricas.somarDias(metricas.diaNoFuso(), -10)]);
  const d = desempenho.painel({ perfilId: 1, dias: 7 });
  assert.equal(d.atual.visualizacoes, 10000);
  assert.equal(d.atual.ganho_seguidores, 25);
  assert.equal(d.antes.visualizacoes, 5000);
  assert.equal(d.variacoes.visualizacoes, 100);
  assert.equal(d.melhores[0].id, 'p1');
  assert.equal(d.serie.length, 7);
  // Seguidores reconstruídos para trás pelo saldo do dia
  const ontemDia = metricas.somarDias(metricas.diaNoFuso(), -1);
  const anteontem = metricas.somarDias(metricas.diaNoFuso(), -2);
  const serie = Object.fromEntries(d.serie.map((x) => [x.dia, x.seguidores]));
  assert.equal(serie[anteontem], serie[ontemDia] - 25);
});

// ------------------------------------------------------------------ comentários

test('comentários: busca, chama no Direct (uma vez) e responde em público', async () => {
  await preparar();
  igConfig.salvarAjustes({ comentarios_ativo: true });
  run("INSERT INTO ig_posts (id, perfil_id, tipo, produto, publicado_em) VALUES ('p9', 1, 'IMAGE', 'FEED', ?)", [new Date().toISOString()]);
  respostasMeta = {
    'GET p9/comments': { data: [{ id: 'c1', text: 'Quanto custa?', username: 'joao', from: { id: '555', username: 'joao' }, timestamp: new Date().toISOString().replace('Z', '+0000'), replies: { data: [] } }] },
    [`POST ${PAGINA}/messages`]: { recipient_id: '9555', message_id: 'mid.priv' },
    'POST c1/replies': { id: 'c1r' },
  };
  const novos = await comentarios.sincronizarComentarios(1);
  assert.equal(novos, 1);
  const lista = comentarios.listarComentarios({ filtro: 'sem_resposta' });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].pode_direct, true);
  const r = await comentarios.chamarNoDirect('c1', 'Oi João! Te chamei aqui no Direct.', null);
  assert.ok(r.conversa_id);
  assert.equal(get('SELECT origem FROM ig_conversas WHERE id = ?', [r.conversa_id]).origem, 'comentario');
  await assert.rejects(comentarios.chamarNoDirect('c1', 'de novo', null), /já foi chamada/);
  await comentarios.responder('c1', 'Te chamei no Direct!', null);
  assert.ok(get("SELECT respondido_em FROM ig_comentarios WHERE id = 'c1'").respondido_em);
});

// ------------------------------------------------------------------ anúncios

test('anúncios: liga os anúncios aos perfis e junta com o que viraram no CRM', async () => {
  await preparar();
  run("INSERT INTO ig_posts (id, perfil_id, tipo, produto, publicado_em) VALUES ('p7', 1, 'VIDEO', 'REELS', ?)", [new Date().toISOString()]);
  respostasMeta = {
    'GET me/adaccounts': { data: [{ id: 'act_1', name: 'Impera', currency: 'BRL' }] },
    'GET act_1/ads': { data: [
      { id: 'ad1', name: 'Anúncio do reel', effective_status: 'ACTIVE', campaign: { id: 'cp1', name: 'Campanha' }, adset: { id: 'as1', name: 'Conjunto' }, creative: { id: 'cr1', effective_instagram_media_id: 'p7' } },
      { id: 'ad2', name: 'De outro perfil', creative: { id: 'cr2', instagram_user_id: '999' } },
    ] },
    'GET act_1/insights': { data: [{ ad_id: 'ad1', spend: '150.5', impressions: '10000', reach: '8000', clicks: '300', inline_link_clicks: '120', date_start: metricas.diaNoFuso(), actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '25' }] }] },
  };
  const r = await anuncios.sincronizarAnuncios();
  assert.equal(r.anuncios, 1);
  const conv = direct.garantirConversa(1, '4444');
  run("UPDATE ig_conversas SET anuncio_id = 'ad1', primeira_em = ? WHERE id = ?", [new Date().toISOString(), conv.id]);
  const lista = desempenho.listarAnuncios({ perfilId: 1, dias: 7 });
  assert.equal(lista[0].gasto, 150.5);
  assert.equal(lista[0].conversas_meta, 25);
  assert.equal(lista[0].conversas_crm, 1);
  assert.equal(lista[0].custo_por_conversa, 6.02);
  const post = desempenho.postParaTela(get("SELECT * FROM ig_posts WHERE id = 'p7'"));
  assert.equal(post.pago.gasto, 150.5);
});

// ------------------------------------------------------------------ relatórios

test('relatórios: gera com o modelo escolhido e guarda o texto e o custo', async () => {
  await preparar();
  relatorios.definirChamadaFalsaRelatorio(async ({ sistema, pedido }) => {
    assert.match(sistema, /analista de Instagram/);
    assert.match(pedido, /<dados>/);
    return { texto: '## Resumo\nTudo certo.', uso: { input_tokens: 1000, output_tokens: 500 } };
  });
  const id = relatorios.pedirRelatorio({ tipo: 'manual' });
  for (let i = 0; i < 50 && get('SELECT status FROM ig_relatorios WHERE id = ?', [id]).status === 'gerando'; i++) await esperar(20);
  const r = relatorios.obterRelatorio(id);
  assert.equal(r.status, 'pronto');
  assert.match(r.texto, /Resumo/);
  assert.ok(r.custo_usd > 0);
});

// ------------------------------------------------------------------ assistente pessoal

test('assistente pessoal: ferramentas do Instagram respeitam permissões e a resposta no Direct vira cartão de aprovação', async () => {
  await preparar();
  const { definicoesPara, executarFerramenta } = await import('../src/modules/agente/ferramentas.js');
  const acoes = await import('../src/modules/agente/acoes.js');
  run("INSERT INTO users (id, name, email, password_hash, role, permissoes) VALUES (50, 'Membro', 'm@x.com', 'x', 'member', '{}') ON CONFLICT(id) DO UPDATE SET permissoes = '{}'");
  run("INSERT INTO users (id, name, email, password_hash, role) VALUES (51, 'Admin', 'a@x.com', 'x', 'admin') ON CONFLICT(id) DO NOTHING");
  const nomesMembro = definicoesPara({ userId: 50 }).map((d) => d.name);
  assert.ok(!nomesMembro.includes('instagram_conversas'), 'sem permissão, a ferramenta nem aparece');
  const nomesAdmin = definicoesPara({ userId: 51 }).map((d) => d.name);
  assert.ok(nomesAdmin.includes('instagram_conversas'));
  assert.ok(nomesAdmin.includes('propor_mensagem_instagram'));

  await webhook.processarCorpo(eventoMensagem({ de: '6001', texto: 'Oi, tudo bem?', mid: 'mid.ag1' }));
  const c = get('SELECT * FROM ig_conversas');
  const ctx = { userId: 51, papel: 'admin', fuso: 'America/Sao_Paulo', fonte: () => {}, progresso: () => {}, acoes: [] };
  const lida = await executarFerramenta('instagram_ler_conversa', { conversa: `ig:${c.id}` }, ctx);
  assert.match(lida.conteudo, /Oi, tudo bem\?/);
  const proposta = await executarFerramenta('propor_mensagem_instagram', { conversa: `ig:${c.id}`, texto: 'Tudo ótimo! Como posso ajudar?' }, ctx);
  assert.match(proposta.conteudo, /Proposta registrada/);
  assert.equal(enviadosIg.length, 0, 'nada sai antes da aprovação');
  const acao = get("SELECT id FROM agente_acoes WHERE tipo = 'enviar_instagram' ORDER BY id DESC LIMIT 1");
  await acoes.aprovar(acao.id, 51, {}, { papel: 'admin' });
  assert.equal(enviadosIg.length, 1);
  assert.equal(get("SELECT origem FROM ig_mensagens WHERE de_mim = 1").origem, 'assistente');
  const semPermissao = await executarFerramenta('instagram_conversas', {}, { ...ctx, userId: 50 });
  assert.equal(semPermissao.erro, true);
});

test('dividir texto: nunca passa de 1.000 bytes e não perde conteúdo', () => {
  const texto = 'Olá, ação! '.repeat(250);
  const partes = direct.dividirTexto(texto);
  assert.ok(partes.length > 1);
  assert.ok(partes.every((p) => Buffer.byteLength(p, 'utf8') <= 1000));
  assert.equal(partes.join(' ').replace(/\s+/g, ' ').trim(), texto.replace(/\s+/g, ' ').trim());
});

test('webhook real (assinatura) só aceita notificações assinadas e responde 200 na hora', async () => {
  await preparar();
  const corpo = JSON.stringify(eventoMensagem({ de: '5001', texto: 'pelo endpoint', mid: 'mid.e1' }));
  let status = null;
  const res = { status(s) { status = s; return this; }, send() { return this; } };
  webhook.receber({ rawBody: Buffer.from(corpo), body: JSON.parse(corpo), get: () => 'sha256=errada' }, res);
  assert.equal(status, 401);
  webhook.receber({ rawBody: Buffer.from(corpo), body: JSON.parse(corpo), get: () => assinar(Buffer.from(corpo)) }, res);
  assert.equal(status, 200);
  await esperar(50);
  assert.ok(get("SELECT 1 AS ok FROM ig_mensagens WHERE mid = 'mid.e1'"));
});

void aoAcontecer;
void all;
