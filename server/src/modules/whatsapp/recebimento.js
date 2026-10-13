// Recebimento: transforma mensagens do WhatsApp (formato do Baileys) em linhas do banco.
// Usado ao vivo (mensagem nova), para mensagens recebidas com o CRM desligado e na importação do histórico.
//
// O trabalho é dividido em duas partes:
//  - prepararMensagem (assíncrona): descobre o telefone (LID → telefone), lê o conteúdo e a citação;
//  - aplicarPreparada (síncrona): grava no banco. Pode rodar em lote, dentro de uma única transação.
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { criarLead } from '../leads/service.js';
import { TIPOS_IGNORADOS, analisarConteudo, horarioDaMensagem, descreverChamada } from './conteudo.js';
import { vincularConversa, ehGrupo, telefoneDoJid } from './ligacao.js';
import { avisar, respirar } from './instancias.js';
import { agendarDownload, podeBaixarNaHora } from './midia.js';

import { serializar, desserializar } from './formato.js';
export { serializar, desserializar, mensagemOriginal } from './formato.js';

// ---------------------------------------------------------------- quem é quem

const individual = (lib, jid) =>
  Boolean(jid) && !lib.isJidGroup(jid) && !lib.isJidBroadcast(jid) && !lib.isJidStatusBroadcast(jid) && !lib.isJidNewsletter(jid) &&
  (lib.isPnUser(jid) || lib.isLidUser(jid));

// Conversas que o CRM guarda: individuais e (se WHATSAPP_GRUPOS não for 0) grupos
export const chatPermitido = (lib, jid) => individual(lib, jid) || (config.whatsapp.grupos && Boolean(jid) && lib.isJidGroup(jid));

export async function resolverTelefone(lib, sock, jid, alternativo = null, cache = null) {
  if (!jid || lib.isJidGroup(jid)) return null;
  if (cache?.has(jid)) return cache.get(jid);
  let telefone = null;
  for (const j of [jid, alternativo]) {
    if (j && lib.isPnUser(j)) { telefone = lib.jidDecode(j)?.user || null; break; }
  }
  if (!telefone && lib.isLidUser(jid) && sock?.signalRepository?.lidMapping) {
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
      if (pn) telefone = lib.jidDecode(pn)?.user || null;
    } catch { /* sem mapeamento ainda */ }
  }
  if (!telefone) telefone = get('SELECT phone FROM wa_contacts WHERE jid = ?', [lib.jidNormalizedUser(jid)])?.phone || null;
  cache?.set(jid, telefone);
  return telefone;
}

function nomeDoContato(jid) {
  const c = get('SELECT name, push_name, phone FROM wa_contacts WHERE jid = ?', [jid]);
  return c?.name || c?.push_name || c?.phone || telefoneDoJid(jid) || null;
}

// ---------------------------------------------------------------- reações, apagadas, editadas, votos

export function aplicarReacao(alvoId, quem, emoji) {
  if (!alvoId) return false;
  const linha = get('SELECT id, reactions FROM wa_messages WHERE wa_id = ? ORDER BY id DESC LIMIT 1', [alvoId]);
  if (!linha) return false;
  let reacoes = {};
  try { reacoes = JSON.parse(linha.reactions || '{}'); } catch { /* recomeça */ }
  if (emoji) reacoes[quem] = emoji;
  else delete reacoes[quem];
  run('UPDATE wa_messages SET reactions = ? WHERE id = ?', [Object.keys(reacoes).length ? JSON.stringify(reacoes) : null, linha.id]);
  return true;
}

export function marcarApagada(waId, horario = agora()) {
  if (!waId) return false;
  return run('UPDATE wa_messages SET deleted_at = ? WHERE wa_id = ? AND deleted_at IS NULL', [horario, waId]).changes > 0;
}

