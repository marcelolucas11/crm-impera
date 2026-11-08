// Números para a tela Instagram → Desempenho (e para os relatórios da IA e a assistente pessoal).
// Tudo vem do que o CRM guardou; nada aqui chama a Meta.
import { get, all } from '../../db.js';
import { lerJson } from '../../events.js';
import { configDoPerfil } from './perfis.js';
import { diaNoFuso, somarDias, inicioDoDia } from './metricas.js';
import { fuso } from './config.js';

const DIA_MS = 86400000;
const soma = (lista, k) => lista.reduce((t, x) => t + (Number(x[k]) || 0), 0);
const temAlgum = (lista, k) => lista.some((x) => x[k] !== null && x[k] !== undefined);
const somaOuNulo = (lista, k) => (temAlgum(lista, k) ? soma(lista, k) : null);
export const variacao = (atual, antes) => (atual === null || antes === null || antes === undefined || !antes ? null : Math.round(((atual - antes) / antes) * 1000) / 10);
const pct = (parte, total) => (total ? Math.round((parte / total) * 10000) / 100 : null);

/** Período em dias ("AAAA-MM-DD") a partir de inicio/fim ISO (fim exclusivo) ou dos últimos N dias */
export function periodoEmDias({ inicio = null, fim = null, dias = 30 } = {}) {
  const f = fuso();
  const i = Date.parse(inicio);
  const e = Date.parse(fim);
  if (Number.isFinite(i) && Number.isFinite(e) && e > i) {
    const de = diaNoFuso(i, f);
    const ate = diaNoFuso(e - 1, f);
    return { de, ate, dias: Math.round((inicioDoDia(somarDias(ate, 1), f) - inicioDoDia(de, f)) / DIA_MS) };
  }
  const n = Math.max(1, Math.min(1095, Number(dias) || 30));
  const ate = diaNoFuso(Date.now(), f);
  return { de: somarDias(ate, -(n - 1)), ate, dias: n };
}

export function periodoAnterior({ de, dias }) {
  return { de: somarDias(de, -dias), ate: somarDias(de, -1), dias };
}

const limitesIso = ({ de, ate }) => ({ desde: new Date(inicioDoDia(de)).toISOString(), ate: new Date(inicioDoDia(somarDias(ate, 1))).toISOString() });

function filtroPerfil(perfilId, alias = '') {
  const col = `${alias ? `${alias}.` : ''}perfil_id`;
  return perfilId ? { sql: ` AND ${col} = ?`, v: [perfilId] } : { sql: ` AND ${col} IN (SELECT id FROM ig_perfis WHERE ativo = 1)`, v: [] };
}

/** Linhas diárias da conta no período (somando os perfis quando não há um escolhido) */
function diasDaConta(perfilId, p) {
  const f = filtroPerfil(perfilId);
  return all(
    `SELECT dia, sum(alcance) AS alcance, sum(visualizacoes) AS visualizacoes, sum(contas_engajadas) AS contas_engajadas, sum(interacoes) AS interacoes,
            sum(curtidas) AS curtidas, sum(comentarios) AS comentarios, sum(compartilhamentos) AS compartilhamentos, sum(salvamentos) AS salvamentos,
            sum(respostas) AS respostas, sum(reposts) AS reposts, sum(cliques_contato) AS cliques_contato, sum(novos_seguidores) AS novos_seguidores,
            sum(seguiram) AS seguiram, sum(deixaram_de_seguir) AS deixaram_de_seguir,
            sum(seguidores) AS seguidores, count(seguidores) AS com_seguidores, count(*) AS perfis, group_concat(quebras, '§') AS quebras
       FROM ig_conta_diaria WHERE dia >= ? AND dia <= ?${f.sql} GROUP BY dia ORDER BY dia`,
    [p.de, p.ate, ...f.v]
  );
}

