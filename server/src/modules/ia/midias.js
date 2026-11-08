// Mídias que o lead manda, prontas para a IA de primeiro contato (Alice SDR) entender:
//  - áudio e a fala de vídeos curtos: transcritos pelo Whisper da própria VPS (agente/transcricao.js), uma vez só
//    (o texto fica em wa_messages.transcricao e serve também para o Organizador e para a Agente Alice)
//  - Word, Excel, PowerPoint e texto (.txt, .csv…): viram texto (wa_messages.texto_extraido)
//  - imagem e PDF: vão direto para o modelo, que vê o arquivo. Ele devolve uma frase dizendo o que é cada um; essa frase
//    fica guardada (texto_extraido) e nas próximas respostas vai só o texto — a imagem não é reenviada (economiza tokens)
//  - figurinha, localização, contato e enquete: vão como texto (rótulo + o que o WhatsApp descreve)
// Nada aqui derruba o atendimento: se algo falhar, a mensagem vai marcada como "não consegui abrir" e a IA passa
// para a equipe (regra do prompt).
import fs from 'node:fs';
import { run } from '../../db.js';
import * as transcricao from '../agente/transcricao.js';
import { baixarMidia, absoluto } from '../whatsapp/midia.js';
import { extrairTexto, ehPdf, ehImagem } from '../agente/documentos.js';

// Quanto o atendimento espera um áudio ser transcrito (o Whisper roda na CPU, um áudio por vez).
// Passou disso, a IA segue sem a transcrição; ela continua rodando e fica guardada para a próxima resposta.
export const ESPERA_TRANSCRICAO_MS = 3 * 60000;
// Vídeos mais longos que isto não são transcritos (o arquivo pesa e o lead raramente fala o essencial num vídeo longo)
export const MAX_VIDEO_SEGUNDOS = 180;
// Quantas imagens/PDFs no máximo vão para o modelo numa resposta (as mais recentes)
export const MAX_VISUAIS = 3;
const MAX_IMAGEM = 3.7 * 1024 * 1024;
const MAX_PDF = 10 * 1024 * 1024;
const MAX_TEXTO_DOCUMENTO = 20000;
const MAX_DESCRICAO = 600;

let prazoTranscricao = ESPERA_TRANSCRICAO_MS;
/** Testes: encurta a espera da transcrição */
export function definirPrazoTranscricao(ms) { prazoTranscricao = ms ?? ESPERA_TRANSCRICAO_MS; }

/** A transcrição de áudio (Whisper na VPS) está instalada e ligada? */
export function transcricaoPronta() {
  try {
    return Boolean(transcricao.lerConfig().ativo && transcricao.instalada());
  } catch {
    return false;
  }
}

function comPrazo(promessa, ms) {
  let timer;
  return Promise.race([
    promessa,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('a transcrição ainda não terminou')), ms); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
}

const curto = (err) => String(err?.message || err || 'erro').replace(/\s+/g, ' ').slice(0, 120);

async function transcrever(m) {
  if (m.transcricao) return;
  if (m.type === 'video' && m.media_seconds && m.media_seconds > MAX_VIDEO_SEGUNDOS) {
    m.midia_falha = `vídeo de ${Math.round(m.media_seconds / 60)} min, longo demais para ouvir`;
    return;
  }
  if (!transcricaoPronta()) {
    m.midia_falha = 'a transcrição de áudio do CRM está desligada';
    return;
  }
  // Já foi tentado antes e falhou (ex.: mídia expirada): não insiste a cada resposta
  if (m.transcricao_em) {
    m.midia_falha = 'não consegui ouvir';
    return;
  }
  try {
    const texto = await comPrazo(transcricao.transcreverMensagem(m.id), prazoTranscricao);
    m.transcricao = texto;
    m.midia_nova = true;
  } catch (err) {
    m.midia_falha = `não consegui ouvir (${curto(err)})`;
  }
}

async function lerDocumento(m) {
  if (m.texto_extraido) return;
  try {
    const linha = await baixarMidia(m.id);
    const caminho = absoluto(linha.media_path);
    const texto = extrairTexto(caminho, { mime: m.media_mime, nome: m.media_name });
    if (texto === null) {
      m.midia_falha = 'formato de arquivo que não sei abrir';
      return;
    }
    const limpo = texto.trim().slice(0, MAX_TEXTO_DOCUMENTO) || '(arquivo vazio)';
    run('UPDATE wa_messages SET texto_extraido = ? WHERE id = ?', [limpo, m.id]);
    m.texto_extraido = limpo;
    m.midia_nova = true;
  } catch (err) {
    m.midia_falha = `não consegui abrir o arquivo (${curto(err)})`;
  }
}