export function aplicarEdicao(lib, waId, novoConteudo, horario = agora()) {
  if (!waId || !novoConteudo) return false;
  const conteudo = lib.normalizeMessageContent(novoConteudo);
  const tipo = conteudo && lib.getContentType(conteudo);
  if (!tipo) return false;
  const info = analisarConteudo(conteudo, tipo);
  const linha = get('SELECT id, type FROM wa_messages WHERE wa_id = ? ORDER BY id DESC LIMIT 1', [waId]);
  if (!linha) return false;
  if (linha.type === 'texto') run('UPDATE wa_messages SET body = ?, edited_at = ? WHERE id = ?', [info.texto, horario, linha.id]);
  else if (info.legenda !== null) run('UPDATE wa_messages SET legenda = ?, edited_at = ? WHERE id = ?', [info.legenda, horario, linha.id]);
  return true;
}

// Voto numa enquete (o Baileys 7 não decifra sozinho: decifra aqui com a chave da enquete original)
function aplicarVoto(lib, sock, msg, voto) {
  const chave = voto?.pollCreationMessageKey;
  if (!chave?.id || !voto.vote) return false;
  const linha = get("SELECT id, raw, extra, from_me, chat_jid FROM wa_messages WHERE wa_id = ? AND type = 'enquete' ORDER BY id DESC LIMIT 1", [chave.id]);
  if (!linha) return false;
  const original = desserializar(lib, linha.raw);
  const segredo = original?.message?.messageContextInfo?.messageSecret;
  if (!segredo) return false;
  const eu = lib.jidNormalizedUser(sock?.user?.id || '');
  const euLid = sock?.user?.lid ? lib.jidNormalizedUser(sock.user.lid) : null;
  const autorEnquete = linha.from_me ? eu : lib.jidNormalizedUser(original.key?.participant || original.key?.remoteJid || '');
  const votante = msg.key.fromMe ? eu : lib.jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
  let decifrado = null;
  // O WhatsApp pode usar o telefone ou o LID de cada lado: tenta as combinações
  const autores = [...new Set([autorEnquete, linha.from_me ? euLid : null, original.key?.participantAlt, original.key?.remoteJidAlt].filter(Boolean).map((j) => lib.jidNormalizedUser(j)))];
  const votantes = [...new Set([votante, msg.key.fromMe ? euLid : null, msg.key.participantAlt, msg.key.remoteJidAlt].filter(Boolean).map((j) => lib.jidNormalizedUser(j)))];
  for (const pollCreatorJid of autores) {
    for (const voterJid of votantes) {
      try {
        decifrado = lib.decryptPollVote(voto.vote, { pollCreatorJid, pollMsgId: chave.id, pollEncKey: segredo, voterJid });
        break;
      } catch { /* tenta a próxima combinação */ }
    }
    if (decifrado) break;
  }
  if (!decifrado) return false;
  let extra = {};
  try { extra = JSON.parse(linha.extra || '{}'); } catch { /* recomeça */ }
  const porHash = new Map((extra.opcoes || []).map((o) => [lib.sha256(Buffer.from(o)).toString('hex'), o]));
  const escolhidas = (decifrado.selectedOptions || []).map((h) => porHash.get(Buffer.from(h).toString('hex'))).filter(Boolean);
  extra.votos = extra.votos || {};
  const quem = msg.key.fromMe ? 'eu' : votante;
  if (escolhidas.length) extra.votos[quem] = escolhidas;
  else delete extra.votos[quem];
  extra.nomes = extra.nomes || {};
  if (!msg.key.fromMe && msg.pushName) extra.nomes[quem] = msg.pushName;
  run('UPDATE wa_messages SET extra = ? WHERE id = ?', [JSON.stringify(extra), linha.id]);
  return true;
}