/** Seguidores de cada dia: a foto do dia quando existe; nos dias sem foto, reconstrói pelo saldo de quem seguiu/deixou */
function serieSeguidores(perfilId, p) {
  const perfis = perfilId ? [perfilId] : all('SELECT id FROM ig_perfis WHERE ativo = 1').map((x) => x.id);
  const total = new Map();
  const hoje = diaNoFuso();
  const nulo = (x) => x === null || x === undefined;
  for (const id of perfis) {
    const linhas = new Map(all('SELECT dia, seguidores, novos_seguidores, seguiram, deixaram_de_seguir FROM ig_conta_diaria WHERE perfil_id = ? AND dia >= ?', [id, p.de]).map((l) => [l.dia, l]));
    // De hoje para trás: seguidores(d - 1) = seguidores(d) - saldo do dia d (quem seguiu menos quem deixou de seguir)
    let valor = get('SELECT seguidores FROM ig_perfis WHERE id = ?', [id])?.seguidores ?? null;
    for (let d = hoje; d >= p.de; d = somarDias(d, -1)) {
      const l = linhas.get(d);
      if (!nulo(l?.seguidores)) valor = l.seguidores;
      if (d <= p.ate && !nulo(valor)) total.set(d, (total.get(d) || 0) + valor);
      const saldo = !l ? null : !nulo(l.seguiram) && !nulo(l.deixaram_de_seguir) ? l.seguiram - l.deixaram_de_seguir : l.novos_seguidores;
      if (!nulo(valor) && !nulo(saldo)) valor -= saldo;
    }
  }
  return total;
}

function quebrasSomadas(linhas, campo) {
  const r = {};
  for (const l of linhas) {
    for (const bloco of String(l.quebras || '').split('§')) {
      const q = lerJson(bloco, {})?.[campo] || {};
      for (const [k, v] of Object.entries(q)) r[k] = (r[k] || 0) + (Number(v) || 0);
    }
  }
  return r;
}

function postsNoPeriodo(perfilId, p, { produto = null } = {}) {
  const { desde, ate } = limitesIso(p);
  const f = filtroPerfil(perfilId);
  return all(
    `SELECT * FROM ig_posts WHERE publicado_em >= ? AND publicado_em < ? AND removido_em IS NULL${f.sql}${produto ? ' AND produto = ?' : ''} ORDER BY publicado_em DESC`,
    [desde, ate, ...f.v, ...(produto ? [produto] : [])]
  );
}

/** Leads do Yay! Forms que vieram do Instagram (UTM com o texto configurado no perfil; padrão: instagram, ig) */
function leadsFormularioDoInstagram(perfilId, { desde, ate }) {
  const perfis = perfilId ? all('SELECT * FROM ig_perfis WHERE id = ?', [perfilId]) : all('SELECT * FROM ig_perfis WHERE ativo = 1');
  const termos = new Set();
  for (const p of perfis) {
    const cfg = configDoPerfil(p);
    for (const t of String(cfg.utm_contem || 'instagram,ig').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) termos.add(t);
    if (p.username) termos.add(p.username.toLowerCase());
  }
  if (!termos.size) return 0;
  const leads = all("SELECT extra FROM leads WHERE created_at >= ? AND created_at < ? AND source = 'yayforms'", [desde, ate]);
  let n = 0;
  for (const l of leads) {
    const utm = lerJson(l.extra, {})?.utm || {};
    const valores = [utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.source, utm.medium].filter(Boolean).map((x) => String(x).toLowerCase());
    if (valores.some((v) => [...termos].some((t) => (t.length <= 2 ? v === t : v.includes(t))))) n++;
  }
  return n;
}

