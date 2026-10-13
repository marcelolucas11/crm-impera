// FFmpeg portátil (pacote ffmpeg-static, fica dentro de node_modules — nada é instalado no sistema).
// Usado para: converter o áudio gravado no navegador em mensagem de voz do WhatsApp (OGG/Opus),
// desenhar a onda do áudio, gerar miniaturas de foto/vídeo, converter vídeos para MP4
// e converter áudios para o Safari tocar. Se o FFmpeg não estiver disponível, o CRM continua
// funcionando: os arquivos são enviados como estão.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

let caminho;

export async function ffmpeg() {
  if (caminho !== undefined) return caminho;
  try {
    const p = process.env.FFMPEG_PATH || (await import('ffmpeg-static')).default;
    caminho = p && fs.existsSync(p) ? p : null;
  } catch {
    caminho = null;
  }
  if (!caminho) console.log('[whatsapp] FFmpeg não encontrado: áudios e vídeos serão enviados sem conversão');
  return caminho;
}

function rodar(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    ffmpeg().then((bin) => {
      if (!bin) return reject(new Error('FFmpeg indisponível'));
      const proc = spawn(bin, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      const saida = [];
      let erros = '';
      proc.stdout.on('data', (d) => saida.push(d));
      proc.stderr.on('data', (d) => { erros = (erros + d).slice(-20000); });
      const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
      proc.on('close', (codigo) => {
        clearTimeout(timer);
        if (codigo === 0) resolve({ stdout: Buffer.concat(saida), stderr: erros });
        else reject(new Error(`FFmpeg falhou (${codigo}): ${erros.split('\n').filter(Boolean).slice(-2).join(' ')}`));
      });
    });
  });
}

// Áudio gravado (webm/mp4 do navegador) → mensagem de voz do WhatsApp
export async function converterParaVoz(entrada, saida) {
  await rodar(['-y', '-i', entrada, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', saida]);
}

// Áudio para navegadores que não tocam OGG (Safari antigo)
export async function converterParaM4a(entrada, saida) {
  await rodar(['-y', '-i', entrada, '-vn', '-c:a', 'aac', '-b:a', '96k', '-f', 'mp4', '-movflags', '+faststart', saida]);
}

// Vídeo em outro formato (MOV, WEBM…) → MP4 que qualquer celular abre
export async function converterParaMp4(entrada, saida) {
  await rodar(
    ['-y', '-i', entrada, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1280,iw)':-2", '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', saida],
    { timeoutMs: 600000 }
  );
}

// Duração (s) e onda (64 barras de 0 a 100) de um áudio
export async function analisarAudio(arquivo) {
  const { stdout } = await rodar(['-i', arquivo, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
  const amostras = Math.floor(stdout.length / 2);
  const segundos = Math.max(1, Math.round(amostras / 8000));
  const barras = 64;
  const porBarra = Math.max(1, Math.floor(amostras / barras));
  const valores = [];
  for (let b = 0; b < barras; b++) {
    let soma = 0;
    let n = 0;
    for (let i = b * porBarra; i < Math.min(amostras, (b + 1) * porBarra); i++) {
      soma += Math.abs(stdout.readInt16LE(i * 2));
      n++;
    }
    valores.push(n ? soma / n : 0);
  }
  const maior = Math.max(...valores, 1);
  return { segundos, onda: Uint8Array.from(valores.map((v) => Math.round((v / maior) * 100))) };
}

// Miniatura JPEG (para o WhatsApp mostrar antes de baixar) + dimensões da foto/vídeo
export async function miniatura(arquivo, { video = false } = {}) {
  const args = video ? ['-ss', '0.5', '-i', arquivo] : ['-i', arquivo];
  const { stdout, stderr } = await rodar([...args, '-frames:v', '1', '-vf', 'scale=96:-2', '-q:v', '6', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']);
  const dim = stderr.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/);
  return { jpeg: stdout.length ? stdout : null, largura: dim ? Number(dim[1]) : null, altura: dim ? Number(dim[2]) : null };
}