// Trecho da mensagem respondida (citação)
function dadosCitacao(lib, sock, contexto) {
  if (!contexto?.stanzaId) return { id: null, texto: null, deMim: null };
  const conhecida = get('SELECT from_me, body, legenda, type FROM wa_messages WHERE wa_id = ? ORDER BY id DESC LIMIT 1', [contexto.stanzaId]);
  let texto = conhecida ? conhecida.legenda || conhecida.body : null;
  if (!texto && contexto.quotedMessage) {
    const q = lib.normalizeMessageContent(contexto.quotedMessage);
    const tipo = q && lib.getContentType(q);
    if (tipo) texto = analisarConteudo(q, tipo).texto;
  }
  let deMim = conhecida ? Boolean(conhecida.from_me) : null;
  if (deMim === null && contexto.participant && sock?.user) {
    deMim = [sock.user.id, sock.user.lid].filter(Boolean).some((eu) => lib.areJidsSameUser(eu, contexto.participant));
  }
  return { id: contexto.stanzaId, texto: texto ? String(texto).slice(0, 300) : null, deMim };
}

// Recibos que vêm no histórico (entregue / lida / ouvida), em ISO
function recibos(msg) {
  let entregue = null;
  let lida = null;
  let ouvida = null;
  const iso = (v) => (v ? horarioDaMensagem(v) : null);
  for (const r of msg.userReceipt || []) {
    entregue = entregue || iso(r.receiptTimestamp);
    lida = lida || iso(r.readTimestamp);
    ouvida = ouvida || iso(r.playedTimestamp);
  }
  return { entregue, lida, ouvida };
}

const CHAMADAS_PERDIDAS = { 40: false, 41: true, 45: false, 46: true };

// ---------------------------------------------------------------- preparar / aplicar

/**
 * Lê uma mensagem do Baileys e devolve o que gravar (ou null para ignorar). Assíncrona.
 * cache: Map opcional jid → telefone (acelera lotes)
 */
export async function prepararMensagem(id, sock, lib, msg, modo, cache = null) {
  const jid = msg?.key?.remoteJid;
  if (!chatPermitido(lib, jid)) return null;
  const grupo = lib.isJidGroup(jid);
  const chatJid = lib.jidNormalizedUser(jid);
  const fromMe = Boolean(msg.key.fromMe);
  const horario = horarioDaMensagem(msg.messageTimestamp);

  // Chamada perdida que chega como "aviso" (sem conteúdo)
  if (!msg.message) {
    const stub = Number(msg.messageStubType);
    if (!(stub in CHAMADAS_PERDIDAS) || !msg.key.id) return null;
    const extra = { video: CHAMADAS_PERDIDAS[stub], resultado: 'perdida', duracao: null };
    return {
      acao: 'nova', chatJid, grupo, fromMe, horario, modo, waId: msg.key.id,
      telefone: grupo ? null : await resolverTelefone(lib, sock, jid, msg.key.remoteJidAlt, cache),
      pushName: null, participante: null,
      info: { tipo: 'chamada', texto: descreverChamada({ ...extra, deMim: fromMe }), legenda: null, midia: null, extra },
      citacao: { id: null, texto: null, deMim: null }, raw: null, status: null, recibos: {},
    };
  }

  const conteudo = lib.normalizeMessageContent(msg.message);
  const tipoBruto = conteudo && lib.getContentType(conteudo);
  if (!tipoBruto) return null;

  if (tipoBruto === 'reactionMessage') {
    return { acao: 'reacao', alvo: conteudo.reactionMessage?.key?.id, quem: fromMe ? 'eu' : 'contato', emoji: conteudo.reactionMessage?.text || '', chatJid };
  }
  if (tipoBruto === 'protocolMessage') {
    const p = conteudo.protocolMessage;
    const tipos = lib.proto.Message.ProtocolMessage.Type;
    const t = p?.type ?? 0;
    if (t === tipos.REVOKE && p.key?.id) return { acao: 'apagar', alvo: p.key.id, horario, chatJid };
    if (t === tipos.MESSAGE_EDIT && p.key?.id) return { acao: 'editar', alvo: p.key.id, conteudo: p.editedMessage, horario, chatJid, lib };
    if (t === tipos.EPHEMERAL_SETTING) return { acao: 'temporarias', chatJid, segundos: Number(p.ephemeralExpiration || 0) };
    return null;
  }
  if (tipoBruto === 'pollUpdateMessage') return { acao: 'voto', msg, voto: conteudo.pollUpdateMessage, chatJid, lib, sock };
  if (TIPOS_IGNORADOS.has(tipoBruto)) return null;

  const info = analisarConteudo(conteudo, tipoBruto);
  const interno = conteudo[tipoBruto] || {};
  const extra = info.extra ? { ...info.extra } : {};
  const ctx = info.contexto;
  // Visualização única e mensagens temporárias
  const original = msg.message;
  if (original?.viewOnceMessage || original?.viewOnceMessageV2 || original?.viewOnceMessageV2Extension || interno.viewOnce) extra.unica = true;
  if (ctx?.expiration) extra.temporaria = Number(ctx.expiration);
  if (ctx?.isForwarded) extra.encaminhada = Number(ctx.forwardingScore || 1);
  // Menções (@fulano) em grupos
  if (ctx?.mentionedJid?.length) {
    extra.mencoes = {};
    for (const m of ctx.mentionedJid.slice(0, 50)) {
      const alvo = lib.jidNormalizedUser(m);
      extra.mencoes[lib.jidDecode(alvo)?.user || alvo] = nomeDoContato(alvo);
    }
  }

  let participante = null;
  if (grupo && !fromMe) {
    const p = msg.key.participant || msg.participant;
    if (p) participante = lib.jidNormalizedUser(msg.key.participantAlt && lib.isPnUser(msg.key.participantAlt) ? msg.key.participantAlt : p);
  }

  return {
    acao: 'nova', chatJid, grupo, fromMe, horario, modo, waId: msg.key.id,
    telefone: grupo ? null : await resolverTelefone(lib, sock, jid, msg.key.remoteJidAlt, cache),
    pushName: fromMe ? null : msg.pushName || null,
    participante,
    info: { ...info, extra: Object.keys(extra).length ? extra : null },
    citacao: dadosCitacao(lib, sock, ctx),
    raw: serializar(lib, msg),
    status: fromMe ? Math.max(2, Number(msg.status) || 2) : null,
    recibos: modo === 'historico' ? recibos(msg) : {},
    lib, sock, msg,
  };
}

