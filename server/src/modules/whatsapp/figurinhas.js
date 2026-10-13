// Figurinhas: favoritas do celular, recentes (enviadas e recebidas) e favoritas do CRM.
//
// Favoritas do celular: o WhatsApp sincroniza as figurinhas favoritas pelo "app state" (coleção
// regular_low, ação SyncActionValue.stickerAction com isFavorite). O Baileys 7 recebe essas ações,
// mas não as repassa (processSyncAction ignora stickerAction). Para não manter um fork da biblioteca,
// o CRM lê a ação no único ponto em que ela passa: a linha de log "processing sync action", que o
// Baileys escreve com a ação completa. O logger de cada número é um logger próprio do CRM que olha
// essa linha (ver interceptarFigurinhas). Se uma versão futura do Baileys deixar de registrar essa
// linha, as favoritas do celular param de chegar, mas o resto (recentes, favoritas do CRM) continua.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { ErroHttp } from '../../util.js';
import { avisar, carregarBaileys, logger, socketConectado, esperar } from './instancias.js';
import * as ff from './ffmpeg.js';

const absoluto = (rel) => path.join(config.filesDir, rel);
const pastaFigurinhas = () => path.join('whatsapp', 'figurinhas');

// WEBP animado tem o bloco "ANIM"
export const webpAnimado = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 30 && buffer.includes(Buffer.from('ANIM'));

/**
 * Guarda (ou atualiza) uma figurinha. A mesma figurinha (mesmo conteúdo) nunca é guardada duas vezes.
 *  buffer: conteúdo do arquivo · caminho: arquivo já salvo (relativo a FILES_DIR), senão é salvo aqui
 */
export function registrarFigurinha({ buffer, caminho = null, mime = 'image/webp', largura = null, altura = null, origem = 'recebida', usadaEm = null, favoritaCelular = null, chave = null }) {
  const hash = chave || crypto.createHash('sha256').update(buffer).digest('hex');
  let rel = caminho;
  if (!rel && buffer) {
    rel = path.join(pastaFigurinhas(), `${hash.replace(/[^a-z0-9]/gi, '').slice(0, 40)}.webp`);
    fs.mkdirSync(path.dirname(absoluto(rel)), { recursive: true });
    if (!fs.existsSync(absoluto(rel))) fs.writeFileSync(absoluto(rel), buffer);
  }
  const animada = buffer ? webpAnimado(buffer) : false;
  run(
    `INSERT INTO wa_stickers (hash, path, mime, animated, width, height, origin, last_used_at, phone_favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       path = COALESCE(wa_stickers.path, excluded.path),
       animated = MAX(wa_stickers.animated, excluded.animated),
       last_used_at = CASE WHEN excluded.last_used_at IS NOT NULL AND (wa_stickers.last_used_at IS NULL OR wa_stickers.last_used_at < excluded.last_used_at)
                           THEN excluded.last_used_at ELSE wa_stickers.last_used_at END,
       phone_favorite = COALESCE(?, wa_stickers.phone_favorite)`,
    [hash, rel, (mime || 'image/webp').split(';')[0], animada, largura, altura, origem, usadaEm, favoritaCelular === null ? 0 : favoritaCelular ? 1 : 0,
      favoritaCelular === null ? null : favoritaCelular ? 1 : 0]
  );
  return get('SELECT id FROM wa_stickers WHERE hash = ?', [hash])?.id || null;
}

export function listarFigurinhas() {
  const campos = 'id, animated, width, height, phone_favorite, crm_favorite, path IS NOT NULL AS pronta, last_used_at';
  const mapa = (f) => ({ ...f, animated: Boolean(f.animated), phone_favorite: Boolean(f.phone_favorite), crm_favorite: Boolean(f.crm_favorite), pronta: Boolean(f.pronta) });
  return {
    favoritas: all(`SELECT ${campos} FROM wa_stickers WHERE phone_favorite = 1 OR crm_favorite = 1 ORDER BY crm_favorite DESC, id DESC LIMIT 300`).map(mapa),
    recentes: all(`SELECT ${campos} FROM wa_stickers WHERE path IS NOT NULL AND last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT 80`).map(mapa),
    sincronizacao: estadoSync,
  };
}

