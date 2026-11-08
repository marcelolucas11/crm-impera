// Coleta das métricas do Instagram (API oficial): números do perfil por dia, publicações (feed, reels, carrossel),
// Stories (enquanto estão no ar), público (idade, gênero, cidade, país) e horários com seguidores online.
// Tudo fica guardado no CRM: a Meta guarda pouco tempo (Stories 24 h, conta ~90 dias), então o histórico longo é nosso.
// A coleta roda uma vez por dia (e os Stories de hora em hora). Se a Meta não aceitar uma métrica, ela é pulada.
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { chamar, paginar, baixarArquivo, ErroMeta } from './graph.js';
import { lerConfig, fuso } from './config.js';
import { obterPerfil, atualizarPerfil, tokenDoPerfil, registrarErro, limparErro, registrar, perfilPausado } from './perfis.js';
import { atualizarDadosDoPerfil, PASTA } from './conexao.js';

const DIA_MS = 86400000;
const MAX_DIAS_HISTORICO = 730;
const DIAS_POR_RODADA = 30;

// ------------------------------------------------------------------ dias no fuso do CRM

/** "AAAA-MM-DD" de um instante no fuso */
export function diaNoFuso(ms = Date.now(), f = fuso()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: f, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Início (ms) de um dia "AAAA-MM-DD" no fuso */
export function inicioDoDia(dia, f = fuso()) {
  const [a, m, d] = dia.split('-').map(Number);
  const chute = Date.UTC(a, m - 1, d, 12, 0, 0);
  const desloc = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: f, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  return Date.UTC(a, m - 1, d, 0, 0, 0) - desloc(chute);
}

export const somarDias = (dia, n) => {
  const [a, m, d] = dia.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + n));
  return x.toISOString().slice(0, 10);
};

// ------------------------------------------------------------------ métricas que a Meta não aceitou (não insiste)

const recusadas = new Map(); // "conta" | "FEED" | "REELS" | "STORY" → Set(métricas)
const recusou = (grupo, metrica) => recusadas.get(grupo)?.has(metrica);
const marcarRecusada = (grupo, metrica) => {
  if (!recusadas.has(grupo)) recusadas.set(grupo, new Set());
  recusadas.get(grupo).add(metrica);
};
export function _zerarRecusadas() { recusadas.clear(); }

/**
 * Pede várias métricas de uma vez; se a Meta recusar, pede uma a uma e anota as que ela não aceita.
 * Devolve { metrica: resposta } (cada resposta no formato da Meta: { name, values, total_value }).
 */
async function pedirMetricas(caminho, { token, metricas, params = {}, grupo }) {
  const pedir = metricas.filter((m) => !recusou(grupo, m));
  if (!pedir.length) return {};
  const ler = (r) => Object.fromEntries((r?.data || []).map((x) => [x.name, x]));
  try {
    return ler(await chamar(caminho, { token, params: { ...params, metric: pedir.join(',') } }));
  } catch (err) {
    if (err.limite || err.tipo === 'token' || err.tipo === 'rede' || err.tipo === 'nao_existe') throw err;
    if (pedir.length === 1) {
      if (err.tipo !== 'poucos_dados' && err.tipo !== 'instavel') marcarRecusada(grupo, pedir[0]);
      return {};
    }
  }
  const saida = {};
  for (const m of pedir) {
    try {
      Object.assign(saida, ler(await chamar(caminho, { token, params: { ...params, metric: m } })));
    } catch (err) {
      if (err.limite || err.tipo === 'token' || err.tipo === 'rede') throw err;
      if (err.tipo !== 'poucos_dados' && err.tipo !== 'instavel' && err.tipo !== 'nao_existe') marcarRecusada(grupo, m);
    }
  }
  return saida;
}

const total = (x) => {
  if (!x) return null;
  if (x.total_value && typeof x.total_value.value === 'number') return x.total_value.value;
  const v = x.values?.[x.values.length - 1]?.value;
  return typeof v === 'number' ? v : null;
};

const quebraDe = (x) => {
  const r = {};
  for (const b of x?.total_value?.breakdowns || []) {
    for (const res of b.results || []) r[(res.dimension_values || []).join('|') || 'total'] = res.value;
  }
  return r;
};

