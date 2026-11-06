// Processo separado que roda o Whisper (transformers.js) para transcrever áudios na própria VPS.
// Fica fora do processo do CRM: se faltar memória ou der erro, o CRM continua no ar.
// Recebe { id, pcm, modelo, idioma } (pcm = arquivo float32 mono 16 kHz) e responde { id, texto } ou { id, erro }.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PASTA = process.env.TRANSCRICAO_DIR;
const MODELOS = {
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
  turbo: 'onnx-community/whisper-large-v3-turbo',
};

let biblioteca = null;
const pipelines = new Map();

async function carregar(modelo) {
  if (!biblioteca) {
    const require = createRequire(path.join(PASTA, 'package.json'));
    const arquivo = require.resolve('@huggingface/transformers');
    biblioteca = await import(pathToFileURL(arquivo).href);
    biblioteca.env.cacheDir = path.join(PASTA, 'modelos');
    biblioteca.env.allowLocalModels = true;
  }
  const id = MODELOS[modelo] || MODELOS.small;
  if (!pipelines.has(id)) {
    process.send?.({ evento: 'carregando', modelo: id });
    // Versão quantizada (menor e mais rápida na CPU); se o modelo não tiver, usa a completa
    const p = biblioteca.pipeline('automatic-speech-recognition', id, { dtype: 'q8', device: 'cpu' })
      .catch(() => biblioteca.pipeline('automatic-speech-recognition', id, { dtype: 'fp32', device: 'cpu' }));
    p.catch(() => pipelines.delete(id));
    pipelines.set(id, p);
  }
  return pipelines.get(id);
}

process.on('message', async (pedido) => {
  if (!pedido?.id) return;
  try {
    const transcrever = await carregar(pedido.modelo);
    const buffer = fs.readFileSync(pedido.pcm);
    const audio = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
    const opcoes = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
    if (pedido.idioma && pedido.idioma !== 'auto') opcoes.language = pedido.idioma;
    const r = await transcrever(audio, opcoes);
    const texto = (Array.isArray(r) ? r.map((x) => x.text).join(' ') : r?.text || '').replace(/\s+/g, ' ').trim();
    process.send?.({ id: pedido.id, texto });
  } catch (err) {
    process.send?.({ id: pedido.id, erro: err?.message || String(err) });
  }
});

process.send?.({ evento: 'pronto' });