export function favoritarNoCrm(id, favorita) {
  const { changes } = run('UPDATE wa_stickers SET crm_favorite = ? WHERE id = ?', [favorita ? 1 : 0, id]);
  if (!changes) throw new ErroHttp(404, 'Figurinha não encontrada');
}

// Favoritar a partir de uma mensagem recebida
export async function favoritarDaMensagem(linhaId, baixar) {
  const linha = await baixar(linhaId);
  const buffer = fs.readFileSync(absoluto(linha.media_path));
  const id = registrarFigurinha({ buffer, caminho: linha.media_path, mime: linha.media_mime, origem: 'recebida', usadaEm: linha.timestamp });
  run('UPDATE wa_stickers SET crm_favorite = 1 WHERE id = ?', [id]);
  return id;
}

export function arquivoDaFigurinha(id) {
  const f = get('SELECT path, mime FROM wa_stickers WHERE id = ?', [id]);
  if (!f?.path || !fs.existsSync(absoluto(f.path))) throw new ErroHttp(404, 'Figurinha ainda não baixada');
  return { caminho: absoluto(f.path), mime: f.mime || 'image/webp', relativo: f.path };
}

export function marcarUsada(id) {
  run('UPDATE wa_stickers SET last_used_at = ? WHERE id = ?', [agora(), id]);
}

// Converte uma imagem (ou vídeo curto/GIF) enviada pelo navegador em figurinha WEBP 512×512
export async function criarFigurinha(arquivoTemporario, mime) {
  if (!(await ff.ffmpeg())) throw new ErroHttp(503, 'O FFmpeg não está disponível: não consigo criar figurinhas');
  const animada = /^video\/|image\/gif/.test(mime || '');
  const saida = `${arquivoTemporario}.webp`;
  try {
    await ff.paraFigurinha(arquivoTemporario, saida, { animada });
  } catch (err) {
    throw new ErroHttp(400, `Não consegui converter em figurinha: ${err.message}`);
  }
  const buffer = fs.readFileSync(saida);
  fs.rmSync(saida, { force: true });
  const id = registrarFigurinha({ buffer, origem: 'criada', usadaEm: agora(), largura: 512, altura: 512 });
  run('UPDATE wa_stickers SET crm_favorite = 1 WHERE id = ?', [id]);
  return id;
}

// ---------------------------------------------------------------- favoritas do celular (app state)

let estadoSync = null; // { numero, fase, recebidas, em }
const filaDownloadFavoritas = [];
let baixandoFavoritas = false;

/**
 * Recebe uma ação de figurinha do app state (stickerAction). Guarda a figurinha como favorita do
 * celular (ou tira a marca) e agenda o download do arquivo.
 */
export function aoReceberAcaoFigurinha(instanciaId, mutacao) {
  const acao = mutacao?.syncAction?.value?.stickerAction;
  if (!acao) return;
  const indice = mutacao.index || [];
  const id = indice[1] || (acao.fileEncSha256 ? Buffer.from(acao.fileEncSha256).toString('hex') : null);
  if (!id) return;
  const chave = `cel:${id}`;
  const midia = {
    directPath: acao.directPath || null,
    url: acao.url || null,
    mediaKey: acao.mediaKey ? Buffer.from(acao.mediaKey).toString('base64') : null,
    fileEncSha256: acao.fileEncSha256 ? Buffer.from(acao.fileEncSha256).toString('base64') : null,
    mimetype: acao.mimetype || 'image/webp',
    lottie: Boolean(acao.isLottie),
  };
  const favorita = acao.isFavorite !== false;
  run(
    `INSERT INTO wa_stickers (hash, mime, animated, width, height, media, phone_favorite, origin, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?, 'celular', ?)
     ON CONFLICT(hash) DO UPDATE SET phone_favorite = excluded.phone_favorite, media = COALESCE(excluded.media, wa_stickers.media)`,
    [chave, midia.mimetype, acao.width || null, acao.height || null, JSON.stringify(midia), favorita ? 1 : 0, agora()]
  );
  if (estadoSync) estadoSync.recebidas = (estadoSync.recebidas || 0) + 1;
  if (favorita && !midia.lottie) {
    filaDownloadFavoritas.push({ instanciaId, chave });
    baixarFavoritas().catch(() => {});
  }
  avisar({ figurinhas: true });
}

