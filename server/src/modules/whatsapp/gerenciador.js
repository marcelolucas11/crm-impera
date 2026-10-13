// Gerencia os números de WhatsApp conectados por QR code (biblioteca Baileys — a mesma usada pela Evolution API).
// Cada número tem a sua sessão em ../dados/whatsapp/numero-<id>/ — nunca vai para o GitHub.
// Mídias e fotos de perfil ficam em ../arquivos/whatsapp/.
//
// Atenção: conexão por QR code não é oficial. O WhatsApp pode banir números que mandam
// mensagens em massa ou de forma automatizada. Este módulo só envia mensagens digitadas
// por uma pessoa no CRM, com um intervalo mínimo entre envios.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { criarLead, encontrarExistente, registrarContatoLead } from '../leads/service.js';
import { variantesTelefone, ErroHttp } from '../../util.js';
import { emitir } from '../../tempoReal.js';
import { TIPOS_IGNORADOS, analisarConteudo, horarioDaMensagem, extensaoDe } from './conteudo.js';
import * as ff from './ffmpeg.js';

const INTERVALO_MINIMO_ENVIO_MS = 1500;
const instancias = new Map();
const enviadasRecentes = new Map();

const pastaMidia = () => path.join(config.filesDir, 'whatsapp');
const absoluto = (rel) => path.join(config.filesDir, rel);

let biblioteca = null;
async function carregarBaileys() {
  if (!biblioteca) biblioteca = await import('baileys');
  return biblioteca;
}

let loggerSilencioso = null;
async function logger() {
  if (!loggerSilencioso) loggerSilencioso = (await import('pino')).default({ level: process.env.WHATSAPP_LOG || 'silent' });
  return loggerSilencioso;
}

