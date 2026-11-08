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
export const PROIBIDAS = ['integration_state', 'sessions', 'password_hash', 'sess', 'schema_migrations', 'ig_credenciais', 'ig_envios_publicos'];
const PROIBIDAS_SET = new Set(PROIBIDAS);
// Tabelas da assistente de cada usuário (conversas, memória, ações): são particulares de cada pessoa
const PREFIXOS_PROIBIDOS = ['agente_'];
const COLUNAS_RETIRADAS = new Set(['password_hash', 'raw', 'thumb', 'sess']);
const PALAVRAS_PROIBIDAS = new Set(['pragma', 'attach', 'detach', 'load_extension', 'readfile', 'writefile', 'fts3_tokenizer', 'vacuum',
  'insert', 'update', 'delete', 'drop', 'create', 'alter', 'reindex', 'analyze', 'edit', 'zipfile', 'sqlar', 'sqlite_dbpage']);
export const MAX_LINHAS = 200;
const MAX_CELULA = 1500;
const TEMPO_MS = 8000;

/**
 * Quebra o SQL em pedaços do jeito que o SQLite lê: textos entre aspas simples, nomes entre aspas duplas, crases ou
 * colchetes, palavras, números, comentários e símbolos. Assim um nome escondido entre aspas (ex.: "'") não engana a
 * conferência — antes, uma aspa simples dentro de aspas duplas fazia a checagem pular o resto da consulta.
 */
export function tokenizarSql(sql) {
  const tokens = [];
  const n = sql.length;
  let i = 0;
  const lerAte = (fechamento, inicio) => {
    let j = inicio;
    let v = '';
    for (;;) {
      if (j >= n) throw new Error('Há aspas, crases ou colchetes sem fechamento na consulta');
      if (sql[j] === fechamento) {
        if (fechamento !== ']' && sql[j + 1] === fechamento) { v += fechamento; j += 2; continue; }
        return { v, fim: j + 1 };
      }
      v += sql[j++];
    }
  };
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { const f = sql.indexOf('\n', i); i = f === -1 ? n : f + 1; continue; }
    if (c === '/' && sql[i + 1] === '*') {
      const f = sql.indexOf('*/', i + 2);
      if (f === -1) throw new Error('Comentário /* sem fechamento na consulta');
      i = f + 2;
      continue;
    }
    if (c === "'") { const r = lerAte("'", i + 1); tokens.push({ t: 'texto', v: r.v }); i = r.fim; continue; }
    if (c === '"' || c === '`') { const r = lerAte(c, i + 1); tokens.push({ t: 'nome', v: r.v }); i = r.fim; continue; }
    if (c === '[') { const r = lerAte(']', i + 1); tokens.push({ t: 'nome', v: r.v }); i = r.fim; continue; }
    if (/[A-Za-z_\u0080-\uffff]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\u0080-\uffff]/.test(sql[j])) j++;
      tokens.push({ t: 'palavra', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(sql[j])) j++;
      tokens.push({ t: 'numero', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ t: 'simbolo', v: c });
    i++;
  }
  return tokens;
}

const nomeProibido = (nome) => {
  const v = String(nome).toLowerCase();
  return PROIBIDAS_SET.has(v) || PREFIXOS_PROIBIDOS.some((p) => v.startsWith(p));
};

/** Confere a consulta. Devolve o SQL limpo ou lança Error com o motivo (em português, o modelo lê e corrige). */
export function validarConsulta(sql) {
  const bruto = String(sql || '').trim();
  if (!bruto) throw new Error('Consulta vazia');
  if (bruto.length > 8000) throw new Error('Consulta longa demais');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(bruto)) throw new Error('A consulta tem caracteres de controle');
  const tokens = tokenizarSql(bruto);
  // ";" só no fim (uma consulta por vez)
  while (tokens.length && tokens[tokens.length - 1].t === 'simbolo' && tokens[tokens.length - 1].v === ';') tokens.pop();
  if (!tokens.length) throw new Error('Consulta vazia');
  if (tokens.some((k) => k.t === 'simbolo' && k.v === ';')) throw new Error('Mande uma consulta por vez (sem ";" no meio)');
  const primeira = tokens[0];
  if (primeira.t !== 'palavra' || !/^(select|with)$/i.test(primeira.v)) throw new Error('Só consultas de leitura: comece com SELECT ou WITH');
  for (const k of tokens) {
    if (k.t === 'palavra' && PALAVRAS_PROIBIDAS.has(k.v.toLowerCase())) throw new Error('A consulta tem um comando que não é de leitura');
    if ((k.t === 'palavra' || k.t === 'nome') && nomeProibido(k.v)) {
      throw new Error(`"${k.v}" guarda dados sigilosos (chaves, senhas, sessões ou dados particulares da assistente) e não pode ser consultado`);
    }
  }
  return bruto.replace(/[;\s]+$/, '');
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
        .filter(([k]) => !COLUNAS_RETIRADAS.has(k.toLowerCase().split(':')[0]))
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
