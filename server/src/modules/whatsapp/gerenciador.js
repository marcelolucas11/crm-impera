// Gerencia os números de WhatsApp conectados por QR code (biblioteca Baileys).
// Cada número tem a sua sessão em ../dados/whatsapp/numero-<id>/ — nunca vai para o GitHub.
//
// Atenção: conexão por QR code não é oficial. O WhatsApp pode banir números que mandam
// mensagens em massa ou de forma automatizada. Este módulo só envia mensagens digitadas
// por uma pessoa no CRM, com um intervalo mínimo entre envios.
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { criarLead, encontrarExistente } from '../leads/service.js';
import { variantesTelefone, ErroHttp } from '../../util.js';
import { TIPOS_IGNORADOS, extrairTexto, horarioDaMensagem } from './conteudo.js';

const INTERVALO_MINIMO_ENVIO_MS = 1500;
const instancias = new Map();
const enviadasRecentes = new Map();

let biblioteca = null;
async function carregarBaileys() {
  if (!biblioteca) biblioteca = await import('baileys');
  return biblioteca;
}

const pastaDe = (id) => path.join(config.whatsapp.pastaSessoes, `numero-${id}`);
const temSessao = (id) => fs.existsSync(path.join(pastaDe(id), 'creds.json'));
const apagarSessao = (id) => fs.rmSync(pastaDe(id), { recursive: true, force: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function estado(id) {
  if (!instancias.has(id)) {
    instancias.set(id, { id, status: 'desconectado', qr: null, sock: null, erro: null, tentativas: 0, parando: false, timer: null, ultimoEnvio: 0 });
  }
  return instancias.get(id);
}

function guardarEnviada(waId, mensagem) {
  if (!waId || !mensagem) return;
  enviadasRecentes.set(waId, mensagem);
  if (enviadasRecentes.size > 1000) enviadasRecentes.delete(enviadasRecentes.keys().next().value);
}

// Cria o socket do Baileys. Substituível nos testes.
let fabricaSocket = async (id, lib) => {
  const pino = (await import('pino')).default;
  const logger = pino({ level: process.env.WHATSAPP_LOG || 'silent' });
  const { state, saveCreds } = await lib.useMultiFileAuthState(pastaDe(id));
  const criar = lib.makeWASocket || lib.default;
  const sock = criar({
    auth: { creds: state.creds, keys: lib.makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: lib.Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => enviadasRecentes.get(key.id),
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
    return { ...n, status: e.status, qr: e.qr, erro: e.erro };
  });
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

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => aoAtualizarConexao(id, sock, u, lib));
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const m of messages || []) {
      aoReceberMensagem(id, sock, m, type, lib).catch((err) => console.error(`[whatsapp #${id}] erro ao gravar mensagem:`, err.message));
    }
  });
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
  }

  if (u.connection === 'close') {
    const codigo = u.lastDisconnect?.error?.output?.statusCode;
    const motivos = lib.DisconnectReason;
    const aguardavaQr = e.status === 'aguardando_qr';
    e.sock = null;
    e.qr = null;

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
  return null;
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
  run(
    `UPDATE leads SET last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END,
                      updated_at = ? WHERE id = ?`,
    [horario, horario, agora(), leadId]
  );
  // Respondeu: o que o lead mandou antes conta como lido
  run('UPDATE wa_messages SET read_at = ? WHERE lead_id = ? AND from_me = 0 AND read_at IS NULL', [agora(), leadId]);
}

