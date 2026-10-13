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

let biblioteca = null;
export async function carregarBaileys() {
  if (!biblioteca) biblioteca = await import('baileys');
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
