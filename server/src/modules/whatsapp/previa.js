// Prévia de link (título, descrição e miniatura) ao enviar uma mensagem com link, como o WhatsApp Web faz.
// Implementação própria e pequena (sem dependência nova): só http/https, nunca endereços internos
// (localhost, rede local, IPv6 local) — o IP é conferido na própria conexão, então um DNS que muda
// de resposta não engana a checagem. Limite de tempo e de tamanho em tudo.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ff from './ffmpeg.js';

const TEMPO_MS = 4000;
const MAX_HTML = 600 * 1024;
const MAX_IMAGEM = 1500 * 1024;

export function ipInterno(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return ipInterno(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') ||
    v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

// Resolve o nome e recusa endereços internos (usado pela própria conexão)
function lookupSeguro(host, opcoes, cb) {
  dns.lookup(host, { ...opcoes, all: false }, (err, endereco, familia) => {
    if (err) return cb(err);
    if (ipInterno(endereco)) return cb(new Error('Endereço interno não permitido'));
    cb(null, endereco, familia);
  });
}

function baixar(url, max, redirecionamentos = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('URL inválida')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('Protocolo não permitido'));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && ipInterno(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('Endereço interno'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, {
      lookup: lookupSeguro,
      timeout: TEMPO_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.0; +https://www.whatsapp.com)', Accept: 'text/html,image/*;q=0.8,*/*;q=0.5' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirecionamentos > 0) {
        res.resume();
        return resolve(baixar(new URL(res.headers.location, u).toString(), max, redirecionamentos - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const partes = [];
      let total = 0;
      res.on('data', (p) => {
        total += p.length;
        if (total > max) { req.destroy(); resolve({ corpo: Buffer.concat(partes), tipo: res.headers['content-type'] || '', url: u.toString(), cortado: true }); return; }
        partes.push(p);
      });
      res.on('end', () => resolve({ corpo: Buffer.concat(partes), tipo: res.headers['content-type'] || '', url: u.toString() }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado')));
    req.on('error', reject);
  });
}

const entidades = (t) => String(t || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();

function meta(html, nomes) {
  for (const nome of nomes) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const valor = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (valor) return entidades(valor);
  }
  return null;
}

/**
 * Prévia no formato que o Baileys espera em sendMessage({ text, linkPreview }).
 * Devolve null se não der (o envio segue sem prévia).
 */
export async function gerarPrevia(texto) {
  const achado = String(texto || '').match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[.,;:!?)\]]+$/, '');
  if (!achado) return null;
  try {
    const pagina = await baixar(achado, MAX_HTML);
    if (!/html/i.test(pagina.tipo)) return null;
    const html = pagina.corpo.toString('utf8');
    const titulo = meta(html, ['og:title', 'twitter:title']) || entidades(html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]);
    if (!titulo) return null;
    const descricao = meta(html, ['og:description', 'twitter:description', 'description']);
    const imagem = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
    let jpegThumbnail;
    if (imagem) {
      try {
        const img = await baixar(new URL(imagem, pagina.url).toString(), MAX_IMAGEM);
        if (/^image\//i.test(img.tipo) && !img.cortado) {
          const tmp = path.join(os.tmpdir(), `previa-${crypto.randomUUID()}`);
          fs.writeFileSync(tmp, img.corpo);
          try { jpegThumbnail = (await ff.miniatura(tmp)).jpeg || undefined; } finally { fs.rmSync(tmp, { force: true }); }
        }
      } catch { /* sem miniatura */ }
    }
    return {
      'canonical-url': pagina.url,
      'matched-text': achado,
      title: titulo.slice(0, 200),
      description: descricao ? descricao.slice(0, 300) : undefined,
      jpegThumbnail,
    };
  } catch {
    return null;
  }
}
