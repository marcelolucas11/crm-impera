// Perfis conectados, tokens guardados e o registro do que aconteceu (para a tela de configuração).
// Tokens ficam na tabela ig_credenciais, que nunca aparece na tela nem nas consultas da assistente.
import { get, all, run, agora } from '../../db.js';
import { lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';

// ------------------------------------------------------------------ tokens

export function lerCredencial(chave) {
  return get('SELECT * FROM ig_credenciais WHERE chave = ?', [chave]);
}

export function salvarCredencial(chave, { token, tipo = null, conta = null, expiraEm = null, dadosExpiramEm = null, escopos = null }) {
  run(
    `INSERT INTO ig_credenciais (chave, token, tipo, conta_meta, expira_em, dados_expiram_em, escopos, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET token = excluded.token, tipo = excluded.tipo, conta_meta = excluded.conta_meta,
       expira_em = excluded.expira_em, dados_expiram_em = excluded.dados_expiram_em, escopos = excluded.escopos,
       atualizado_em = excluded.atualizado_em`,
    [chave, token, tipo, conta, expiraEm, dadosExpiramEm, escopos ? JSON.stringify(escopos) : null, agora()]
  );
}

export function apagarCredencial(chave) {
  run('DELETE FROM ig_credenciais WHERE chave = ?', [chave]);
}

export const tokenUsuario = () => lerCredencial('usuario')?.token || null;

/** Token da Página ligada ao perfil (é com ele que se fala com o Instagram) */
export function tokenDoPerfil(perfil) {
  const p = typeof perfil === 'object' ? perfil : get('SELECT page_id FROM ig_perfis WHERE id = ?', [perfil]);
  const t = p?.page_id ? lerCredencial(`pagina:${p.page_id}`)?.token : null;
  if (!t) throw new ErroHttp(409, 'Este perfil está sem acesso à Meta. Conecte de novo em Equipe e integrações → Instagram.');
  return t;
}

// ------------------------------------------------------------------ perfis

export const perfilPorId = (id) => get('SELECT * FROM ig_perfis WHERE id = ?', [id]);
export const perfilPorIgId = (igId) => get('SELECT * FROM ig_perfis WHERE ig_id = ?', [String(igId)]);
export const perfilPorPagina = (pageId) => get('SELECT * FROM ig_perfis WHERE page_id = ?', [String(pageId)]);
export const perfisAtivos = () => all('SELECT * FROM ig_perfis WHERE ativo = 1 ORDER BY id');

export function obterPerfil(id) {
  const p = perfilPorId(id);
  if (!p) throw new ErroHttp(404, 'Perfil não encontrado');
  return p;
}

export function atualizarPerfil(id, campos) {
  const chaves = Object.keys(campos);
  if (!chaves.length) return;
  run(`UPDATE ig_perfis SET ${chaves.map((k) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE id = ?`, [...chaves.map((k) => campos[k]), agora(), id]);
  motores.delete(Number(id));
}

export function configDoPerfil(perfil) {
  return lerJson(perfil?.config, {}) || {};
}

/**
 * Motor do Direct do perfil: 'oficial' (API da Meta, janela de 24 h) ou 'login' (entra como o app do Instagram,
 * plugin privado/). Métricas, publicações, comentários e anúncios seguem sempre pela API oficial.
 */
const motores = new Map(); // perfilId → { motor, em } (a lista de conversas pergunta isto para cada linha)
export function motorDoPerfil(perfil) {
  if (typeof perfil === 'object' && perfil) return configDoPerfil(perfil).direct_motor === 'login' ? 'login' : 'oficial';
  const guardado = motores.get(perfil);
  if (guardado && Date.now() - guardado.em < 5000) return guardado.motor;
  const p = get('SELECT config FROM ig_perfis WHERE id = ?', [perfil]);
  const motor = configDoPerfil(p).direct_motor === 'login' ? 'login' : 'oficial';
  motores.set(perfil, { motor, em: Date.now() });
  return motor;
}

/** Pausa um perfil depois de bater no limite de chamadas da Meta (os relógios pulam ele até lá) */
export function pausarPerfil(id, minutos = 60) {
  atualizarPerfil(id, { pausado_ate: new Date(Date.now() + minutos * 60000).toISOString() });
}

export const perfilPausado = (p) => Boolean(p?.pausado_ate && p.pausado_ate > agora());

/** Perfil para a tela (sem nada sigiloso) */
export function perfilPublico(p) {
  if (!p) return null;
  const cred = p.page_id ? lerCredencial(`pagina:${p.page_id}`) : null;
  return {
    id: p.id, ig_id: p.ig_id, page_id: p.page_id, page_nome: p.page_nome, username: p.username, nome: p.nome,
    foto: Boolean(p.foto_local || p.foto_url), biografia: p.biografia, site: p.site,
    seguidores: p.seguidores, seguindo: p.seguindo, publicacoes: p.publicacoes,
    ativo: Boolean(p.ativo), alice_ativa: Boolean(p.alice_ativa), com_acesso: Boolean(cred),
    inscrito_em: p.inscrito_em, inscricao_erro: p.inscricao_erro, webhook_em: p.webhook_em,
    ultimo_erro: p.ultimo_erro, ultimo_erro_em: p.ultimo_erro_em, pausado_ate: p.pausado_ate,
    sync_direct_em: p.sync_direct_em, sync_conta_em: p.sync_conta_em, sync_posts_em: p.sync_posts_em,
    sync_stories_em: p.sync_stories_em, sync_comentarios_em: p.sync_comentarios_em, historico_direct_em: p.historico_direct_em,
    conta_desde: p.conta_desde, conta_backfill_ok: Boolean(p.conta_backfill_ok),
    config: configDoPerfil(p),
    direct_motor: motorDoPerfil(p),
  };
}

// ------------------------------------------------------------------ registro

const MAX_REGISTRO = 3000;
let contadorLimpeza = 0;

export function registrar(perfilId, tipo, detalhe = null) {
  run('INSERT INTO ig_registro (perfil_id, tipo, detalhe) VALUES (?, ?, ?)', [perfilId || null, tipo, detalhe ? String(detalhe).slice(0, 1000) : null]);
  if (++contadorLimpeza % 200 === 0) {
    run('DELETE FROM ig_registro WHERE id NOT IN (SELECT id FROM ig_registro ORDER BY id DESC LIMIT ?)', [MAX_REGISTRO]);
  }
}

/** Erro numa sincronização: guarda no perfil (aparece na tela) e pausa se for limite da Meta */
export function registrarErro(perfilId, onde, err) {
  const texto = `${onde}: ${err?.message || err}`.slice(0, 500);
  if (perfilId) {
    atualizarPerfil(perfilId, { ultimo_erro: texto, ultimo_erro_em: agora() });
    if (err?.limite) pausarPerfil(perfilId, 60);
  }
  registrar(perfilId, 'erro', texto);
  console.error(`[instagram] ${texto}`);
  emitir('instagram', { perfil: perfilId, erro: true });
}

export function limparErro(perfilId) {
  run('UPDATE ig_perfis SET ultimo_erro = NULL, ultimo_erro_em = NULL WHERE id = ? AND ultimo_erro IS NOT NULL', [perfilId]);
}

export function ultimosRegistros(limite = 60) {
  return all(
    `SELECT r.id, r.tipo, r.detalhe, r.criado_em, p.username FROM ig_registro r LEFT JOIN ig_perfis p ON p.id = r.perfil_id
      ORDER BY r.id DESC LIMIT ?`,
    [limite]
  );
}
