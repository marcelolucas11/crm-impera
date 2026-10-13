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

// Endereços que a prévia nunca acessa (localhost, rede local, link-local, multicast, IPv6 local/mapeado)
// (listas separadas: o BlockList trata IPv4 como "::ffff:x.x.x.x" ao conferir regras IPv6)
const BLOQUEADOS_V4 = new net.BlockList();
for (const [rede, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) BLOQUEADOS_V4.addSubnet(rede, bits, 'ipv4');
const BLOQUEADOS_V6 = new net.BlockList();
for (const [rede, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16]]) {
  BLOQUEADOS_V6.addSubnet(rede, bits, 'ipv6');
}

export function ipInterno(ip) {
  if (!ip) return true;
  const limpo = String(ip).replace(/^\[|\]$/g, '');
  const tipo = net.isIP(limpo);
  if (!tipo) return true;
  if (tipo === 6) {
    // IPv4 escrito dentro do IPv6 (::ffff:127.0.0.1 ou ::ffff:7f00:1)
    const m = limpo.toLowerCase().match(/^::ffff:(.+)$/);
    if (m) {
      if (net.isIPv4(m[1])) return ipInterno(m[1]);
      const p = m[1].split(':');
      if (p.length === 2) {
        const n = (parseInt(p[0], 16) << 16) + parseInt(p[1], 16);
        return ipInterno([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
      }
    }
    if (/^::ffff:/i.test(limpo)) return true;
    return BLOQUEADOS_V6.check(limpo, 'ipv6');
  }
  return BLOQUEADOS_V4.check(limpo, 'ipv4');
}

// Resolve o nome e recusa endereços internos (usado pela própria conexão)
function lookupSeguro(host, opcoes, cb) {
  dns.lookup(host, { ...opcoes, all: true }, (err, enderecos) => {
    if (err) return cb(err);
    const permitidos = (enderecos || []).filter((e) => !ipInterno(e.address));
    if (!permitidos.length || permitidos.length !== enderecos.length) return cb(new Error('Endereço interno não permitido'));
    if (opcoes?.all) return cb(null, permitidos);
    cb(null, permitidos[0].address, permitidos[0].family);
  });
}

function baixar(url, max, redirecionamentos = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('URL inválida')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('Protocolo não permitido'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if ((net.isIP(host) && ipInterno(host)) || /^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) return reject(new Error('Endereço interno'));
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
          const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[img.tipo.split(';')[0].trim().toLowerCase()];
          if (ext) {
            const tmp = path.join(os.tmpdir(), `previa-${crypto.randomUUID()}${ext}`);
            fs.writeFileSync(tmp, img.corpo);
            // Imagem de terceiros: o FFmpeg só lê este arquivo como imagem (nada de playlists ou outros protocolos)
            try { jpegThumbnail = (await ff.miniatura(tmp, { seguro: true })).jpeg || undefined; } finally { fs.rmSync(tmp, { force: true }); }
          }
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
