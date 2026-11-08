// Permissões da pessoa logada (vêm do servidor em user.permissoes). Esconder na tela é só conforto:
// quem decide é o servidor. Administrador pode tudo.

export function pode(user, chave) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(user.permissoes?.[chave]);
}

// Telas do topo e as permissões que liberam cada uma
const TELAS = {
  kanban: ['kanban'],
  whatsapp: ['whatsapp'],
  instagram: ['instagram', 'instagram_desempenho', 'instagram_comentarios'],
  disparos: ['disparos'],
  ia: ['ia', 'agente'],
  estatisticas: ['estatisticas'],
};

export const ORDEM_TELAS = ['kanban', 'whatsapp', 'instagram', 'disparos', 'ia', 'estatisticas'];

export function podeVer(user, pagina) {
  if (pagina === 'equipe') return true;
  const chaves = TELAS[pagina];
  if (!chaves) return false;
  return chaves.some((c) => pode(user, c));
}

export function primeiraPagina(user) {
  return ORDEM_TELAS.find((p) => podeVer(user, p)) || 'equipe';
}