async function blocoVisual(m) {
  const linha = await baixarMidia(m.id);
  const caminho = absoluto(linha.media_path);
  const tamanho = fs.statSync(caminho).size;
  const mime = String(m.media_mime || linha.media_mime || '').split(';')[0].toLowerCase();
  if (m.type === 'imagem' || ehImagem(mime)) {
    if (!ehImagem(mime)) throw new Error(`formato de imagem não suportado (${mime || 'desconhecido'})`);
    if (tamanho > MAX_IMAGEM) throw new Error(`imagem grande demais (${Math.round(tamanho / 1048576)} MB)`);
    return { type: 'image', source: { type: 'base64', media_type: mime, data: fs.readFileSync(caminho).toString('base64') } };
  }
  if (tamanho > MAX_PDF) throw new Error(`PDF grande demais (${Math.round(tamanho / 1048576)} MB)`);
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(caminho).toString('base64') } };
}

const ehVisual = (m) => m.type === 'imagem' || (m.type === 'documento' && ehPdf(m.media_mime, m.media_name));

/**
 * Prepara as mídias do LEAD dentro da janela que vai para o modelo (as últimas `janela` mensagens).
 * Altera as próprias mensagens do histórico (transcricao, texto_extraido, anexo, midia_falha) e devolve os anexos
 * visuais para ir junto do pedido: [{ numero, id, tipo: 'imagem' | 'pdf', bloco }].
 *  verImagens: false = imagens e PDFs não vão para o modelo (aparecem como "não abri")
 */
export async function prepararMidias(historico, { janela = 20, verImagens = true } = {}) {
  const recentes = historico.slice(-janela).filter((m) => !m.from_me);
  for (const m of recentes) {
    if (m.type === 'audio' || m.type === 'video') await transcrever(m);
    else if (m.type === 'documento' && !ehPdf(m.media_mime, m.media_name)) await lerDocumento(m);
  }

  // Imagens e PDFs: só os que ainda não têm descrição guardada; os mais recentes primeiro
  const candidatos = recentes.filter((m) => ehVisual(m) && !m.texto_extraido);
  const anexos = [];
  for (const m of [...candidatos].reverse()) {
    if (!verImagens) {
      m.midia_falha = 'a leitura de imagens e PDFs está desligada na aba IA';
      continue;
    }
    if (anexos.length >= MAX_VISUAIS) {
      m.midia_falha = 'não abri (mais antiga que as outras que o lead mandou)';
      continue;
    }
    try {
      const bloco = await blocoVisual(m);
      anexos.unshift({ id: m.id, tipo: bloco.type === 'image' ? 'imagem' : 'pdf', bloco, mensagem: m });
    } catch (err) {
      m.midia_falha = `não consegui abrir (${curto(err)})`;
    }
  }
  // Numera na ordem em que aparecem na conversa
  anexos.forEach((a, i) => { a.numero = i + 1; a.mensagem.anexo = a.numero; delete a.mensagem; });
  return anexos;
}

/**
 * Guarda a frase que o modelo devolveu sobre cada anexo (resposta.midias = [{ anexo: 1, descricao: '…' }]).
 * Nas próximas respostas a imagem/PDF vai só como esse texto. Devolve quantas foram guardadas.
 */
export function guardarDescricoes(anexos, midias) {
  if (!anexos?.length || !Array.isArray(midias)) return 0;
  let n = 0;
  for (const item of midias) {
    const numero = Number(item?.anexo ?? item?.numero);
    const a = anexos.find((x) => x.numero === numero);
    const descricao = String(item?.descricao || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRICAO);
    if (!a || !descricao) continue;
    run('UPDATE wa_messages SET texto_extraido = ? WHERE id = ? AND texto_extraido IS NULL', [descricao, a.id]);
    n++;
  }
  return n;
}

/** Resumo do que foi feito com as mídias, para o registro da conversa (ou null se nada) */
export function resumoDasMidias(historico, anexos) {
  const partes = [];
  const transcritos = historico.filter((m) => m.midia_nova && m.transcricao).length;
  const lidos = historico.filter((m) => m.midia_nova && m.texto_extraido && m.type === 'documento').length;
  const falhas = historico.filter((m) => m.midia_falha).length;
  if (transcritos) partes.push(`${transcritos} áudio(s) transcrito(s)`);
  if (lidos) partes.push(`${lidos} documento(s) lido(s)`);
  if (anexos.length) partes.push(`${anexos.length} imagem(ns)/PDF(s) aberto(s)`);
  if (falhas) partes.push(`${falhas} mídia(s) sem abrir`);
  return partes.length ? partes.join(', ') : null;
}
