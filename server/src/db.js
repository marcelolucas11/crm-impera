// Banco de dados SQLite (um arquivo: ../dados/crm.db). Usa o SQLite que já vem dentro do Node.
// Toda a conversa com o banco passa por aqui — trocar de banco no futuro mexe só neste arquivo.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db = null;
// Consultas preparadas reaproveitadas. Tem teto: consultas montadas com listas de tamanho variável (IN (?, ?, ...))
// geram textos diferentes, e sem limite o cache crescia para sempre (memória que nunca voltava).
const preparados = new Map();
const MAX_PREPARADOS = 400;

// Gerações por tabela: cada INSERT/UPDATE/DELETE soma 1 no contador da tabela. Os caches da tela (cache.js) usam isso
// para saber se um resultado ainda vale ("nenhuma destas tabelas mudou desde o cálculo"), sem consultar o banco.
const geracoes = new Map();
let geracaoGeral = 0; // escritas em que não dá para saber a tabela (exec com SQL livre, migrações)
let relogioOtimizar = null;

export function abrirBanco(arquivo = config.dbFile) {
  if (db) return db;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  db = new DatabaseSync(arquivo);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -16000;
    PRAGMA journal_size_limit = 67108864;
  `);
  // Estatísticas do planejador de consultas em dia (barato; recomendado pelo SQLite para conexões longas)
  relogioOtimizar = setInterval(() => {
    try { db?.exec('PRAGMA optimize'); } catch { /* tenta na próxima */ }
  }, 6 * 60 * 60 * 1000);
  relogioOtimizar.unref?.();
  return db;
}

export function fecharBanco() {
  if (!db) return;
  clearInterval(relogioOtimizar);
  relogioOtimizar = null;
  try { db.exec('PRAGMA optimize'); } catch { /* ignora */ }
  preparados.clear();
  db.close();
  db = null;
}

export const exec = (sql) => {
  const r = db.exec(sql);
  if (!/^\s*(?:PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SELECT)\b/i.test(sql)) geracaoGeral++;
  return r;
};

// Tabela que um INSERT/UPDATE/DELETE/REPLACE altera (null para leituras)
const RE_ESCRITA = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`[]?([\w]+)/i;
function tabelaAlterada(sql) {
  const m = RE_ESCRITA.exec(sql);
  if (m) return m[1].toLowerCase();
  // WITH ... INSERT/UPDATE/DELETE (raro): sem saber a tabela, invalida tudo
  return /^\s*WITH\b/i.test(sql) && /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql) ? '*' : null;
}

function preparar(sql) {
  let p = preparados.get(sql);
  if (p) {
    // Mais usada vai para o fim (o mais antigo sai primeiro quando passa do teto)
    preparados.delete(sql);
    preparados.set(sql, p);
    return p;
  }
  p = { st: db.prepare(sql), alvo: tabelaAlterada(sql) };
  preparados.set(sql, p);
  if (preparados.size > MAX_PREPARADOS) preparados.delete(preparados.keys().next().value);
  return p;
}

function marcarEscrita(alvo) {
  if (!alvo) return;
  if (alvo === '*') geracaoGeral++;
  else geracoes.set(alvo, (geracoes.get(alvo) || 0) + 1);
}

/** Texto que muda sempre que alguma das tabelas indicadas (ou o banco todo, por exec) é alterada */
export function geracao(tabelas = []) {
  return `${geracaoGeral}|${tabelas.map((t) => geracoes.get(t) || 0).join('.')}`;
}

// Converte valores de JS para o que o SQLite aceita
const limpar = (params) =>
  params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (p !== null && typeof p === 'object') return JSON.stringify(p);
    return p;
  });

export const get = (sql, params = []) => {
  const p = preparar(sql);
  const r = p.st.get(...limpar(params));
  if (p.alvo) marcarEscrita(p.alvo);
  return r ? { ...r } : null;
};

export const all = (sql, params = []) => {
  const p = preparar(sql);
  const linhas = p.st.all(...limpar(params)).map((r) => ({ ...r }));
  if (p.alvo) marcarEscrita(p.alvo);
  return linhas;
};

// Percorre as linhas uma de cada vez, sem carregar todas na memória (para varrer tabelas grandes)
export function* iterar(sql, params = []) {
  const p = preparar(sql);
  for (const r of p.st.iterate(...limpar(params))) yield { ...r };
}

export const run = (sql, params = []) => {
  const p = preparar(sql);
  const r = p.st.run(...limpar(params));
  if (p.alvo && r.changes) marcarEscrita(p.alvo);
  return r;
};

// Transação: tudo ou nada. A função precisa ser síncrona (sem await dentro).
// Pode ser chamada de dentro de outra transação: a de dentro só roda junto com a de fora.
let profundidade = 0;
export function tx(fn) {
  if (profundidade > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  profundidade++;
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* a transação já tinha sido desfeita pelo SQLite */ }
    // Desfeita: o que foi contado como escrita pode não existir mais — invalida os caches
    geracaoGeral++;
    throw err;
  } finally {
    profundidade--;
  }
}

// Cópia consistente do banco, mesmo com o CRM rodando
export function copiarBanco(destino) {
  db.prepare('VACUUM INTO ?').run(destino);
}

export const agora = () => new Date().toISOString();