function garantirChat(instanciaId, chatJid, grupo, aoVivo) {
  run(
    `INSERT INTO wa_chats (jid, instance_id, is_group, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET instance_id = COALESCE(wa_chats.instance_id, excluded.instance_id),
       hidden_at = CASE WHEN ? THEN NULL ELSE wa_chats.hidden_at END`,
    [chatJid, instanciaId, grupo, agora(), aoVivo]
  );
}

function registrarChamadaNoLead(leadId, linhaId, p) {
  if (!leadId) return;
  run(
    'INSERT INTO lead_events (lead_id, type, data, created_at) VALUES (?, ?, ?, ?)',
    [leadId, 'whatsapp_call', JSON.stringify({ ...p.info.extra, de_mim: p.fromMe, mensagem: linhaId }), p.horario]
  );
}

/**
 * Grava o que prepararMensagem devolveu. Síncrona (pode ficar dentro de uma transação maior).
 * Devolve { linhaId, chat, midia } ou null.
 */
export function aplicarPreparada(instanciaId, p) {
  if (!p) return null;
  if (p.acao === 'reacao') return aplicarReacao(p.alvo, p.quem, p.emoji) ? { chat: p.chatJid } : null;
  if (p.acao === 'apagar') return marcarApagada(p.alvo, p.horario) ? { chat: p.chatJid } : null;
  if (p.acao === 'editar') return p.lib && aplicarEdicao(p.lib, p.alvo, p.conteudo, p.horario) ? { chat: p.chatJid } : null;
  if (p.acao === 'temporarias') {
    run('INSERT INTO wa_chats (jid, instance_id, ephemeral_seconds) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET ephemeral_seconds = excluded.ephemeral_seconds', [p.chatJid, instanciaId, p.segundos]);
    return { chat: p.chatJid };
  }
  if (p.acao === 'voto') return p.lib && aplicarVoto(p.lib, p.sock, p.msg, p.voto) ? { chat: p.chatJid } : null;
  if (p.acao !== 'nova') return null;

  const { chatJid, fromMe, info, horario, modo } = p;
  const aoVivo = modo === 'ao_vivo';

  // Já existe (ex.: eco de uma mensagem enviada pelo CRM): só completa o que faltar
  const existente = get('SELECT id, lead_id, chat_jid, raw, delivered_at FROM wa_messages WHERE wa_id = ? AND from_me = ?', [p.waId, fromMe]);
  if (existente) {
    if (!existente.raw && p.raw) run('UPDATE wa_messages SET raw = ? WHERE id = ?', [p.raw, existente.id]);
    if (p.recibos?.entregue && !existente.delivered_at) {
      run('UPDATE wa_messages SET delivered_at = ?, seen_at = COALESCE(seen_at, ?), played_at = COALESCE(played_at, ?) WHERE id = ?',
        [p.recibos.entregue, p.recibos.lida, p.recibos.ouvida, existente.id]);
    }
    // O WhatsApp pode usar outro identificador (LID) para a mesma conversa: liga ao mesmo lead
    if (existente.lead_id && existente.chat_jid !== chatJid && !p.grupo) {
      run(
        `INSERT INTO wa_contacts (jid, phone, lead_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET lead_id = COALESCE(wa_contacts.lead_id, excluded.lead_id), phone = COALESCE(wa_contacts.phone, excluded.phone)`,
        [chatJid, p.telefone, existente.lead_id, agora()]
      );
    }
    return null;
  }

  let leadId = null;
  if (p.grupo) {
    run('INSERT INTO wa_contacts (jid, updated_at) VALUES (?, ?) ON CONFLICT(jid) DO NOTHING', [chatJid, agora()]);
    if (p.participante && p.pushName) {
      run(
        `INSERT INTO wa_contacts (jid, phone, push_name, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET push_name = COALESCE(excluded.push_name, wa_contacts.push_name)`,
        [p.participante, telefoneDoJid(p.participante), p.pushName, agora()]
      );
    }
  } else {
    const podeCriar = !fromMe && aoVivo && config.whatsapp.criarLeadNovo;
    leadId = vincularConversa({
      chatJid,
      phone: p.telefone,
      pushName: p.pushName,
      criar: podeCriar
        ? ({ phone, pushName }) => criarLead({ name: pushName || null, phone, source: 'whatsapp', extra: { whatsapp: { jid: chatJid } } })
        : null,
    });
  }
  garantirChat(instanciaId, chatJid, p.grupo, aoVivo);
  if (info.extra?.temporaria) run('UPDATE wa_chats SET ephemeral_seconds = ? WHERE jid = ?', [info.extra.temporaria, chatJid]);

  const m = info.midia;
  // Mensagens antigas (histórico) e chamadas entram como lidas: não contam como "mensagem nova"
  const jaLida = !fromMe && (modo === 'historico' || info.tipo === 'chamada') ? agora() : null;
  const r = run(
    `INSERT OR IGNORE INTO wa_messages
       (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, legenda, timestamp, read_at, status, raw,
        media_mime, media_name, media_size, media_seconds, media_w, media_h, media_status, thumb, ptt,
        quoted_wa_id, quoted_body, quoted_from_me, extra, participant_jid, participant_name, delivered_at, seen_at, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      instanciaId, leadId, chatJid, p.waId, fromMe, info.tipo, info.texto, info.legenda, horario, jaLida, p.status, p.raw,
      m?.mime ?? null, m?.nome ?? null, m?.tamanho ?? null, m?.segundos ?? null, m?.largura ?? null, m?.altura ?? null,
      m ? 'pendente' : null, m?.thumb ?? null, m?.ptt ?? false,
      p.citacao.id, p.citacao.texto, p.citacao.deMim, info.extra, p.participante, p.grupo && !fromMe ? p.pushName : null,
      p.recibos?.entregue ?? null, p.recibos?.lida ?? null, p.recibos?.ouvida ?? null,
    ]
  );
  if (!r.changes) return null;
  const linhaId = Number(r.lastInsertRowid);
  if (fromMe && info.tipo !== 'chamada') {
    if (leadId) registrarContatoDoLead(leadId, horario, aoVivo);
    else if (aoVivo) run('UPDATE wa_messages SET read_at = ? WHERE lead_id IS NULL AND chat_jid = ? AND from_me = 0 AND read_at IS NULL', [agora(), chatJid]);
  }
  if (info.tipo === 'chamada') registrarChamadaNoLead(leadId, linhaId, p);
  return { linhaId, chat: chatJid, leadId, midia: m && aoVivo && podeBaixarNaHora(m) ? linhaId : null };
}

// Mensagem nossa para o lead: zera o follow-up (só avança a data) e, ao vivo, marca o que ele mandou antes como lido
function registrarContatoDoLead(leadId, horario, aoVivo) {
  run(
    `UPDATE leads SET
       last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END,
       first_contact_at = CASE WHEN first_contact_at IS NULL OR first_contact_at > ? THEN ? ELSE first_contact_at END,
       updated_at = ?
     WHERE id = ?`,
    [horario, horario, horario, horario, agora(), leadId]
  );
  if (aoVivo) run('UPDATE wa_messages SET read_at = ? WHERE lead_id = ? AND from_me = 0 AND read_at IS NULL', [agora(), leadId]);
}

/**
 * Grava uma mensagem (recebida ao vivo, offline ou do histórico). modo: ao_vivo | offline | historico
 * Devolve o id da linha nova, ou null.
 */
export async function gravarMensagem(id, sock, lib, msg, modo) {
  const p = await prepararMensagem(id, sock, lib, msg, modo);
  if (!p) return null;
  const resultado = tx(() => aplicarPreparada(id, p));
  if (resultado?.chat && modo !== 'historico') avisar({ chat: resultado.chat });
  if (resultado?.midia) agendarDownload(resultado.midia);
  return resultado?.linhaId || null;
}

const TAMANHO_LOTE = 250;

/**
 * Grava muitas mensagens de uma vez (histórico), em lotes de 250 por transação, devolvendo o controle
 * ao servidor entre um lote e outro. Sem duplicar: a mesma mensagem nunca é gravada duas vezes.
 * Devolve { novas, chats: Set }.
 */
export async function gravarLote(id, sock, lib, mensagens, modo = 'historico', aoProgredir = null) {
  const cache = new Map();
  let novas = 0;
  const chats = new Set();
  for (let i = 0; i < mensagens.length; i += TAMANHO_LOTE) {
    const fatia = mensagens.slice(i, i + TAMANHO_LOTE);
    const preparadas = [];
    for (const msg of fatia) {
      try {
        const p = await prepararMensagem(id, sock, lib, msg, modo, cache);
        if (p) preparadas.push(p);
      } catch (err) {
        console.error(`[whatsapp #${id}] mensagem do histórico ignorada:`, err.message);
      }
    }
    tx(() => {
      for (const p of preparadas) {
        try {
          const r = aplicarPreparada(id, p);
          if (r?.linhaId) novas++;
          if (r?.chat) chats.add(r.chat);
        } catch (err) {
          console.error(`[whatsapp #${id}] mensagem do histórico ignorada:`, err.message);
        }
      }
    });
    aoProgredir?.(Math.min(mensagens.length, i + TAMANHO_LOTE), novas);
    await respirar();
  }
  return { novas, chats };
}

