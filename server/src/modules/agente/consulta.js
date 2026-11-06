// "consultar_banco": a Alice pode fazer qualquer consulta de LEITURA no banco do CRM, menos nos dados sigilosos.
// Camadas de proteção:
//  1) só SELECT/WITH, uma instrução só, sem PRAGMA/ATTACH/funções de arquivo;
//  2) tabelas e colunas sigilosas (chaves de API, senhas, sessões) recusadas antes de rodar;
//  3) conexão própria SOMENTE LEITURA, num processo separado que é morto se passar do tempo
//     (uma consulta pesada nunca trava nem esquenta o CRM);
//  4) colunas sigilosas que viessem num SELECT * são retiradas do resultado.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';
import { all } from '../../db.js';

// Tabelas e colunas que a Alice nunca lê
export const PROIBIDAS = ['integration_state', 'sessions', 'password_hash', 'sess', 'schema_migrations'];
const COLUNAS_RETIRADAS = new Set(['password_hash', 'raw', 'thumb', 'sess']);
const PALAVRAS_PROIBIDAS = /\b(pragma|attach|detach|load_extension|readfile|writefile|fts3_tokenizer|vacuum|insert|update|delete|drop|create|alter|reindex|analyze)\b/i;
export const MAX_LINHAS = 200;
const MAX_CELULA = 1500;
const TEMPO_MS = 8000;

function semComentarios(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
}

/** Confere a consulta. Devolve o SQL limpo ou lança Error com o motivo (em português, o modelo lê e corrige). */
export function validarConsulta(sql) {
  let s = semComentarios(sql).replace(/;\s*$/, '');
  if (!s) throw new Error('Consulta vazia');
  if (s.length > 8000) throw new Error('Consulta longa demais');
  // Tira o conteúdo das strings antes de procurar palavras proibidas (um LIKE '%delete%' é permitido)
  const semStrings = s.replace(/'(?:[^']|'')*'/g, "''");
  if (semStrings.includes(';')) throw new Error('Mande uma consulta por vez (sem ";" no meio)');
  if (!/^(select|with)\b/i.test(semStrings)) throw new Error('Só consultas de leitura: comece com SELECT ou WITH');
  if (PALAVRAS_PROIBIDAS.test(semStrings)) throw new Error('A consulta tem um comando que não é de leitura');
  const minusculo = semStrings.toLowerCase();
  const proibida = PROIBIDAS.find((p) => new RegExp(`\\b${p}\\b`).test(minusculo));
  if (proibida) throw new Error(`"${proibida}" guarda dados sigilosos (chaves, senhas ou sessões) e não pode ser consultado`);
  return s;
}

const PROCESSO = fileURLToPath(new URL('./consulta-processo.js', import.meta.url));

export function consultar(sql, { arquivo = config.dbFile, max = MAX_LINHAS, tempoMs = TEMPO_MS } = {}) {
  let limpo;
  try { limpo = validarConsulta(sql); } catch (e) { return Promise.resolve({ erro: e.message }); }
  return new Promise((resolve) => {
    const p = fork(PROCESSO, [], { execArgv: ['--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let terminou = false;
    const fim = (r) => { if (terminou) return; terminou = true; clearTimeout(timer); try { p.kill('SIGKILL'); } catch { /* já saiu */ } resolve(r); };
    const timer = setTimeout(() => fim({ erro: `A consulta passou de ${tempoMs / 1000} s e foi cancelada. Use filtros (datas, LIMIT) ou índices.` }), tempoMs);
    p.once('message', (r) => {
      if (r.erro) return fim({ erro: r.erro });
      const linhas = r.linhas.map((l) => Object.fromEntries(Object.entries(l)
        .filter(([k]) => !COLUNAS_RETIRADAS.has(k.toLowerCase()))
        .map(([k, v]) => [k, typeof v === 'string' && v.length > MAX_CELULA ? `${v.slice(0, MAX_CELULA)}…` : v])));
      fim({ linhas, total: linhas.length, mais: r.mais });
    });
    p.once('error', (e) => fim({ erro: e.message }));
    p.once('exit', (codigo) => fim({ erro: `A consulta parou (código ${codigo})` }));
    p.send({ arquivo, sql: limpo, max });
  });
}

/** Esquema do banco em texto compacto (sem as tabelas sigilosas), para o prompt da Alice */
export function esquemaCompacto() {
  const tabelas = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name)
    .filter((t) => !PROIBIDAS.includes(t) && !t.startsWith('agente_') && !t.includes('_fts'));
  return tabelas.map((t) => {
    const cols = all(`SELECT name, type FROM pragma_table_info('${t.replace(/'/g, "''")}')`)
      .filter((c) => !COLUNAS_RETIRADAS.has(c.name))
      .map((c) => c.name);
    return `${t}(${cols.join(', ')})`;
  }).join('\n');
}
