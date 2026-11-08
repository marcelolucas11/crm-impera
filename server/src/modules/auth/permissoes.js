// Permissões por funcionário. O administrador libera, para cada pessoa da equipe, quais telas e funções do CRM ela usa
// (Equipe e integrações → Permissões). Administrador sempre pode tudo.
//
// Padrão: o que a equipe já usava antes das permissões continua liberado (kanban, WhatsApp, disparos, IA, estatísticas);
// as partes novas (Instagram) nascem fechadas e só o administrador libera.
// O servidor confere em cada rota: esconder o botão na tela é só conforto, quem decide é o servidor.
import { get } from '../../db.js';
import { lerJson } from '../../events.js';

export const PERMISSOES = [
  // telas
  { chave: 'kanban', grupo: 'telas', padrao: true },
  { chave: 'whatsapp', grupo: 'telas', padrao: true },
  { chave: 'instagram', grupo: 'telas', padrao: false },
  { chave: 'instagram_desempenho', grupo: 'telas', padrao: false },
  { chave: 'instagram_comentarios', grupo: 'telas', padrao: false },
  { chave: 'disparos', grupo: 'telas', padrao: true },
  { chave: 'ia', grupo: 'telas', padrao: true },
  { chave: 'agente', grupo: 'telas', padrao: true },
  { chave: 'estatisticas', grupo: 'telas', padrao: true },
  // funções
  { chave: 'leads_editar', grupo: 'funcoes', padrao: true },
  { chave: 'leads_excluir', grupo: 'funcoes', padrao: false },
  { chave: 'whatsapp_enviar', grupo: 'funcoes', padrao: true },
  { chave: 'instagram_responder', grupo: 'funcoes', padrao: false },
  { chave: 'disparos_enviar', grupo: 'funcoes', padrao: true },
];
const CHAVES = new Set(PERMISSOES.map((p) => p.chave));

/** Permissões efetivas de um usuário ({ chave: true|false } com todas as chaves). Administrador = tudo liberado. */
export function resolverPermissoes(user) {
  const admin = user?.role === 'admin';
  const salvas = lerJson(user?.permissoes, {}) || {};
  const r = {};
  for (const p of PERMISSOES) r[p.chave] = admin ? true : typeof salvas[p.chave] === 'boolean' ? salvas[p.chave] : p.padrao;
  return r;
}

/** Limpa o que veio da tela: só chaves conhecidas e valores verdadeiro/falso */
export function validarPermissoes(entrada) {
  const limpo = {};
  for (const [k, v] of Object.entries(entrada && typeof entrada === 'object' ? entrada : {})) {
    if (CHAVES.has(k)) limpo[k] = Boolean(v);
  }
  return limpo;
}

/** O usuário (objeto com role/permissoes, ou id) tem esta permissão? */
export function temPermissao(userOuId, chave) {
  const user = typeof userOuId === 'object' && userOuId
    ? userOuId
    : get('SELECT id, role, permissoes, active FROM users WHERE id = ?', [Number(userOuId)]);
  if (!user || user.active === 0) return false;
  if (user.role === 'admin') return true;
  const efetivas = user.permissoesEfetivas || resolverPermissoes(user);
  return Boolean(efetivas[chave]);
}

/** Middleware: passa se o usuário tiver ALGUMA das permissões indicadas (depois de exigirLogin) */
export function exigirPermissao(...chaves) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    const efetivas = req.user?.permissoesEfetivas || resolverPermissoes(req.user);
    if (chaves.some((c) => efetivas[c])) return next();
    return res.status(403).json({ erro: 'Você não tem permissão para esta parte do CRM. Peça a um administrador para liberar em Equipe e integrações → Permissões.' });
  };
}
