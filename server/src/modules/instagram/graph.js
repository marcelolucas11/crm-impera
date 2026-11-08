// Cliente da API da Meta (Graph API) com fetch, sem biblioteca externa.
// Assina cada chamada com appsecret_proof quando o segredo do app está configurado (mais seguro e exigido
// por apps com "Exigir chave secreta do app" ligado). Erros da Meta viram mensagens em português.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { GRAPH_URL, segredoApp, versaoApi } from './config.js';

export class ErroMeta extends Error {
  constructor(mensagem, { status = 422, codigo = null, subcodigo = null, tipo = null, temporario = false, limite = false } = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.subcodigo = subcodigo;
    this.tipo = tipo;
    this.temporario = temporario;
    this.limite = limite;
  }
}

// Códigos de limite de chamadas da Meta (aplicativo, usuário, página, Instagram)
const LIMITE = new Set([4, 17, 32, 613, 80001, 80002, 80004, 80005, 80006, 80008, 80014]);

/** Erro da Meta → ErroMeta com o que fazer, em português */
export function traduzirErroMeta(httpStatus, erro = {}) {
  const codigo = Number(erro.code) || null;
  const sub = Number(erro.error_subcode) || null;
  const msg = String(erro.message || '').trim();
  const detalhe = msg ? ` (Meta: ${msg})` : '';
  if (codigo === 190) {
    return new ErroMeta(`O acesso à Meta expirou ou foi revogado. Conecte de novo em Equipe e integrações → Instagram.${detalhe}`, { status: 400, codigo, subcodigo: sub, tipo: 'token' });
  }
  if (LIMITE.has(codigo)) {
    return new ErroMeta(`A Meta pediu uma pausa: limite de chamadas atingido. O CRM tenta de novo sozinho mais tarde.${detalhe}`, { status: 429, codigo, subcodigo: sub, tipo: 'limite', temporario: true, limite: true });
  }
  if (codigo === 10 || (codigo >= 200 && codigo < 300)) {
    if (/not enough viewers|insufficient/i.test(msg)) return new ErroMeta(`Poucas pessoas viram para a Meta mostrar este número.${detalhe}`, { status: 422, codigo, subcodigo: sub, tipo: 'poucos_dados' });
    return new ErroMeta(`O app da Meta não tem permissão para isso. Confira as permissões ao conectar (e se o app está no modo Live para webhooks).${detalhe}`, { status: 403, codigo, subcodigo: sub, tipo: 'permissao' });
  }
  if (codigo === 100 && /does not exist|nonexisting|unsupported get request/i.test(msg)) {
    return new ErroMeta(`A Meta não encontrou este item (pode ter sido apagado).${detalhe}`, { status: 404, codigo, subcodigo: sub, tipo: 'nao_existe' });
  }
  if (codigo === 100) return new ErroMeta(`A Meta recusou o pedido.${detalhe}`, { status: 422, codigo, subcodigo: sub, tipo: 'parametro' });
  if (codigo === 551 || sub === 2534022 || /outside of allowed window|janela/i.test(msg)) {
    return new ErroMeta('Passou de 24 horas desde a última mensagem da pessoa: o Instagram só deixa responder depois que ela escrever de novo.', { status: 409, codigo, subcodigo: sub, tipo: 'janela' });
  }
  if (codigo === 1 || codigo === 2 || httpStatus >= 500) {
    return new ErroMeta(`A Meta está instável agora; o CRM tenta de novo.${detalhe}`, { status: 422, codigo, subcodigo: sub, tipo: 'instavel', temporario: true });
  }
  return new ErroMeta(`A Meta respondeu com erro ${codigo || httpStatus}.${detalhe}`, { status: 422, codigo, subcodigo: sub });
}

let chamadaFalsa = null;
/** Testes: troca a chamada real por fn({ metodo, caminho, params, corpo, token }) => resposta JSON (ou lança) */
export function definirChamadaFalsaMeta(fn) { chamadaFalsa = fn; }

export const provaDoSegredo = (token, segredo = segredoApp()) => (segredo && token ? crypto.createHmac('sha256', segredo).update(token).digest('hex') : null);

function montarUrl(caminho, params) {
  const base = /^https?:\/\//.test(caminho) ? caminho : `${GRAPH_URL}/${versaoApi()}/${String(caminho).replace(/^\/+/, '')}`;
  const url = new URL(base);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return url;
}

