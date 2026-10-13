// Gerencia os números de WhatsApp conectados por QR code (biblioteca Baileys — a mesma usada pela Evolution API).
// Cada número tem a sua sessão em ../dados/whatsapp/numero-<id>/ — nunca vai para o GitHub.
// Mídias, figurinhas e fotos de perfil ficam em ../arquivos/whatsapp/.
//
// Organização do módulo:
//   gerenciador.js  conexão (QR code, reconexão), eventos do WhatsApp, fotos de perfil, números
//   recebimento.js  mensagens recebidas → banco (ao vivo e em lote)
//   historico.js    importação do histórico (90 dias) e complemento por conversa
//   ligacao.js      conversa ↔ lead (telefone, 9º dígito, LID)
//   envio.js        tudo que o CRM manda (texto, mídia, figurinha, enquete...) e ações nas mensagens
//   chamadas.js     chamadas recebidas, recusar, link de chamada
//   figurinhas.js   figurinhas favoritas (celular e CRM) e recentes
//   presenca.js     online / visto por último / digitando
//   conversas.js    caixa de entrada (lista, filtros, estado das conversas)
//
// Atenção: conexão por QR code não é oficial. O WhatsApp pode banir números que mandam
// mensagens em massa ou de forma automatizada. Este módulo só envia o que uma pessoa faz no CRM,
// com um intervalo mínimo entre envios.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { emitir } from '../../tempoReal.js';
import {
  instancias, estado, socketConectado, algumConectado, avisar, carregarBaileys, definirBiblioteca, esperar,
} from './instancias.js';
import {
  gravarMensagem, aoAtualizarMensagens, aoReceberRecibos, aoAtualizarContatos, aplicarMapeamentos, aplicarEstadoChats,
  completarNomesDosGrupos, mensagemOriginal,
} from './recebimento.js';
import { aoReceberHistorico, aoConectar, agendarReligar, progressoDe } from './historico.js';
import { aoReceberChamadas } from './chamadas.js';
import { aoAtualizarPresenca } from './presenca.js';
import { loggerComFigurinhas } from './figurinhas.js';
import { enviadaRecente } from './envio.js';
import { religarTudo } from './ligacao.js';
import * as ff from './ffmpeg.js';

const pastaMidia = () => path.join(config.filesDir, 'whatsapp');
const absoluto = (rel) => path.join(config.filesDir, rel);
const pastaDe = (id) => path.join(config.whatsapp.pastaSessoes, `numero-${id}`);
const temSessao = (id) => fs.existsSync(path.join(pastaDe(id), 'creds.json'));
const apagarSessao = (id) => fs.rmSync(pastaDe(id), { recursive: true, force: true });

// Cria o socket do Baileys. Substituível nos testes.
let fabricaSocket = async (id, lib) => {
  const log = await loggerComFigurinhas(id);
  const { state, saveCreds } = await lib.useMultiFileAuthState(pastaDe(id));
  const criar = lib.makeWASocket || lib.default;
  const historico = config.whatsapp.historicoDias > 0;
  const sock = criar({
    auth: { creds: state.creds, keys: lib.makeCacheableSignalKeyStore(state.keys, log) },
    logger: log,
    // "Desktop" + syncFullHistory = o celular manda o histórico completo, como para o WhatsApp do computador
    browser: lib.Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: historico,
    // Processa todos os tipos de lote do histórico (INITIAL_BOOTSTRAP, RECENT, FULL, ON_DEMAND...)
    shouldSyncHistoryMessage: () => historico,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => enviadaRecente(key.id) || mensagemOriginal(lib, key.id)?.message || undefined,
  });
  return { sock, saveCreds };
};
export function definirFabricaSocket(fn, libFalsa) {
  fabricaSocket = fn;
  if (libFalsa) definirBiblioteca(libFalsa);
}

export function listarNumeros() {
  return all('SELECT id, name, phone, created_at FROM wa_instances ORDER BY id').map((n) => {
    const e = estado(n.id);
    return { ...n, status: e.status, qr: e.qr, erro: e.erro, historico: progressoDe(n.id) };
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
  e.mostrouQr = false;
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
  // Lotes do histórico são processados um de cada vez, na ordem em que chegam
  let filaHistorico = Promise.resolve();
  sock.ev.on('messaging-history.set', (dados) => {
    filaHistorico = filaHistorico
      .then(() => aoReceberHistorico(id, sock, lib, dados))
      .catch((err) => console.error(`[whatsapp #${id}] erro no histórico:`, err.message));
  });
  sock.ev.on('messages.update', protegido('atualização', (lista) => aoAtualizarMensagens(lib, lista)));
  sock.ev.on('message-receipt.update', protegido('recibos', (lista) => aoReceberRecibos(lista)));
  sock.ev.on('contacts.upsert', protegido('contatos', (lista) => aoAtualizarContatos(lib, lista)));
  sock.ev.on('contacts.update', protegido('contatos', (lista) => aoAtualizarContatos(lib, lista)));
  sock.ev.on('chats.upsert', protegido('conversas', (lista) => aplicarEstadoChats(lib, id, lista)));
  sock.ev.on('chats.update', protegido('conversas', (lista) => aplicarEstadoChats(lib, id, lista)));
  sock.ev.on('groups.upsert', protegido('grupos', (lista) => aoAtualizarContatos(lib, lista)));
  sock.ev.on('groups.update', protegido('grupos', (lista) => aoAtualizarContatos(lib, lista)));
  sock.ev.on('lid-mapping.update', protegido('lid', (m) => aplicarMapeamentos(lib, Array.isArray(m) ? m : [m])));
  sock.ev.on('presence.update', protegido('presença', (p) => aoAtualizarPresenca(lib, p)));
  sock.ev.on('call', protegido('chamada', (lista) => aoReceberChamadas(id, sock, lib, lista)));
}

function aoAtualizarConexao(id, sock, u, lib) {
  const e = estado(id);
  if (e.sock !== sock) return; // evento de um socket antigo

  if (u.qr) {
    e.qr = u.qr;
    e.status = 'aguardando_qr';
    e.mostrouQr = true;
  }

  if (u.connection === 'open') {
    e.status = 'conectado';
    e.qr = null;
    e.erro = null;
    e.tentativas = 0;
    const telefone = lib.jidDecode(sock.user?.id)?.user;
    if (telefone) run('UPDATE wa_instances SET phone = ? WHERE id = ?', [telefone, id]);
    console.log(`[whatsapp #${id}] conectado${telefone ? ` (${telefone})` : ''}`);
    // Conexão nova pelo QR code: depois que o celular mandar o histórico, o CRM completa os 90 dias
    aoConectar(id, { conexaoNova: Boolean(e.mostrouQr || e.conexaoNova) });
    e.conexaoNova = false;
    setTimeout(() => { if (socketConectado(id)) completarNomesDosGrupos(lib, sock).catch(() => {}); }, 20000).unref?.();
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
    // Depois de ler o QR code, o WhatsApp pede um reinício: a próxima conexão ainda é "nova"
    if (codigo === motivos.restartRequired && e.mostrouQr) e.conexaoNova = true;

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
  // Na subida: liga ao lead toda conversa que ainda não estava ligada (barato e idempotente)
  try {
    const n = religarTudo();
    if (n) console.log(`[whatsapp] ${n} conversa(s) ligada(s) a leads`);
  } catch (err) {
    console.error('[whatsapp] erro ao religar conversas e leads:', err.message);
  }
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
export { agendarReligar, socketConectado };