const pastaDe = (id) => path.join(config.whatsapp.pastaSessoes, `numero-${id}`);
const temSessao = (id) => fs.existsSync(path.join(pastaDe(id), 'creds.json'));
const apagarSessao = (id) => fs.rmSync(pastaDe(id), { recursive: true, force: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const avisar = (dados = {}) => emitir('whatsapp', dados);

function estado(id) {
  if (!instancias.has(id)) {
    instancias.set(id, {
      id, status: 'desconectado', qr: null, sock: null, erro: null, tentativas: 0, parando: false, timer: null, ultimoEnvio: 0,
      historico: null,
    });
  }
  return instancias.get(id);
}

function guardarEnviada(waId, mensagem) {
  if (!waId || !mensagem) return;
  enviadasRecentes.set(waId, mensagem);
  if (enviadasRecentes.size > 1000) enviadasRecentes.delete(enviadasRecentes.keys().next().value);
}

// Mensagem original guardada no banco, codificada no formato do próprio WhatsApp (protobuf).
// Preserva as chaves da mídia (para baixar depois) e permite citar a mensagem numa resposta.
function serializar(lib, msg) {
  try {
    const pb = lib.proto.WebMessageInfo;
    return `pb:${Buffer.from(pb.encode(pb.fromObject(msg)).finish()).toString('base64')}`;
  } catch {
    return null;
  }
}

function desserializar(lib, raw) {
  if (!raw) return null;
  try {
    if (raw.startsWith('pb:')) return lib.proto.WebMessageInfo.decode(Buffer.from(raw.slice(3), 'base64'));
    return JSON.parse(raw, lib.BufferJSON.reviver);
  } catch {
    return null;
  }
}

function mensagemOriginal(lib, waId) {
  const linha = get('SELECT raw FROM wa_messages WHERE wa_id = ? AND raw IS NOT NULL LIMIT 1', [waId]);
  return linha ? desserializar(lib, linha.raw) : null;
}

// Cria o socket do Baileys. Substituível nos testes.
let fabricaSocket = async (id, lib) => {
  const log = await logger();
  const { state, saveCreds } = await lib.useMultiFileAuthState(pastaDe(id));
  const criar = lib.makeWASocket || lib.default;
  const sock = criar({
    auth: { creds: state.creds, keys: lib.makeCacheableSignalKeyStore(state.keys, log) },
    logger: log,
    browser: lib.Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => enviadasRecentes.get(key.id) || mensagemOriginal(lib, key.id)?.message || undefined,
  });
  return { sock, saveCreds };
};
export function definirFabricaSocket(fn, libFalsa) {
  fabricaSocket = fn;
  if (libFalsa) biblioteca = libFalsa;
}

export function listarNumeros() {
  return all('SELECT id, name, phone, created_at FROM wa_instances ORDER BY id').map((n) => {
    const e = estado(n.id);
    return { ...n, status: e.status, qr: e.qr, erro: e.erro, historico: e.historico };
  });
}

function socketConectado(id) {
  const e = id ? instancias.get(id) : null;
  if (e?.status === 'conectado' && e.sock) return e;
  return null;
}

// Um número conectado (o pedido, se estiver conectado; senão qualquer um)
function algumConectado(preferido) {
  return socketConectado(preferido) || [...instancias.values()].find((e) => e.status === 'conectado' && e.sock) || null;
}

export async function conectar(id) {
  const e = estado(id);
  if (e.sock) return;
  clearTimeout(e.timer);
  if (e.status === 'desconectado' || e.status === 'erro') e.tentativas = 0;
  e.parando = false;
  e.status = 'conectando';
  e.erro = null;

  let lib;
  try {
    lib = await carregarBaileys();
  } catch (err) {
    e.status = 'erro';
    e.erro = `A biblioteca do WhatsApp não carregou: ${err.message}`;
    return;
  }
  fs.mkdirSync(pastaDe(id), { recursive: true });
  const { sock, saveCreds } = await fabricaSocket(id, lib);
  e.sock = sock;

  const protegido = (nome, fn) => (...args) => {
    Promise.resolve()
      .then(() => fn(...args))
      .catch((err) => console.error(`[whatsapp #${id}] erro em ${nome}:`, err.message));
  };

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => aoAtualizarConexao(id, sock, u, lib));
  sock.ev.on('messages.upsert', protegido('mensagem', async ({ messages, type }) => {
    for (const m of messages || []) {
      await gravarMensagem(id, sock, lib, m, type === 'notify' ? 'ao_vivo' : 'offline').catch((err) =>
        console.error(`[whatsapp #${id}] erro ao gravar mensagem:`, err.message)
      );
    }
  }));
  sock.ev.on('messaging-history.set', protegido('histórico', (dados) => aoReceberHistorico(id, sock, lib, dados)));
  sock.ev.on('messages.update', protegido('atualização', (lista) => aoAtualizarMensagens(lib, lista)));
  sock.ev.on('contacts.upsert', protegido('contatos', (lista) => aoAtualizarContatos(lib, lista)));
  sock.ev.on('contacts.update', protegido('contatos', (lista) => aoAtualizarContatos(lib, lista)));
  sock.ev.on('lid-mapping.update', protegido('lid', (m) => aplicarMapeamentos(lib, Array.isArray(m) ? m : [m])));
}

function aoAtualizarConexao(id, sock, u, lib) {
  const e = estado(id);
  if (e.sock !== sock) return; // evento de um socket antigo

  if (u.qr) {
    e.qr = u.qr;
    e.status = 'aguardando_qr';
  }

  if (u.connection === 'open') {
    e.status = 'conectado';
    e.qr = null;
    e.erro = null;
    e.tentativas = 0;
    const telefone = lib.jidDecode(sock.user?.id)?.user;
    if (telefone) run('UPDATE wa_instances SET phone = ? WHERE id = ?', [telefone, id]);
    console.log(`[whatsapp #${id}] conectado${telefone ? ` (${telefone})` : ''}`);
    avisar({ numeros: true });
  }

  if (u.connection === 'close') {
    const codigo = u.lastDisconnect?.error?.output?.statusCode;
    const motivos = lib.DisconnectReason;
    const aguardavaQr = e.status === 'aguardando_qr';
    e.sock = null;
    e.qr = null;
    avisar({ numeros: true });

    if (e.parando) {
      e.status = 'desconectado';
      return;
    }
    if (codigo === motivos.loggedOut) {
      apagarSessao(id);
      e.status = 'desconectado';
      e.erro = 'O número foi desconectado pelo celular. Conecte de novo pelo QR code.';
      console.log(`[whatsapp #${id}] sessão encerrada pelo celular`);
      return;
    }
    if (codigo === motivos.connectionReplaced) {
      e.status = 'desconectado';
      e.erro = 'Este número foi aberto em outro lugar (outro computador rodando o CRM?). Clique em Conectar para retomar aqui.';
      return;
    }
    if (codigo === motivos.forbidden) {
      e.status = 'erro';
      e.erro = 'O WhatsApp recusou a conexão deste número.';
      return;
    }
    if (aguardavaQr && codigo !== motivos.restartRequired) {
      e.status = 'desconectado';
      e.erro = 'O QR code expirou. Clique em Conectar para gerar outro.';
      return;
    }

    e.tentativas++;
    const motivo = u.lastDisconnect?.error?.message || (codigo ? `código ${codigo}` : 'sem resposta');
    const jaConectou = Boolean(get('SELECT phone FROM wa_instances WHERE id = ?', [id])?.phone);
    if (!jaConectou && e.tentativas >= 5) {
      e.status = 'desconectado';
      e.erro = `Não foi possível falar com o WhatsApp (${motivo}). Verifique a internet e clique em Conectar.`;
      return;
    }
    const espera = codigo === motivos.restartRequired ? 0 : Math.min(60, 2 ** Math.min(e.tentativas, 6)) * 1000;
    e.status = 'reconectando';
    e.erro = codigo === motivos.restartRequired ? null : `Conexão caiu (${motivo}). Nova tentativa em ${Math.round(espera / 1000)} s.`;
    e.timer = setTimeout(() => conectar(id).catch((err) => { e.status = 'erro'; e.erro = err.message; }), espera);
    e.timer.unref?.();
  }
}

// ---------------------------------------------------------------- recebimento

const chatIndividual = (lib, jid) =>
  Boolean(jid) && !lib.isJidGroup(jid) && !lib.isJidBroadcast(jid) && !lib.isJidStatusBroadcast(jid) && !lib.isJidNewsletter(jid) &&
  (lib.isPnUser(jid) || lib.isLidUser(jid));

async function resolverTelefone(lib, sock, key) {
  for (const jid of [key.remoteJid, key.remoteJidAlt]) {
    if (jid && lib.isPnUser(jid)) return lib.jidDecode(jid)?.user || null;
  }
  if (lib.isLidUser(key.remoteJid) && sock?.signalRepository?.lidMapping) {
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(key.remoteJid);
      if (pn) return lib.jidDecode(pn)?.user || null;
    } catch { /* sem mapeamento ainda */ }
  }
  return get('SELECT phone FROM wa_contacts WHERE jid = ?', [lib.jidNormalizedUser(key.remoteJid)])?.phone || null;
}

