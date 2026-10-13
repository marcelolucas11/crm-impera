// Envio pelo CRM: texto, arquivos, figurinhas, enquetes, contatos, localização, encaminhar, editar,
// reagir, apagar, estrela, mensagens temporárias, "digitando…" e ações de conversa (arquivar, fixar...).
//
// Atenção: conexão por QR code não é oficial. O WhatsApp pode banir números que mandam mensagens em massa
// ou automatizadas. O CRM só envia o que uma pessoa faz na tela, com intervalo mínimo entre envios.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { variantesTelefone, ErroHttp } from '../../util.js';
import { extensaoDe } from './conteudo.js';
import { serializar, desserializar } from './formato.js';
import { socketConectado, algumConectado, avisar, carregarBaileys, esperar } from './instancias.js';
import { aplicarReacao, marcarApagada } from './recebimento.js';
import { caminhoRelativo, absoluto, baixarMidia } from './midia.js';
import { arquivoDaFigurinha, marcarUsada, registrarFigurinha } from './figurinhas.js';
import * as ff from './ffmpeg.js';
import { gerarPrevia } from './previa.js';

const INTERVALO_MINIMO_ENVIO_MS = 1500;
const EDITAR_ATE_MS = 15 * 60000;
const enviadasRecentes = new Map();

export function guardarEnviada(waId, mensagem) {
  if (!waId || !mensagem) return;
  enviadasRecentes.set(waId, mensagem);
  if (enviadasRecentes.size > 1000) enviadasRecentes.delete(enviadasRecentes.keys().next().value);
}
export const enviadaRecente = (waId) => enviadasRecentes.get(waId);

function numeroConectado(numeroId) {
  const e = socketConectado(numeroId);
  if (!e) throw new ErroHttp(409, 'Este número não está conectado');
  return e;
}

async function respeitarIntervalo(e) {
  const desdeUltimo = Date.now() - e.ultimoEnvio;
  if (desdeUltimo < INTERVALO_MINIMO_ENVIO_MS) await esperar(INTERVALO_MINIMO_ENVIO_MS - desdeUltimo);
  e.ultimoEnvio = Date.now();
}

async function destinoDoLead(e, lib, leadId) {
  const lead = get('SELECT id, phone FROM leads WHERE id = ?', [leadId]);
  if (!lead) throw new ErroHttp(404, 'Lead não encontrado');
  const jid = get(
    "SELECT jid FROM wa_contacts WHERE lead_id = ? AND jid NOT LIKE '%@g.us' ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
    [leadId]
  )?.jid;
  if (jid) return jid;
  if (!lead.phone) throw new ErroHttp(400, 'O lead não tem telefone');
  const resultado = await e.sock.onWhatsApp(...variantesTelefone(lead.phone));
  const achado = (resultado || []).find((r) => r.exists);
  if (!achado) throw new ErroHttp(400, 'Este telefone não tem WhatsApp');
  return lib.jidNormalizedUser(achado.jid);
}

async function resolverDestino(e, lib, destino) {
  if (destino.leadId) return { jid: await destinoDoLead(e, lib, destino.leadId), leadId: destino.leadId };
  if (!destino.jid) throw new ErroHttp(400, 'Conversa inválida');
  return { jid: destino.jid, leadId: null };
}

// Mensagem que está sendo respondida (precisa da mensagem original para o WhatsApp mostrar a citação)
function carregarCitada(lib, linhaId) {
  if (!linhaId) return null;
  const linha = get('SELECT id, wa_id, chat_jid, from_me, body, legenda, raw, participant_jid FROM wa_messages WHERE id = ?', [linhaId]);
  if (!linha) return null;
  let original = desserializar(lib, linha.raw);
  if (!original?.message) {
    original = {
      key: { remoteJid: linha.chat_jid, fromMe: Boolean(linha.from_me), id: linha.wa_id, participant: linha.participant_jid || undefined },
      message: { conversation: linha.legenda || linha.body || '' },
    };
  }
  return { linha, original };
}