/**
 * Chama a Graph API. caminho: "me/accounts" ou URL completa (paginação). params vão na URL; corpo (POST) vai em JSON.
 * Devolve o JSON da resposta. Lança ErroMeta.
 */
export async function chamar(caminho, { metodo = 'GET', token = null, params = {}, corpo = null, tempoMs = 30000, provar = true } = {}) {
  if (chamadaFalsa) {
    const r = await chamadaFalsa({ metodo, caminho, params, corpo, token });
    if (r && r.error) throw traduzirErroMeta(400, r.error);
    return r;
  }
  const extra = {};
  if (token) extra.access_token = token;
  const prova = provar ? provaDoSegredo(token) : null;
  if (prova && !/^https?:\/\//.test(caminho)) extra.appsecret_proof = prova;
  const url = montarUrl(caminho, { ...params, ...extra });
  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: corpo ? { 'content-type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(tempoMs),
    });
  } catch (err) {
    const motivo = err?.name === 'TimeoutError' ? 'a Meta demorou demais para responder' : err.message;
    throw new ErroMeta(`O servidor do CRM não conseguiu falar com a Meta (${motivo}).`, { status: 422, temporario: true, tipo: 'rede' });
  }
  let dados = null;
  try { dados = await resposta.json(); } catch { /* sem corpo */ }
  if (!resposta.ok || dados?.error) throw traduzirErroMeta(resposta.status, dados?.error || {});
  return dados ?? {};
}

/** Busca todas as páginas de uma lista (data + paging.next), até `max` itens */
export async function paginar(caminho, opcoes = {}, { max = 1000, parar = null } = {}) {
  const itens = [];
  let r = await chamar(caminho, opcoes);
  for (;;) {
    for (const item of r?.data || []) {
      itens.push(item);
      if (itens.length >= max) return itens;
      if (parar?.(item)) return itens;
    }
    const proxima = r?.paging?.next;
    if (!proxima || !(r?.data || []).length) return itens;
    r = await chamar(proxima, { token: null, provar: false });
  }
}

let baixarFalso = null;
/** Testes: troca o download por fn(url) => { buffer, mime } */
export function definirDownloadFalso(fn) { baixarFalso = fn; }

const EXTENSOES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'application/pdf': '.pdf',
};
export const extensaoDoMime = (mime) => EXTENSOES[String(mime || '').split(';')[0].toLowerCase()] || '';

/**
 * Baixa um arquivo da CDN da Meta (links expiram) para `destinoSemExtensao` + extensão do tipo.
 * Devolve { caminho, mime, tamanho }. Para no limite de tamanho.
 */
export async function baixarArquivo(url, destinoSemExtensao, { maxBytes = 30 * 1024 * 1024, tempoMs = 60000 } = {}) {
  fs.mkdirSync(path.dirname(destinoSemExtensao), { recursive: true });
  if (baixarFalso) {
    const { buffer, mime } = await baixarFalso(url);
    const caminho = destinoSemExtensao + extensaoDoMime(mime);
    fs.writeFileSync(caminho, buffer);
    return { caminho, mime, tamanho: buffer.length };
  }
  const resposta = await fetch(url, { signal: AbortSignal.timeout(tempoMs), redirect: 'follow' });
  if (!resposta.ok || !resposta.body) throw new ErroMeta(`O arquivo não está mais disponível na Meta (${resposta.status})`, { status: 404, tipo: 'nao_existe' });
  const mime = String(resposta.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  const declarado = Number(resposta.headers.get('content-length') || 0);
  if (declarado > maxBytes) throw new ErroMeta('Arquivo grande demais para guardar', { status: 413 });
  let ext = extensaoDoMime(mime);
  if (!ext) {
    try { ext = (path.extname(new URL(url).pathname) || '').slice(0, 6).replace(/[^.\w]/g, ''); } catch { ext = ''; }
  }
  const caminho = destinoSemExtensao + ext;
  let total = 0;
  const limite = new Transform({
    transform(pedaco, _e, cb) {
      total += pedaco.length;
      if (total > maxBytes) return cb(new ErroMeta('Arquivo grande demais para guardar', { status: 413 }));
      cb(null, pedaco);
    },
  });
  try {
    await pipeline(Readable.fromWeb(resposta.body), limite, fs.createWriteStream(caminho));
  } catch (err) {
    fs.rmSync(caminho, { force: true });
    throw err;
  }
  return { caminho, mime, tamanho: total };
}
