// Ponto de entrada do servidor: abre o banco, aplica migrações, liga os módulos e serve a interface
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config, validarConfig, RAIZ_APP } from './config.js';
import { abrirBanco, fecharBanco, get } from './db.js';
import { aplicarMigracoes } from './migrar.js';
import { LojaSessoes } from './sessoes.js';
import { modulos } from './modules/index.js';

function iniciar() {
  validarConfig();
  abrirBanco();
  aplicarMigracoes(path.join(RAIZ_APP, 'server', 'migrations'));
  fs.mkdirSync(config.filesDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: null,
          // blob: = prévia de fotos/vídeos antes de enviar pelo WhatsApp
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
        },
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

  app.use(
    session({
      name: 'crm.sid',
      store: new LojaSessoes(),
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

  app.get('/api/health', (_req, res) => {
    get('SELECT 1');
    res.json({ ok: true, versao: config.version });
  });

  for (const modulo of modulos) {
    modulo.register(app);
    console.log(`[módulo] ${modulo.name} carregado`);
  }

  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  app.use('/webhooks', (_req, res) => res.status(404).json({ erro: 'Não encontrado' }));

  // Interface (React compilado em server/public)
  const pastaPublica = path.join(RAIZ_APP, 'server', 'public');
  const indexHtml = path.join(pastaPublica, 'index.html');
  app.use(express.static(pastaPublica, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!fs.existsSync(indexHtml)) return res.status(503).send('Interface não compilada. Rode ./atualizar.sh');
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

  const servidor = app.listen(config.port, config.host, () => {
    console.log(`[crm] versão ${config.version} rodando em http://${config.host}:${config.port}`);
    console.log(`[crm] banco: ${config.dbFile}`);
    for (const modulo of modulos) {
      try {
        modulo.start?.();
      } catch (err) {
        console.error(`[módulo] ${modulo.name} não iniciou:`, err.message);
      }
    }
  });

  let encerrando = false;
  const encerrar = (sinal) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`[crm] recebido ${sinal}, encerrando...`);
    for (const modulo of modulos) {
      try { modulo.stop?.(); } catch { /* ignora */ }
    }
    servidor.close(() => {
      fecharBanco();
      process.exit(0);
    });
    servidor.closeAllConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
  // Fechar a janela do Terminal manda SIGHUP; o Node ignora o "nohup", então o CRM ignora aqui
  process.on('SIGHUP', () => console.log('[crm] Terminal fechado — o CRM continua ligado'));
}

try {
  iniciar();
} catch (err) {
  console.error('[crm] falha ao iniciar:', err.message);
  process.exit(1);
}