function numerosDoDirect(perfilId, { desde, ate }) {
  const f = filtroPerfil(perfilId, 'c');
  const conversas = get(`SELECT count(*) AS n FROM ig_conversas c WHERE c.primeira_em >= ? AND c.primeira_em < ?${f.sql}`, [desde, ate, ...f.v]).n;
  const deAnuncio = get(`SELECT count(*) AS n FROM ig_conversas c WHERE c.primeira_em >= ? AND c.primeira_em < ? AND c.anuncio_id IS NOT NULL${f.sql}`, [desde, ate, ...f.v]).n;
  const recebidas = get(`SELECT count(*) AS n FROM ig_mensagens m JOIN ig_conversas c ON c.id = m.conversa_id WHERE m.de_mim = 0 AND m.timestamp >= ? AND m.timestamp < ?${f.sql}`, [desde, ate, ...f.v]).n;
  const leads = all(
    `SELECT DISTINCT l.id, s.kind, l.created_at,
            EXISTS (SELECT 1 FROM calendly_events e WHERE e.lead_id = l.id AND e.status = 'active') AS reuniao
       FROM ig_conversas c JOIN leads l ON l.id = c.lead_id JOIN stages s ON s.id = l.stage_id
      WHERE l.created_at >= ? AND l.created_at < ?${f.sql}`,
    [desde, ate, ...f.v]
  );
  return {
    conversas_novas: conversas, conversas_de_anuncio: deAnuncio, mensagens_recebidas: recebidas,
    leads: leads.length, reunioes: leads.filter((l) => l.reuniao).length, fechados: leads.filter((l) => l.kind === 'won').length,
    perdidos: leads.filter((l) => l.kind === 'lost').length,
  };
}

function numerosDosAnuncios(perfilId, p) {
  const f = filtroPerfil(perfilId, 'a');
  const r = get(
    `SELECT sum(d.gasto) AS gasto, sum(d.impressoes) AS impressoes, sum(d.alcance) AS alcance, sum(d.cliques) AS cliques,
            sum(d.cliques_link) AS cliques_link, sum(d.conversas) AS conversas, sum(d.leads) AS leads, count(DISTINCT a.id) AS anuncios
       FROM ig_anuncios_diario d JOIN ig_anuncios a ON a.id = d.anuncio_id WHERE d.dia >= ? AND d.dia <= ?${f.sql}`,
    [p.de, p.ate, ...f.v]
  );
  const gasto = r?.gasto || 0;
  return {
    gasto: Math.round(gasto * 100) / 100, impressoes: r?.impressoes || 0, alcance: r?.alcance || 0, cliques: r?.cliques || 0,
    cliques_link: r?.cliques_link || 0, conversas: r?.conversas || 0, leads: r?.leads || 0, anuncios: r?.anuncios || 0,
    custo_por_conversa: r?.conversas ? Math.round((gasto / r.conversas) * 100) / 100 : null,
    custo_por_lead: r?.leads ? Math.round((gasto / r.leads) * 100) / 100 : null,
    moeda: get('SELECT moeda FROM ig_anuncios_contas WHERE moeda IS NOT NULL LIMIT 1')?.moeda || 'BRL',
  };
}