// ---------------------------------------------------------------- atualizações

export function aoAtualizarMensagens(lib, lista) {
  let mudou = false;
  for (const { key, update } of lista || []) {
    if (!key?.id || !update) continue;
    if (typeof update.status === 'number' && key.fromMe) {
      const agoraIso = agora();
      const r = update.status === 0
        ? run('UPDATE wa_messages SET status = 0 WHERE wa_id = ? AND from_me = 1 AND COALESCE(status, 1) <= 1', [key.id])
        : run(
          `UPDATE wa_messages SET status = ?,
             delivered_at = CASE WHEN ? >= 3 THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
             seen_at = CASE WHEN ? >= 4 THEN COALESCE(seen_at, ?) ELSE seen_at END,
             played_at = CASE WHEN ? >= 5 THEN COALESCE(played_at, ?) ELSE played_at END
           WHERE wa_id = ? AND from_me = 1 AND COALESCE(status, 0) < ?`,
          [update.status, update.status, agoraIso, update.status, agoraIso, update.status, agoraIso, key.id, update.status]
        );
      if (r.changes) mudou = true;
    }
    if (update.messageStubType === lib.WAMessageStubType.REVOKE && marcarApagada(key.id)) mudou = true;
    const editada = update.message?.editedMessage?.message;
    if (editada?.protocolMessage?.editedMessage) mudou = aplicarEdicao(lib, key.id, editada.protocolMessage.editedMessage) || mudou;
    else if (editada) mudou = aplicarEdicao(lib, key.id, editada) || mudou;
    // Estrela marcada no celular
    if (typeof update.starred === 'boolean') {
      run('UPDATE wa_messages SET starred_at = ? WHERE wa_id = ?', [update.starred ? agora() : null, key.id]);
      mudou = true;
    }
  }
  if (mudou) avisar();
}