// Liga uma conversa do WhatsApp a um lead (procura por conversa, depois por telefone; cria se permitido)
function vincularLead({ chatJid, phone, pushName, criar }) {
  const contato = get('SELECT lead_id FROM wa_contacts WHERE jid = ?', [chatJid]);
  let leadId = contato?.lead_id && get('SELECT 1 FROM leads WHERE id = ?', [contato.lead_id]) ? contato.lead_id : null;

  if (!leadId && phone) leadId = encontrarExistente({ phone });
  if (!leadId && phone) {
    const v = variantesTelefone(phone);
    leadId = get(`SELECT lead_id FROM wa_contacts WHERE phone IN (${v.map(() => '?').join(',')}) AND lead_id IS NOT NULL LIMIT 1`, v)?.lead_id || null;
  }
  if (!leadId && criar) {
    leadId = criarLead({ name: pushName || null, phone, source: 'whatsapp', extra: { whatsapp: { jid: chatJid } } });
  }
  if (leadId) {
    if (phone) run('UPDATE leads SET phone = COALESCE(phone, ?) WHERE id = ?', [phone, leadId]);
    if (pushName) run('UPDATE leads SET name = COALESCE(name, ?) WHERE id = ?', [pushName, leadId]);
  }

  run(
    `INSERT INTO wa_contacts (jid, phone, lead_id, push_name, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       phone = COALESCE(excluded.phone, wa_contacts.phone),
       lead_id = COALESCE(excluded.lead_id, wa_contacts.lead_id),
       push_name = COALESCE(excluded.push_name, wa_contacts.push_name),
       updated_at = excluded.updated_at`,
    [chatJid, phone, leadId, pushName || null, agora()]
  );
  if (leadId) run('UPDATE wa_messages SET lead_id = ? WHERE chat_jid = ? AND lead_id IS NULL', [leadId, chatJid]);
  return leadId;
}

function registrarContato(leadId, horario) {
  registrarContatoLead(leadId, horario);
  // Respondeu: o que o lead mandou antes conta como lido
  run('UPDATE wa_messages SET read_at = ? WHERE lead_id = ? AND from_me = 0 AND read_at IS NULL', [agora(), leadId]);
}

// Respondeu alguém que ainda não é lead: marca a conversa como lida
function marcarConversaRespondida(chatJid) {
  run('UPDATE wa_messages SET read_at = ? WHERE lead_id IS NULL AND chat_jid = ? AND from_me = 0 AND read_at IS NULL', [agora(), chatJid]);
}

function aplicarReacao(alvoId, quem, emoji) {
  if (!alvoId) return;
  const linha = get('SELECT id, reactions FROM wa_messages WHERE wa_id = ? ORDER BY id DESC LIMIT 1', [alvoId]);
  if (!linha) return;
  let reacoes = {};
  try { reacoes = JSON.parse(linha.reactions || '{}'); } catch { /* recomeça */ }
  if (emoji) reacoes[quem] = emoji;
  else delete reacoes[quem];
  run('UPDATE wa_messages SET reactions = ? WHERE id = ?', [Object.keys(reacoes).length ? JSON.stringify(reacoes) : null, linha.id]);
  avisar();
}

function marcarApagada(waId, horario = agora()) {
  if (!waId) return;
  const { changes } = run('UPDATE wa_messages SET deleted_at = ? WHERE wa_id = ? AND deleted_at IS NULL', [horario, waId]);
  if (changes) avisar();
}

