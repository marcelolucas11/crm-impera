// Diretrizes da Alice: textos (prompts) que cada usuário escreve, cola ou sobe de arquivo para dar o norte à
// sua assistente. Mesmo funcionamento das diretrizes da IA de primeiro contato, mas uma lista por usuário.
// Cada edição guarda a versão anterior. Memória: fatos curtos que ela leva em conta em tudo.
import { get, all, run, tx, agora } from '../../db.js';
import { ErroHttp } from '../../util.js';

export const LIMITES = { titulo: 120, conteudo: 40000, totalAtivas: 80000, quantidade: 50, versoesPorDiretriz: 30 };
const textoLimpo = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim().slice(0, max);
const nomeArquivo = (v) => String(v ?? '').trim().split(/[\\/]/).pop().slice(0, 120) || null;

const CAMPOS = `d.id, d.titulo, d.conteudo, d.ativa, d.ordem, d.arquivo, d.criada_em, d.atualizada_em,
  (SELECT count(*) FROM agente_diretrizes_versoes v WHERE v.diretriz_id = d.id) AS versoes`;
const paraTela = (d) => (d ? { ...d, ativa: Boolean(d.ativa), caracteres: d.conteudo.length } : null);

export const listarDiretrizes = (userId) => all(`SELECT ${CAMPOS} FROM agente_diretrizes d WHERE d.user_id = ? ORDER BY d.ordem, d.id`, [userId]).map(paraTela);

export function obterDiretriz(userId, id) {
  const d = paraTela(get(`SELECT ${CAMPOS} FROM agente_diretrizes d WHERE d.id = ? AND d.user_id = ?`, [id, userId]));
  if (!d) throw new ErroHttp(404, 'Diretriz não encontrada');
  return d;
}

export const diretrizesAtivas = (userId) => all("SELECT titulo, conteudo FROM agente_diretrizes WHERE user_id = ? AND ativa = 1 AND trim(conteudo) <> '' ORDER BY ordem, id", [userId]);

export function resumoDiretrizes(userId) {
  const r = get("SELECT count(*) AS total, COALESCE(sum(ativa), 0) AS ativas, COALESCE(sum(CASE WHEN ativa = 1 THEN length(conteudo) ELSE 0 END), 0) AS caracteres_ativos FROM agente_diretrizes WHERE user_id = ?", [userId]);
  return { ...r, limite_caracteres_ativos: LIMITES.totalAtivas, limite_caracteres: LIMITES.conteudo };
}

function conferirTotal(userId, { id = null, conteudo, ativa }) {
  if (!ativa) return;
  const outras = get('SELECT COALESCE(sum(length(conteudo)), 0) AS n FROM agente_diretrizes WHERE user_id = ? AND ativa = 1 AND id IS NOT ?', [userId, id]).n;
  if (outras + conteudo.length > LIMITES.totalAtivas) throw new ErroHttp(400, `As diretrizes ativas passariam de ${LIMITES.totalAtivas.toLocaleString('pt-BR')} caracteres somadas. Desative ou encurte alguma antes.`);
}

function validar(entrada, atual = null) {
  const titulo = entrada.titulo === undefined ? atual?.titulo : textoLimpo(entrada.titulo, LIMITES.titulo);
  if (!titulo) throw new ErroHttp(400, 'Dê um título para a diretriz');
  const bruto = entrada.conteudo === undefined ? atual?.conteudo ?? '' : String(entrada.conteudo ?? '');
  if (bruto.length > LIMITES.conteudo + 2000) throw new ErroHttp(400, `Texto grande demais: o limite é ${LIMITES.conteudo.toLocaleString('pt-BR')} caracteres por diretriz.`);
  return { titulo, conteudo: textoLimpo(bruto, LIMITES.conteudo), ativa: entrada.ativa === undefined ? Boolean(atual?.ativa ?? true) : Boolean(entrada.ativa) };
}

export function criarDiretriz(userId, entrada = {}) {
  if (get('SELECT count(*) AS n FROM agente_diretrizes WHERE user_id = ?', [userId]).n >= LIMITES.quantidade) throw new ErroHttp(400, `Limite de ${LIMITES.quantidade} diretrizes.`);
  const v = validar(entrada);
  conferirTotal(userId, v);
  const ordem = (get('SELECT COALESCE(max(ordem), 0) AS m FROM agente_diretrizes WHERE user_id = ?', [userId]).m || 0) + 1;
  const r = run('INSERT INTO agente_diretrizes (user_id, titulo, conteudo, ativa, ordem, arquivo) VALUES (?, ?, ?, ?, ?, ?)', [userId, v.titulo, v.conteudo, v.ativa ? 1 : 0, ordem, nomeArquivo(entrada.arquivo)]);
  return obterDiretriz(userId, Number(r.lastInsertRowid));
}