async function aoReceberMensagem(id, sock, msg, tipoUpsert, lib) {
  const jid = msg?.key?.remoteJid;
  if (!jid || lib.isJidGroup(jid) || lib.isJidBroadcast(jid) || lib.isJidStatusBroadcast(jid) || lib.isJidNewsletter(jid)) return;
  if (!lib.isPnUser(jid) && !lib.isLidUser(jid)) return;

  const conteudo = lib.normalizeMessageContent(msg.message);
  if (!conteudo) return;
  const tipoBruto = lib.getContentType(conteudo);
  if (!tipoBruto || TIPOS_IGNORADOS.has(tipoBruto)) return;

  const { tipo, texto } = extrairTexto(conteudo, tipoBruto);
  const fromMe = Boolean(msg.key.fromMe);
  const chatJid = lib.jidNormalizedUser(jid);
  const telefone = await resolverTelefone(lib, sock, msg.key);
  const horario = horarioDaMensagem(msg.messageTimestamp);

  tx(() => {
    const leadId = vincularLead({
      chatJid,
      phone: telefone,
      pushName: fromMe ? null : msg.pushName,
      criar: !fromMe && tipoUpsert === 'notify' && config.whatsapp.criarLeadNovo,
    });
    const { changes } = run(
      `INSERT OR IGNORE INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, leadId, chatJid, msg.key.id, fromMe, tipo, texto, horario]
    );
    if (changes && leadId && fromMe) registrarContato(leadId, horario);
  });
}

export async function enviarMensagem(numeroId, leadId, texto, userId) {
  const e = estado(numeroId);
  if (e.status !== 'conectado' || !e.sock) throw new ErroHttp(409, 'Este número não está conectado');
  const lib = await carregarBaileys();
  const lead = get('SELECT id, phone FROM leads WHERE id = ?', [leadId]);
  if (!lead) throw new ErroHttp(404, 'Lead não encontrado');

  let destino = get('SELECT jid FROM wa_contacts WHERE lead_id = ? ORDER BY updated_at DESC LIMIT 1', [leadId])?.jid;
  if (!destino) {
    if (!lead.phone) throw new ErroHttp(400, 'O lead não tem telefone');
    const resultado = await e.sock.onWhatsApp(...variantesTelefone(lead.phone));
    const achado = (resultado || []).find((r) => r.exists);
    if (!achado) throw new ErroHttp(400, 'Este telefone não tem WhatsApp');
    destino = lib.jidNormalizedUser(achado.jid);
  }

  const desdeUltimo = Date.now() - e.ultimoEnvio;
  if (desdeUltimo < INTERVALO_MINIMO_ENVIO_MS) await esperar(INTERVALO_MINIMO_ENVIO_MS - desdeUltimo);
  e.ultimoEnvio = Date.now();

  const enviada = await e.sock.sendMessage(destino, { text: texto });
  const waId = enviada?.key?.id || `local-${Date.now()}`;
  guardarEnviada(waId, enviada?.message);
  const horario = agora();

  tx(() => {
    run(
      `INSERT INTO wa_contacts (jid, phone, lead_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET lead_id = excluded.lead_id, updated_at = excluded.updated_at`,
      [destino, lib.isPnUser(destino) ? lib.jidDecode(destino)?.user : null, leadId, horario]
    );
    run(
      `INSERT OR IGNORE INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, sent_by, timestamp)
       VALUES (?, ?, ?, ?, 1, 'texto', ?, ?, ?)`,
      [numeroId, leadId, destino, waId, texto, userId, horario]
    );
    // Se o WhatsApp já devolveu a mensagem antes (evento), completa quem enviou e o lead
    run('UPDATE wa_messages SET lead_id = ?, sent_by = COALESCE(sent_by, ?) WHERE wa_id = ? AND from_me = 1', [leadId, userId, waId]);
    // ...e liga ao lead o outro identificador (LID) que o WhatsApp usou para essa conversa
    run(
      `UPDATE wa_contacts SET lead_id = ? WHERE lead_id IS NULL
         AND jid IN (SELECT chat_jid FROM wa_messages WHERE wa_id = ? AND from_me = 1)`,
      [leadId, waId]
    );
    registrarContato(leadId, horario);
  });
  return { wa_id: waId };
}

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
}

export async function removerNumero(id) {
  await desconectar(id);
  run('DELETE FROM wa_instances WHERE id = ?', [id]);
  instancias.delete(id);
}

export async function iniciarTodos() {
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
