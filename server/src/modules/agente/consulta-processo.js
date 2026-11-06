// Processo da consulta de leitura da Alice (consulta.js): conexão própria SOMENTE LEITURA.
// É um processo separado (não uma thread) porque só um processo pode ser interrompido no meio de uma consulta
// pesada do SQLite: passou do tempo, o CRM mata este processo e nada fica rodando escondido.
import { DatabaseSync } from 'node:sqlite';

process.once('message', ({ arquivo, sql, max }) => {
  let resposta;
  try {
    const db = new DatabaseSync(arquivo, { readOnly: true });
    db.exec('PRAGMA query_only = ON');
    const st = db.prepare(sql);
    const linhas = [];
    let mais = false;
    for (const l of st.iterate()) {
      if (linhas.length >= max) { mais = true; break; }
      linhas.push(Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v instanceof Uint8Array ? `[${v.length} bytes]` : v])));
    }
    db.close();
    resposta = { linhas, mais };
  } catch (e) {
    resposta = { erro: e.message };
  }
  process.send(resposta, () => process.exit(0));
});
