// Conexão com a Meta: login do Facebook (OAuth) ou token colado (usuário do sistema do Gerenciador de Negócios),
// lista das contas do Instagram disponíveis, conectar/desconectar perfis e inscrição da Página no app (webhooks).
//
// Recomendado para uso interno: token de USUÁRIO DO SISTEMA (Gerenciador de Negócios → Usuários do sistema), que não
// expira. O login do Facebook gera um token de 60 dias; o CRM avisa antes de vencer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { lerConfig, idApp, segredoApp, versaoApi } from './config.js';
import { chamar, paginar, baixarArquivo, ErroMeta } from './graph.js';
import {
  lerCredencial, salvarCredencial, apagarCredencial, tokenUsuario, perfilPorIgId, obterPerfil, atualizarPerfil,
  registrar, perfilPublico, tokenDoPerfil,
} from './perfis.js';

// Permissões pedidas no login comum (no Login do Facebook para Empresas elas vêm da configuração)
export const ESCOPOS = [
  'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments', 'instagram_manage_insights',
  'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'business_management', 'ads_read',
];
const CAMPOS_PERFIL = 'id,username,name,profile_picture_url,biography,website,followers_count,follows_count,media_count';
export const PASTA = () => path.join(config.filesDir, 'instagram');

// ------------------------------------------------------------------ endereço de retorno do login

export function urlPublica(req = null) {
  if (config.publicUrl) return config.publicUrl;
  if (!req) return '';
  return `${req.protocol}://${req.get('host')}${config.basePath}`;
}

export const urlRetorno = (req) => `${urlPublica(req)}/api/instagram/oauth/retorno`;
export const urlWebhook = (req) => `${urlPublica(req)}/webhooks/instagram`;

/** Endereço do login do Facebook. Guarda um "state" na sessão para conferir no retorno. */
export function urlLogin(req) {
  const appId = idApp();
  if (!appId) throw new ErroHttp(400, 'Preencha o ID do app da Meta antes de conectar');
  if (!segredoApp()) throw new ErroHttp(400, 'Preencha a chave secreta do app da Meta antes de conectar');
  const estado = crypto.randomBytes(16).toString('hex');
  req.session.igEstado = estado;
  const cfg = lerConfig();
  const p = new URLSearchParams({ client_id: appId, redirect_uri: urlRetorno(req), state: estado, response_type: 'code' });
  if (cfg.config_id) p.set('config_id', cfg.config_id);
  else p.set('scope', ESCOPOS.join(','));
  return `https://www.facebook.com/${versaoApi()}/dialog/oauth?${p}`;
}

/** Retorno do login: troca o código por um token de usuário de longa duração e guarda */
export async function concluirLogin(req, { code, state }) {
  if (!state || state !== req.session.igEstado) throw new ErroHttp(400, 'O login voltou com um código que não é deste CRM. Tente conectar de novo.');
  req.session.igEstado = null;
  if (!code) throw new ErroHttp(400, 'A Meta não mandou o código de acesso (login cancelado?)');
  const curto = await chamar('oauth/access_token', {
    params: { client_id: idApp(), client_secret: segredoApp(), redirect_uri: urlRetorno(req), code }, provar: false,
  });
  return guardarTokenUsuario(curto.access_token, { origem: 'login' });
}

// ------------------------------------------------------------------ token de usuário

/** Confere o token na Meta (tipo, validade, permissões). Precisa do ID e do segredo do app. */
export async function inspecionarToken(token) {
  if (!idApp() || !segredoApp()) return null;
  try {
    const r = await chamar('debug_token', { params: { input_token: token, access_token: `${idApp()}|${segredoApp()}` }, provar: false });
    return r?.data || null;
  } catch {
    return null;
  }
}

const dataDe = (seg) => (seg && Number(seg) > 0 ? new Date(Number(seg) * 1000).toISOString() : null);

/**
 * Guarda um token de usuário (do login ou colado na tela). Token curto de usuário vira de longa duração (60 dias).
 * Token de usuário do sistema não expira.
 */