export function atualizarDiretriz(userId, id, entrada = {}) {
  const atual = get('SELECT * FROM agente_diretrizes WHERE id = ? AND user_id = ?', [id, userId]);
  if (!atual) throw new ErroHttp(404, 'Diretriz não encontrada');
  const v = validar(entrada, atual);
  conferirTotal(userId, { id, ...v });
  const mudouTexto = v.titulo !== atual.titulo || v.conteudo !== atual.conteudo;
  tx(() => {
    if (mudouTexto) {
      run('INSERT INTO agente_diretrizes_versoes (diretriz_id, titulo, conteudo, salva_em) VALUES (?, ?, ?, ?)', [id, atual.titulo, atual.conteudo, atual.atualizada_em]);
      run('DELETE FROM agente_diretrizes_versoes WHERE diretriz_id = ? AND id NOT IN (SELECT id FROM agente_diretrizes_versoes WHERE diretriz_id = ? ORDER BY id DESC LIMIT ?)', [id, id, LIMITES.versoesPorDiretriz]);
    }
    run('UPDATE agente_diretrizes SET titulo = ?, conteudo = ?, ativa = ?, arquivo = COALESCE(?, arquivo), atualizada_em = ? WHERE id = ?',
      [v.titulo, v.conteudo, v.ativa ? 1 : 0, nomeArquivo(entrada.arquivo), mudouTexto ? agora() : atual.atualizada_em, id]);
  });
  return obterDiretriz(userId, id);
}

export function apagarDiretriz(userId, id) {
  if (!run('DELETE FROM agente_diretrizes WHERE id = ? AND user_id = ?', [id, userId]).changes) throw new ErroHttp(404, 'Diretriz não encontrada');
}

export function ordenarDiretrizes(userId, ids) {
  if (!Array.isArray(ids)) throw new ErroHttp(400, 'Envie a lista de ids na ordem desejada');
  tx(() => ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).forEach((id, i) => run('UPDATE agente_diretrizes SET ordem = ? WHERE id = ? AND user_id = ?', [i + 1, id, userId])));
  return listarDiretrizes(userId);
}

export function versoesDaDiretriz(userId, id) {
  obterDiretriz(userId, id);
  return all('SELECT id, titulo, conteudo, salva_em FROM agente_diretrizes_versoes WHERE diretriz_id = ? ORDER BY id DESC', [id]);
}

export function restaurarVersao(userId, id, versaoId) {
  obterDiretriz(userId, id);
  const v = get('SELECT titulo, conteudo FROM agente_diretrizes_versoes WHERE id = ? AND diretriz_id = ?', [versaoId, id]);
  if (!v) throw new ErroHttp(404, 'Versão não encontrada');
  return atualizarDiretriz(userId, id, { titulo: v.titulo, conteudo: v.conteudo });
}

// ------------------------------------------------------------------ memória

const MAX_MEMORIA = 200;
export const listarMemoria = (userId) => all('SELECT id, texto, origem, created_at, updated_at FROM agente_memoria WHERE user_id = ? ORDER BY id', [userId]);

export function criarMemoria(userId, texto, origem = 'usuario') {
  const t = textoLimpo(texto, 500);
  if (!t) throw new ErroHttp(400, 'Escreva o que a assistente deve lembrar');
  if (get('SELECT count(*) AS n FROM agente_memoria WHERE user_id = ?', [userId]).n >= MAX_MEMORIA) throw new ErroHttp(400, `Limite de ${MAX_MEMORIA} lembretes. Junte ou apague alguns.`);
  return Number(run('INSERT INTO agente_memoria (user_id, texto, origem) VALUES (?, ?, ?)', [userId, t, origem]).lastInsertRowid);
}

export function editarMemoria(userId, id, texto) {
  const t = textoLimpo(texto, 500);
  if (!t) throw new ErroHttp(400, 'O lembrete não pode ficar vazio');
  if (!run('UPDATE agente_memoria SET texto = ?, updated_at = ? WHERE id = ? AND user_id = ?', [t, agora(), id, userId]).changes) throw new ErroHttp(404, 'Lembrete não encontrado');
}

export function apagarMemoria(userId, id) {
  if (!run('DELETE FROM agente_memoria WHERE id = ? AND user_id = ?', [id, userId]).changes) throw new ErroHttp(404, 'Lembrete não encontrado');
}
