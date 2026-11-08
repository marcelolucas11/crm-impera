// Arquivos dos fluxos (áudio, vídeo, imagem/GIF, documento). Ficam em FILES_DIR/disparos/AAAA-MM/<id>.<ext>
// e são reaproveitados por todas as campanhas e modelos que usam o mesmo bloco.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, run, all } from '../../db.js';
import { config } from '../../config.js';
import { ErroHttp } from '../../util.js';
import { gravarFluxo } from '../../upload.js';
import { baixarSeguro } from '../../rede.js';

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

const mensagemGrande = () => `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`;

function pastaDoMes() {
  const agora = new Date();
  const pastaRel = path.join('disparos', `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`);
  fs.mkdirSync(path.join(config.filesDir, pastaRel), { recursive: true });
  return pastaRel;
}

function registrar(rel, { nome, mime, tamanho }, userId) {
  const id = Number(run('INSERT INTO disparo_midias (nome, mime, path, tamanho, criado_por) VALUES (?, ?, ?, ?, ?)', [
    String(nome || 'arquivo').slice(0, 200), String(mime || 'application/octet-stream').slice(0, 120), rel, tamanho, userId || null,
  ]).lastInsertRowid);
  return publica(get('SELECT * FROM disparo_midias WHERE id = ?', [id]));
}

async function gravar(fonte, { nome, mime }, userId) {
  const rel = path.join(pastaDoMes(), `${crypto.randomUUID()}.${extensao(mime, nome)}`);
  const tamanho = await gravarFluxo(fonte, path.join(config.filesDir, rel), { max: maxBytes(), mensagem: mensagemGrande() });
  return registrar(rel, { nome, mime, tamanho }, userId);
}

export const publica = (m) => (m ? { id: m.id, nome: m.nome, mime: m.mime, tamanho: m.tamanho, created_at: m.created_at } : null);

// Corpo da requisição = o próprio arquivo (application/octet-stream), ?nome=&mime=
export async function receberUpload(req, userId) {
  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > maxBytes()) throw new ErroHttp(413, `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`);
  return gravar(req, { nome: String(req.query.nome || 'arquivo'), mime: String(req.query.mime || 'application/octet-stream') }, userId);
}

// Baixa um arquivo de um link (ex.: vídeo MP4 hospedado) e guarda como mídia.
// Endereços internos (rede local, a própria máquina) nunca são baixados: rede.js confere o IP na própria conexão e em
// cada redirecionamento, então o servidor não vira ponte para dentro da rede.
export async function importarDeUrl(endereco, userId) {
  let url;
  try { url = new URL(String(endereco || '').trim()); } catch { throw new ErroHttp(400, 'Link inválido'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new ErroHttp(400, 'Use um link http(s)');
  const pastaRel = pastaDoMes();
  const temporario = path.join(config.filesDir, pastaRel, `${crypto.randomUUID()}.baixando`);
  let r;
  try {
    r = await baixarSeguro(url.toString(), { max: maxBytes(), aoExceder: 'erro', tempoMs: 30000, totalMs: 120000, redirecionamentos: 5, destino: temporario });
  } catch (err) {
    fs.rmSync(temporario, { force: true });
    if (err.grande) throw new ErroHttp(413, mensagemGrande());
    if (/interno/i.test(err.message)) throw new ErroHttp(400, 'Esse endereço não pode ser usado');
    if (err.statusHttp) throw new ErroHttp(400, `O link respondeu com erro ${err.statusHttp}`);
    if (/demorou|esgotado/i.test(err.message)) throw new ErroHttp(400, 'O download demorou demais');
    if (err.code === 'ENOTFOUND') throw new ErroHttp(400, 'Não encontrei esse endereço');
    throw new ErroHttp(400, `Não consegui baixar: ${err.message}`);
  }
  const mime = (r.tipo || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  if (/^text\/html/i.test(mime)) {
    fs.rmSync(temporario, { force: true });
    throw new ErroHttp(400, 'O link abre uma página, não um arquivo. Use o link direto do arquivo (ex.: terminando em .mp4)');
  }
  if (!r.tamanho) {
    fs.rmSync(temporario, { force: true });
    throw new ErroHttp(400, 'Arquivo vazio');
  }
  let nome = 'arquivo';
  try { nome = decodeURIComponent(path.basename(url.pathname)) || 'arquivo'; } catch { nome = path.basename(url.pathname) || 'arquivo'; }
  const rel = path.join(pastaRel, `${crypto.randomUUID()}.${extensao(mime, nome)}`);
  fs.renameSync(temporario, path.join(config.filesDir, rel));
  return registrar(rel, { nome, mime, tamanho: r.tamanho }, userId);
}

export function arquivoDaMidia(id) {
  const m = get('SELECT * FROM disparo_midias WHERE id = ?', [id]);
  if (!m) throw new ErroHttp(404, 'Arquivo não encontrado');
  const caminho = path.join(config.filesDir, m.path);
  if (!fs.existsSync(caminho)) throw new ErroHttp(404, 'Arquivo não está mais no servidor');
  return { caminho, mime: m.mime, nome: m.nome };
}

export const listarMidias = () => all('SELECT * FROM disparo_midias ORDER BY id DESC LIMIT 200').map(publica);
