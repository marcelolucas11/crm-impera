// Aplica as migrações pendentes da pasta /migrations, em ordem, cada uma numa transação.
// Uma migração aplicada nunca roda de novo. Regra da casa: migrações só ACRESCENTAM
// (novas tabelas/colunas); nunca apagam dados.
import fs from 'node:fs/promises';
import path from 'node:path';

const LOCK_ID = 727001;

export async function aplicarMigracoes(pool, pasta) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.name));
    const arquivos = (await fs.readdir(pasta)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

    let novas = 0;
    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      const sql = await fs.readFile(path.join(pasta, arquivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
        novas++;
        console.log(`[migração] aplicada: ${arquivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${arquivo}: ${err.message}`);
      }
    }
    if (!novas) console.log('[migração] banco já está atualizado');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