// ------------------------------------------------------------------ conta por dia

const METRICAS_CONTA = ['views', 'reach', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'replies', 'reposts', 'profile_links_taps'];

/** Busca os números de um dia ("AAAA-MM-DD", no fuso) e grava. Devolve true se veio algum número. */
export async function coletarDiaDaConta(perfil, dia, token = tokenDoPerfil(perfil)) {
  const since = Math.floor(inicioDoDia(dia) / 1000);
  const until = Math.floor(inicioDoDia(somarDias(dia, 1)) / 1000);
  const base = { period: 'day', metric_type: 'total_value', since, until };
  const caminho = `${perfil.ig_id}/insights`;
  const principais = await pedirMetricas(caminho, { token, metricas: METRICAS_CONTA, params: base, grupo: 'conta' });
  const seguir = await pedirMetricas(caminho, { token, metricas: ['follows_and_unfollows'], params: { ...base, breakdown: 'follow_type' }, grupo: 'conta_follow' });
  const porFormato = await pedirMetricas(caminho, { token, metricas: ['views'], params: { ...base, breakdown: 'media_product_type' }, grupo: 'conta_formato' });
  const porSeguidor = await pedirMetricas(caminho, { token, metricas: ['reach'], params: { ...base, breakdown: 'follow_type' }, grupo: 'conta_seguidor' });
  const fu = quebraDe(seguir.follows_and_unfollows);
  const valores = {
    visualizacoes: total(principais.views), alcance: total(principais.reach), contas_engajadas: total(principais.accounts_engaged),
    interacoes: total(principais.total_interactions), curtidas: total(principais.likes), comentarios: total(principais.comments),
    compartilhamentos: total(principais.shares), salvamentos: total(principais.saves), respostas: total(principais.replies),
    reposts: total(principais.reposts), cliques_contato: total(principais.profile_links_taps),
    seguiram: fu.FOLLOWER ?? null, deixaram_de_seguir: fu.NON_FOLLOWER ?? null,
  };
  const quebras = { visualizacoes_por_formato: quebraDe(porFormato.views), alcance_por_seguidor: quebraDe(porSeguidor.reach) };
  const veioAlgo = Object.values(valores).some((v) => v !== null && v !== undefined);
  run(
    `INSERT INTO ig_conta_diaria (perfil_id, dia, alcance, visualizacoes, contas_engajadas, interacoes, curtidas, comentarios, compartilhamentos,
       salvamentos, respostas, reposts, cliques_contato, seguiram, deixaram_de_seguir, quebras, coletado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(perfil_id, dia) DO UPDATE SET alcance = excluded.alcance, visualizacoes = excluded.visualizacoes,
       contas_engajadas = excluded.contas_engajadas, interacoes = excluded.interacoes, curtidas = excluded.curtidas,
       comentarios = excluded.comentarios, compartilhamentos = excluded.compartilhamentos, salvamentos = excluded.salvamentos,
       respostas = excluded.respostas, reposts = excluded.reposts, cliques_contato = excluded.cliques_contato,
       seguiram = excluded.seguiram, deixaram_de_seguir = excluded.deixaram_de_seguir, quebras = excluded.quebras, coletado_em = excluded.coletado_em`,
    [perfil.id, dia, valores.alcance, valores.visualizacoes, valores.contas_engajadas, valores.interacoes, valores.curtidas, valores.comentarios,
      valores.compartilhamentos, valores.salvamentos, valores.respostas, valores.reposts, valores.cliques_contato, valores.seguiram,
      valores.deixaram_de_seguir, JSON.stringify(quebras), agora()]
  );
  return veioAlgo;
}