// Recibos com horário (message-receipt.update): entregue / lida / ouvida
export function aoReceberRecibos(lista) {
  let mudou = false;
  for (const { key, receipt } of lista || []) {
    if (!key?.id || !receipt) continue;
    const iso = (v) => (v ? horarioDaMensagem(v) : null);
    const r = run(
      `UPDATE wa_messages SET delivered_at = COALESCE(delivered_at, ?), seen_at = COALESCE(seen_at, ?), played_at = COALESCE(played_at, ?)
        WHERE wa_id = ? AND from_me = 1`,
      [iso(receipt.receiptTimestamp), iso(receipt.readTimestamp), iso(receipt.playedTimestamp), key.id]
    );
    if (r.changes) mudou = true;
  }
  if (mudou) avisar();
}

export function aoAtualizarContatos(lib, lista) {
  const fotosMudaram = [];
  tx(() => {
    for (const c of lista || []) {
      if (c.id && lib.isJidGroup(c.id)) {
        if (c.name || c.subject) run('UPDATE wa_chats SET name = ? WHERE jid = ?', [c.name || c.subject, c.id]);
        continue;
      }
      const ids = [c.id, c.lid, c.phoneNumber].filter((j) => j && (lib.isPnUser(j) || lib.isLidUser(j))).map((j) => lib.jidNormalizedUser(j));
      if (!ids.length) continue;
      const pn = ids.find((j) => lib.isPnUser(j));
      const telefone = pn ? lib.jidDecode(pn)?.user : null;
      const nome = c.name || null;
      const apelido = c.notify || c.verifiedName || null;
      for (const jid of ids) {
        if (nome || apelido || telefone) {
          run(
            `INSERT INTO wa_contacts (jid, phone, name, push_name, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(jid) DO UPDATE SET
               phone = COALESCE(wa_contacts.phone, excluded.phone),
               name = COALESCE(excluded.name, wa_contacts.name),
               push_name = COALESCE(excluded.push_name, wa_contacts.push_name)`,
            [jid, telefone, nome, apelido, agora()]
          );
        }
        if (c.imgUrl !== undefined) fotosMudaram.push(jid);
      }
    }
    for (const jid of fotosMudaram) run('DELETE FROM wa_photos WHERE jid = ?', [jid]);
  });
}