/** Resumo de um período (usado para o período atual e o anterior) */
export function resumoDoPeriodo(perfilId, p) {
  const linhas = diasDaConta(perfilId, p);
  const iso = limitesIso(p);
  const posts = postsNoPeriodo(perfilId, p);
  const seguidores = serieSeguidores(perfilId, p);
  const valoresSeg = [...seguidores.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const segIni = valoresSeg[0]?.[1] ?? null;
  const segFim = valoresSeg[valoresSeg.length - 1]?.[1] ?? null;
  const seguiram = somaOuNulo(linhas, 'seguiram');
  const deixaram = somaOuNulo(linhas, 'deixaram_de_seguir');
  const novos = somaOuNulo(linhas, 'novos_seguidores');
  const interacoes = somaOuNulo(linhas, 'interacoes');
  const alcance = somaOuNulo(linhas, 'alcance');
  const visualizacoes = somaOuNulo(linhas, 'visualizacoes');
  return {
    periodo: p,
    seguidores: segFim,
    ganho_seguidores: seguiram !== null && deixaram !== null ? seguiram - deixaram : novos ?? (segIni !== null && segFim !== null ? segFim - segIni : null),
    seguiram, deixaram_de_seguir: deixaram, novos_seguidores: novos,
    visualizacoes, alcance, contas_engajadas: somaOuNulo(linhas, 'contas_engajadas'), interacoes,
    curtidas: somaOuNulo(linhas, 'curtidas'), comentarios: somaOuNulo(linhas, 'comentarios'),
    compartilhamentos: somaOuNulo(linhas, 'compartilhamentos'), salvamentos: somaOuNulo(linhas, 'salvamentos'),
    respostas: somaOuNulo(linhas, 'respostas'), reposts: somaOuNulo(linhas, 'reposts'), cliques_contato: somaOuNulo(linhas, 'cliques_contato'),
    engajamento_alcance: interacoes !== null && alcance ? pct(interacoes, alcance) : null,
    publicacoes: posts.length,
    publicacoes_por_formato: posts.reduce((r, x) => { const k = formato(x); r[k] = (r[k] || 0) + 1; return r; }, {}),
    visualizacoes_por_formato: quebrasSomadas(linhas, 'visualizacoes_por_formato'),
    alcance_por_seguidor: quebrasSomadas(linhas, 'alcance_por_seguidor'),
    direct: numerosDoDirect(perfilId, iso),
    leads_formulario: leadsFormularioDoInstagram(perfilId, iso),
    anuncios: numerosDosAnuncios(perfilId, p),
    dias_com_dados: linhas.filter((l) => l.visualizacoes !== null || l.alcance !== null).length,
  };
}

export const formato = (post) => (post.produto === 'STORY' ? 'stories' : post.produto === 'REELS' ? 'reels' : post.tipo === 'CAROUSEL_ALBUM' ? 'carrossel' : post.tipo === 'VIDEO' ? 'video' : 'foto');

/** Painel completo: indicadores com variação, série diária, formatos, melhores publicações, horários, público e funil */
export function painel({ perfilId = null, inicio = null, fim = null, dias = 30 } = {}) {
  const p = periodoEmDias({ inicio, fim, dias });
  const antes = periodoAnterior(p);
  const atual = resumoDoPeriodo(perfilId, p);
  const anterior = resumoDoPeriodo(perfilId, antes);
  const comparar = ['seguidores', 'ganho_seguidores', 'visualizacoes', 'alcance', 'interacoes', 'curtidas', 'comentarios', 'compartilhamentos', 'salvamentos', 'contas_engajadas', 'publicacoes', 'engajamento_alcance', 'leads_formulario'];
  const variacoes = Object.fromEntries(comparar.map((k) => [k, variacao(atual[k], anterior[k])]));
  variacoes.conversas_novas = variacao(atual.direct.conversas_novas, anterior.direct.conversas_novas);
  variacoes.leads_direct = variacao(atual.direct.leads, anterior.direct.leads);
  variacoes.gasto = variacao(atual.anuncios.gasto, anterior.anuncios.gasto);

  // Série diária
  const linhas = diasDaConta(perfilId, p);
  const porDia = new Map(linhas.map((l) => [l.dia, l]));
  const seguidores = serieSeguidores(perfilId, p);
  const f = filtroPerfil(perfilId, 'c');
  const directPorDia = new Map(all(
    `SELECT primeira_em FROM ig_conversas c WHERE c.primeira_em >= ? AND c.primeira_em < ?${f.sql}`, [limitesIso(p).desde, limitesIso(p).ate, ...f.v]
  ).reduce((m, r) => { const d = diaNoFuso(Date.parse(r.primeira_em)); m.set(d, (m.get(d) || 0) + 1); return m; }, new Map()));
  const fa = filtroPerfil(perfilId, 'a');
  const gastoPorDia = new Map(all(
    `SELECT d.dia, sum(d.gasto) AS gasto FROM ig_anuncios_diario d JOIN ig_anuncios a ON a.id = d.anuncio_id WHERE d.dia >= ? AND d.dia <= ?${fa.sql} GROUP BY d.dia`,
    [p.de, p.ate, ...fa.v]
  ).map((r) => [r.dia, r.gasto]));
  const serie = [];
  for (let d = p.de; d <= p.ate; d = somarDias(d, 1)) {
    const l = porDia.get(d) || {};
    serie.push({
      dia: d, seguidores: seguidores.get(d) ?? null, novos_seguidores: l.novos_seguidores ?? (l.seguiram !== undefined && l.seguiram !== null && l.deixaram_de_seguir !== null ? l.seguiram - l.deixaram_de_seguir : null),
      visualizacoes: l.visualizacoes ?? null, alcance: l.alcance ?? null, interacoes: l.interacoes ?? null,
      conversas: directPorDia.get(d) || 0, gasto: gastoPorDia.has(d) ? Math.round(gastoPorDia.get(d) * 100) / 100 : null,
    });
  }

  // Melhores publicações do período (por visualizações) e desempenho por formato
  const posts = postsNoPeriodo(perfilId, p).filter((x) => x.produto !== 'STORY');
  const melhores = [...posts].sort((a, b) => (b.visualizacoes || 0) - (a.visualizacoes || 0)).slice(0, 8).map(postParaTela);
  const porFormato = {};
  for (const x of postsNoPeriodo(perfilId, p)) {
    const k = formato(x);
    porFormato[k] = porFormato[k] || { formato: k, publicacoes: 0, visualizacoes: 0, alcance: 0, interacoes: 0 };
    porFormato[k].publicacoes++;
    porFormato[k].visualizacoes += x.visualizacoes || 0;
    porFormato[k].alcance += x.alcance || 0;
    porFormato[k].interacoes += x.interacoes || 0;
  }
  for (const v of Object.values(porFormato)) {
    v.media_visualizacoes = Math.round(v.visualizacoes / v.publicacoes);
    v.engajamento = pct(v.interacoes, v.alcance);
  }

  return {
    periodo: p, anterior: antes, atual, antes: anterior, variacoes, serie, melhores,
    por_formato: Object.values(porFormato).sort((a, b) => b.media_visualizacoes - a.media_visualizacoes),
    horarios: horarios(perfilId), publico: publico(perfilId), funil: funil(atual),
    perfis: perfilId ? null : comparativoPerfis(p),
    coleta: get(`SELECT max(sync_conta_em) AS conta, max(sync_posts_em) AS posts, min(conta_desde) AS desde FROM ig_perfis WHERE ativo = 1${perfilId ? ' AND id = ?' : ''}`, perfilId ? [perfilId] : []),
  };
}

function funil(r) {
  return [
    { etapa: 'visualizacoes', valor: r.visualizacoes },
    { etapa: 'contas_engajadas', valor: r.contas_engajadas },
    { etapa: 'conversas_direct', valor: r.direct.conversas_novas },
    { etapa: 'leads', valor: r.direct.leads + r.leads_formulario },
    { etapa: 'reunioes', valor: r.direct.reunioes },
    { etapa: 'fechados', valor: r.direct.fechados },
  ];
}

/** Melhores horários: seguidores online por hora (Meta) e média de visualizações por dia da semana × hora de publicação */
export function horarios(perfilId) {
  const f = filtroPerfil(perfilId);
  const online = all(`SELECT dados FROM ig_publico WHERE tipo = 'online' AND recorte = 'hora'${f.sql}`, f.v);
  const somaHoras = {};
  let fusoMeta = 'America/Los_Angeles';
  for (const o of online) {
    const d = lerJson(o.dados, {});
    fusoMeta = d.fuso_meta || fusoMeta;
    for (const [h, n] of Object.entries(d.medias || {})) somaHoras[h] = (somaHoras[h] || 0) + n;
  }
  // A Meta conta as horas no fuso do Pacífico: converte para o fuso do CRM
  const deslocamento = (() => {
    const agoraMs = Date.now();
    const hora = (tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(agoraMs));
    return (hora(fuso()) - hora(fusoMeta) + 24) % 24;
  })();
  const seguidoresOnline = Array.from({ length: 24 }, (_, h) => ({ hora: h, seguidores: somaHoras[(h - deslocamento + 24) % 24] ?? null }));
  const posts = all(`SELECT publicado_em, visualizacoes, interacoes FROM ig_posts WHERE produto <> 'STORY' AND removido_em IS NULL AND visualizacoes IS NOT NULL AND publicado_em >= ?${f.sql}`,
    [new Date(Date.now() - 180 * DIA_MS).toISOString(), ...f.v]);
  const grade = {};
  for (const x of posts) {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso(), weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(x.publicado_em));
    const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.find((y) => y.type === 'weekday')?.value);
    const hora = Number(partes.find((y) => y.type === 'hour')?.value);
    const k = `${dia}-${hora}`;
    grade[k] = grade[k] || { dia, hora, publicacoes: 0, visualizacoes: 0 };
    grade[k].publicacoes++;
    grade[k].visualizacoes += x.visualizacoes || 0;
  }
  const publicacao = Object.values(grade).map((g) => ({ ...g, media: Math.round(g.visualizacoes / g.publicacoes) })).sort((a, b) => b.media - a.media);
  return { seguidores_online: seguidoresOnline, publicacao, fuso: fuso() };
}

