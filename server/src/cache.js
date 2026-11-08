// Cache curto para as listas que as telas pedem o tempo todo (kanban, caixa de entrada do WhatsApp, contadores do topo).
// Várias abas abertas e as atualizações automáticas pediam o mesmo cálculo pesado várias vezes por minuto; agora o
// resultado é guardado e reaproveitado enquanto nenhuma das tabelas de que ele depende mudar (db.geracao) e até um
// prazo curto (para o que depende do relógio, como "follow-up atrasado"). Mudou algo no banco → recalcula na hora.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { geracao } from './db.js';

const itens = new Map(); // chave → { geracao, ate, valor, json, etag, gzip }
const MAX_ITENS = 300;

function guardar(chave, item) {
  itens.delete(chave);
  itens.set(chave, item);
  if (itens.size > MAX_ITENS) itens.delete(itens.keys().next().value);
  return item;
}

function obter(chave, tabelas) {
  const item = itens.get(chave);
  if (!item) return null;
  if (item.ate < Date.now() || item.geracao !== geracao(tabelas)) {
    itens.delete(chave);
    return null;
  }
  return item;
}

/**
 * Devolve o valor guardado ou calcula de novo. O valor devolvido é compartilhado: quem chama não pode alterá-lo.
 *  tabelas: tabelas de que o resultado depende · ttlMs: validade máxima mesmo sem mudança no banco
 */
export function memoizar(chave, tabelas, ttlMs, calcular) {
  const item = obter(chave, tabelas);
  if (item && 'valor' in item) return item.valor;
  const g = geracao(tabelas);
  const valor = calcular();
  guardar(chave, { geracao: g, ate: Date.now() + ttlMs, valor });
  return valor;
}

/**
 * Responde um JSON pelo cache: guarda o texto já pronto (e a versão compactada), devolve 304 quando a tela já tem a
 * mesma versão e manda compactado quando o navegador aceita. Menos trabalho para o servidor e menos dados na rede.
 */
export function responderJson(req, res, { chave, tabelas, ttlMs = 15000 }, calcular) {
  let item = obter(chave, tabelas);
  if (!item || !item.json) {
    const g = geracao(tabelas);
    const json = JSON.stringify(calcular());
    item = guardar(chave, {
      geracao: g,
      ate: Date.now() + ttlMs,
      json,
      etag: `W/"${crypto.createHash('sha1').update(json).digest('base64url').slice(0, 27)}"`,
      gzip: null,
    });
  }
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('ETag', item.etag);
  const pedida = String(req.headers['if-none-match'] || '');
  if (pedida && pedida.split(/\s*,\s*/).includes(item.etag)) return res.status(304).end();
  res.type('application/json; charset=utf-8');
  if (item.json.length > 4096 && /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) {
    item.gzip ||= zlib.gzipSync(item.json, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', item.gzip.length);
    return res.end(item.gzip);
  }
  res.setHeader('Content-Length', Buffer.byteLength(item.json));
  return res.end(item.json);
}

/** Esquece tudo (testes e mudanças que o banco não registra, como configurações em memória) */
export function limparCache() {
  itens.clear();
}
