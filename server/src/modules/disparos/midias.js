// Arquivos dos fluxos (áudio, vídeo, imagem/GIF, documento). Ficam em FILES_DIR/disparos/AAAA-MM/<id>.<ext>
// e são reaproveitados por todas as campanhas e modelos que usam o mesmo bloco.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { get, run, all } from '../../db.js';
import { config } from '../../config.js';
import { ErroHttp } from '../../util.js';

const EXTENSOES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

const maxBytes = () => config.whatsapp.envioMaxMb * 1024 * 1024;

function extensao(mime, nome) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (EXTENSOES[base]) return EXTENSOES[base];
  const daNome = path.extname(String(nome || '')).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(daNome) ? daNome : 'bin';
}

function limitador() {
  let total = 0;
  const max = maxBytes();
  const t = new Transform({
    transform(pedaco, _enc, cb) {
      total += pedaco.length;
      if (total > max) return cb(new ErroHttp(413, `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`));
      cb(null, pedaco);
    },
  });
  t.total = () => total;
  return t;
}

async function gravar(fonte, { nome, mime }, userId) {
  const agora = new Date();
  const pastaRel = path.join('disparos', `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`);
  fs.mkdirSync(path.join(config.filesDir, pastaRel), { recursive: true });
  const rel = path.join(pastaRel, `${crypto.randomUUID()}.${extensao(mime, nome)}`);
  const destino = path.join(config.filesDir, rel);
  const limite = limitador();
  try {
    await pipeline(fonte, limite, fs.createWriteStream(destino));
  } catch (err) {
    fs.rmSync(destino, { force: true });
    throw err.status ? err : new ErroHttp(400, 'O envio do arquivo foi interrompido');
  }
  if (!limite.total()) {
    fs.rmSync(destino, { force: true });
    throw new ErroHttp(400, 'Arquivo vazio');
  }
  const id = Number(run('INSERT INTO disparo_midias (nome, mime, path, tamanho, criado_por) VALUES (?, ?, ?, ?, ?)', [
    String(nome || 'arquivo').slice(0, 200), String(mime || 'application/octet-stream').slice(0, 120), rel, limite.total(), userId || null,
  ]).lastInsertRowid);
  return publica(get('SELECT * FROM disparo_midias WHERE id = ?', [id]));
}

export const publica = (m) => (m ? { id: m.id, nome: m.nome, mime: m.mime, tamanho: m.tamanho, created_at: m.created_at } : null);

// Corpo da requisição = o próprio arquivo (application/octet-stream), ?nome=&mime=
export async function receberUpload(req, userId) {
  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > maxBytes()) throw new ErroHttp(413, `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`);
  return gravar(req, { nome: String(req.query.nome || 'arquivo'), mime: String(req.query.mime || 'application/octet-stream') }, userId);
}

// Endereços internos (rede local, a própria máquina) não podem ser baixados: o servidor não vira ponte para dentro da rede
function ipInterno(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return ipInterno(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// Baixa um arquivo de um link (ex.: vídeo MP4 hospedado) e guarda como mídia
export async function importarDeUrl(endereco, userId) {
  let url;
  try { url = new URL(String(endereco || '').trim()); } catch { throw new ErroHttp(400, 'Link inválido'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new ErroHttp(400, 'Use um link http(s)');
  const ips = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!ips.length) throw new ErroHttp(400, 'Não encontrei esse endereço');
  if (ips.some((i) => ipInterno(i.address))) throw new ErroHttp(400, 'Esse endereço não pode ser usado');
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), 120000);
  try {
    const resp = await fetch(url, { redirect: 'follow', signal: controle.signal });
    // O link pode redirecionar: o destino final também não pode ser interno
    if (resp.url && new URL(resp.url).hostname !== url.hostname) {
      const finais = await dns.lookup(new URL(resp.url).hostname, { all: true }).catch(() => []);
      if (!finais.length || finais.some((i) => ipInterno(i.address))) { controle.abort(); throw new ErroHttp(400, 'Esse endereço não pode ser usado'); }
    }
    if (!resp.ok || !resp.body) throw new ErroHttp(400, `O link respondeu com erro ${resp.status}`);
    const tamanho = Number(resp.headers.get('content-length') || 0);
    if (tamanho > maxBytes()) throw new ErroHttp(413, `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`);
    const mime = (resp.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (/^text\/html/i.test(mime)) throw new ErroHttp(400, 'O link abre uma página, não um arquivo. Use o link direto do arquivo (ex.: terminando em .mp4)');
    const nome = decodeURIComponent(path.basename(url.pathname)) || 'arquivo';
    return await gravar(Readable.fromWeb(resp.body), { nome, mime }, userId);
  } catch (err) {
    if (err.name === 'AbortError') throw new ErroHttp(400, 'O download demorou demais');
    throw err.status ? err : new ErroHttp(400, `Não consegui baixar: ${err.message}`);
  } finally {
    clearTimeout(tempo);
  }
}

export function arquivoDaMidia(id) {
  const m = get('SELECT * FROM disparo_midias WHERE id = ?', [id]);
  if (!m) throw new ErroHttp(404, 'Arquivo não encontrado');
  const caminho = path.join(config.filesDir, m.path);
  if (!fs.existsSync(caminho)) throw new ErroHttp(404, 'Arquivo não está mais no servidor');
  return { caminho, mime: m.mime, nome: m.nome };
}

export const listarMidias = () => all('SELECT * FROM disparo_midias ORDER BY id DESC LIMIT 200').map(publica);