export function publico(perfilId) {
  const f = filtroPerfil(perfilId);
  const linhas = all(`SELECT tipo, recorte, dados, coletado_em FROM ig_publico WHERE tipo IN ('seguidores', 'engajado')${f.sql}`, f.v);
  const r = {};
  for (const l of linhas) {
    r[l.tipo] = r[l.tipo] || {};
    const atual = r[l.tipo][l.recorte] || {};
    for (const [k, v] of Object.entries(lerJson(l.dados, {}))) atual[k] = (atual[k] || 0) + (Number(v) || 0);
    r[l.tipo][l.recorte] = atual;
  }
  for (const tipo of Object.keys(r)) {
    for (const recorte of Object.keys(r[tipo])) {
      r[tipo][recorte] = Object.entries(r[tipo][recorte]).map(([chave, valor]) => ({ chave, valor })).sort((a, b) => b.valor - a.valor).slice(0, recorte === 'city' ? 12 : 20);
    }
  }
  return r;
}

function comparativoPerfis(p) {
  return all('SELECT id, username, nome, seguidores FROM ig_perfis WHERE ativo = 1 ORDER BY seguidores DESC').map((x) => {
    const r = resumoDoPeriodo(x.id, p);
    return {
      perfil_id: x.id, username: x.username, seguidores: x.seguidores, ganho_seguidores: r.ganho_seguidores, visualizacoes: r.visualizacoes,
      alcance: r.alcance, interacoes: r.interacoes, engajamento_alcance: r.engajamento_alcance, publicacoes: r.publicacoes,
      conversas: r.direct.conversas_novas, leads: r.direct.leads + r.leads_formulario, gasto: r.anuncios.gasto,
    };
  });
}

