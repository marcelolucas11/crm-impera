// Prévia de link (título, descrição e miniatura) ao enviar uma mensagem com link, como o WhatsApp Web faz.
// Implementação própria e pequena (sem dependência nova): só http/https, nunca endereços internos
// (localhost, rede local, IPv6 local) — o IP é conferido na própria conexão, então um DNS que muda
// de resposta não engana a checagem. Limite de tempo e de tamanho em tudo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ff from './ffmpeg.js';
import { baixarSeguro } from '../../rede.js';

// A proteção contra endereços internos fica em rede.js (compartilhada com os disparos por link)
export { ipInterno } from '../../rede.js';

const TEMPO_MS = 4000;
const MAX_HTML = 600 * 1024;
const MAX_IMAGEM = 1500 * 1024;
const CABECALHOS = { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.0; +https://www.whatsapp.com)', Accept: 'text/html,image/*;q=0.8,*/*;q=0.5' };

const baixar = (url, max) => baixarSeguro(url, { max, tempoMs: TEMPO_MS, totalMs: 3 * TEMPO_MS, redirecionamentos: 3, cabecalhos: CABECALHOS });

const entidades = (t) => String(t || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (t, n) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : t)).trim();

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
