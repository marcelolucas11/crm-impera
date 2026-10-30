// Diretrizes da IA: textos (prompts) que a equipe escreve, cola ou sobe de arquivo na tela "IA".
// As ativas entram no prompt da IA de primeiro contato, abaixo das regras fixas de segurança (que sempre valem).
// Cada edição guarda a versão anterior, para poder voltar atrás.
import { get, all, run, tx, agora } from '../../db.js';
import { ErroHttp } from '../../util.js';

export const LIMITES = {
  titulo: 120,
  // Por diretriz (~10 mil tokens)
  conteudo: 40000,
  // Soma das ativas: o prompt da IA fica em cache, mas cada caractere ainda custa na primeira chamada
  totalAtivas: 80000,
  quantidade: 50,
  versoesPorDiretriz: 30,
};

const textoLimpo = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim().slice(0, max);

function nomeArquivo(v) {
  const n = String(v ?? '').trim().split(/[\\/]/).pop().slice(0, 120);
  return n || null;
}

const CAMPOS = `d.id, d.titulo, d.conteudo, d.ativa, d.ordem, d.arquivo, d.criada_em, d.atualizada_em,
  uc.name AS criada_por_nome, ua.name AS atualizada_por_nome,
  (SELECT count(*) FROM ia_diretrizes_versoes v WHERE v.diretriz_id = d.id) AS versoes`;
const JUNCOES = 'LEFT JOIN users uc ON uc.id = d.criada_por LEFT JOIN users ua ON ua.id = d.atualizada_por';

const paraTela = (d) => (d ? { ...d, ativa: Boolean(d.ativa), caracteres: d.conteudo.length } : null);

export function listarDiretrizes() {
  return all(`SELECT ${CAMPOS} FROM ia_diretrizes d ${JUNCOES} ORDER BY d.ordem, d.id`).map(paraTela);
}

export function obterDiretriz(id) {
  const d = paraTela(get(`SELECT ${CAMPOS} FROM ia_diretrizes d ${JUNCOES} WHERE d.id = ?`, [id]));
  if (!d) throw new ErroHttp(404, 'Diretriz não encontrada');
  return d;
}

// O que entra no prompt da IA (só as ativas e com conteúdo, na ordem definida)
export function diretrizesAtivas() {
  return all("SELECT titulo, conteudo FROM ia_diretrizes WHERE ativa = 1 AND trim(conteudo) <> '' ORDER BY ordem, id");
}

export function resumoDiretrizes() {
  const r = get("SELECT count(*) AS total, COALESCE(sum(ativa), 0) AS ativas, COALESCE(sum(CASE WHEN ativa = 1 THEN length(conteudo) ELSE 0 END), 0) AS caracteres_ativos FROM ia_diretrizes");
  return { ...r, limite_caracteres_ativos: LIMITES.totalAtivas, limite_caracteres: LIMITES.conteudo };
}

// Confere se, com esta mudança, a soma das ativas continua dentro do limite
function conferirTotal({ id = null, conteudo, ativa }) {
  if (!ativa) return;
  const outras = get('SELECT COALESCE(sum(length(conteudo)), 0) AS n FROM ia_diretrizes WHERE ativa = 1 AND id IS NOT ?', [id]).n;
  if (outras + conteudo.length > LIMITES.totalAtivas) {
    throw new ErroHttp(400, `As diretrizes ativas passariam de ${LIMITES.totalAtivas.toLocaleString('pt-BR')} caracteres somadas. Desative ou encurte alguma antes.`);
  }
}

function validar(entrada, atual = null) {
  const titulo = entrada.titulo === undefined ? atual?.titulo : textoLimpo(entrada.titulo, LIMITES.titulo);
  if (!titulo) throw new ErroHttp(400, 'Dê um título para a diretriz');
  const bruto = entrada.conteudo === undefined ? atual?.conteudo ?? '' : String(entrada.conteudo ?? '');
  if (bruto.length > LIMITES.conteudo + 2000) {
    throw new ErroHttp(400, `Texto grande demais: o limite é ${LIMITES.conteudo.toLocaleString('pt-BR')} caracteres por diretriz. Divida em mais de uma.`);
  }
  const conteudo = textoLimpo(bruto, LIMITES.conteudo);
  const ativa = entrada.ativa === undefined ? Boolean(atual?.ativa ?? true) : Boolean(entrada.ativa);
  return { titulo, conteudo, ativa };
}