export async function guardarTokenUsuario(bruto, { origem = 'colado' } = {}) {
  let token = String(bruto ?? '').replace(/\s+/g, '');
  if (!/^EA[A-Za-z0-9]{20,}$/.test(token)) throw new ErroHttp(400, 'Isso não parece um token de acesso da Meta (começa com EA…)');
  // Confere se funciona antes de guardar
  let eu;
  try {
    eu = await chamar('me', { token, params: { fields: 'id,name' } });
  } catch (err) {
    throw new ErroHttp(400, `A Meta não aceitou este token: ${err.message}`);
  }
  let info = await inspecionarToken(token);
  // Token de usuário que expira logo: troca por um de longa duração
  if (info?.type === 'USER' && info.expires_at && info.expires_at * 1000 - Date.now() < 7 * 86400000 && segredoApp()) {
    try {
      const longo = await chamar('oauth/access_token', {
        params: { grant_type: 'fb_exchange_token', client_id: idApp(), client_secret: segredoApp(), fb_exchange_token: token }, provar: false,
      });
      if (longo?.access_token) {
        token = longo.access_token;
        info = (await inspecionarToken(token)) || info;
      }
    } catch (err) {
      registrar(null, 'aviso', `Não consegui trocar o token por um de longa duração: ${err.message}`);
    }
  }
  const sistema = info?.type === 'SYSTEM_USER' || (info && !info.expires_at);
  salvarCredencial('usuario', {
    token,
    tipo: sistema ? 'sistema' : 'usuario',
    conta: eu?.name || null,
    expiraEm: dataDe(info?.expires_at),
    dadosExpiramEm: dataDe(info?.data_access_expires_at),
    escopos: info?.scopes || null,
  });
  registrar(null, 'conexao', `Acesso à Meta salvo (${origem}) — ${eu?.name || 'conta'}${sistema ? ', usuário do sistema' : ''}`);
  emitir('instagram', { conexao: true });
  return estadoConexao();
}

export function removerTokenUsuario() {
  apagarCredencial('usuario');
  registrar(null, 'conexao', 'Acesso à Meta removido (os perfis já conectados continuam com o acesso da Página)');
  emitir('instagram', { conexao: true });
}

/** Situação do acesso à Meta para a tela (sem o token) */
export function estadoConexao() {
  const c = lerCredencial('usuario');
  const escopos = (() => { try { return JSON.parse(c?.escopos || 'null'); } catch { return null; } })();
  const faltando = escopos ? ESCOPOS.filter((e) => !escopos.includes(e)) : [];
  const vence = c?.expira_em ? new Date(c.expira_em).getTime() : null;
  return {
    conectado: Boolean(c),
    tipo: c?.tipo || null,
    conta: c?.conta_meta || null,
    expira_em: c?.expira_em || null,
    dados_expiram_em: c?.dados_expiram_em || null,
    vence_logo: Boolean(vence && vence - Date.now() < 10 * 86400000),
    escopos,
    escopos_faltando: faltando,
    atualizado_em: c?.atualizado_em || null,
  };
}

// ------------------------------------------------------------------ contas disponíveis e perfis

/** Páginas que o token enxerga e o Instagram ligado a cada uma */
async function paginasComInstagram() {
  const token = tokenUsuario();
  if (!token) throw new ErroHttp(409, 'Conecte a conta da Meta primeiro (login do Facebook ou token)');
  const paginas = await paginar('me/accounts', {
    token,
    params: { fields: 'id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url,followers_count}', limit: 100 },
  }, { max: 500 });
  return paginas;
}

export async function contasDisponiveis() {
  const paginas = await paginasComInstagram();
  return paginas.map((p) => {
    const ig = p.instagram_business_account;
    const ja = ig ? perfilPorIgId(ig.id) : null;
    return {
      page_id: p.id, page_nome: p.name, tarefas: p.tasks || [],
      instagram: ig ? { ig_id: ig.id, username: ig.username, nome: ig.name, seguidores: ig.followers_count ?? null, foto_url: ig.profile_picture_url || null } : null,
      conectado: Boolean(ja?.ativo), perfil_id: ja?.id || null,
    };
  });
}

/** Busca os dados do perfil na Meta e guarda (foto baixada para não depender do link que expira) */
export async function atualizarDadosDoPerfil(perfilId) {
  const p = obterPerfil(perfilId);
  const token = tokenDoPerfil(p);
  const d = await chamar(p.ig_id, { token, params: { fields: CAMPOS_PERFIL } });
  const campos = {
    username: d.username || p.username, nome: d.name || p.nome, biografia: d.biography ?? p.biografia, site: d.website ?? p.site,
    seguidores: d.followers_count ?? p.seguidores, seguindo: d.follows_count ?? p.seguindo, publicacoes: d.media_count ?? p.publicacoes,
    foto_url: d.profile_picture_url || p.foto_url,
  };
  if (d.profile_picture_url && d.profile_picture_url !== p.foto_url) {
    try {
      const r = await baixarArquivo(d.profile_picture_url, path.join(PASTA(), 'perfis', `perfil-${p.id}`), { maxBytes: 5 * 1024 * 1024 });
      campos.foto_local = path.relative(config.filesDir, r.caminho);
    } catch { /* fica sem a foto local */ }
  }
  atualizarPerfil(perfilId, campos);
  return obterPerfil(perfilId);
}

/** Inscreve a Página no app para os webhooks do Instagram chegarem (precisa da permissão pages_manage_metadata) */
export async function inscreverPagina(perfilId) {
  const p = obterPerfil(perfilId);
  try {
    await chamar(`${p.page_id}/subscribed_apps`, { metodo: 'POST', token: tokenDoPerfil(p), params: { subscribed_fields: 'feed' } });
    atualizarPerfil(perfilId, { inscrito_em: agora(), inscricao_erro: null });
    return true;
  } catch (err) {
    atualizarPerfil(perfilId, { inscricao_erro: err.message.slice(0, 400) });
    registrar(perfilId, 'aviso', `Inscrição da Página nos webhooks: ${err.message}`);
    return false;
  }
}

