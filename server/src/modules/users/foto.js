// Foto de perfil das pessoas da equipe. A interface já manda a imagem recortada e reduzida (quadrada, ~256 px)
// como data URL; aqui conferimos se é mesmo uma imagem e gravamos em FILES_DIR/usuarios/<id>-<aleatório>.<ext>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, run } from '../../db.js';
import { config } from '../../config.js';
import { ErroHttp } from '../../util.js';

export const FOTO_MAX_BYTES = 1024 * 1024; // 1 MB (a interface manda bem menos que isso)

// Tipo real do arquivo pelos primeiros bytes (não confia no que o navegador disse)
function tipoDaImagem(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export const MIME_FOTO = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// "data:image/jpeg;base64,...." → Buffer conferido
export function lerImagem(dataUrl) {
  const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new ErroHttp(400, 'Envie uma foto em JPG, PNG ou WebP');
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  if (!buf.length) throw new ErroHttp(400, 'Foto vazia');
  if (buf.length > FOTO_MAX_BYTES) throw new ErroHttp(413, 'Foto grande demais (máximo 1 MB)');
  const tipo = tipoDaImagem(buf);
  if (!tipo) throw new ErroHttp(400, 'O arquivo enviado não é uma imagem JPG, PNG ou WebP');
  return { buf, ...tipo };
}

const pasta = () => path.join(config.filesDir, 'usuarios');

function apagarArquivo(rel) {
  if (!rel) return;
  const alvo = path.resolve(config.filesDir, rel);
  // Só apaga dentro da pasta de fotos
  if (alvo.startsWith(path.resolve(pasta()) + path.sep)) fs.rmSync(alvo, { force: true });
}

export function salvarFoto(userId, dataUrl) {
  const { buf, ext } = lerImagem(dataUrl);
  const atual = get('SELECT photo_path FROM users WHERE id = ?', [userId]);
  if (!atual) throw new ErroHttp(404, 'Usuário não encontrado');
  fs.mkdirSync(pasta(), { recursive: true });
  const rel = path.join('usuarios', `${userId}-${crypto.randomBytes(6).toString('hex')}.${ext}`);
  fs.writeFileSync(path.join(config.filesDir, rel), buf);
  run('UPDATE users SET photo_path = ?, photo_at = ? WHERE id = ?', [rel, new Date().toISOString(), userId]);
  apagarArquivo(atual.photo_path);
  return rel;
}

export function removerFoto(userId) {
  const atual = get('SELECT photo_path FROM users WHERE id = ?', [userId]);
  if (!atual) throw new ErroHttp(404, 'Usuário não encontrado');
  run('UPDATE users SET photo_path = NULL, photo_at = NULL WHERE id = ?', [userId]);
  apagarArquivo(atual.photo_path);
}

// Caminho do arquivo no disco (ou null se a pessoa não tem foto ou o arquivo sumiu)
export function arquivoDaFoto(userId) {
  const u = get('SELECT photo_path FROM users WHERE id = ?', [userId]);
  if (!u?.photo_path) return null;
  const alvo = path.resolve(config.filesDir, u.photo_path);
  if (!alvo.startsWith(path.resolve(pasta()) + path.sep) || !fs.existsSync(alvo)) return null;
  const ext = path.extname(alvo).slice(1).toLowerCase();
  return { caminho: alvo, mime: MIME_FOTO[ext] || 'application/octet-stream' };
}
