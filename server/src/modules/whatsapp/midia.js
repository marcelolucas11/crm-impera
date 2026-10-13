// Download das mídias recebidas (fotos, áudios, vídeos, documentos, figurinhas).
// Arquivos ficam em ../arquivos/whatsapp/<número>/<AAAA-MM>/.
import fs from 'node:fs';
import path from 'node:path';
import { get, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { ErroHttp } from '../../util.js';
import { extensaoDe } from './conteudo.js';
import { desserializar } from './formato.js';
import { algumConectado, avisar, carregarBaileys, logger } from './instancias.js';
import { registrarFigurinha } from './figurinhas.js';
import * as ff from './ffmpeg.js';

export const absoluto = (rel) => path.join(config.filesDir, rel);

export const podeBaixarNaHora = (midia) => {
  const limite = config.whatsapp.midiaAutoMb * 1024 * 1024;
  return limite > 0 && (!midia.tamanho || midia.tamanho <= limite);
};

const filaDownloads = [];
let baixandoAgora = 0;
const downloadsEmAndamento = new Map();

export function agendarDownload(linhaId) {
  filaDownloads.push(linhaId);
  processarFila();
}

function processarFila() {
  while (baixandoAgora < 2 && filaDownloads.length) {
    const linhaId = filaDownloads.shift();
    baixandoAgora++;
    baixarMidia(linhaId)
      .catch(() => { /* o erro fica gravado; dá para tentar de novo abrindo a mídia */ })
      .finally(() => {
        baixandoAgora--;
        processarFila();
      });
  }
}

export function caminhoRelativo(instanciaId, horario, nomeBase, ext) {
  const mes = String(horario || agora()).slice(0, 7);
  return path.join('whatsapp', String(instanciaId || 0), mes, `${nomeBase}${ext}`);
}

// Baixa (se preciso) a mídia da mensagem e devolve a linha atualizada
export function baixarMidia(linhaId) {
  if (downloadsEmAndamento.has(linhaId)) return downloadsEmAndamento.get(linhaId);
  const tarefa = (async () => {
    const linha = get('SELECT id, instance_id, raw, media_path, media_mime, media_name, timestamp, type, media_w, media_h FROM wa_messages WHERE id = ?', [linhaId]);
    if (!linha) throw new ErroHttp(404, 'Mensagem não encontrada');
    if (linha.media_path && fs.existsSync(absoluto(linha.media_path))) return linha;
    if (!linha.raw) throw new ErroHttp(404, 'Esta mídia é de antes da versão 0.5 do CRM e não pode ser baixada. Veja no celular.');
    const lib = await carregarBaileys();
    const log = await logger();
    const msg = desserializar(lib, linha.raw);
    if (!msg) throw new ErroHttp(404, 'Mídia não disponível');
    const e = algumConectado(linha.instance_id);
    let buffer;
    try {
      buffer = await lib.downloadMediaMessage(msg, 'buffer', {}, e ? { reuploadRequest: e.sock.updateMediaMessage, logger: log } : { logger: log });
    } catch (err) {
      run("UPDATE wa_messages SET media_status = 'erro' WHERE id = ?", [linhaId]);
      throw new ErroHttp(e ? 410 : 409, e
        ? 'O WhatsApp não tem mais esta mídia (pode ter expirado). Veja no celular.'
        : `Não consegui baixar a mídia (${err.message}). Conecte o número e tente de novo.`);
    }
    const rel = caminhoRelativo(linha.instance_id, linha.timestamp, `m${linha.id}`, extensaoDe(linha.media_mime, linha.media_name));
    fs.mkdirSync(path.dirname(absoluto(rel)), { recursive: true });
    fs.writeFileSync(absoluto(rel), buffer);
    run("UPDATE wa_messages SET media_path = ?, media_size = ?, media_status = 'ok' WHERE id = ?", [rel, buffer.length, linhaId]);
    if (linha.type === 'figurinha') {
      try {
        registrarFigurinha({ buffer, caminho: rel, mime: linha.media_mime, largura: linha.media_w, altura: linha.media_h, origem: 'recebida', usadaEm: linha.timestamp });
      } catch { /* não é essencial */ }
    }
    avisar({ midia: linhaId });
    return { ...linha, media_path: rel };
  })().finally(() => downloadsEmAndamento.delete(linhaId));
  downloadsEmAndamento.set(linhaId, tarefa);
  return tarefa;
}

// Arquivo da mídia para mostrar no navegador. compat=true converte áudio para M4A (Safari).
export async function arquivoDaMidia(linhaId, { compat = false } = {}) {
  const linha = await baixarMidia(linhaId);
  const info = get('SELECT media_mime, media_name, type FROM wa_messages WHERE id = ?', [linhaId]);
  let caminho = absoluto(linha.media_path);
  let mime = info.media_mime || 'application/octet-stream';
  if (compat && info.type === 'audio' && /ogg|opus|webm|amr/i.test(mime)) {
    const m4a = caminho.replace(/\.[^.]+$/, '') + '.compat.m4a';
    if (!fs.existsSync(m4a)) {
      try { await ff.converterParaM4a(caminho, m4a); } catch { return { caminho, mime, nome: info.media_name, tipo: info.type }; }
    }
    caminho = m4a;
    mime = 'audio/mp4';
  }
  return { caminho, mime, nome: info.media_name, tipo: info.type };
}