// ------------------------------------------------------------------ publicações

export function postParaTela(x) {
  const pago = get(
    `SELECT sum(d.gasto) AS gasto, sum(d.impressoes) AS impressoes, sum(d.alcance) AS alcance, sum(d.conversas) AS conversas, sum(d.leads) AS leads, count(DISTINCT a.id) AS anuncios
       FROM ig_anuncios a LEFT JOIN ig_anuncios_diario d ON d.anuncio_id = a.id WHERE a.post_id = ?`,
    [x.id]
  );
  const engajamento = x.interacoes !== null && x.alcance ? pct(x.interacoes, x.alcance) : null;
  return {
    id: x.id, perfil_id: x.perfil_id, formato: formato(x), tipo: x.tipo, produto: x.produto,
    legenda: x.legenda ? String(x.legenda).slice(0, 300) : null, permalink: x.permalink, publicado_em: x.publicado_em,
    miniatura: Boolean(x.thumb_local || x.thumb_url || (x.tipo !== 'VIDEO' && x.media_url)),
    visualizacoes: x.visualizacoes, alcance: x.alcance, curtidas: x.curtidas, comentarios: x.comentarios, salvamentos: x.salvamentos,
    compartilhamentos: x.compartilhamentos, interacoes: x.interacoes, reposts: x.reposts, seguiram: x.seguiram, visitas_perfil: x.visitas_perfil,
    respostas: x.respostas, cliques_link: x.cliques_link, tempo_medio_s: x.tempo_medio_ms ? Math.round(x.tempo_medio_ms / 100) / 10 : null,
    taxa_pulo: x.taxa_pulo, engajamento, total_visualizacoes: x.total_visualizacoes, total_curtidas: x.total_curtidas, total_comentarios: x.total_comentarios,
    pago: pago?.anuncios ? {
      anuncios: pago.anuncios, gasto: Math.round((pago.gasto || 0) * 100) / 100, impressoes: pago.impressoes || 0, alcance: pago.alcance || 0,
      conversas: pago.conversas || 0, leads: pago.leads || 0,
    } : null,
    metricas_em: x.metricas_em,
  };
}

