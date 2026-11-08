// Entrega de arquivos que vieram de fora (mídias do WhatsApp e do Instagram, anexos, arquivos dos disparos).
// O tipo do arquivo é informado por quem mandou e não dá para confiar nele: só imagens comuns, áudio, vídeo e PDF
// abrem na tela, sempre isolados (sem rodar script nenhum na página do CRM); o resto é sempre baixado.
// Antes cada tela fazia isso do seu jeito, e algumas abriam qualquer tipo direto no CRM.

// Tipos que o navegador pode abrir direto na tela
const ABRE_NA_TELA = /^(image\/(jpeg|png|webp|gif|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/i;
// Página isolada: sem scripts, sem formulários, sem acesso ao resto do CRM
const POLITICA_ISOLADA = "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; sandbox";

export const abreNaTela = (mime) => ABRE_NA_TELA.test(String(mime || '').split(';')[0].trim());

/**
 * Envia o arquivo com os cabeçalhos de proteção.
 *  mime: tipo informado · nome: nome para o download · download: força baixar · cache: Cache-Control
 */
export function enviarArquivoSeguro(res, caminho, { mime = null, nome = null, download = false, cache = 'private, max-age=86400' } = {}) {
  const tipo = String(mime || 'application/octet-stream').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  // Cabeçalho com caractere inválido (vindo de fora) derrubaria a resposta: usa o tipo genérico
  res.setHeader('Content-Type', /^[\w.+-]+\/[\w.+-]+$/.test(tipo) ? tipo : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cache) res.setHeader('Cache-Control', cache);
  // O leitor de PDF do navegador não funciona numa página isolada; o PDF não roda script na página do CRM
  if (tipo === 'application/pdf') res.removeHeader('Content-Security-Policy');
  else res.setHeader('Content-Security-Policy', POLITICA_ISOLADA);
  if (download || !abreNaTela(tipo)) res.attachment(nome || 'arquivo');
  return res.sendFile(caminho);
}
