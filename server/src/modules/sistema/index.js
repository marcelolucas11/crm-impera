// Atualização pelo próprio CRM (só administrador): procura versão nova no GitHub e roda o ./atualizar.sh
import { Router } from 'express';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';

const sh = promisify(execFile);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const LOG = path.resolve(APP_DIR, '../logs/atualizacao.log');
const git = async (...args) => (await sh('git', args, { cwd: APP_DIR, timeout: 60000 })).stdout.trim();

let iniciadaEm = null; // evita dois cliques seguidos

// O número da versão fica no arquivo VERSAO (raiz do repositório), o mesmo que aparece no README e nas tags do GitHub
const limparVersao = (t) => String(t || '').trim().split('\n')[0].replace(/^v/i, '') || null;
const versaoInstalada = () => { try { return limparVersao(fs.readFileSync(path.join(APP_DIR, 'VERSAO'), 'utf8')); } catch { return null; } };
const versaoRemota = async () => { try { return limparVersao(await git('show', '@{u}:VERSAO')); } catch { return null; } };

// Endereço do repositório no GitHub (sem usuário/token que possa estar na URL do remote), para o link do commit
async function enderecoGithub() {
  try {
    const url = await git('remote', 'get-url', 'origin');
    const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    return m ? `https://github.com/${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

export default {
  name: 'sistema',
  register(app) {
    const r = Router();
    r.use(exigirLogin, exigirAdmin);

    r.get('/versao', async (req, res) => {
      try {
        // "atual" continua sendo o commit: é ele que a tela compara para saber que a atualização terminou
        const atual = await git('rev-parse', '--short', 'HEAD');
        const data = await git('log', '-1', '--format=%cI');
        const base = { atual, data, versao: versaoInstalada(), github: await enderecoGithub() };
        if (req.query.buscar !== '1') return res.json(base);
        await git('fetch', '--quiet', 'origin');
        const remota = await git('rev-parse', '--short', '@{u}');
        const log = await git('log', '--format=%s', 'HEAD..@{u}');
        res.json({
          ...base,
          remota,
          versaoRemota: await versaoRemota(),
          novidades: log ? log.split('\n').map((l) => l.trim()).filter(Boolean) : [],
        });
      } catch (e) {
        res.status(500).json({ erro: `Não consegui consultar o GitHub: ${String(e.stderr || e.message).trim().slice(0, 300)}` });
      }
    });

    r.post('/atualizar', (req, res) => {
      if (iniciadaEm && Date.now() - iniciadaEm < 10 * 60000) return res.status(409).json({ erro: 'Já existe uma atualização em andamento.' });
      try {
        fs.mkdirSync(path.dirname(LOG), { recursive: true });
        const saida = fs.openSync(LOG, 'w');
        // detached: roda numa sessão própria, então continua vivo quando o atualizar.sh desliga este servidor
        const filho = spawn('bash', [path.join(APP_DIR, 'atualizar.sh')], { cwd: APP_DIR, detached: true, stdio: ['ignore', saida, saida] });
        filho.unref();
        iniciadaEm = Date.now();
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ erro: `Não consegui iniciar a atualização: ${e.message}` });
      }
    });

    r.get('/log', (req, res) => {
      let texto = '';
      try { texto = fs.readFileSync(LOG, 'utf8').replace(/\x1b\[[0-9;]*m/g, ''); } catch { /* ainda não existe */ }
      res.json({ log: texto.split('\n').slice(-40).join('\n') });
    });

    app.use('/api/sistema', r);
  },
};