async function baixarFavoritas() {
  if (baixandoFavoritas) return;
  baixandoFavoritas = true;
  try {
    const lib = await carregarBaileys();
    while (filaDownloadFavoritas.length) {
      const { chave } = filaDownloadFavoritas.shift();
      const f = get('SELECT id, path, media FROM wa_stickers WHERE hash = ?', [chave]);
      if (!f || f.path || !f.media) continue;
      let m;
      try { m = JSON.parse(f.media); } catch { continue; }
      if (!m.mediaKey || (!m.directPath && !m.url)) continue;
      try {
        const stream = await lib.downloadContentFromMessage(
          { mediaKey: Buffer.from(m.mediaKey, 'base64'), directPath: m.directPath, url: m.url || (m.directPath ? lib.getUrlFromDirectPath(m.directPath) : undefined) },
          'sticker'
        );
        const partes = [];
        for await (const p of stream) partes.push(p);
        const buffer = Buffer.concat(partes);
        const rel = path.join(pastaFigurinhas(), `cel-${crypto.createHash('sha1').update(chave).digest('hex').slice(0, 24)}.webp`);
        fs.mkdirSync(path.dirname(absoluto(rel)), { recursive: true });
        fs.writeFileSync(absoluto(rel), buffer);
        run('UPDATE wa_stickers SET path = ?, animated = ? WHERE id = ?', [rel, webpAnimado(buffer) ? 1 : 0, f.id]);
        avisar({ figurinhas: true });
      } catch (err) {
        console.error('[whatsapp] não consegui baixar uma figurinha favorita:', err.message);
      }
      await esperar(300);
    }
  } finally {
    baixandoFavoritas = false;
  }
}

/**
 * Logger do número que também enxerga as ações de figurinha do app state.
 * O Baileys escreve logger.trace({ syncAction }, 'processing sync action') para cada ação sincronizada.
 */
export async function loggerComFigurinhas(instanciaId) {
  const base = await logger();
  const log = base.child({ numero: instanciaId });
  const original = log.trace.bind(log);
  log.trace = (obj, ...resto) => {
    try {
      if (resto[0] === 'processing sync action' && obj?.syncAction?.syncAction?.value?.stickerAction) {
        aoReceberAcaoFigurinha(instanciaId, obj.syncAction);
      }
    } catch { /* nunca atrapalha o Baileys */ }
    return original(obj, ...resto);
  };
  return log;
}

/**
 * Pede de novo ao WhatsApp a coleção "regular_low" do app state, desde o começo, para receber todas as
 * figurinhas favoritas (e também estrelas, fixadas e arquivadas). Não desconecta o número.
 */
export async function sincronizarFavoritas(instanciaId) {
  const e = socketConectado(instanciaId);
  if (!e) throw new ErroHttp(409, 'Este número não está conectado');
  if (typeof e.sock.resyncAppState !== 'function') throw new ErroHttp(501, 'Esta versão da biblioteca do WhatsApp não permite sincronizar as figurinhas');
  estadoSync = { numero: instanciaId, fase: 'sincronizando', recebidas: 0, em: agora() };
  avisar({ figurinhas: true });
  try {
    const keys = e.sock.authState?.keys;
    if (keys?.set) await keys.set({ 'app-state-sync-version': { regular_low: null } });
    await e.sock.resyncAppState(['regular_low'], false);
    estadoSync = { ...estadoSync, fase: 'pronto', em: agora() };
  } catch (err) {
    estadoSync = { ...estadoSync, fase: 'erro', erro: err.message, em: agora() };
    throw new ErroHttp(502, `O WhatsApp não respondeu à sincronização: ${err.message}`);
  } finally {
    avisar({ figurinhas: true });
  }
  return estadoSync;
}