/** Novos seguidores por dia (a Meta entrega só os últimos 30 dias) */
async function coletarNovosSeguidores(perfil, token) {
  const ate = Math.floor(inicioDoDia(diaNoFuso()) / 1000);
  const desde = ate - 29 * 86400;
  const r = await pedirMetricas(`${perfil.ig_id}/insights`, { token, metricas: ['follower_count'], params: { period: 'day', since: desde, until: ate }, grupo: 'conta_novos' });
  for (const v of r.follower_count?.values || []) {
    if (typeof v.value !== 'number' || !v.end_time) continue;
    // end_time é o fim do dia medido: o dia é o anterior a ele
    const dia = diaNoFuso(new Date(String(v.end_time).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).getTime() - 3600000);
    run(`INSERT INTO ig_conta_diaria (perfil_id, dia, novos_seguidores) VALUES (?, ?, ?)
         ON CONFLICT(perfil_id, dia) DO UPDATE SET novos_seguidores = excluded.novos_seguidores`, [perfil.id, dia, v.value]);
  }
}

/** Foto do dia: seguidores, seguindo e total de publicações (vale para hoje) */
function gravarFotoDoDia(perfil) {
  const hoje = diaNoFuso();
  run(`INSERT INTO ig_conta_diaria (perfil_id, dia, seguidores, seguindo, publicacoes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(perfil_id, dia) DO UPDATE SET seguidores = excluded.seguidores, seguindo = excluded.seguindo, publicacoes = excluded.publicacoes`,
  [perfil.id, hoje, perfil.seguidores, perfil.seguindo, perfil.publicacoes]);
}

/** Coleta diária da conta: foto do dia, ontem e anteontem (a Meta ajusta os números por até 48 h) e novos seguidores */
export async function coletarConta(perfilId) {
  let perfil = obterPerfil(perfilId);
  const token = tokenDoPerfil(perfil);
  try { perfil = await atualizarDadosDoPerfil(perfilId); } catch (err) { if (err.limite || err.tipo === 'token') throw err; }
  gravarFotoDoDia(perfil);
  const hoje = diaNoFuso();
  for (const n of [1, 2, 3]) await coletarDiaDaConta(perfil, somarDias(hoje, -n), token);
  await coletarDiaDaConta(perfil, hoje, token);
  try { await coletarNovosSeguidores(perfil, token); } catch (err) { if (err.limite) throw err; }
  if (!perfil.conta_desde) atualizarPerfil(perfilId, { conta_desde: somarDias(hoje, -3) });
  atualizarPerfil(perfilId, { sync_conta_em: agora() });
}

/** Completa o histórico da conta para trás (30 dias por rodada) até a Meta não ter mais dados */
export async function completarHistoricoDaConta(perfilId) {
  const perfil = obterPerfil(perfilId);
  if (perfil.conta_backfill_ok) return 0;
  const token = tokenDoPerfil(perfil);
  const hoje = diaNoFuso();
  let dia = perfil.conta_desde ? somarDias(perfil.conta_desde, -1) : somarDias(hoje, -4);
  const limite = somarDias(hoje, -MAX_DIAS_HISTORICO);
  let vazios = 0;
  let feitos = 0;
  while (feitos < DIAS_POR_RODADA && dia >= limite) {
    let veio = false;
    try {
      veio = await coletarDiaDaConta(perfil, dia, token);
    } catch (err) {
      if (err.limite || err.tipo === 'token' || err.tipo === 'rede') throw err;
      // A Meta não guarda dias tão antigos: o histórico terminou
      atualizarPerfil(perfilId, { conta_backfill_ok: 1 });
      registrar(perfilId, 'metricas', `Histórico da conta completo até ${dia}`);
      return feitos;
    }
    feitos++;
    vazios = veio ? 0 : vazios + 1;
    atualizarPerfil(perfilId, { conta_desde: dia });
    if (vazios >= 10) {
      run('DELETE FROM ig_conta_diaria WHERE perfil_id = ? AND dia >= ? AND dia < ? AND seguidores IS NULL AND alcance IS NULL AND visualizacoes IS NULL AND novos_seguidores IS NULL', [perfilId, dia, somarDias(dia, 10)]);
      atualizarPerfil(perfilId, { conta_backfill_ok: 1, conta_desde: somarDias(dia, 10) });
      registrar(perfilId, 'metricas', `Histórico da conta completo (a Meta tem dados desde ${somarDias(dia, 10)})`);
      return feitos;
    }
    dia = somarDias(dia, -1);
  }
  if (dia < limite) atualizarPerfil(perfilId, { conta_backfill_ok: 1 });
  emitir('instagram', { perfil: perfilId, metricas: true });
  return feitos;
}

