// Ponto de entrada do servidor: aplica migrações, liga os módulos e serve a interface
import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, validarConfig } from './config.js';
import { pool, aguardarBanco } from './db.js';
import { aplicarMigracoes } from './migrate.js';
import { modulos } from './modules/index.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function iniciar() {
  validarConfig();
  await aguardarBanco();
  await aplicarMigracoes(pool, path.join(raiz, 'migrations'));
  fs.mkdirSync(config.filesDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: null },
      },
    })
  );

  // Guarda o corpo bruto para conferir assinaturas de webhooks
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  const PgStore = connectPg(session);
  app.use(
    session({
      name: 'crm.sid',
      store: new PgStore({ pool, tableName: 'sessions', pruneSessionInterval: 60 * 60 }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, versao: config.version });
  });

  for (const modulo of modulos) {
    modulo.register(app);
    console.log(`[módulo] ${modulo.name} carregado`);
  }

  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  app.use('/webhooks', (_req, res) => res.status(404).json({ erro: 'Não encontrado' }));

  // Interface (React compilado)
  const pastaPublica = path.join(raiz, 'public');
  const indexHtml = path.join(pastaPublica, 'index.html');
  app.use(express.static(pastaPublica, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (!fs.existsSync(indexHtml)) return res.status(503).send('Interface não compilada.');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  // Tratamento de erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[erro]', req.method, req.path, err);
    res.status(status).json({ erro: status >= 500 ? 'Erro interno no servidor' : err.message });
  });

  app.listen(config.port, () => {
    console.log(`[crm] versão ${config.version} rodando na porta ${config.port}`);
  });
}

iniciar().catch((err) => {
  console.error('[crm] falha ao iniciar:', err.message);
  process.exit(1);
});

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`[crm] recebido ${sinal}, encerrando...`);
    pool.end().finally(() => process.exit(0));
  });
}
