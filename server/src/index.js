// Ponto de entrada do servidor: abre o banco, aplica migrações, liga os módulos e serve a interface
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { config, validarConfig, RAIZ_APP } from './config.js';
import { abrirBanco, fecharBanco, get } from './db.js';
import { aplicarMigracoes } from './migrar.js';
import { LojaSessoes } from './sessoes.js';
import { modulos } from './modules/index.js';

// Arquivos criados pelo CRM (banco, sessões do WhatsApp, mídias, backups) ficam legíveis só pelo usuário que roda o
// CRM — outros usuários da máquina não leem conversas nem credenciais. Pastas que já existiam são ajustadas também.
function protegerArquivos() {
  try { process.umask(0o077); } catch { /* sistema sem umask */ }
  const privados = [path.dirname(config.dbFile), config.whatsapp.pastaSessoes, config.filesDir];
  for (const p of privados) {
    try { if (fs.existsSync(p)) fs.chmodSync(p, 0o700); } catch { /* pasta de outro usuário: deixa como está */ }
  }
  for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`, path.join(RAIZ_APP, '.env')]) {
    try { if (fs.existsSync(f)) fs.chmodSync(f, 0o600); } catch { /* idem */ }
  }
}

// Bloqueia pedidos que mudam algo no CRM vindos de outro site (CSRF). O cookie de login é "lax", mas sites do mesmo
// domínio (ex.: outra página em *.imperaservices.com) contam como "mesmo site" para o navegador; aqui só passa o que
// saiu da própria tela do CRM. Navegadores atuais dizem de onde veio o pedido (Sec-Fetch-Site); nos antigos, Origin.
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
function mesmaOrigem(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  const recusar = () => res.status(403).json({ erro: 'Pedido recusado: ele não veio da tela do CRM. Recarregue a página e tente de novo.' });
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none' ? next() : recusar();
  const origem = req.get('origin');
  if (!origem) return next(); // programas (não navegador) não mandam Origin; o login continua obrigatório
  let host;
  try { host = new URL(origem).host; } catch { return recusar(); }
  const aceitos = [req.get('host'), String(req.get('x-forwarded-host') || '').split(',')[0].trim()];
  if (config.publicOrigin) { try { aceitos.push(new URL(config.publicOrigin).host); } catch { /* sem PUBLIC_URL válido */ } }
  return aceitos.filter(Boolean).includes(host) ? next() : recusar();
}

// Endereços públicos (webhooks e links temporários do Instagram): quem erra demais (token ou assinatura inválidos)
// fica bloqueado por um tempo. Entregas certas nunca contam, então o Yay! Forms e a Meta não são afetados.
const limiteTentativas = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas inválidas. Aguarde alguns minutos.' },
});

// Página da interface: lida do disco uma vez (e de novo só se o arquivo mudar), com o caminho base já colocado
function criarPaginaInicial(indexHtml, base) {
  let guardada = null;
  let conferidaEm = 0;
  return () => {
    const agora = Date.now();
    if (guardada && agora - conferidaEm < 5000) return guardada;
    conferidaEm = agora;
    let mtime;
    try { mtime = fs.statSync(indexHtml).mtimeMs; } catch { guardada = null; return null; }
    if (guardada?.mtime === mtime) return guardada;
    const html = fs.readFileSync(indexHtml, 'utf8')
      .replace('<head>', `<head><base href="${base}/"><meta name="base-path" content="${base}">`);
    guardada = { mtime, html };
    return guardada;
  };
}

// Arquivos da interface já compactados na compilação (.br / .gz ao lado do original): entrega o menor que o navegador aceita
function arquivosCompactados(pastaPublica) {
  const existe = new Map();
  const tem = (arq) => {
    if (!existe.has(arq)) existe.set(arq, fs.existsSync(arq));
    return existe.get(arq);
  };
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.path.startsWith('/assets/')) return next();
    const aceita = String(req.headers['accept-encoding'] || '');
    const original = path.join(pastaPublica, path.normalize(req.path).replace(/^([/\\])+/, ''));
    if (!original.startsWith(pastaPublica + path.sep)) return next();
    for (const [ext, nome] of [['.br', 'br'], ['.gz', 'gzip']]) {
      if (!new RegExp(`\\b${nome}\\b`).test(aceita) || !tem(original + ext)) continue;
      res.setHeader('Content-Encoding', nome);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.type(path.extname(original));
      return res.sendFile(original + ext, { dotfiles: 'deny' }, (err) => {
        if (!err || res.headersSent) return;
        res.removeHeader('Content-Encoding');
        existe.set(original + ext, false);
        next();
      });
    }
    return next();
  };
}

function iniciar() {
  validarConfig();
  protegerArquivos();
  abrirBanco();
  aplicarMigracoes(path.join(RAIZ_APP, 'server', 'migrations'));
  fs.mkdirSync(config.filesDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // CRM num subcaminho (ex.: /interno): tira o prefixo e segue como se fosse a raiz.
  // /interno/webhooks/... vira /webhooks/..., /interno/api/... vira /api/... e assim por diante.
  const base = config.basePath;
  if (base) {
    app.use((req, res, next) => {
      const [caminho, ...resto] = req.url.split('?');
      const busca = resto.length ? `?${resto.join('?')}` : '';
      if (caminho === base) {
        // Sem a barra final os arquivos da interface não carregam: /interno → /interno/
        if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, `${base}/${busca}`);
        req.url = `/${busca}`;
      } else if (caminho.startsWith(`${base}/`)) {
        req.url = caminho.slice(base.length) + busca;
      }
      next();
    });
  }

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

  // Guarda o corpo bruto só nos webhooks (é o que confere a assinatura); nas outras rotas não ocupa memória à toa
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        if (req.url.startsWith('/webhooks/')) req.rawBody = buf;
      },
    })
  );
  app.use('/api', mesmaOrigem);
  app.use(['/webhooks', '/publico'], limiteTentativas);

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
  // Arquivos em /assets/ têm o código da versão no nome: o navegador guarda por um ano e não pergunta de novo
  app.use(arquivosCompactados(pastaPublica));
  const estaticos = express.static(pastaPublica, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, arquivo) => {
      if (arquivo.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  // /index.html direto sairia sem o caminho base (a tela abriria quebrada em /interno): vai para a página montada abaixo
  app.use((req, res, next) => (req.path === '/index.html' ? next() : estaticos(req, res, next)));
  // Diz à interface em que caminho ela está (raiz ou /interno), para os arquivos e a API irem ao lugar certo
  const paginaInicial = criarPaginaInicial(indexHtml, base);
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pagina = paginaInicial();
    if (!pagina) return res.status(503).send('Interface não compilada. Rode ./atualizar.sh');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(pagina.html);
  });

  // Tratamento de erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = Number(err.status || err.statusCode) || 500;
    if (status >= 500) console.error('[erro]', req.method, req.path, err);
    if (res.headersSent) return res.end();
    let mensagem = err.message;
    if (err.type === 'entity.too.large') mensagem = 'O conteúdo enviado é grande demais';
    else if (err.type === 'entity.parse.failed') mensagem = 'O conteúdo enviado não é um JSON válido';
    res.status(status).json({ erro: status >= 500 ? 'Erro interno no servidor' : mensagem });
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
  // Erro sem tratamento numa promessa (comum na biblioteca do WhatsApp): registra e continua no ar.
  // Antes, um erro desses derrubava o servidor inteiro e a página dava 502 até alguém religar.
  process.on('unhandledRejection', (err) => {
    console.error('[crm] erro não tratado (o servidor continua no ar):', err?.stack || err);
  });
  // Erro grave fora de promessa: o estado pode ter ficado inconsistente. Registra e sai;
  // o vigia (scripts/vigia.sh) religa o CRM em poucos segundos.
  process.on('uncaughtException', (err) => {
    console.error('[crm] erro grave, reiniciando:', err?.stack || err);
    try { fecharBanco(); } catch { /* ignora */ }
    process.exit(1);
  });
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