// Prepara o arquivo enviado pelo CRM no formato que o WhatsApp espera
async function prepararArquivo(arquivo, legenda) {
  const mime = String(arquivo.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const nome = arquivo.nome || 'arquivo';
  let caminho = arquivo.caminho;
  const temFf = Boolean(await ff.ffmpeg());

  // Figurinha a partir de imagem/vídeo (512×512 WEBP)
  if (arquivo.modo === 'figurinha') {
    if (!temFf && mime !== 'image/webp') throw new ErroHttp(503, 'O FFmpeg não está disponível para criar a figurinha');
    let webp = caminho;
    if (mime !== 'image/webp' || temFf) {
      webp = `${caminho}.webp`;
      await ff.paraFigurinha(caminho, webp, { animada: /^video\/|image\/gif/.test(mime) });
    }
    const buffer = fs.readFileSync(webp);
    const id = registrarFigurinha({ buffer, origem: 'criada', usadaEm: agora(), largura: 512, altura: 512 });
    const f = arquivoDaFigurinha(id);
    return {
      arquivoFinal: f.caminho, tipo: 'figurinha', mime: 'image/webp', largura: 512, altura: 512, nome: null, figurinhaId: id,
      conteudo: { sticker: { url: f.caminho }, mimetype: 'image/webp' },
    };
  }

  // "GIF" do WhatsApp = vídeo curto sem som, em repetição
  if (arquivo.modo === 'gif') {
    let mp4 = caminho;
    if (temFf) {
      mp4 = `${caminho}.mp4`;
      await ff.paraGif(caminho, mp4);
    }
    let mini = null;
    if (temFf) { try { mini = await ff.miniatura(mp4, { video: true }); } catch { /* sem miniatura */ } }
    return {
      arquivoFinal: mp4, tipo: 'video', mime: 'video/mp4', largura: mini?.largura, altura: mini?.altura, nome, gif: true,
      conteudo: {
        video: { url: mp4 }, gifPlayback: true, mimetype: 'video/mp4', caption: legenda || undefined,
        ...(mini?.jpeg ? { jpegThumbnail: mini.jpeg } : {}),
      },
    };
  }

  // Mensagem de voz gravada no navegador (WEBM sem conversão o celular não toca: vai como documento)
  const audioTocavel = mime.startsWith('audio/') && mime !== 'audio/webm';
  if ((arquivo.modo === 'voz' && temFf) || (arquivo.modo !== 'documento' && audioTocavel)) {
    const voz = arquivo.modo === 'voz';
    if (voz && temFf) {
      try {
        const ogg = `${caminho}.ogg`;
        await ff.converterParaVoz(caminho, ogg);
        const { segundos, onda } = await ff.analisarAudio(ogg);
        return {
          arquivoFinal: ogg, tipo: 'audio', mime: 'audio/ogg; codecs=opus', segundos, ptt: true,
          conteudo: { audio: { url: ogg }, ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds: segundos, waveform: onda },
        };
      } catch (err) {
        console.error('[whatsapp] não consegui converter o áudio gravado:', err.message);
      }
    }
    if (audioTocavel) {
      let segundos = null;
      if (temFf) { try { segundos = (await ff.analisarAudio(caminho)).segundos; } catch { /* sem duração */ } }
      return {
        arquivoFinal: caminho, tipo: 'audio', mime, segundos, ptt: false, nome,
        conteudo: { audio: { url: caminho }, mimetype: mime, ptt: false, ...(segundos ? { seconds: segundos } : {}) },
      };
    }
  }

  if (arquivo.modo !== 'documento' && /^image\/(jpeg|png|webp|gif)$/.test(mime)) {
    let mini = null;
    if (temFf) { try { mini = await ff.miniatura(caminho); } catch { /* sem miniatura */ } }
    return {
      arquivoFinal: caminho, tipo: 'imagem', mime, largura: mini?.largura, altura: mini?.altura, nome,
      conteudo: {
        image: { url: caminho }, mimetype: mime, caption: legenda || undefined, viewOnce: arquivo.unica || undefined,
        ...(mini?.jpeg ? { jpegThumbnail: mini.jpeg } : {}),
        ...(mini?.largura ? { width: mini.largura, height: mini.altura } : {}),
      },
    };
  }

  if (arquivo.modo !== 'documento' && mime.startsWith('video/')) {
    let mimeVideo = mime;
    if (mime !== 'video/mp4' && temFf) {
      try {
        const mp4 = `${caminho}.mp4`;
        await ff.converterParaMp4(caminho, mp4);
        caminho = mp4;
        mimeVideo = 'video/mp4';
      } catch (err) {
        console.error('[whatsapp] não consegui converter o vídeo:', err.message);
      }
    }
    if (mimeVideo === 'video/mp4') {
      let mini = null;
      if (temFf) { try { mini = await ff.miniatura(caminho, { video: true }); } catch { /* sem miniatura */ } }
      return {
        arquivoFinal: caminho, tipo: 'video', mime: 'video/mp4', largura: mini?.largura, altura: mini?.altura, nome,
        conteudo: {
          video: { url: caminho }, mimetype: 'video/mp4', caption: legenda || undefined, viewOnce: arquivo.unica || undefined,
          ...(mini?.jpeg ? { jpegThumbnail: mini.jpeg } : {}),
          ...(mini?.largura ? { width: mini.largura, height: mini.altura } : {}),
        },
      };
    }
  }

  return {
    arquivoFinal: caminho, tipo: 'documento', mime, nome,
    conteudo: { document: { url: caminho }, mimetype: mime, fileName: nome, caption: legenda || undefined },
  };
}

const PREVIAS = { imagem: '📷 Foto', video: '🎥 Vídeo', documento: '📄', audio: '🎤 Mensagem de voz', figurinha: '🙂 Figurinha' };

// Grava no banco a mensagem que está saindo (aparece na tela com o reloginho) e devolve o id
// automatico = envio da fila de disparos: não marca como lidas as mensagens que o contato mandou (a equipe ainda precisa ver)
function gravarSaindo({ numeroId, leadId, jid, waId, userId, horario, tipo, previa, legenda, midia, citada, extra, grupo, automatico = false }) {
  let linhaId;
  tx(() => {
    if (!grupo) {
      run(
        `INSERT INTO wa_contacts (jid, phone, lead_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET lead_id = COALESCE(wa_contacts.lead_id, excluded.lead_id), updated_at = excluded.updated_at`,
        [jid, /@s\.whatsapp\.net$/.test(jid) ? jid.split('@')[0] : null, leadId, horario]
      );
    }
    run(
      `INSERT INTO wa_chats (jid, instance_id, is_group, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET hidden_at = NULL`,
      [jid, numeroId, grupo ? 1 : 0, horario]
    );
    const r = run(
      `INSERT INTO wa_messages
         (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, legenda, sent_by, timestamp, status,
          media_mime, media_path, media_name, media_size, media_seconds, media_w, media_h, media_status, ptt,
          quoted_wa_id, quoted_body, quoted_from_me, extra)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroId, leadId, jid, waId, tipo, previa, legenda, userId, horario,
        midia?.mime ?? null, midia?.path ?? null, midia?.nome ?? null, midia?.tamanho ?? null,
        midia?.segundos ?? null, midia?.largura ?? null, midia?.altura ?? null, midia ? 'ok' : null, midia?.ptt ?? false,
        citada?.linha.wa_id ?? null, citada ? (citada.linha.legenda || citada.linha.body || '').slice(0, 300) : null,
        citada ? Boolean(citada.linha.from_me) : null, extra ? JSON.stringify(extra) : null,
      ]
    );
    linhaId = Number(r.lastInsertRowid);
    if (leadId) {
      run(
        `UPDATE leads SET
           last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END,
           first_contact_at = COALESCE(first_contact_at, ?), updated_at = ?
         WHERE id = ?`,
        [horario, horario, horario, horario, leadId]
      );
      if (!automatico) run('UPDATE wa_messages SET read_at = ? WHERE lead_id = ? AND from_me = 0 AND read_at IS NULL', [horario, leadId]);
    } else if (!automatico) {
      run('UPDATE wa_messages SET read_at = ? WHERE chat_jid = ? AND from_me = 0 AND read_at IS NULL', [horario, jid]);
    }
    if (!automatico) run('UPDATE wa_chats SET marked_unread = 0 WHERE jid = ?', [jid]);
  });
  return linhaId;
}

// Manda para o WhatsApp e atualiza o status (✓ ou ⚠)
async function despachar(e, lib, { linhaId, jid, waId, conteudo, citada, leadId }) {
  avisar({ chat: jid });
  await respeitarIntervalo(e);
  try {
    const opcoes = { messageId: waId, ...(citada ? { quoted: citada.original } : {}) };
    // Mensagens temporárias ligadas na conversa: a mensagem também é temporária
    const temporarias = get('SELECT ephemeral_seconds FROM wa_chats WHERE jid = ?', [jid])?.ephemeral_seconds;
    if (temporarias) opcoes.ephemeralExpiration = temporarias;
    const enviada = await e.sock.sendMessage(jid, conteudo, opcoes);
    guardarEnviada(waId, enviada?.message);
    run('UPDATE wa_messages SET raw = COALESCE(raw, ?), status = CASE WHEN COALESCE(status, 0) < 2 THEN 2 ELSE status END WHERE id = ?', [
      enviada ? serializar(lib, enviada) : null, linhaId,
    ]);
    // Se o WhatsApp devolveu a conversa com outro identificador (LID), liga ao mesmo lead
    if (leadId) {
      run(
        `UPDATE wa_contacts SET lead_id = ? WHERE lead_id IS NULL
           AND jid IN (SELECT chat_jid FROM wa_messages WHERE wa_id = ? AND from_me = 1)`,
        [leadId, waId]
      );
    }
    avisar({ chat: jid });
    return enviada;
  } catch (err) {
    run('UPDATE wa_messages SET status = 0 WHERE id = ?', [linhaId]);
    avisar({ chat: jid });
    throw new ErroHttp(502, `O WhatsApp não aceitou a mensagem: ${err.message}`);
  }
}

// Prévia de link (título, descrição, miniatura) como o WhatsApp Web faz ao enviar um link
async function previaDeLink(texto) {
  if (!config.whatsapp.previaLinks) return null;
  return gerarPrevia(texto);
}

/**
 * Envia texto e/ou arquivo (ou um conteúdo especial: figurinha, enquete, contato, localização).
 *  destino: { leadId } ou { jid }
 *  dados: { texto, arquivo: { caminho, mime, nome, modo: auto|documento|voz|figurinha|gif, unica }, responderId, mencoes,
 *          automatico (fila de disparos), semPrevia (não busca a prévia do link) }
 */
export async function enviar(numeroId, destino, { texto = null, arquivo = null, responderId = null, especial = null, mencoes = null, automatico = false, semPrevia = false }, userId) {
  const e = numeroConectado(numeroId);
  const lib = await carregarBaileys();
  const { jid, leadId } = await resolverDestino(e, lib, destino);
  const grupo = lib.isJidGroup(jid);
  const citada = carregarCitada(lib, responderId);

  let preparo = null;
  if (arquivo) preparo = await prepararArquivo(arquivo, texto);

  let conteudo;
  let tipo = 'texto';
  let previa = texto || '';
  let legenda = null;
  let midia = null;
  let extra = null;
  const waId = lib.generateMessageIDV2(e.sock.user?.id);
  const horario = agora();

  if (especial) {
    ({ conteudo, tipo, previa, extra } = especial);
  } else if (preparo) {
    conteudo = preparo.conteudo;
    tipo = preparo.tipo;
    legenda = texto || null;
    const base = tipo === 'documento' ? `📄 ${preparo.nome}` : tipo === 'audio' && !preparo.ptt ? '🎵 Áudio' : preparo.gif ? '🎞 GIF' : PREVIAS[tipo];
    previa = texto ? `${base}: ${texto}` : base;
    let rel;
    if (tipo === 'figurinha') {
      rel = arquivoDaFigurinha(preparo.figurinhaId).relativo;
    } else {
      rel = caminhoRelativo(numeroId, horario, `e-${waId}`, extensaoDe(preparo.mime, preparo.nome));
      fs.mkdirSync(path.dirname(absoluto(rel)), { recursive: true });
      fs.copyFileSync(preparo.arquivoFinal, absoluto(rel));
    }
    midia = {
      mime: preparo.mime, path: rel, nome: tipo === 'documento' || tipo === 'audio' ? preparo.nome ?? null : null,
      tamanho: fs.statSync(absoluto(rel)).size, segundos: preparo.segundos, largura: preparo.largura, altura: preparo.altura, ptt: preparo.ptt,
    };
    if (preparo.gif || arquivo.unica) extra = { ...(preparo.gif ? { gif: true } : {}), ...(arquivo.unica ? { unica: true } : {}) };
  } else {
    const info = semPrevia ? null : await previaDeLink(texto);
    conteudo = { text: texto, linkPreview: info || null };
    if (info) extra = { previa: { url: info['canonical-url'] || info['matched-text'], titulo: info.title || null, descricao: info.description || null, thumb: info.jpegThumbnail ? Buffer.from(info.jpegThumbnail).toString('base64') : null } };
  }
  if (mencoes?.length && grupo) {
    const jids = mencoes.filter((m) => /@(s\.whatsapp\.net|lid)$/.test(m)).slice(0, 50);
    if (jids.length) {
      conteudo = { ...conteudo, mentions: jids };
      extra = { ...(extra || {}), mencoes: Object.fromEntries(jids.map((j) => [j.split('@')[0], get('SELECT COALESCE(name, push_name, phone) AS n FROM wa_contacts WHERE jid = ?', [j])?.n || j.split('@')[0]])) };
    }
  }

  const linhaId = gravarSaindo({ numeroId, leadId, jid, waId, userId, horario, tipo, previa, legenda, midia, citada, extra, grupo, automatico });
  await despachar(e, lib, { linhaId, jid, waId, conteudo, citada, leadId });
  if (preparo?.figurinhaId) marcarUsada(preparo.figurinhaId);
  return { id: linhaId, wa_id: waId };
}

// Compatibilidade com a versão anterior
export const enviarMensagem = (numeroId, leadId, texto, userId) => enviar(numeroId, { leadId }, { texto }, userId);

export async function enviarFigurinha(numeroId, destino, figurinhaId, userId, responderId = null) {
  const f = arquivoDaFigurinha(figurinhaId);
  const info = get('SELECT animated FROM wa_stickers WHERE id = ?', [figurinhaId]);
  const r = await enviar(numeroId, destino, {
    responderId,
    especial: {
      conteudo: { sticker: { url: f.caminho }, mimetype: 'image/webp', isAnimated: Boolean(info?.animated) },
      tipo: 'figurinha', previa: '🙂 Figurinha', extra: null,
    },
  }, userId);
  run(
    "UPDATE wa_messages SET media_mime = 'image/webp', media_path = ?, media_status = 'ok', media_w = 512, media_h = 512, media_size = ? WHERE id = ?",
    [f.relativo, fs.statSync(f.caminho).size, r.id]
  );
  marcarUsada(figurinhaId);
  avisar();
  return r;
}

export function enviarEnquete(numeroId, destino, { pergunta, opcoes, multipla }, userId) {
  const limpas = [...new Set((opcoes || []).map((o) => String(o || '').trim()).filter(Boolean))].slice(0, 12);
  if (!pergunta?.trim()) throw new ErroHttp(400, 'Escreva a pergunta da enquete');
  if (limpas.length < 2) throw new ErroHttp(400, 'A enquete precisa de pelo menos 2 opções diferentes');
  return enviar(numeroId, destino, {
    especial: {
      conteudo: { poll: { name: pergunta.trim().slice(0, 255), values: limpas, selectableCount: multipla ? 0 : 1 } },
      tipo: 'enquete', previa: `📊 ${pergunta.trim()}`, extra: { pergunta: pergunta.trim(), opcoes: limpas, multipla: Boolean(multipla), votos: {} },
    },
  }, userId);
}

function vcard(nome, telefone) {
  const tel = String(telefone || '').replace(/\D/g, '');
  const limpo = String(nome || 'Contato').replace(/[\r\n;]/g, ' ').trim();
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${limpo}\nTEL;type=CELL;type=VOICE;waid=${tel}:+${tel}\nEND:VCARD`;
}

export function enviarContato(numeroId, destino, contatos, userId) {
  const lista = (contatos || []).filter((c) => String(c.telefone || '').replace(/\D/g, '').length >= 8).slice(0, 10);
  if (!lista.length) throw new ErroHttp(400, 'Escolha um contato com telefone');
  const nome = lista.length === 1 ? lista[0].nome || 'Contato' : `${lista.length} contatos`;
  return enviar(numeroId, destino, {
    especial: {
      conteudo: { contacts: { displayName: nome, contacts: lista.map((c) => ({ displayName: c.nome || 'Contato', vcard: vcard(c.nome, c.telefone) })) } },
      tipo: 'contato', previa: `👤 ${lista.map((c) => c.nome || 'Contato').join(', ')}`,
      extra: { contatos: lista.map((c) => ({ nome: c.nome || 'Contato', telefones: [String(c.telefone).replace(/\D/g, '')] })) },
    },
  }, userId);
}

export function enviarLocalizacao(numeroId, destino, { lat, lng, nome, endereco }, userId) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) throw new ErroHttp(400, 'Localização inválida');
  return enviar(numeroId, destino, {
    especial: {
      conteudo: { location: { degreesLatitude: la, degreesLongitude: lo, name: nome || undefined, address: endereco || undefined } },
      tipo: 'localizacao', previa: `📍 ${nome || 'Localização'}`, extra: { lat: la, lng: lo, nome: nome || null, endereco: endereco || null },
    },
  }, userId);
}

// ---------------------------------------------------------------- ações sobre mensagens

function linhaDaMensagem(linhaId) {
  const linha = get('SELECT * FROM wa_messages WHERE id = ?', [linhaId]);
  if (!linha) throw new ErroHttp(404, 'Mensagem não encontrada');
  return linha;
}

const chaveDaMensagem = (linha) => ({
  remoteJid: linha.chat_jid, fromMe: Boolean(linha.from_me), id: linha.wa_id,
  ...(linha.participant_jid && !linha.from_me ? { participant: linha.participant_jid } : {}),
});

export async function reagir(linhaId, emoji) {
  const linha = linhaDaMensagem(linhaId);
  const e = algumConectado(linha.instance_id);
  if (!e) throw new ErroHttp(409, 'Nenhum número conectado');
  await respeitarIntervalo(e);
  await e.sock.sendMessage(linha.chat_jid, { react: { text: emoji || '', key: chaveDaMensagem(linha) } });
  aplicarReacao(linha.wa_id, 'eu', emoji || '');
  avisar({ chat: linha.chat_jid });
}

export async function apagarParaTodos(linhaId) {
  const linha = linhaDaMensagem(linhaId);
  if (!linha.from_me) throw new ErroHttp(400, 'Só dá para apagar para todos as mensagens enviadas por vocês');
  const e = socketConectado(linha.instance_id);
  if (!e) throw new ErroHttp(409, 'O número que enviou esta mensagem não está conectado');
  await e.sock.sendMessage(linha.chat_jid, { delete: chaveDaMensagem(linha) });
  marcarApagada(linha.wa_id);
  avisar({ chat: linha.chat_jid });
}

// "Apagar para mim": só esconde no CRM (a mensagem continua guardada no banco)
export function ocultarParaMim(linhaId, ocultar = true) {
  const linha = linhaDaMensagem(linhaId);
  run('UPDATE wa_messages SET hidden_at = ? WHERE id = ?', [ocultar ? agora() : null, linha.id]);
  avisar({ chat: linha.chat_jid });
}

export async function editar(linhaId, novoTexto) {
  const linha = linhaDaMensagem(linhaId);
  if (!linha.from_me) throw new ErroHttp(400, 'Só dá para editar mensagens enviadas por vocês');
  if (linha.type !== 'texto') throw new ErroHttp(400, 'Só dá para editar mensagens de texto');
  if (linha.deleted_at) throw new ErroHttp(400, 'Esta mensagem foi apagada');
  if (Date.now() - new Date(linha.timestamp).getTime() > EDITAR_ATE_MS) throw new ErroHttp(400, 'O WhatsApp só deixa editar até 15 minutos depois do envio');
  const texto = String(novoTexto || '').trim();
  if (!texto) throw new ErroHttp(400, 'Escreva a mensagem');
  const e = socketConectado(linha.instance_id);
  if (!e) throw new ErroHttp(409, 'O número que enviou esta mensagem não está conectado');
  await respeitarIntervalo(e);
  await e.sock.sendMessage(linha.chat_jid, { text: texto, edit: chaveDaMensagem(linha) });
  run('UPDATE wa_messages SET body = ?, edited_at = ? WHERE id = ?', [texto, agora(), linha.id]);
  avisar({ chat: linha.chat_jid });
}

export async function estrela(linhaId, marcar) {
  const linha = linhaDaMensagem(linhaId);
  run('UPDATE wa_messages SET starred_at = ? WHERE id = ?', [marcar ? agora() : null, linha.id]);
  avisar({ chat: linha.chat_jid });
  // Também marca no celular (melhor esforço)
  const e = socketConectado(linha.instance_id);
  if (e?.sock.chatModify) {
    e.sock.chatModify({ star: { messages: [{ id: linha.wa_id, fromMe: Boolean(linha.from_me) }], star: Boolean(marcar) } }, linha.chat_jid).catch(() => {});
  }
}

/** Encaminhar uma mensagem para uma ou várias conversas */
export async function encaminhar(linhaId, destinos, numeroId, userId) {
  const linha = linhaDaMensagem(linhaId);
  if (linha.deleted_at) throw new ErroHttp(400, 'Esta mensagem foi apagada');
  if (!destinos?.length) throw new ErroHttp(400, 'Escolha para quem encaminhar');
  if (destinos.length > 5) throw new ErroHttp(400, 'O WhatsApp permite encaminhar para no máximo 5 conversas de cada vez');
  const lib = await carregarBaileys();
  const e = numeroConectado(numeroId);
  let original = desserializar(lib, linha.raw);
  if (linha.media_mime && !linha.media_path) {
    try { await baixarMidia(linha.id); } catch { /* encaminha pelo original */ }
  }
  const atualizada = get('SELECT * FROM wa_messages WHERE id = ?', [linha.id]);
  if (!original?.message) {
    original = { key: chaveDaMensagem(linha), message: { conversation: linha.legenda || linha.body || '' } };
  }
  const resultados = [];
  for (const destino of destinos) {
    try {
      const { jid, leadId } = await resolverDestino(e, lib, destino);
      const waId = lib.generateMessageIDV2(e.sock.user?.id);
      let extra = null;
      try { extra = JSON.parse(atualizada.extra || 'null'); } catch { /* sem extra */ }
      extra = { ...(extra || {}), encaminhada: 1 };
      delete extra.votos;
      const linhaNova = gravarSaindo({
        numeroId, leadId, jid, waId, userId, horario: agora(), tipo: atualizada.type, previa: atualizada.body, legenda: atualizada.legenda,
        midia: atualizada.media_path ? {
          mime: atualizada.media_mime, path: atualizada.media_path, nome: atualizada.media_name, tamanho: atualizada.media_size,
          segundos: atualizada.media_seconds, largura: atualizada.media_w, altura: atualizada.media_h, ptt: Boolean(atualizada.ptt),
        } : null,
        citada: null, extra, grupo: lib.isJidGroup(jid),
      });
      if (atualizada.thumb) run('UPDATE wa_messages SET thumb = ? WHERE id = ?', [atualizada.thumb, linhaNova]);
      await despachar(e, lib, { linhaId: linhaNova, jid, waId, conteudo: { forward: original }, citada: null, leadId });
      resultados.push({ ok: true, id: linhaNova });
    } catch (err) {
      resultados.push({ ok: false, erro: err.message });
    }
  }
  return resultados;
}

// Cifra um voto de enquete (o inverso de decryptPollVote do Baileys)
export function cifrarVoto(lib, { segredo, msgId, autor, votante, opcoes }) {
  const plano = lib.proto.Message.PollVoteMessage.encode({ selectedOptions: opcoes.map((o) => lib.sha256(Buffer.from(o))) }).finish();
  const assinatura = Buffer.concat([Buffer.from(msgId), Buffer.from(autor), Buffer.from(votante), Buffer.from('Poll Vote'), Buffer.from([1])]);
  const chave0 = lib.hmacSign(Buffer.from(segredo), Buffer.alloc(32), 'sha256');
  const chave = lib.hmacSign(assinatura, chave0, 'sha256');
  const encIv = crypto.randomBytes(12);
  const encPayload = lib.aesEncryptGCM(plano, chave, encIv, Buffer.from(`${msgId}\u0000${votante}`));
  return { encPayload, encIv };
}

/** Votar numa enquete (o voto vai cifrado com a chave da enquete, como no WhatsApp) */
export async function votar(linhaId, opcoesEscolhidas) {
  const linha = linhaDaMensagem(linhaId);
  if (linha.type !== 'enquete') throw new ErroHttp(400, 'Esta mensagem não é uma enquete');
  const lib = await carregarBaileys();
  const e = socketConectado(linha.instance_id) || algumConectado();
  if (!e) throw new ErroHttp(409, 'Nenhum número conectado');
  const original = desserializar(lib, linha.raw);
  const segredo = original?.message?.messageContextInfo?.messageSecret;
  if (!segredo) throw new ErroHttp(400, 'Não dá para votar nesta enquete pelo CRM (ela veio sem a chave). Vote pelo celular.');
  let extra = {};
  try { extra = JSON.parse(linha.extra || '{}'); } catch { /* recomeça */ }
  const escolhidas = (opcoesEscolhidas || []).filter((o) => (extra.opcoes || []).includes(o));
  if (!extra.multipla && escolhidas.length > 1) throw new ErroHttp(400, 'Esta enquete aceita só uma opção');

  const lid = lib.isLidUser(linha.chat_jid) || (linha.participant_jid && lib.isLidUser(linha.participant_jid));
  const eu = lib.jidNormalizedUser((lid && e.sock.user?.lid) || e.sock.user?.id);
  const autor = linha.from_me ? eu : lib.jidNormalizedUser(linha.participant_jid || original.key?.participant || linha.chat_jid);
  const { encPayload, encIv } = cifrarVoto(lib, { segredo, msgId: linha.wa_id, autor, votante: eu, opcoes: escolhidas });
  const iv = encIv;
  await respeitarIntervalo(e);
  await e.sock.relayMessage(linha.chat_jid, {
    pollUpdateMessage: {
      pollCreationMessageKey: chaveDaMensagem(linha),
      vote: { encPayload, encIv: iv },
      senderTimestampMs: Date.now(),
    },
  }, {});
  extra.votos = extra.votos || {};
  if (escolhidas.length) extra.votos.eu = escolhidas;
  else delete extra.votos.eu;
  run('UPDATE wa_messages SET extra = ? WHERE id = ?', [JSON.stringify(extra), linha.id]);
  avisar({ chat: linha.chat_jid });
}

// Informações da mensagem (entregue / lida / ouvida)
export function informacoes(linhaId) {
  const l = linhaDaMensagem(linhaId);
  return {
    id: l.id, enviada_em: l.timestamp, status: l.status, entregue_em: l.delivered_at, lida_em: l.seen_at, ouvida_em: l.played_at,
    enviada_por: l.sent_by ? get('SELECT name FROM users WHERE id = ?', [l.sent_by])?.name : null,
    numero: get('SELECT name FROM wa_instances WHERE id = ?', [l.instance_id])?.name || null,
  };
}

// ---------------------------------------------------------------- conversa

// Abrir a conversa no CRM: avisa o WhatsApp que as mensagens foram lidas (✓✓ azul para o contato)
export function confirmarLeitura(linhas) {
  if (!config.whatsapp.confirmarLeitura || !linhas?.length) return;
  const porNumero = new Map();
  for (const l of linhas) {
    if (!porNumero.has(l.instance_id)) porNumero.set(l.instance_id, []);
    porNumero.get(l.instance_id).push({ remoteJid: l.chat_jid, id: l.wa_id, fromMe: false, ...(l.participant_jid ? { participant: l.participant_jid } : {}) });
  }
  for (const [numeroId, chaves] of porNumero) {
    const e = socketConectado(numeroId);
    if (e) e.sock.readMessages(chaves).catch(() => { /* não é essencial */ });
  }
}

// "digitando…" / "gravando áudio…" para o contato (e assinar a presença dele)
const ultimaPresenca = new Map();
export async function avisarDigitando(numeroId, jid, estadoPresenca = 'composing') {
  const e = socketConectado(numeroId);
  if (!e || !jid) return;
  const chave = `${numeroId}|${jid}|${estadoPresenca}`;
  if (estadoPresenca !== 'paused' && Date.now() - (ultimaPresenca.get(chave) || 0) < 4000) return;
  ultimaPresenca.set(chave, Date.now());
  await e.sock.sendPresenceUpdate(estadoPresenca, jid).catch(() => {});
}

export async function assinarPresenca(jid, numeroPreferido = null) {
  const e = socketConectado(numeroPreferido) || algumConectado();
  if (!e || !jid) return;
  await e.sock.presenceSubscribe(jid).catch(() => {});
}

// Mensagens temporárias (segundos: 0 desliga; 86400 = 24 h; 604800 = 7 dias; 7776000 = 90 dias)
export async function definirTemporarias(numeroId, jid, segundos) {
  const e = numeroConectado(numeroId);
  const permitido = [0, 86400, 604800, 7776000];
  const s = Number(segundos) || 0;
  if (!permitido.includes(s)) throw new ErroHttp(400, 'Duração inválida');
  await e.sock.sendMessage(jid, { disappearingMessagesInChat: s || false });
  run('INSERT INTO wa_chats (jid, instance_id, ephemeral_seconds) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET ephemeral_seconds = excluded.ephemeral_seconds', [jid, numeroId, s || null]);
  avisar({ chat: jid });
}

/**
 * Leva para o celular o que foi feito na conversa pelo CRM (arquivar, fixar, silenciar, marcar como não lida).
 * Melhor esforço: se o WhatsApp recusar, a mudança continua valendo no CRM.
 */
export async function refletirNoCelular(jids, mudanca) {
  for (const jid of jids) {
    const ultima = get(
      `SELECT instance_id, wa_id, from_me, timestamp, participant_jid, chat_jid FROM wa_messages
        WHERE chat_jid = ? AND raw IS NOT NULL ORDER BY timestamp DESC, id DESC LIMIT 1`,
      [jid]
    );
    if (!ultima) continue;
    const e = socketConectado(ultima.instance_id);
    if (!e?.sock.chatModify) continue;
    const lastMessages = [{ key: chaveDaMensagem(ultima), messageTimestamp: Math.floor(new Date(ultima.timestamp).getTime() / 1000) }];
    let mod = null;
    if ('arquivada' in mudanca) mod = { archive: Boolean(mudanca.arquivada), lastMessages };
    else if ('fixada' in mudanca) mod = { pin: Boolean(mudanca.fixada) };
    else if ('silenciada_ate' in mudanca) mod = { mute: mudanca.silenciada_ate ? Math.min(new Date(mudanca.silenciada_ate).getTime(), Date.now() + 365 * 86400000 * 10) : null };
    else if ('nao_lida' in mudanca) mod = { markRead: !mudanca.nao_lida, lastMessages };
    if (!mod) continue;
    await e.sock.chatModify(mod, jid).catch((err) => console.error('[whatsapp] o celular não aceitou a mudança na conversa:', err.message));
  }
}

export { chaveDaMensagem };
export const _paraTeste = { vcard, prepararArquivo };
