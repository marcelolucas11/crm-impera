// Conexão com o PostgreSQL. Usa as variáveis PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT.
import pg from 'pg';

export const pool = new pg.Pool({ max: 10 });

pool.on('error', (err) => console.error('[db] erro inesperado no pool:', err.message));

export const query = (texto, parametros) => pool.query(texto, parametros);

// Executa várias operações numa transação (tudo ou nada)
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Espera o banco aceitar conexões (útil quando a VPS reinicia)
export async function aguardarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === tentativas) throw err;
      console.log(`[db] aguardando banco (${i}/${tentativas})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
