// Cria ~150 leads falsos espalhados pelas etapas (só para medir desempenho). Nunca aponte para o banco real.
// Uso: DB_FILE=/tmp/x/crm.db node scripts/perf/semear-kanban.js [quantidade]
import path from 'node:path';
if (!process.env.DB_FILE || /dados[\/\\]crm\.db$/.test(path.resolve(process.env.DB_FILE))) {
  console.error('Defina DB_FILE para um banco temporário (nunca o banco real).');
  process.exit(1);
}
process.env.SESSION_SECRET ||= 'semente-de-exemplo-123456';
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'server');
const db = await import(path.join(raiz, 'src/db.js'));
const { aplicarMigracoes } = await import(path.join(raiz, 'src/migrar.js'));
db.abrirBanco();
aplicarMigracoes(path.join(raiz, 'migrations'));
const etapas = db.all('SELECT id FROM stages ORDER BY position').map((e) => e.id);
const n = Number(process.argv[2] || 150);
const nomes = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Hugo', 'Iara', 'João', 'Kátia', 'Lucas'];
for (let i = 0; i < n; i++) {
  const criado = new Date(Date.now() - (i * 37 + 5) * 60000 * 7).toISOString();
  db.run('INSERT INTO leads (name, phone, source, stage_id, created_at, last_contact_at) VALUES (?, ?, ?, ?, ?, ?)', [
    `${nomes[i % nomes.length]} Perf ${i + 1}`, `55119${String(70000000 + i).padStart(8, '0')}`,
    i % 3 ? 'yayforms' : 'calendly', etapas[i % Math.min(etapas.length, 6)], criado, i % 4 ? criado : null,
  ]);
}
console.log(`${n} leads criados em ${etapas.length} etapas.`);