export function criarDiretriz(entrada = {}, userId = null) {
  if (get('SELECT count(*) AS n FROM ia_diretrizes').n >= LIMITES.quantidade) {
    throw new ErroHttp(400, `Limite de ${LIMITES.quantidade} diretrizes. Apague alguma que não usa mais.`);
  }
  const v = validar(entrada);
  conferirTotal(v);
  const ordem = (get('SELECT COALESCE(max(ordem), 0) AS m FROM ia_diretrizes').m || 0) + 1;
  const r = run(
    `INSERT INTO ia_diretrizes (titulo, conteudo, ativa, ordem, arquivo, criada_por, atualizada_por) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [v.titulo, v.conteudo, v.ativa ? 1 : 0, ordem, nomeArquivo(entrada.arquivo), userId, userId]
  );
  return obterDiretriz(Number(r.lastInsertRowid));
}

export function atualizarDiretriz(id, entrada = {}, userId = null) {
  const atual = get('SELECT * FROM ia_diretrizes WHERE id = ?', [id]);
  if (!atual) throw new ErroHttp(404, 'Diretriz não encontrada');
  const v = validar(entrada, atual);
  conferirTotal({ id, ...v });
  const mudouTexto = v.titulo !== atual.titulo || v.conteudo !== atual.conteudo;
  tx(() => {
    if (mudouTexto) {
      run('INSERT INTO ia_diretrizes_versoes (diretriz_id, titulo, conteudo, salva_por, salva_em) VALUES (?, ?, ?, ?, ?)', [
        id, atual.titulo, atual.conteudo, atual.atualizada_por, atual.atualizada_em,
      ]);
      // Mantém só as versões mais recentes
      run(
        `DELETE FROM ia_diretrizes_versoes WHERE diretriz_id = ? AND id NOT IN
           (SELECT id FROM ia_diretrizes_versoes WHERE diretriz_id = ? ORDER BY id DESC LIMIT ?)`,
        [id, id, LIMITES.versoesPorDiretriz]
      );
    }
    run(
      `UPDATE ia_diretrizes SET titulo = ?, conteudo = ?, ativa = ?, arquivo = COALESCE(?, arquivo),
              atualizada_por = ?, atualizada_em = ? WHERE id = ?`,
      [v.titulo, v.conteudo, v.ativa ? 1 : 0, nomeArquivo(entrada.arquivo), mudouTexto ? userId : atual.atualizada_por, mudouTexto ? agora() : atual.atualizada_em, id]
    );
  });
  return obterDiretriz(id);
}

export function apagarDiretriz(id) {
  const r = run('DELETE FROM ia_diretrizes WHERE id = ?', [id]);
  if (!r.changes) throw new ErroHttp(404, 'Diretriz não encontrada');
}

// Nova ordem: lista de ids na ordem desejada
export function ordenarDiretrizes(ids) {
  if (!Array.isArray(ids)) throw new ErroHttp(400, 'Envie a lista de ids na ordem desejada');
  tx(() => ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).forEach((id, i) => run('UPDATE ia_diretrizes SET ordem = ? WHERE id = ?', [i + 1, id])));
  return listarDiretrizes();
}

export function versoesDaDiretriz(id) {
  obterDiretriz(id);
  return all(
    `SELECT v.id, v.titulo, v.conteudo, v.salva_em, u.name AS salva_por_nome
       FROM ia_diretrizes_versoes v LEFT JOIN users u ON u.id = v.salva_por
      WHERE v.diretriz_id = ? ORDER BY v.id DESC`,
    [id]
  );
}

// Volta para uma versão anterior (a atual vira uma versão também, então nada se perde)
export function restaurarVersao(id, versaoId, userId = null) {
  const v = get('SELECT titulo, conteudo FROM ia_diretrizes_versoes WHERE id = ? AND diretriz_id = ?', [versaoId, id]);
  if (!v) throw new ErroHttp(404, 'Versão não encontrada');
  return atualizarDiretriz(id, { titulo: v.titulo, conteudo: v.conteudo }, userId);
}