// ------------------------------------------------------------------ publicações

const CAMPOS_MIDIA = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
const METRICAS_POST = {
  FEED: ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'follows', 'profile_visits', 'reposts', 'total_likes', 'total_comments', 'total_views'],
  REELS: ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate', 'reposts', 'total_likes', 'total_comments', 'total_views'],
  STORY: ['reach', 'views', 'replies', 'shares', 'follows', 'profile_visits', 'total_interactions', 'reposts', 'navigation', 'link_clicks', 'total_views'],
};

const dataMeta = (v) => {
  if (!v) return null;
  const t = Date.parse(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function gravarMidia(perfilId, m, produto = null) {
  run(
    `INSERT INTO ig_posts (id, perfil_id, tipo, produto, legenda, permalink, media_url, thumb_url, publicado_em, curtidas, comentarios, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET tipo = excluded.tipo, produto = COALESCE(excluded.produto, ig_posts.produto), legenda = excluded.legenda,
       permalink = COALESCE(excluded.permalink, ig_posts.permalink), media_url = COALESCE(excluded.media_url, ig_posts.media_url),
       thumb_url = COALESCE(excluded.thumb_url, ig_posts.thumb_url), curtidas = COALESCE(excluded.curtidas, ig_posts.curtidas),
       comentarios = COALESCE(excluded.comentarios, ig_posts.comentarios), removido_em = NULL, atualizado_em = excluded.atualizado_em`,
    [m.id, perfilId, m.media_type || null, produto || m.media_product_type || null, m.caption || null, m.permalink || null,
      m.media_url || null, m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null, dataMeta(m.timestamp),
      m.like_count ?? null, m.comments_count ?? null, agora()]
  );
}

/** Métricas de uma publicação (pelo tipo dela) e evolução do dia */
export async function coletarMetricasDoPost(perfil, post, token = tokenDoPerfil(perfil)) {
  const grupo = post.produto === 'STORY' ? 'STORY' : post.produto === 'REELS' ? 'REELS' : 'FEED';
  let r;
  try {
    r = await pedirMetricas(`${post.id}/insights`, { token, metricas: METRICAS_POST[grupo], grupo: `post_${grupo}` });
  } catch (err) {
    if (err.tipo === 'nao_existe') {
      run('UPDATE ig_posts SET removido_em = COALESCE(removido_em, ?) WHERE id = ?', [agora(), post.id]);
      return null;
    }
    throw err;
  }
  const v = (k) => total(r[k]);
  const metricas = Object.fromEntries(Object.entries(r).map(([k, x]) => [k, total(x)]));
  const campos = {
    alcance: v('reach'), visualizacoes: v('views'), curtidas: v('likes') ?? post.curtidas, comentarios: v('comments') ?? post.comentarios,
    compartilhamentos: v('shares'), salvamentos: v('saved'), interacoes: v('total_interactions'), reposts: v('reposts'), seguiram: v('follows'),
    visitas_perfil: v('profile_visits'), respostas: v('replies'), cliques_link: v('link_clicks'),
    tempo_medio_ms: v('ig_reels_avg_watch_time'), tempo_total_ms: v('ig_reels_video_view_total_time'), taxa_pulo: v('reels_skip_rate'),
    total_curtidas: v('total_likes'), total_comentarios: v('total_comments'), total_visualizacoes: v('total_views'),
  };
  // Não apaga um número que já existia quando a Meta não devolveu (ex.: Story que saiu do ar)
  const anterior = lerJson(post.metricas, {}) || {};
  const sets = Object.entries(campos).filter(([, x]) => x !== null && x !== undefined);
  run(`UPDATE ig_posts SET ${[...sets.map(([k]) => `${k} = ?`), 'metricas = ?', 'metricas_em = ?'].join(', ')} WHERE id = ?`, [
    ...sets.map(([, x]) => x), JSON.stringify({ ...anterior, ...metricas }), agora(), post.id,
  ]);
  const limiteDias = lerConfig().posts_diario_dias;
  if (post.publicado_em && Date.now() - new Date(post.publicado_em).getTime() <= limiteDias * DIA_MS) {
    run(`INSERT INTO ig_posts_diario (post_id, dia, visualizacoes, alcance, curtidas, comentarios, salvamentos, compartilhamentos, interacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id, dia) DO UPDATE SET visualizacoes = excluded.visualizacoes, alcance = excluded.alcance, curtidas = excluded.curtidas,
           comentarios = excluded.comentarios, salvamentos = excluded.salvamentos, compartilhamentos = excluded.compartilhamentos, interacoes = excluded.interacoes`,
    [post.id, diaNoFuso(), campos.visualizacoes, campos.alcance, campos.curtidas, campos.comentarios, campos.salvamentos, campos.compartilhamentos, campos.interacoes]);
  }
  return campos;
}

/**
 * Lista as publicações (todas na primeira vez; depois só as novas até chegar nas já conhecidas e antigas)
 * e atualiza as métricas: as recentes todo dia, as antigas uma vez por semana (em lotes).
 */
export async function coletarPosts(perfilId, { tudo = false } = {}) {
  const perfil = obterPerfil(perfilId);
  const token = tokenDoPerfil(perfil);
  const cfg = lerConfig();
  const primeiraVez = !get('SELECT 1 AS ok FROM ig_posts WHERE perfil_id = ? AND produto <> \'STORY\' LIMIT 1', [perfilId]);
  const corte = new Date(Date.now() - cfg.posts_diario_dias * DIA_MS).toISOString();
  const lista = await paginar(`${perfil.ig_id}/media`, { token, params: { fields: CAMPOS_MIDIA, limit: 50 } }, {
    max: 20000,
    parar: tudo || primeiraVez ? null : (m) => (dataMeta(m.timestamp) || '') < corte && get('SELECT 1 AS ok FROM ig_posts WHERE id = ?', [m.id]),
  });
  for (const m of lista) gravarMidia(perfilId, m);
  if (primeiraVez) registrar(perfilId, 'metricas', `${lista.length} publicação(ões) encontradas`);
  // Recentes (até N dias): todo dia. Antigas: as que não são atualizadas há 7 dias, 150 por rodada.
  const recentes = all("SELECT * FROM ig_posts WHERE perfil_id = ? AND produto <> 'STORY' AND removido_em IS NULL AND publicado_em >= ? ORDER BY publicado_em DESC", [perfilId, corte]);
  const antigas = all(
    `SELECT * FROM ig_posts WHERE perfil_id = ? AND produto <> 'STORY' AND removido_em IS NULL AND (publicado_em < ? OR publicado_em IS NULL)
      AND (metricas_em IS NULL OR metricas_em < ?) ORDER BY metricas_em IS NOT NULL, metricas_em LIMIT 150`,
    [perfilId, corte, new Date(Date.now() - 7 * DIA_MS).toISOString()]
  );
  let feitos = 0;
  for (const post of [...recentes, ...antigas]) {
    try {
      await coletarMetricasDoPost(perfil, post, token);
      feitos++;
    } catch (err) {
      if (err.limite || err.tipo === 'token' || err.tipo === 'rede') throw err;
    }
  }
  atualizarPerfil(perfilId, { sync_posts_em: agora() });
  emitir('instagram', { perfil: perfilId, posts: true });
  return { publicacoes: lista.length, atualizadas: feitos };
}

/** Publicações que ainda não têm números (primeira coleta de perfis grandes): mais um lote a cada hora */
export async function completarMetricasAntigas(perfilId, lote = 120) {
  const perfil = obterPerfil(perfilId);
  const pendentes = all("SELECT * FROM ig_posts WHERE perfil_id = ? AND produto <> 'STORY' AND removido_em IS NULL AND metricas_em IS NULL ORDER BY publicado_em DESC LIMIT ?", [perfilId, lote]);
  if (!pendentes.length) return 0;
  const token = tokenDoPerfil(perfil);
  let feitos = 0;
  for (const post of pendentes) {
    try {
      await coletarMetricasDoPost(perfil, post, token);
    } catch (err) {
      if (err.limite || err.tipo === 'token' || err.tipo === 'rede') throw err;
      // Publicação que não aceita métricas (ex.: dentro de álbum): marca para não tentar de novo a toda hora
      run('UPDATE ig_posts SET metricas_em = ? WHERE id = ?', [agora(), post.id]);
    }
    feitos++;
  }
  emitir('instagram', { perfil: perfilId, posts: true });
  return feitos;
}

/** Stories no ar: guarda a mídia (some em 24 h) e as métricas a cada hora */
export async function coletarStories(perfilId) {
  const perfil = obterPerfil(perfilId);
  const token = tokenDoPerfil(perfil);
  const lista = await paginar(`${perfil.ig_id}/stories`, { token, params: { fields: 'id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp', limit: 50 } }, { max: 200 });
  for (const s of lista) {
    gravarMidia(perfilId, s, 'STORY');
    const post = get('SELECT * FROM ig_posts WHERE id = ?', [s.id]);
    if (!post.thumb_local) await guardarMiniatura(post).catch(() => {});
    try { await coletarMetricasDoPost(perfil, post, token); } catch (err) { if (err.limite || err.tipo === 'token') throw err; }
  }
  atualizarPerfil(perfilId, { sync_stories_em: agora() });
  if (lista.length) emitir('instagram', { perfil: perfilId, stories: true });
  return lista.length;
}

/** Métricas de Story que a Meta manda pelo webhook quando ele sai do ar */
export function aoReceberMetricasDeStory(perfil, valor) {
  const id = String(valor?.media_id || '');
  if (!id) return;
  run("INSERT INTO ig_posts (id, perfil_id, produto, atualizado_em) VALUES (?, ?, 'STORY', ?) ON CONFLICT(id) DO NOTHING", [id, perfil.id, agora()]);
  const post = get('SELECT metricas FROM ig_posts WHERE id = ?', [id]);
  const m = { ...(lerJson(post?.metricas, {}) || {}) };
  for (const [k, v] of Object.entries(valor)) if (typeof v === 'number' && v >= 0) m[k] = v;
  run('UPDATE ig_posts SET alcance = COALESCE(?, alcance), respostas = COALESCE(?, respostas), metricas = ?, metricas_em = ? WHERE id = ?', [
    typeof valor.reach === 'number' && valor.reach >= 0 ? valor.reach : null,
    typeof valor.replies === 'number' && valor.replies >= 0 ? valor.replies : null, JSON.stringify(m), agora(), id,
  ]);
  emitir('instagram', { perfil: perfil.id, stories: true });
}

/** Miniatura guardada no CRM (o link da Meta expira). Usa a do vídeo ou a própria foto. */
export async function guardarMiniatura(post) {
  const url = post.thumb_url || (post.tipo !== 'VIDEO' ? post.media_url : null);
  if (!url) return null;
  const r = await baixarArquivo(url, path.join(PASTA(), 'posts', String(post.perfil_id), String(post.id).replace(/\W/g, '')), { maxBytes: 15 * 1024 * 1024 });
  const rel = path.relative(config.filesDir, r.caminho);
  run('UPDATE ig_posts SET thumb_local = ? WHERE id = ?', [rel, post.id]);
  return rel;
}

/** Arquivo da miniatura (baixa na primeira vez; se o link expirou, pede um novo à Meta) */
export async function arquivoMiniatura(postId) {
  let post = get('SELECT * FROM ig_posts WHERE id = ?', [String(postId)]);
  if (!post) return null;
  if (post.thumb_local && fs.existsSync(path.join(config.filesDir, post.thumb_local))) return path.join(config.filesDir, post.thumb_local);
  try {
    await guardarMiniatura(post);
  } catch {
    // Link vencido: busca o endereço atual da mídia
    try {
      const perfil = obterPerfil(post.perfil_id);
      const m = await chamar(post.id, { token: tokenDoPerfil(perfil), params: { fields: 'media_url,thumbnail_url,media_type' } });
      run('UPDATE ig_posts SET media_url = COALESCE(?, media_url), thumb_url = COALESCE(?, thumb_url) WHERE id = ?', [m.media_url || null, m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : null) || null, post.id]);
      post = get('SELECT * FROM ig_posts WHERE id = ?', [post.id]);
      await guardarMiniatura(post);
    } catch { return null; }
  }
  post = get('SELECT thumb_local FROM ig_posts WHERE id = ?', [post.id]);
  return post?.thumb_local ? path.join(config.filesDir, post.thumb_local) : null;
}

// ------------------------------------------------------------------ público e horários

const RECORTES = ['age', 'gender', 'city', 'country'];

export async function coletarPublico(perfilId) {
  const perfil = obterPerfil(perfilId);
  const token = tokenDoPerfil(perfil);
  for (const metrica of ['follower_demographics', 'engaged_audience_demographics']) {
    for (const recorte of RECORTES) {
      const r = await pedirMetricas(`${perfil.ig_id}/insights`, {
        token, metricas: [metrica], params: { period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown: recorte }, grupo: `publico_${metrica}_${recorte}`,
      });
      const dados = quebraDe(r[metrica]);
      if (Object.keys(dados).length) {
        run(`INSERT INTO ig_publico (perfil_id, tipo, recorte, dados, coletado_em) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(perfil_id, tipo, recorte) DO UPDATE SET dados = excluded.dados, coletado_em = excluded.coletado_em`,
        [perfilId, metrica === 'follower_demographics' ? 'seguidores' : 'engajado', recorte, JSON.stringify(dados), agora()]);
      }
    }
  }
  // Seguidores online por hora (média dos últimos dias que a Meta entrega)
  const ate = Math.floor(Date.now() / 1000);
  const r = await pedirMetricas(`${perfil.ig_id}/insights`, { token, metricas: ['online_followers'], params: { period: 'lifetime', since: ate - 7 * 86400, until: ate }, grupo: 'online' });
  const somas = {};
  let dias = 0;
  for (const v of r.online_followers?.values || []) {
    if (!v?.value || typeof v.value !== 'object' || !Object.keys(v.value).length) continue;
    dias++;
    for (const [h, n] of Object.entries(v.value)) somas[h] = (somas[h] || 0) + Number(n || 0);
  }
  if (dias) {
    const medias = Object.fromEntries(Object.entries(somas).map(([h, s]) => [h, Math.round(s / dias)]));
    run(`INSERT INTO ig_publico (perfil_id, tipo, recorte, dados, coletado_em) VALUES (?, 'online', 'hora', ?, ?)
         ON CONFLICT(perfil_id, tipo, recorte) DO UPDATE SET dados = excluded.dados, coletado_em = excluded.coletado_em`, [perfilId, JSON.stringify({ fuso_meta: 'America/Los_Angeles', medias }), agora()]);
  }
  atualizarPerfil(perfilId, { sync_demografia_em: agora() });
}

// ------------------------------------------------------------------ coleta completa (diária)

/** Tudo de um perfil: conta, publicações e (uma vez por semana) público. Erros de um passo não impedem os outros. */
export async function coletarTudo(perfilId, { tudo = false } = {}) {
  const perfil = obterPerfil(perfilId);
  if (!perfil.ativo || perfilPausado(perfil)) return { pulado: true };
  const passos = [
    ['Conta', () => coletarConta(perfilId)],
    ['Publicações', () => coletarPosts(perfilId, { tudo })],
    ['Stories', () => coletarStories(perfilId)],
  ];
  const semanaPassada = new Date(Date.now() - 6.5 * DIA_MS).toISOString();
  if (!perfil.sync_demografia_em || perfil.sync_demografia_em < semanaPassada || tudo) passos.push(['Público', () => coletarPublico(perfilId)]);
  let falhou = false;
  for (const [nome, fn] of passos) {
    try {
      await fn();
    } catch (err) {
      falhou = true;
      registrarErro(perfilId, nome, err);
      if (err instanceof ErroMeta && (err.limite || err.tipo === 'token')) break;
    }
  }
  if (!falhou) limparErro(perfilId);
  return { ok: !falhou };
}