/** Conecta (ou reconecta) um perfil a partir da lista de contas disponíveis */
export async function conectarPerfil(igId) {
  const paginas = await paginasComInstagram();
  const pagina = paginas.find((p) => p.instagram_business_account?.id === String(igId));
  if (!pagina) throw new ErroHttp(404, 'Este Instagram não apareceu nas contas que o acesso enxerga. Confira se ele é profissional e está ligado a uma Página do Facebook.');
  if (!pagina.access_token) throw new ErroHttp(409, 'A Meta não devolveu o acesso da Página. Confira se a conta tem a tarefa de gerenciar a Página.');
  const ig = pagina.instagram_business_account;
  salvarCredencial(`pagina:${pagina.id}`, { token: pagina.access_token, tipo: 'pagina', conta: pagina.name });
  const existente = perfilPorIgId(ig.id);
  let id;
  if (existente) {
    id = existente.id;
    atualizarPerfil(id, { page_id: pagina.id, page_nome: pagina.name, ativo: 1, username: ig.username || existente.username, nome: ig.name || existente.nome });
  } else {
    id = Number(run('INSERT INTO ig_perfis (ig_id, page_id, page_nome, username, nome, seguidores) VALUES (?, ?, ?, ?, ?, ?)', [
      ig.id, pagina.id, pagina.name, ig.username || null, ig.name || null, ig.followers_count ?? null,
    ]).lastInsertRowid);
  }
  try { await atualizarDadosDoPerfil(id); } catch (err) { registrar(id, 'aviso', `Dados do perfil: ${err.message}`); }
  await inscreverPagina(id);
  registrar(id, 'conexao', `Perfil @${ig.username || ig.id} conectado`);
  emitir('instagram', { perfis: true });
  return perfilPublico(obterPerfil(id));
}

/** Desconecta: para de sincronizar e apaga o acesso da Página. Nada do que foi guardado é apagado. */
export async function desconectarPerfil(perfilId) {
  const p = obterPerfil(perfilId);
  try {
    if (p.page_id && lerCredencial(`pagina:${p.page_id}`)) {
      await chamar(`${p.page_id}/subscribed_apps`, { metodo: 'DELETE', token: tokenDoPerfil(p) }).catch(() => {});
    }
  } finally {
    // A mesma Página pode estar ligada a outro perfil? Não no Instagram: 1 Página ↔ 1 perfil
    if (p.page_id) apagarCredencial(`pagina:${p.page_id}`);
    atualizarPerfil(perfilId, { ativo: 0, alice_ativa: 0, inscrito_em: null });
    registrar(perfilId, 'conexao', `Perfil @${p.username || p.ig_id} desconectado (os dados continuam guardados)`);
    emitir('instagram', { perfis: true });
  }
}

/** Confere o acesso (todo dia): token perto de vencer, Página sem acesso, permissões que faltam */
export async function conferirAcessos() {
  const c = lerCredencial('usuario');
  if (c) {
    const info = await inspecionarToken(c.token);
    if (info && info.is_valid === false) registrar(null, 'aviso', 'O acesso de usuário da Meta não é mais válido: conecte de novo');
    else if (info) {
      run('UPDATE ig_credenciais SET expira_em = ?, dados_expiram_em = ?, escopos = ? WHERE chave = ?', [
        dataDe(info.expires_at), dataDe(info.data_access_expires_at), info.scopes ? JSON.stringify(info.scopes) : c.escopos, 'usuario',
      ]);
    }
  }
  for (const p of all('SELECT * FROM ig_perfis WHERE ativo = 1')) {
    if (!lerCredencial(`pagina:${p.page_id}`)) continue;
    try {
      await chamar(p.page_id, { token: tokenDoPerfil(p), params: { fields: 'id' } });
    } catch (err) {
      if (err instanceof ErroMeta && err.tipo === 'token') {
        atualizarPerfil(p.id, { ultimo_erro: `Acesso da Página: ${err.message}`.slice(0, 500), ultimo_erro_em: agora() });
        // Tenta renovar pelo token de usuário (a Página continua a mesma)
        try { await conectarPerfil(p.ig_id); } catch { /* fica o aviso na tela */ }
      }
    }
  }
}

/** Arquivo local da foto do perfil (ou null) */
export function arquivoFotoPerfil(perfilId) {
  const p = get('SELECT foto_local FROM ig_perfis WHERE id = ?', [perfilId]);
  if (!p?.foto_local) return null;
  const caminho = path.join(config.filesDir, p.foto_local);
  return fs.existsSync(caminho) ? caminho : null;
}