const ORDENS = {
  recentes: 'publicado_em DESC',
  visualizacoes: 'COALESCE(visualizacoes, 0) DESC',
  alcance: 'COALESCE(alcance, 0) DESC',
  interacoes: 'COALESCE(interacoes, 0) DESC',
  engajamento: 'CASE WHEN alcance > 0 THEN CAST(interacoes AS REAL) / alcance END DESC',
  salvamentos: 'COALESCE(salvamentos, 0) DESC',
  compartilhamentos: 'COALESCE(compartilhamentos, 0) DESC',
  seguiram: 'COALESCE(seguiram, 0) DESC',
};

export function listarPosts({ perfilId = null, inicio = null, fim = null, dias = null, formato: fmt = null, ordenar = 'recentes', busca = '', limite = 200 } = {}) {
  const where = ['removido_em IS NULL'];
  const v = [];
  const f = filtroPerfil(perfilId);
  if (inicio || fim || dias) {
    const p = periodoEmDias({ inicio, fim, dias: dias || 30 });
    const { desde, ate } = limitesIso(p);
    where.push('publicado_em >= ? AND publicado_em < ?');
    v.push(desde, ate);
  }
  if (fmt === 'stories') where.push("produto = 'STORY'");
  else if (fmt === 'reels') where.push("produto = 'REELS'");
  else if (fmt === 'carrossel') where.push("tipo = 'CAROUSEL_ALBUM' AND produto <> 'STORY'");
  else if (fmt === 'foto') where.push("tipo = 'IMAGE' AND produto <> 'STORY'");
  else if (fmt === 'video') where.push("tipo = 'VIDEO' AND produto = 'FEED'");
  else where.push("produto <> 'STORY'");
  if (busca) { where.push('legenda LIKE ?'); v.push(`%${String(busca).replace(/[%_]/g, '')}%`); }
  const linhas = all(`SELECT * FROM ig_posts WHERE ${where.join(' AND ')}${f.sql} ORDER BY ${ORDENS[ordenar] || ORDENS.recentes} LIMIT ?`, [...v, ...f.v, Math.min(1000, limite)]);
  return linhas.map(postParaTela);
}

