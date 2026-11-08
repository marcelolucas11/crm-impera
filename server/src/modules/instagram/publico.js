// Arquivos que o CRM manda pelo Direct: a Meta não aceita upload direto pela API do Instagram, ela BUSCA o arquivo
// num endereço público. O CRM copia o arquivo para uma pasta própria e cria um link com um código aleatório que vale
// 2 horas (só esse arquivo, nada mais do CRM fica exposto). Precisa do PUBLIC_URL (endereço https da VPS).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { ErroHttp } from '../../util.js';
import { extensaoDoMime } from './graph.js';

const VALIDADE_MS = 2 * 3600 * 1000;
const pasta = () => path.join(config.filesDir, 'instagram', 'envios');

/** Cria o link público temporário de um arquivo local. Devolve a URL. */
export function linkPublico(caminho, mime) {
  if (!config.publicUrl || !/^https:\/\//.test(config.publicUrl)) {
    throw new ErroHttp(409, 'Para mandar arquivos pelo Direct o CRM precisa de um endereço público com https (PUBLIC_URL no .env da VPS).');
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const ext = extensaoDoMime(mime) || path.extname(caminho).slice(0, 6).replace(/[^.\w]/g, '');
  fs.mkdirSync(pasta(), { recursive: true });
  const copia = path.join(pasta(), `${token}${ext}`);
  fs.copyFileSync(caminho, copia);
  run('INSERT INTO ig_envios_publicos (token, caminho, mime, expira_em) VALUES (?, ?, ?, ?)', [
    token, path.relative(config.filesDir, copia), mime || null, new Date(Date.now() + VALIDADE_MS).toISOString(),
  ]);
  return `${config.publicUrl}/publico/instagram/${token}${ext}`;
}

/** Rota pública (sem login): entrega o arquivo enquanto o link vale */
export function servirPublico(req, res) {
  const nome = String(req.params.arquivo || '');
  const token = nome.replace(/\.[\w]{1,6}$/, '');
  if (!/^[\w-]{20,64}$/.test(token)) return res.status(404).end();
  const r = get('SELECT * FROM ig_envios_publicos WHERE token = ?', [token]);
  if (!r || r.expira_em < agora()) return res.status(404).end();
  const caminho = path.join(config.filesDir, r.caminho);
  if (!caminho.startsWith(pasta()) || !fs.existsSync(caminho)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (r.mime) res.type(r.mime);
  res.sendFile(caminho);
}

/** Apaga os links vencidos e seus arquivos */
export function limparVencidos() {
  const vencidos = all('SELECT token, caminho FROM ig_envios_publicos WHERE expira_em < ? LIMIT 500', [agora()]);
  for (const r of vencidos) {
    fs.rmSync(path.join(config.filesDir, r.caminho), { force: true });
    run('DELETE FROM ig_envios_publicos WHERE token = ?', [r.token]);
  }
  return vencidos.length;
}
