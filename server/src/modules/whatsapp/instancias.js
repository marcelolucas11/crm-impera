// Estado em memória dos números conectados (um socket do Baileys por número) e utilidades comuns
// aos arquivos do módulo de WhatsApp (biblioteca, logger, avisos para a tela).
import { emitir } from '../../tempoReal.js';

export const instancias = new Map();

export function estado(id) {
  if (!instancias.has(id)) {
    instancias.set(id, {
      id, status: 'desconectado', qr: null, sock: null, erro: null, tentativas: 0, parando: false, timer: null, ultimoEnvio: 0,
      // Importação do histórico: { fase, importadas, conversas, total, feitas, progresso, ate, em, erro }
      historico: null,
      logger: null,
    });
  }
  return instancias.get(id);
}

export function socketConectado(id) {
  const e = id ? instancias.get(Number(id)) : null;
  if (e?.status === 'conectado' && e.sock) return e;
  return null;
}

// Um número conectado (o pedido, se estiver conectado; senão qualquer um)
export function algumConectado(preferido) {
  return socketConectado(preferido) || [...instancias.values()].find((e) => e.status === 'conectado' && e.sock) || null;
}

export const avisar = (dados = {}) => emitir('whatsapp', dados);

// Desde ~30/06/2026 o WhatsApp recusa a conexão (fecha com 428 "Connection Terminated", antes do
// QR code) de quem se apresenta como WhatsApp Desktop antigo: Mac (DARWIN) ou Windows Electron (WIN32).
// O WhatsApp Desktop atual se apresenta como WIN_HYBRID, e só um "Desktop" recebe o histórico completo.
// O Baileys 7.0.0-rc14 ainda manda WIN32 para Windows; a correção (#2741) não saiu no npm. Até sair,
// troca WIN32 → WIN_HYBRID no pacote de apresentação. Quando o Baileys corrigir, isto não muda nada.
export function corrigirPlataforma(lib) {
  const cp = lib?.proto?.ClientPayload;
  const plataformas = cp?.WebInfo?.WebSubPlatform;
  if (!cp || !plataformas || cp.fromObject.__crmImpera) return;
  const original = cp.fromObject.bind(cp);
  const corrigido = (obj) => {
    const payload = original(obj);
    if (payload?.webInfo?.webSubPlatform === plataformas.WIN32) payload.webInfo.webSubPlatform = plataformas.WIN_HYBRID;
    return payload;
  };
  corrigido.__crmImpera = true;
  cp.fromObject = corrigido;
}

let biblioteca = null;
export async function carregarBaileys() {
  if (!biblioteca) {
    biblioteca = await import('baileys');
    corrigirPlataforma(biblioteca);
  }
  return biblioteca;
}
export const bibliotecaCarregada = () => biblioteca;
export function definirBiblioteca(lib) {
  biblioteca = lib;
}

let loggerBase = null;
export async function logger() {
  if (!loggerBase) loggerBase = (await import('pino')).default({ level: process.env.WHATSAPP_LOG || 'silent' });
  return loggerBase;
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// Devolve o controle para o Node (o servidor continua respondendo durante tarefas longas)
export const respirar = () => new Promise((r) => setImmediate(r));