// O WhatsApp esconde o telefone atrás de um "LID"; quando ele revela o par LID ↔ telefone, liga ao lead
export function aplicarMapeamentos(lib, pares) {
  let mudou = 0;
  tx(() => {
    for (const par of pares || []) {
      if (!par?.lid || !par?.pn) continue;
      const lid = lib.jidNormalizedUser(par.lid);
      const telefone = lib.jidDecode(par.pn)?.user;
      if (!telefone) continue;
      const existe = get('SELECT phone, lead_id FROM wa_contacts WHERE jid = ?', [lid]);
      if (!existe) {
        // Guarda o par mesmo sem conversa ainda: a conversa que chegar depois já nasce com o telefone
        run('INSERT INTO wa_contacts (jid, phone, updated_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO NOTHING', [lid, telefone, agora()]);
        continue;
      }
      if (existe.phone && existe.lead_id) continue;
      if (!existe.phone) run('UPDATE wa_contacts SET phone = ? WHERE jid = ?', [telefone, lid]);
      if (!existe.lead_id) {
        vincularConversa({ chatJid: lid, phone: telefone });
        mudou++;
      }
    }
  });
  if (mudou) avisar();
}

/**
 * Estado das conversas vindo do celular (histórico e chats.update): nome do grupo, arquivada,
 * fixada, silenciada, marcada como não lida, mensagens temporárias.
 */
