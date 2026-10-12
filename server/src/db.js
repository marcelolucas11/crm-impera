// Banco de dados SQLite (um arquivo: ../dados/crm.db). Usa o SQLite que já vem dentro do Node.
// Toda a conversa com o banco passa por aqui — trocar de banco no futuro mexe só neste arquivo.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db = null;
const preparados = new Map();

export function abrirBanco(arquivo = config.dbFile) {
  if (db) return db;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  db = new DatabaseSync(arquivo);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

export function fecharBanco() {
  if (!db) return;
  preparados.clear();
  db.close();
  db = null;
}

export const exec = (sql) => db.exec(sql);

function preparar(sql) {
  let s = preparados.get(sql);
  if (!s) {
    s = db.prepare(sql);
    preparados.set(sql, s);
  }
  return s;
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
  const r = preparar(sql).get(...limpar(params));
  return r ? { ...r } : null;
};

export const all = (sql, params = []) => preparar(sql).all(...limpar(params)).map((r) => ({ ...r }));

export const run = (sql, params = []) => preparar(sql).run(...limpar(params));

// Transação: tudo ou nada. A função precisa ser síncrona (sem await dentro).
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Cópia consistente do banco, mesmo com o CRM rodando
export function copiarBanco(destino) {
  db.prepare('VACUUM INTO ?').run(destino);
}

export const agora = () => new Date().toISOString();
