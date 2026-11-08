// Comentários das publicações: acompanhar (busca a cada N minutos as publicações recentes e recebe pelo webhook quando
// o app tem acesso avançado), responder publicamente, ocultar e "chamar no Direct" (resposta privada: a Meta deixa
// mandar UMA mensagem no Direct para quem comentou, em até 7 dias; a conversa continua se a pessoa responder).
// Vem desligado de fábrica: liga na aba Instagram → Ajustes.
import { get, all, run, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { chamar, paginar } from './graph.js';
import { lerConfig } from './config.js';
import { obterPerfil, atualizarPerfil, tokenDoPerfil, registrar, registrarErro, perfilPausado } from './perfis.js';
import { registrarMensagem } from './direct.js';

const PRAZO_DIRECT_MS = 7 * 86400000;
const CAMPOS = 'id,text,timestamp,username,like_count,from,parent_id,hidden';

const dataMeta = (v) => {
  if (!v) return null;
  const t = Date.parse(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function gravar(perfil, postId, c, paiId = null) {
  const deMim = String(c.from?.id || '') === String(perfil.ig_id) || (c.username && c.username === perfil.username);
  const novo = !get('SELECT 1 AS ok FROM ig_comentarios WHERE id = ?', [String(c.id)]);
  run(
    `INSERT INTO ig_comentarios (id, post_id, perfil_id, pai_id, usuario, usuario_id, texto, curtidas, de_mim, oculto, lido, publicado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET texto = excluded.texto, curtidas = COALESCE(excluded.curtidas, ig_comentarios.curtidas),
       oculto = excluded.oculto, apagado_em = NULL`,
    [String(c.id), postId ? String(postId) : null, perfil.id, paiId || c.parent_id || null, c.username || c.from?.username || null,
      c.from?.id ? String(c.from.id) : null, c.text || null, c.like_count ?? null, deMim ? 1 : 0, c.hidden ? 1 : 0, deMim ? 1 : 0,
      dataMeta(c.timestamp) || agora()]
  );
  // Resposta nossa a um comentário: marca o comentário de cima como respondido
  if (deMim && (paiId || c.parent_id)) run('UPDATE ig_comentarios SET respondido_em = COALESCE(respondido_em, ?) WHERE id = ?', [dataMeta(c.timestamp) || agora(), paiId || c.parent_id]);
  return novo && !deMim;
}

/** Busca os comentários das publicações dos últimos N dias */
export async function sincronizarComentarios(perfilId) {
  const cfg = lerConfig();
  const perfil = obterPerfil(perfilId);
  if (!perfil.ativo || perfilPausado(perfil)) return 0;
  const token = tokenDoPerfil(perfil);
  const desde = new Date(Date.now() - cfg.comentarios_dias * 86400000).toISOString();
  const posts = all("SELECT id, comentarios FROM ig_posts WHERE perfil_id = ? AND produto <> 'STORY' AND removido_em IS NULL AND publicado_em >= ? ORDER BY publicado_em DESC LIMIT 60", [perfilId, desde]);
  let novos = 0;
  for (const p of posts) {
    let lista;
    try {
      lista = await paginar(`${p.id}/comments`, { token, params: { fields: `${CAMPOS},replies{${CAMPOS}}`, limit: 50 } }, { max: 500 });
    } catch (err) {
      if (err.limite || err.tipo === 'token') { registrarErro(perfilId, 'Comentários', err); break; }
      continue;
    }
    for (const c of lista) {
      if (gravar(perfil, p.id, c)) novos++;
      for (const r of c.replies?.data || []) if (gravar(perfil, p.id, r, String(c.id))) novos++;
    }
  }
  atualizarPerfil(perfilId, { sync_comentarios_em: agora() });
  if (novos) emitir('instagram', { perfil: perfilId, comentarios: true });
  return novos;
}

/** Comentário que chegou pelo webhook (field "comments") */
export function aoReceberComentario(perfil, valor) {
  if (!lerConfig().comentarios_ativo || !valor?.id) return;
  const c = { id: valor.id, text: valor.text, username: valor.from?.username, from: valor.from, parent_id: valor.parent_id || null, timestamp: new Date().toISOString() };
  gravar(perfil, valor.media?.id || null, c);
  if (valor.media?.ad_id) run('UPDATE ig_comentarios SET anuncio_id = ? WHERE id = ?', [String(valor.media.ad_id), String(valor.id)]);
  emitir('instagram', { perfil: perfil.id, comentarios: true });
}

// ------------------------------------------------------------------ tela

const FILTROS = {
  todos: '1 = 1',
  nao_lidos: 'c.lido = 0',
  sem_resposta: 'c.respondido_em IS NULL AND c.direct_em IS NULL',
  anuncios: 'c.anuncio_id IS NOT NULL',
  ocultos: 'c.oculto = 1',
};

export function listarComentarios({ perfilId = null, postId = null, filtro = 'todos', busca = '', limite = 300 } = {}) {
  const where = ['c.de_mim = 0', 'c.pai_id IS NULL', 'c.apagado_em IS NULL', FILTROS[filtro] || FILTROS.todos, 'p.ativo = 1'];
  const v = [];
  if (perfilId) { where.push('c.perfil_id = ?'); v.push(perfilId); }
  if (postId) { where.push('c.post_id = ?'); v.push(String(postId)); }
  if (busca) { where.push('(c.texto LIKE ? OR c.usuario LIKE ?)'); const b = `%${String(busca).replace(/[%_]/g, '')}%`; v.push(b, b); }
  const linhas = all(
    `SELECT c.*, p.username AS perfil_username, po.legenda, po.permalink, po.produto, po.thumb_local, po.thumb_url,
            u.name AS respondido_por_nome, d.name AS direct_por_nome
       FROM ig_comentarios c JOIN ig_perfis p ON p.id = c.perfil_id LEFT JOIN ig_posts po ON po.id = c.post_id
       LEFT JOIN users u ON u.id = c.respondido_por LEFT JOIN users d ON d.id = c.direct_por
      WHERE ${where.join(' AND ')} ORDER BY c.publicado_em DESC LIMIT ?`,
    [...v, limite]
  );
  return linhas.map((c) => ({
    id: c.id, perfil_id: c.perfil_id, perfil_username: c.perfil_username, post_id: c.post_id, usuario: c.usuario, texto: c.texto,
    curtidas: c.curtidas, oculto: Boolean(c.oculto), lido: Boolean(c.lido), publicado_em: c.publicado_em,
    respondido_em: c.respondido_em, respondido_por: c.respondido_por_nome, direct_em: c.direct_em, direct_por: c.direct_por_nome,
    pode_direct: !c.direct_em && Date.now() - new Date(c.publicado_em).getTime() < PRAZO_DIRECT_MS,
    anuncio: Boolean(c.anuncio_id),
    post: c.post_id ? { legenda: c.legenda ? String(c.legenda).slice(0, 120) : null, permalink: c.permalink, produto: c.produto } : null,
    respostas: all('SELECT id, usuario, texto, de_mim, publicado_em FROM ig_comentarios WHERE pai_id = ? AND apagado_em IS NULL ORDER BY publicado_em', [c.id])
      .map((r) => ({ ...r, de_mim: Boolean(r.de_mim) })),
  }));
}

export const naoLidos = () => get('SELECT count(*) AS n FROM ig_comentarios c JOIN ig_perfis p ON p.id = c.perfil_id WHERE p.ativo = 1 AND c.lido = 0 AND c.de_mim = 0 AND c.pai_id IS NULL').n;

function obterComentario(id) {
  const c = get('SELECT * FROM ig_comentarios WHERE id = ?', [String(id)]);
  if (!c) throw new ErroHttp(404, 'Comentário não encontrado');
  return c;
}

export function marcarLidos(ids) {
  for (const id of (Array.isArray(ids) ? ids : [ids]).slice(0, 500)) run('UPDATE ig_comentarios SET lido = 1 WHERE id = ?', [String(id)]);
  emitir('instagram', { comentarios: true });
}

/** Resposta pública no comentário */
export async function responder(id, texto, userId) {
  const c = obterComentario(id);
  const msg = String(texto || '').trim().slice(0, 2200);
  if (!msg) throw new ErroHttp(400, 'Escreva a resposta');
  const perfil = obterPerfil(c.perfil_id);
  const r = await chamar(`${c.id}/replies`, { metodo: 'POST', token: tokenDoPerfil(perfil), params: { message: msg } });
  if (r?.id) gravar(perfil, c.post_id, { id: r.id, text: msg, username: perfil.username, from: { id: perfil.ig_id }, timestamp: new Date().toISOString() }, c.id);
  run('UPDATE ig_comentarios SET respondido_em = ?, respondido_por = ?, lido = 1 WHERE id = ?', [agora(), userId, c.id]);
  registrar(perfil.id, 'comentario', `Resposta pública a @${c.usuario || '?'}`);
  emitir('instagram', { comentarios: true });
  return { id: r?.id || null };
}

/** "Chamar no Direct": resposta privada (uma mensagem; a conversa continua se a pessoa responder) */
export async function chamarNoDirect(id, texto, userId) {
  const c = obterComentario(id);
  if (c.direct_em) throw new ErroHttp(409, 'Esta pessoa já foi chamada no Direct por este comentário');
  if (Date.now() - new Date(c.publicado_em).getTime() > PRAZO_DIRECT_MS) throw new ErroHttp(409, 'O Instagram só deixa chamar no Direct até 7 dias depois do comentário');
  const msg = String(texto || '').trim().slice(0, 1000);
  if (!msg) throw new ErroHttp(400, 'Escreva a mensagem');
  const perfil = obterPerfil(c.perfil_id);
  const r = await chamar(`${perfil.page_id}/messages`, {
    metodo: 'POST', token: tokenDoPerfil(perfil), corpo: { recipient: { comment_id: c.id }, message: { text: msg } },
  });
  run('UPDATE ig_comentarios SET direct_em = ?, direct_por = ?, lido = 1 WHERE id = ?', [agora(), userId, c.id]);
  let conversaId = null;
  if (r?.recipient_id) {
    const { mensagem } = registrarMensagem(perfil, {
      igsid: String(r.recipient_id), mid: r.message_id || null, deMim: true, timestamp: agora(), texto: msg, origem: 'crm', enviadoPor: userId, status: 2,
    }, { aoVivo: true });
    conversaId = mensagem.conversa_id;
    run("UPDATE ig_conversas SET origem = COALESCE(origem, 'comentario') WHERE id = ?", [conversaId]);
  }
  registrar(perfil.id, 'comentario', `Chamou @${c.usuario || '?'} no Direct pelo comentário`);
  emitir('instagram', { comentarios: true });
  return { conversa_id: conversaId };
}

export async function ocultar(id, oculto = true) {
  const c = obterComentario(id);
  const perfil = obterPerfil(c.perfil_id);
  await chamar(c.id, { metodo: 'POST', token: tokenDoPerfil(perfil), params: { hide: oculto ? 'true' : 'false' } });
  run('UPDATE ig_comentarios SET oculto = ?, lido = 1 WHERE id = ?', [oculto ? 1 : 0, c.id]);
  emitir('instagram', { comentarios: true });
}