export function detalhePost(id) {
  const x = get('SELECT * FROM ig_posts WHERE id = ?', [String(id)]);
  if (!x) return null;
  const base = postParaTela(x);
  const media = get(
    `SELECT avg(visualizacoes) AS visualizacoes, avg(alcance) AS alcance, avg(interacoes) AS interacoes, avg(salvamentos) AS salvamentos, avg(compartilhamentos) AS compartilhamentos
       FROM ig_posts WHERE perfil_id = ? AND produto = ? AND removido_em IS NULL AND visualizacoes IS NOT NULL AND publicado_em >= ?`,
    [x.perfil_id, x.produto, new Date(Date.now() - 90 * DIA_MS).toISOString()]
  );
  return {
    ...base,
    legenda: x.legenda,
    metricas: lerJson(x.metricas, {}),
    evolucao: all('SELECT * FROM ig_posts_diario WHERE post_id = ? ORDER BY dia', [x.id]),
    media_do_perfil: Object.fromEntries(Object.entries(media || {}).map(([k, val]) => [k, val === null ? null : Math.round(val)])),
    anuncios: all(
      `SELECT a.id, a.nome, a.status, a.campanha_nome, sum(d.gasto) AS gasto, sum(d.impressoes) AS impressoes, sum(d.conversas) AS conversas, sum(d.leads) AS leads
         FROM ig_anuncios a LEFT JOIN ig_anuncios_diario d ON d.anuncio_id = a.id WHERE a.post_id = ? GROUP BY a.id`,
      [x.id]
    ),
    comentarios_guardados: get('SELECT count(*) AS n FROM ig_comentarios WHERE post_id = ? AND de_mim = 0', [x.id]).n,
  };
}

// ------------------------------------------------------------------ anúncios

/** Anúncios ligados aos perfis com os números do período e o que eles geraram no CRM (Direct → lead → fechado) */
export function listarAnuncios({ perfilId = null, inicio = null, fim = null, dias = 30 } = {}) {
  const p = periodoEmDias({ inicio, fim, dias });
  const f = filtroPerfil(perfilId, 'a');
  const linhas = all(
    `SELECT a.*, sum(d.gasto) AS gasto, sum(d.impressoes) AS impressoes, sum(d.alcance) AS alcance, sum(d.cliques) AS cliques,
            sum(d.cliques_link) AS cliques_link, sum(d.conversas) AS conversas_meta, sum(d.leads) AS leads_meta
       FROM ig_anuncios a JOIN ig_anuncios_diario d ON d.anuncio_id = a.id
      WHERE d.dia >= ? AND d.dia <= ?${f.sql} GROUP BY a.id ORDER BY gasto DESC`,
    [p.de, p.ate, ...f.v]
  );
  const { desde, ate } = limitesIso(p);
  return linhas.map((a) => {
    const crm = get(
      `SELECT count(*) AS conversas, count(c.lead_id) AS leads,
              sum(CASE WHEN s.kind = 'won' THEN 1 ELSE 0 END) AS fechados,
              sum(CASE WHEN EXISTS (SELECT 1 FROM calendly_events e WHERE e.lead_id = c.lead_id AND e.status = 'active') THEN 1 ELSE 0 END) AS reunioes
         FROM ig_conversas c LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN stages s ON s.id = l.stage_id
        WHERE c.anuncio_id = ? AND c.primeira_em >= ? AND c.primeira_em < ?`,
      [a.id, desde, ate]
    );
    const gasto = Math.round((a.gasto || 0) * 100) / 100;
    return {
      id: a.id, nome: a.nome, status: a.status, campanha: a.campanha_nome, objetivo: a.objetivo, conjunto: a.conjunto_nome,
      perfil_id: a.perfil_id, post_id: a.post_id, permalink: a.permalink,
      gasto, impressoes: a.impressoes || 0, alcance: a.alcance || 0, cliques: a.cliques || 0, cliques_link: a.cliques_link || 0,
      conversas_meta: a.conversas_meta || 0, leads_meta: a.leads_meta || 0,
      conversas_crm: crm?.conversas || 0, leads_crm: crm?.leads || 0, reunioes_crm: crm?.reunioes || 0, fechados_crm: crm?.fechados || 0,
      custo_por_conversa: a.conversas_meta ? Math.round((gasto / a.conversas_meta) * 100) / 100 : null,
      custo_por_lead_crm: crm?.leads ? Math.round((gasto / crm.leads) * 100) / 100 : null,
    };
  });
}
