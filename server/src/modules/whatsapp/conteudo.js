// Converte o conteúdo de uma mensagem do WhatsApp em texto simples para mostrar no CRM

// Tipos que não são mensagens de conversa (reações, avisos internos, enquetes etc.)
export const TIPOS_IGNORADOS = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'keepInChatMessage',
  'encReactionMessage',
  'editedMessage',
  'pinInChatMessage',
]);

const ROTULOS = {
  imageMessage: ['imagem', '📷 Imagem'],
  videoMessage: ['video', '🎥 Vídeo'],
  audioMessage: ['audio', '🎤 Áudio'],
  documentMessage: ['documento', '📄 Documento'],
  documentWithCaptionMessage: ['documento', '📄 Documento'],
  stickerMessage: ['figurinha', '🙂 Figurinha'],
  locationMessage: ['localizacao', '📍 Localização'],
  liveLocationMessage: ['localizacao', '📍 Localização em tempo real'],
  contactMessage: ['contato', '👤 Contato'],
  contactsArrayMessage: ['contato', '👤 Contatos'],
  pollCreationMessage: ['enquete', '📊 Enquete'],
  pollCreationMessageV3: ['enquete', '📊 Enquete'],
};

export function extrairTexto(conteudo, tipo) {
  if (tipo === 'conversation') return { tipo: 'texto', texto: conteudo.conversation || '' };
  if (tipo === 'extendedTextMessage') return { tipo: 'texto', texto: conteudo.extendedTextMessage?.text || '' };
  if (tipo === 'buttonsResponseMessage') return { tipo: 'texto', texto: conteudo.buttonsResponseMessage?.selectedDisplayText || '' };
  if (tipo === 'listResponseMessage') return { tipo: 'texto', texto: conteudo.listResponseMessage?.title || '' };
  if (tipo === 'templateButtonReplyMessage') return { tipo: 'texto', texto: conteudo.templateButtonReplyMessage?.selectedDisplayText || '' };

  const [tipoCurto, rotulo] = ROTULOS[tipo] || ['outro', 'Mensagem'];
  const interno = conteudo[tipo] || {};
  const legenda = interno.caption || interno.message?.documentMessage?.caption || interno.fileName || interno.displayName || interno.name || '';
  return { tipo: tipoCurto, texto: legenda ? `${rotulo}: ${legenda}` : rotulo };
}

// O horário vem em segundos, às vezes como objeto Long
export function horarioDaMensagem(ts) {
  if (ts === null || ts === undefined) return new Date().toISOString();
  const segundos = typeof ts === 'object' ? (typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts.low ?? ts)) : Number(ts);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000).toISOString() : new Date().toISOString();
}