export function aplicarEstadoChats(lib, instanciaId, chats, { historico = false } = {}) {
  // Campos que não vieram chegam como null (protobuf). No histórico, só valores "ligados" contam:
  // um lote de histórico nunca desfaz o que a equipe marcou no CRM.
  const veio = (v) => v !== null && v !== undefined;
  const num = (v) => (veio(v) ? Number(typeof v === 'object' ? v.toString() : v) : null);
  const iso = (s) => (s ? new Date(Number(s) * (Number(s) > 1e12 ? 1 : 1000)).toISOString() : null);
  let mudou = false;
  tx(() => {
    for (const c of chats || []) {
      if (!c?.id || !chatPermitido(lib, c.id)) continue;
      const jid = lib.jidNormalizedUser(c.id);
      const grupo = lib.isJidGroup(jid);
      run(
        'INSERT INTO wa_chats (jid, instance_id, is_group, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(jid) DO NOTHING',
        [jid, instanciaId, grupo, agora()]
      );
      const sets = [];
      const vals = [];
      const nome = c.name || c.subject || (grupo ? c.displayName : null);
      if (nome && grupo) { sets.push('name = ?'); vals.push(nome); }
      if (typeof c.archived === 'boolean' && (!historico || c.archived)) { sets.push('archived = ?'); vals.push(c.archived ? 1 : 0); }
      const pin = num(c.pinned);
      if (veio(c.pinned) && (!historico || pin)) { sets.push('pinned_at = ?'); vals.push(pin ? iso(pin) || agora() : null); }
      const fim = num(c.muteEndTime);
      if (veio(c.muteEndTime) && (!historico || fim)) {
        sets.push('muted_until = ?');
        // -1 = silenciada para sempre
        vals.push(fim ? (fim < 0 ? '9999-12-31T00:00:00.000Z' : iso(fim)) : null);
      }
      if (typeof c.markedAsUnread === 'boolean' && (!historico || c.markedAsUnread)) { sets.push('marked_unread = ?'); vals.push(c.markedAsUnread ? 1 : 0); }
      if (c.unreadCount === -1) { sets.push('marked_unread = 1'); }
      const efem = num(c.ephemeralExpiration);
      if (veio(c.ephemeralExpiration) && (!historico || efem)) { sets.push('ephemeral_seconds = ?'); vals.push(efem || null); }
      if (!sets.length) continue;
      run(`UPDATE wa_chats SET ${sets.join(', ')}, updated_at = ? WHERE jid = ?`, [...vals, agora(), jid]);
      mudou = true;
    }
  });
  if (mudou) avisar({ chats: true });
}

// Nome dos grupos que ainda não têm nome (pergunta ao WhatsApp um por vez)
export async function completarNomesDosGrupos(lib, sock) {
  const semNome = all("SELECT jid FROM wa_chats WHERE is_group = 1 AND name IS NULL LIMIT 50").map((r) => r.jid);
  for (const jid of semNome) {
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta?.subject) run('UPDATE wa_chats SET name = ? WHERE jid = ?', [meta.subject, jid]);
    } catch { /* saiu do grupo ou sem acesso */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (semNome.length) avisar({ chats: true });
}

export { ehGrupo };
