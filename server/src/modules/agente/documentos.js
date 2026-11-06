// Lê o texto de documentos para a Alice, sem bibliotecas externas:
//  - Word (.docx), PowerPoint (.pptx) e Excel (.xlsx): são arquivos ZIP com XML dentro (leitor de ZIP abaixo)
//  - texto puro (.txt, .csv, .md, .json, .html…)
// PDF e imagem vão direto para o modelo (ele lê sozinho); áudio passa pela transcrição.
import fs from 'node:fs';
import zlib from 'node:zlib';

const LIMITE_TEXTO = 60000;

/** Lista { nome → Buffer } das entradas de um ZIP (só as que o filtro aceitar) */
export function lerZip(buffer, filtro = () => true) {
  const fim = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error('Arquivo ZIP inválido');
  const total = buffer.readUInt16LE(fim + 10);
  let p = buffer.readUInt32LE(fim + 16);
  const saida = {};
  for (let i = 0; i < total && p + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buffer.readUInt16LE(p + 10);
    const tamanhoComprimido = buffer.readUInt32LE(p + 20);
    const nomeLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const comentarioLen = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const nome = buffer.toString('utf8', p + 46, p + 46 + nomeLen);
    p += 46 + nomeLen + extraLen + comentarioLen;
    if (!filtro(nome)) continue;
    const inicioDados = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const dados = buffer.subarray(inicioDados, inicioDados + tamanhoComprimido);
    if (metodo === 0) saida[nome] = dados;
    else if (metodo === 8) saida[nome] = zlib.inflateRawSync(dados);
  }
  return saida;
}

const desescapar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function textoDocx(arquivos) {
  const xml = arquivos['word/document.xml']?.toString('utf8') || '';
  return desescapar(xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
}

function textoPptx(arquivos) {
  const slides = Object.keys(arquivos).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  return slides.map((n, i) => {
    const xml = arquivos[n].toString('utf8');
    const t = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => desescapar(m[1])).join(' ');
    return `Slide ${i + 1}: ${t}`;
  }).join('\n');
}

function colunaParaIndice(ref) {
  const letras = String(ref).replace(/\d+/g, '');
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function textoXlsx(arquivos) {
  const compartilhadas = [];
  const sst = arquivos['xl/sharedStrings.xml']?.toString('utf8') || '';
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    compartilhadas.push(desescapar([...si[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join('')));
  }
  const pasta = arquivos['xl/workbook.xml']?.toString('utf8') || '';
  const nomes = [...pasta.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => desescapar(m[1]));
  const planilhas = Object.keys(arquivos).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const partes = [];
  planilhas.forEach((n, i) => {
    const xml = arquivos[n].toString('utf8');
    const linhas = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const celulas = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const tipo = attrs.match(/t="(\w+)"/)?.[1];
        const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1];
        const inline = c[2]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
        let valor = tipo === 's' ? compartilhadas[Number(v)] : tipo === 'inlineStr' ? desescapar(inline || '') : v !== undefined ? desescapar(v) : '';
        if (valor === undefined) valor = '';
        const idx = ref ? colunaParaIndice(ref) : celulas.length;
        celulas[idx] = String(valor).replace(/\s+/g, ' ');
      }
      if (celulas.some((x) => x)) linhas.push(Array.from(celulas, (x) => x ?? '').join(' | '));
      if (linhas.length >= 1500) break;
    }
    partes.push(`Planilha "${nomes[i] || i + 1}":\n${linhas.join('\n')}`);
  });
  return partes.join('\n\n');
}

const TEXTO_PURO = /^(text\/|application\/(json|xml|csv|x-ndjson))/i;
const EXTENSAO_TEXTO = /\.(txt|csv|tsv|md|json|xml|html?|log|yml|yaml)$/i;

/** Texto de um documento (ou null se o formato não for de texto). */
export function extrairTexto(caminho, { mime = '', nome = '' } = {}) {
  const m = String(mime).toLowerCase();
  const n = String(nome || caminho).toLowerCase();
  let texto = null;
  if (/wordprocessingml|\.docx$/.test(m + n)) texto = textoDocx(lerZip(fs.readFileSync(caminho), (x) => x === 'word/document.xml'));
  else if (/presentationml|\.pptx$/.test(m + n)) texto = textoPptx(lerZip(fs.readFileSync(caminho), (x) => x.startsWith('ppt/slides/slide')));
  else if (/spreadsheetml|\.xlsx$/.test(m + n)) texto = textoXlsx(lerZip(fs.readFileSync(caminho), (x) => x.startsWith('xl/')));
  else if (TEXTO_PURO.test(m) || EXTENSAO_TEXTO.test(n)) texto = fs.readFileSync(caminho, 'utf8');
  if (texto === null) return null;
  texto = texto.replace(/\u0000/g, '');
  return texto.length > LIMITE_TEXTO ? `${texto.slice(0, LIMITE_TEXTO)}\n…(cortado: o arquivo continua)` : texto;
}

export const ehPdf = (mime, nome) => /application\/pdf/i.test(mime || '') || /\.pdf$/i.test(nome || '');
export const ehImagem = (mime) => /^image\/(jpeg|png|webp|gif)/i.test(mime || '');
export const ehAudio = (mime, nome) => /^audio\//i.test(mime || '') || /\.(ogg|opus|mp3|m4a|wav|webm|aac|amr)$/i.test(nome || '');