function aplicarEdicao(lib, waId, novoConteudo, horario = agora()) {
  if (!waId || !novoConteudo) return;
  const conteudo = lib.normalizeMessageContent(novoConteudo);
  const tipo = conteudo && lib.getContentType(conteudo);
  if (!tipo) return;
  const info = analisarConteudo(conteudo, tipo);
  const linha = get('SELECT id, type FROM wa_messages WHERE wa_id = ? ORDER BY id DESC LIMIT 1', [waId]);
  if (!linha) return;
  if (linha.type === 'texto') run('UPDATE wa_messages SET body = ?, edited_at = ? WHERE id = ?', [info.texto, horario, linha.id]);
  else if (info.legenda !== null) run('UPDATE wa_messages SET legenda = ?, edited_at = ? WHERE id = ?', [info.legenda, horario, linha.id]);
  avisar();
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

const podeBaixarNaHora = (midia) => {
  const limite = config.whatsapp.midiaAutoMb * 1024 * 1024;
  return limite > 0 && (!midia.tamanho || midia.tamanho <= limite);
};

/**
 * Grava uma mensagem recebida (ou enviada pelo celular). modo: ao_vivo | offline | historico
 * Devolve o id da linha nova, ou null se não gravou nada.
 */
async function gravarMensagem(id, sock, lib, msg, modo) {
  const jid = msg?.key?.remoteJid;
  if (!chatIndividual(lib, jid) || !msg.message) return null;
  const conteudo = lib.normalizeMessageContent(msg.message);
  const tipoBruto = conteudo && lib.getContentType(conteudo);
  if (!tipoBruto || TIPOS_IGNORADOS.has(tipoBruto)) return null;
  const chatJid = lib.jidNormalizedUser(jid);
  const fromMe = Boolean(msg.key.fromMe);

  if (tipoBruto === 'reactionMessage') {
    aplicarReacao(conteudo.reactionMessage?.key?.id, fromMe ? 'eu' : 'contato', conteudo.reactionMessage?.text || '');
    return null;
  }
  if (tipoBruto === 'protocolMessage') {
    const p = conteudo.protocolMessage;
    const tipos = lib.proto.Message.ProtocolMessage.Type;
    const t = p?.type ?? 0;
    if (t === tipos.REVOKE && p.key?.id) marcarApagada(p.key.id, horarioDaMensagem(msg.messageTimestamp));
    if (t === tipos.MESSAGE_EDIT && p.key?.id) aplicarEdicao(lib, p.key.id, p.editedMessage, horarioDaMensagem(msg.messageTimestamp));
    return null;
  }

  // Já existe (ex.: eco de uma mensagem enviada pelo CRM): só completa o que faltar
  const existente = get('SELECT id, lead_id, chat_jid, raw FROM wa_messages WHERE wa_id = ? AND from_me = ?', [msg.key.id, fromMe]);
  if (existente) {
    tx(() => {
      if (!existente.raw) run('UPDATE wa_messages SET raw = ? WHERE id = ?', [serializar(lib, msg), existente.id]);
      // O WhatsApp pode usar outro identificador (LID) para a mesma conversa: liga ao mesmo lead
      if (existente.lead_id && existente.chat_jid !== chatJid) {
        run(
          `INSERT INTO wa_contacts (jid, lead_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET lead_id = COALESCE(wa_contacts.lead_id, excluded.lead_id)`,
          [chatJid, existente.lead_id, agora()]
        );
      }
    });
    return null;
  }

  const info = analisarConteudo(conteudo, tipoBruto);
  const telefone = await resolverTelefone(lib, sock, msg.key);
  const horario = horarioDaMensagem(msg.messageTimestamp);
  const citacao = dadosCitacao(lib, sock, info.contexto);
  const m = info.midia;
  let linhaId = null;

  tx(() => {
    const leadId = vincularLead({
      chatJid,
      phone: telefone,
      pushName: fromMe ? null : msg.pushName,
      criar: !fromMe && modo === 'ao_vivo' && config.whatsapp.criarLeadNovo,
    });
    const r = run(
      `INSERT OR IGNORE INTO wa_messages
         (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, legenda, timestamp, read_at, status, raw,
          media_mime, media_name, media_size, media_seconds, media_w, media_h, media_status, thumb, ptt,
          quoted_wa_id, quoted_body, quoted_from_me, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, leadId, chatJid, msg.key.id, fromMe, info.tipo, info.texto, info.legenda, horario,
        !fromMe && modo === 'historico' ? agora() : null,
        fromMe ? Math.max(2, Number(msg.status) || 2) : null,
        serializar(lib, msg),
        m?.mime ?? null, m?.nome ?? null, m?.tamanho ?? null, m?.segundos ?? null, m?.largura ?? null, m?.altura ?? null,
        m ? 'pendente' : null, m?.thumb ?? null, m?.ptt ?? false,
        citacao.id, citacao.texto, citacao.deMim, info.extra,
      ]
    );
    if (!r.changes) return;
    linhaId = Number(r.lastInsertRowid);
    if (fromMe) {
      if (leadId) registrarContato(leadId, horario);
      else marcarConversaRespondida(chatJid);
    }
  });

  if (linhaId && modo !== 'historico') {
    avisar({ chat: chatJid });
    if (m && podeBaixarNaHora(m)) agendarDownload(linhaId);
  }
  return linhaId;
}

async function aoReceberHistorico(id, sock, lib, { messages = [], contacts = [], lidPnMappings = [], syncType } = {}) {
  const e = estado(id);
  const sobDemanda = syncType === lib.proto.HistorySync.HistorySyncType.ON_DEMAND;
  if (lidPnMappings?.length) aplicarMapeamentos(lib, lidPnMappings);
  if (contacts?.length) aoAtualizarContatos(lib, contacts);
  if (!sobDemanda && config.whatsapp.historicoDias === 0) return;

  const limite = sobDemanda ? 0 : Date.now() - config.whatsapp.historicoDias * 86400000;
  const ordenadas = [...messages]
    .filter((m) => new Date(horarioDaMensagem(m.messageTimestamp)).getTime() >= limite)
    .sort((a, b) => horarioDaMensagem(a.messageTimestamp).localeCompare(horarioDaMensagem(b.messageTimestamp)));

  if (ordenadas.length) e.historico = { ...(e.historico || { importadas: 0 }), importando: true };
  let novas = 0;
  for (const msg of ordenadas) {
    try {
      if (await gravarMensagem(id, sock, lib, msg, 'historico')) novas++;
    } catch (err) {
      console.error(`[whatsapp #${id}] mensagem do histórico ignorada:`, err.message);
    }
  }
  // Nomes da agenda chegam junto: aplica de novo agora que as conversas existem
  if (contacts?.length && novas) aoAtualizarContatos(lib, contacts);
  e.historico = { importadas: (e.historico?.importadas || 0) + novas, importando: false, em: agora() };
  if (novas) {
    console.log(`[whatsapp #${id}] histórico${sobDemanda ? ' (pedido)' : ''}: ${novas} mensagens importadas`);
    avisar({ historico: true });
  }
}

function aoAtualizarMensagens(lib, lista) {
  let mudou = false;
  for (const { key, update } of lista || []) {
    if (!key?.id || !update) continue;
    if (typeof update.status === 'number' && key.fromMe) {
      const r = update.status === 0
        ? run('UPDATE wa_messages SET status = 0 WHERE wa_id = ? AND from_me = 1 AND COALESCE(status, 1) <= 1', [key.id])
        : run('UPDATE wa_messages SET status = ? WHERE wa_id = ? AND from_me = 1 AND COALESCE(status, 0) < ?', [update.status, key.id, update.status]);
      if (r.changes) mudou = true;
    }
    if (update.messageStubType === lib.WAMessageStubType.REVOKE) marcarApagada(key.id);
    const editada = update.message?.editedMessage?.message;
    if (editada?.protocolMessage?.editedMessage) aplicarEdicao(lib, key.id, editada.protocolMessage.editedMessage);
    else if (editada) aplicarEdicao(lib, key.id, editada);
  }
  if (mudou) avisar();
}

function aoAtualizarContatos(lib, lista) {
  const fotosMudaram = [];
  tx(() => {
    for (const c of lista || []) {
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
function aplicarMapeamentos(lib, pares) {
  tx(() => {
    for (const par of pares || []) {
      if (!par?.lid || !par?.pn) continue;
      const lid = lib.jidNormalizedUser(par.lid);
      const telefone = lib.jidDecode(par.pn)?.user;
      if (!telefone) continue;
      const { changes } = run('UPDATE wa_contacts SET phone = ? WHERE jid = ? AND phone IS NULL', [telefone, lid]);
      if (!changes) continue;
      const leadId = encontrarExistente({ phone: telefone });
      if (leadId) {
        run('UPDATE wa_contacts SET lead_id = ? WHERE jid = ? AND lead_id IS NULL', [leadId, lid]);
        run('UPDATE wa_messages SET lead_id = ? WHERE chat_jid = ? AND lead_id IS NULL', [leadId, lid]);
      }
    }
  });
}

// ---------------------------------------------------------------- mídia

const filaDownloads = [];
let baixandoAgora = 0;
const downloadsEmAndamento = new Map();

function agendarDownload(linhaId) {
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

function caminhoRelativo(instanciaId, horario, nomeBase, ext) {
  const mes = String(horario || agora()).slice(0, 7);
  return path.join('whatsapp', String(instanciaId || 0), mes, `${nomeBase}${ext}`);
}

// Baixa (se preciso) a mídia da mensagem e devolve a linha atualizada
export function baixarMidia(linhaId) {
  if (downloadsEmAndamento.has(linhaId)) return downloadsEmAndamento.get(linhaId);
  const tarefa = (async () => {
    const linha = get('SELECT id, instance_id, raw, media_path, media_mime, media_name, timestamp FROM wa_messages WHERE id = ?', [linhaId]);
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

// ---------------------------------------------------------------- envio

function numeroConectado(numeroId) {
  const e = socketConectado(numeroId);
  if (!e) throw new ErroHttp(409, 'Este número não está conectado');
  return e;
}

async function destinoDoLead(e, lib, leadId) {
  const lead = get('SELECT id, phone FROM leads WHERE id = ?', [leadId]);
  if (!lead) throw new ErroHttp(404, 'Lead não encontrado');
  const jid = get(
    "SELECT jid FROM wa_contacts WHERE lead_id = ? ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
    [leadId]
  )?.jid;
  if (jid) return jid;
  if (!lead.phone) throw new ErroHttp(400, 'O lead não tem telefone');
  const resultado = await e.sock.onWhatsApp(...variantesTelefone(lead.phone));
  const achado = (resultado || []).find((r) => r.exists);
  if (!achado) throw new ErroHttp(400, 'Este telefone não tem WhatsApp');
  return lib.jidNormalizedUser(achado.jid);
}

// Mensagem que está sendo respondida (precisa da mensagem original para o WhatsApp mostrar a citação)
function carregarCitada(lib, linhaId) {
  if (!linhaId) return null;
  const linha = get('SELECT id, wa_id, chat_jid, from_me, body, legenda, raw FROM wa_messages WHERE id = ?', [linhaId]);
  if (!linha) return null;
  let original = desserializar(lib, linha.raw);
  if (!original?.message) {
    original = { key: { remoteJid: linha.chat_jid, fromMe: Boolean(linha.from_me), id: linha.wa_id }, message: { conversation: linha.legenda || linha.body || '' } };
  }
  return { linha, original };
}

// Prepara o arquivo enviado pelo CRM no formato que o WhatsApp espera
async function prepararArquivo(arquivo, legenda) {
  const mime = String(arquivo.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const nome = arquivo.nome || 'arquivo';
  let caminho = arquivo.caminho;
  const temFf = Boolean(await ff.ffmpeg());

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
        image: { url: caminho }, mimetype: mime, caption: legenda || undefined,
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
          video: { url: caminho }, mimetype: 'video/mp4', caption: legenda || undefined,
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

const PREVIAS = { imagem: '📷 Foto', video: '🎥 Vídeo', documento: '📄', audio: '🎤 Mensagem de voz' };

/**
 * Envia texto e/ou arquivo.
 *  destino: { leadId } ou { jid }
 *  dados: { texto, arquivo: { caminho, mime, nome, modo: auto|documento|voz }, responderId }
 */
export async function enviar(numeroId, destino, { texto = null, arquivo = null, responderId = null }, userId) {
  const e = numeroConectado(numeroId);
  const lib = await carregarBaileys();
  const leadId = destino.leadId || null;
  const destinoJid = leadId ? await destinoDoLead(e, lib, leadId) : destino.jid;
  const citada = carregarCitada(lib, responderId);

  let preparo = null;
  if (arquivo) preparo = await prepararArquivo(arquivo, texto);
  const conteudo = preparo ? preparo.conteudo : { text: texto };

  const waId = lib.generateMessageIDV2(e.sock.user?.id);
  const horario = agora();
  let mediaRel = null;
  if (preparo) {
    mediaRel = caminhoRelativo(numeroId, horario, `e-${waId}`, extensaoDe(preparo.mime, preparo.nome));
    fs.mkdirSync(path.dirname(absoluto(mediaRel)), { recursive: true });
    fs.copyFileSync(preparo.arquivoFinal, absoluto(mediaRel));
  }

  const tipo = preparo ? preparo.tipo : 'texto';
  let previa = texto || '';
  if (preparo) {
    const base = tipo === 'documento' ? `📄 ${preparo.nome}` : tipo === 'audio' && !preparo.ptt ? '🎵 Áudio' : PREVIAS[tipo];
    previa = texto ? `${base}: ${texto}` : base;
  }
  const tamanho = mediaRel ? fs.statSync(absoluto(mediaRel)).size : null;

  let linhaId;
  tx(() => {
    run(
      `INSERT INTO wa_contacts (jid, phone, lead_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET lead_id = COALESCE(excluded.lead_id, wa_contacts.lead_id), updated_at = excluded.updated_at`,
      [destinoJid, lib.isPnUser(destinoJid) ? lib.jidDecode(destinoJid)?.user : null, leadId, horario]
    );
    const r = run(
      `INSERT INTO wa_messages
         (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, legenda, sent_by, timestamp, status,
          media_mime, media_path, media_name, media_size, media_seconds, media_w, media_h, media_status, ptt,
          quoted_wa_id, quoted_body, quoted_from_me)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroId, leadId, destinoJid, waId, tipo, previa, preparo ? texto : null, userId, horario,
        preparo?.mime ?? null, mediaRel, preparo?.tipo === 'documento' || preparo?.tipo === 'audio' ? preparo.nome ?? null : null, tamanho,
        preparo?.segundos ?? null, preparo?.largura ?? null, preparo?.altura ?? null, preparo ? 'ok' : null, preparo?.ptt ?? false,
        citada?.linha.wa_id ?? null, citada ? (citada.linha.legenda || citada.linha.body || '').slice(0, 300) : null,
        citada ? Boolean(citada.linha.from_me) : null,
      ]
    );
    linhaId = Number(r.lastInsertRowid);
    if (leadId) registrarContato(leadId, horario);
    else marcarConversaRespondida(destinoJid);
  });
  avisar({ chat: destinoJid });

  const desdeUltimo = Date.now() - e.ultimoEnvio;
  if (desdeUltimo < INTERVALO_MINIMO_ENVIO_MS) await esperar(INTERVALO_MINIMO_ENVIO_MS - desdeUltimo);
  e.ultimoEnvio = Date.now();

  try {
    const enviada = await e.sock.sendMessage(destinoJid, conteudo, { messageId: waId, ...(citada ? { quoted: citada.original } : {}) });
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
  } catch (err) {
    run('UPDATE wa_messages SET status = 0 WHERE id = ?', [linhaId]);
    avisar({ chat: destinoJid });
    throw new ErroHttp(502, `O WhatsApp não aceitou a mensagem: ${err.message}`);
  }
  avisar({ chat: destinoJid });
  return { id: linhaId, wa_id: waId };
}

// Compatibilidade com a versão anterior
export const enviarMensagem = (numeroId, leadId, texto, userId) => enviar(numeroId, { leadId }, { texto }, userId);
export const enviarParaContato = (numeroId, jid, texto, userId) => enviar(numeroId, { jid }, { texto }, userId);

function chaveDaMensagem(linha) {
  return { remoteJid: linha.chat_jid, fromMe: Boolean(linha.from_me), id: linha.wa_id };
}

export async function reagir(linhaId, emoji) {
  const linha = get('SELECT id, instance_id, chat_jid, wa_id, from_me FROM wa_messages WHERE id = ?', [linhaId]);
  if (!linha) throw new ErroHttp(404, 'Mensagem não encontrada');
  const e = algumConectado(linha.instance_id);
  if (!e) throw new ErroHttp(409, 'Nenhum número conectado');
  await e.sock.sendMessage(linha.chat_jid, { react: { text: emoji || '', key: chaveDaMensagem(linha) } });
  aplicarReacao(linha.wa_id, 'eu', emoji || '');
}

export async function apagarParaTodos(linhaId) {
  const linha = get('SELECT id, instance_id, chat_jid, wa_id, from_me, deleted_at FROM wa_messages WHERE id = ?', [linhaId]);
  if (!linha) throw new ErroHttp(404, 'Mensagem não encontrada');
  if (!linha.from_me) throw new ErroHttp(400, 'Só dá para apagar mensagens enviadas por vocês');
  const e = socketConectado(linha.instance_id);
  if (!e) throw new ErroHttp(409, 'O número que enviou esta mensagem não está conectado');
  await e.sock.sendMessage(linha.chat_jid, { delete: chaveDaMensagem(linha) });
  marcarApagada(linha.wa_id);
}

// Abrir a conversa no CRM: avisa o WhatsApp que as mensagens foram lidas (✓✓ azul para o contato)
export function confirmarLeitura(linhas) {
  if (!config.whatsapp.confirmarLeitura || !linhas?.length) return;
  const porNumero = new Map();
  for (const l of linhas) {
    if (!porNumero.has(l.instance_id)) porNumero.set(l.instance_id, []);
    porNumero.get(l.instance_id).push({ remoteJid: l.chat_jid, id: l.wa_id, fromMe: false });
  }
  for (const [numeroId, chaves] of porNumero) {
    const e = socketConectado(numeroId);
    if (e) e.sock.readMessages(chaves).catch(() => { /* não é essencial */ });
  }
}

// Pede ao celular mensagens mais antigas desta conversa (chegam pelo evento de histórico)
export async function buscarMaisAntigas(chatJids) {
  if (!chatJids?.length) throw new ErroHttp(400, 'Conversa sem mensagens');
  const linha = get(
    `SELECT instance_id, chat_jid, wa_id, from_me, timestamp FROM wa_messages
      WHERE chat_jid IN (${chatJids.map(() => '?').join(',')}) ORDER BY timestamp ASC, id ASC LIMIT 1`,
    chatJids
  );
  if (!linha) throw new ErroHttp(400, 'Conversa sem mensagens');
  const e = algumConectado(linha.instance_id);
  if (!e) throw new ErroHttp(409, 'Nenhum número conectado');
  await e.sock.fetchMessageHistory(50, chaveDaMensagem(linha), Math.floor(new Date(linha.timestamp).getTime() / 1000));
}

// ---------------------------------------------------------------- fotos de perfil
// A tela pergunta quais contatos têm foto (consultarFotos). O que ainda não se sabe entra numa fila
// que consulta o WhatsApp um contato por vez; quando chega foto nova, a tela é avisada (evento "fotos").

const FOTO_VALIDA_MS = 3 * 86400000;
const SEM_FOTO_VALIDO_MS = 86400000;
const filaFotos = [];
const naFila = new Set();
let consultandoFotos = false;

function fotoNoCache(jid) {
  const r = get('SELECT path, checked_at FROM wa_photos WHERE jid = ?', [jid]);
  if (!r) return { conhecida: false };
  const idade = Date.now() - new Date(r.checked_at).getTime();
  const existe = Boolean(r.path) && fs.existsSync(absoluto(r.path));
  return {
    conhecida: r.path ? existe && idade < FOTO_VALIDA_MS : idade < SEM_FOTO_VALIDO_MS,
    caminho: existe ? absoluto(r.path) : null,
    versao: existe ? crypto.createHash('sha1').update(r.checked_at).digest('hex').slice(0, 8) : null,
  };
}

async function consultarFotoNoWhatsApp(e, jid) {
  let url = null;
  try {
    url = await e.sock.profilePictureUrl(jid, 'preview', 8000);
  } catch (err) {
    const codigo = Number(err?.output?.statusCode || err?.data);
    // 401/403/404 = contato sem foto ou foto privada. Outros erros: tenta de novo mais tarde.
    if (![401, 403, 404].includes(codigo) && !/item-not-found|not-authorized|forbidden/i.test(err.message || '')) return false;
  }
  let rel = null;
  if (url) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return false;
      rel = path.join('whatsapp', 'fotos', `${crypto.createHash('sha1').update(jid).digest('hex').slice(0, 20)}.jpg`);
      fs.mkdirSync(path.dirname(absoluto(rel)), { recursive: true });
      fs.writeFileSync(absoluto(rel), Buffer.from(await resp.arrayBuffer()));
    } catch {
      return false;
    }
  }
  run(
    'INSERT INTO wa_photos (jid, path, checked_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET path = excluded.path, checked_at = excluded.checked_at',
    [jid, rel, agora()]
  );
  return Boolean(rel);
}

async function processarFilaFotos() {
  if (consultandoFotos) return;
  consultandoFotos = true;
  let novas = 0;
  try {
    while (filaFotos.length) {
      const e = algumConectado();
      if (!e) break;
      const jids = filaFotos.shift();
      naFila.delete(jids[0]);
      // Tenta cada identificador do contato até achar uma foto (no máximo 2 consultas)
      for (const jid of jids.slice(0, 2)) {
        if (fotoNoCache(jid).conhecida) continue;
        if (await consultarFotoNoWhatsApp(e, jid)) { novas++; break; }
        await esperar(400);
      }
      if (novas && (novas % 5 === 0 || !filaFotos.length)) emitir('fotos', {});
      // Ritmo de uma pessoa abrindo conversas, para não chamar a atenção do WhatsApp
      await esperar(400);
    }
  } finally {
    consultandoFotos = false;
    if (novas) emitir('fotos', {});
  }
}

/**
 * Recebe uma lista de "contatos" (cada um = lista de identificadores) e devolve, para cada um,
 * a versão da foto (texto) ou null. Contatos ainda não consultados entram na fila.
 */
export function consultarFotos(contatos) {
  const conectado = Boolean(algumConectado());
  const resultado = contatos.map((jids) => {
    let desconhecida = false;
    for (const jid of jids) {
      const c = fotoNoCache(jid);
      if (c.caminho && (c.conhecida || !conectado)) return c.versao;
      if (!c.conhecida) desconhecida = true;
    }
    // A foto antiga serve enquanto a nova não chega
    const antiga = jids.map(fotoNoCache).find((c) => c.caminho);
    if (desconhecida && conectado && jids.length && !naFila.has(jids[0])) {
      naFila.add(jids[0]);
      filaFotos.push(jids);
    }
    return antiga?.versao || null;
  });
  if (filaFotos.length) processarFilaFotos().catch(() => {});
  return resultado;
}

// Arquivo da foto já baixada (sem consultar o WhatsApp)
export function arquivoDaFoto(jids) {
  for (const jid of jids) {
    const c = fotoNoCache(jid);
    if (c.caminho) return c.caminho;
  }
  return null;
}

// ---------------------------------------------------------------- números

export function criarNumero(nome) {
  const { lastInsertRowid } = run('INSERT INTO wa_instances (name) VALUES (?)', [nome]);
  return Number(lastInsertRowid);
}

export async function desconectar(id) {
  const e = estado(id);
  e.parando = true;
  clearTimeout(e.timer);
  const sock = e.sock;
  e.sock = null;
  if (sock) {
    try { await sock.logout(); } catch { /* já desconectado */ }
    try { sock.end?.(undefined); } catch { /* ignora */ }
  }
  apagarSessao(id);
  e.status = 'desconectado';
  e.qr = null;
  e.erro = null;
  e.historico = null;
  avisar({ numeros: true });
}

export async function removerNumero(id) {
  await desconectar(id);
  run('DELETE FROM wa_instances WHERE id = ?', [id]);
  instancias.delete(id);
}

export async function iniciarTodos() {
  fs.mkdirSync(pastaMidia(), { recursive: true });
  ff.ffmpeg().catch(() => {});
  for (const { id } of all('SELECT id FROM wa_instances')) {
    if (temSessao(id)) await conectar(id).catch((err) => console.error(`[whatsapp #${id}] não conectou:`, err.message));
  }
}

// Desliga sem encerrar as sessões (usado ao parar o CRM)
export function pararTodos() {
  for (const e of instancias.values()) {
    e.parando = true;
    clearTimeout(e.timer);
    try { e.sock?.end?.(undefined); } catch { /* ignora */ }
    e.sock = null;
  }
}

export const numeroExiste = (id) => Boolean(get('SELECT 1 FROM wa_instances WHERE id = ?', [id]));
