// Aplica as migrações pendentes da pasta /migrations, em ordem, cada uma numa transação.
// Uma migração aplicada nunca roda de novo. Regra da casa: migrações só ACRESCENTAM
// (novas tabelas/colunas); nunca apagam dados.
import fs from 'node:fs';
import path from 'node:path';
import { exec, all, run } from './db.js';

export function aplicarMigracoes(pasta) {
  exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const aplicadas = new Set(all('SELECT name FROM schema_migrations').map((r) => r.name));
  const arquivos = fs.readdirSync(pasta).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  let novas = 0;
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
    exec('BEGIN IMMEDIATE');
    try {
      exec(sql);
      run('INSERT INTO schema_migrations (name) VALUES (?)', [arquivo]);
      exec('COMMIT');
      novas++;
      console.log(`[migração] aplicada: ${arquivo}`);
    } catch (err) {
      exec('ROLLBACK');
      throw new Error(`Falha na migração ${arquivo}: ${err.message}`);
    }
  }
  if (!novas) console.log('[migração] banco já está atualizado');
}
