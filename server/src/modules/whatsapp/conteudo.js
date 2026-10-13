// Converte o conteúdo de uma mensagem do WhatsApp no que o CRM guarda e mostra:
// tipo, texto de prévia (lista de conversas), legenda, dados da mídia, resposta citada e extras.

// Tipos que não são mensagens de conversa. Reações, edições e "apagar" são tratados à parte.
export const TIPOS_IGNORADOS = new Set([
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'keepInChatMessage',
  'encReactionMessage',
  'pinInChatMessage',
  'callLogMesssage',
  'botInvokeMessage',
]);

const ROTULOS = {
  imageMessage: ['imagem', '📷 Foto'],
  videoMessage: ['video', '🎥 Vídeo'],
  ptvMessage: ['video', '🎥 Vídeo'],
  audioMessage: ['audio', '🎤 Áudio'],
  documentMessage: ['documento', '📄 Documento'],
  documentWithCaptionMessage: ['documento', '📄 Documento'],
  stickerMessage: ['figurinha', '🙂 Figurinha'],
  locationMessage: ['localizacao', '📍 Localização'],
  liveLocationMessage: ['localizacao', '📍 Localização em tempo real'],
  contactMessage: ['contato', '👤 Contato'],
  contactsArrayMessage: ['contato', '👤 Contatos'],
  pollCreationMessage: ['enquete', '📊 Enquete'],
  pollCreationMessageV2: ['enquete', '📊 Enquete'],
  pollCreationMessageV3: ['enquete', '📊 Enquete'],
  eventMessage: ['evento', '📅 Evento'],
};

const TIPOS_MIDIA = new Set(['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'documentMessage', 'stickerMessage']);

const MIME_PADRAO = {
  imageMessage: 'image/jpeg',
  videoMessage: 'video/mp4',
  ptvMessage: 'video/mp4',
  audioMessage: 'audio/ogg; codecs=opus',
  documentMessage: 'application/octet-stream',
  stickerMessage: 'image/webp',
};

const numero = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return typeof v.toNumber === 'function' ? v.toNumber() : Number(v.low ?? 0);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const base64 = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  try { return Buffer.from(v).toString('base64'); } catch { return null; }
};

// Texto simples de uma mensagem (usado também para o trecho citado numa resposta)
function textoDe(conteudo, tipo) {
  if (tipo === 'conversation') return conteudo.conversation || '';
  if (tipo === 'extendedTextMessage') return conteudo.extendedTextMessage?.text || '';
  if (tipo === 'buttonsResponseMessage') return conteudo.buttonsResponseMessage?.selectedDisplayText || '';
  if (tipo === 'listResponseMessage') return conteudo.listResponseMessage?.title || '';
  if (tipo === 'templateButtonReplyMessage') return conteudo.templateButtonReplyMessage?.selectedDisplayText || '';
  if (tipo === 'interactiveResponseMessage') return conteudo.interactiveResponseMessage?.body?.text || '';
  return null;
}

function telefonesDoVcard(vcard) {
  const tel = [...String(vcard || '').matchAll(/TEL[^:]*:([+\d\s()-]+)/g)].map((m) => m[1].replace(/\D/g, '')).filter(Boolean);
  return tel;
}

/**
 * @returns {{ tipo, texto, legenda, midia, extra, contexto }}
 *  tipo: texto | imagem | video | audio | documento | figurinha | localizacao | contato | enquete | outro
 *  texto: prévia para a lista de conversas
 *  midia: { mime, nome, tamanho, segundos, largura, altura, ptt, thumb } ou null
 */
export function analisarConteudo(conteudo, tipoBruto) {
  const simples = textoDe(conteudo, tipoBruto);
  const interno = conteudo?.[tipoBruto] || {};
  const contexto = interno.contextInfo || null;

  if (simples !== null) {
    return { tipo: 'texto', texto: simples, legenda: null, midia: null, extra: null, contexto };
  }

  const [tipo, rotulo] = ROTULOS[tipoBruto] || ['outro', 'Mensagem'];
  let legenda = interno.caption || null;
  let midia = null;
  let extra = null;

  if (TIPOS_MIDIA.has(tipoBruto)) {
    midia = {
      mime: (interno.mimetype || MIME_PADRAO[tipoBruto]).trim(),
      nome: interno.fileName || interno.title || null,
      tamanho: numero(interno.fileLength),
      segundos: numero(interno.seconds),
      largura: numero(interno.width),
      altura: numero(interno.height),
      ptt: Boolean(interno.ptt) || tipoBruto === 'ptvMessage',
      thumb: base64(interno.jpegThumbnail),
    };
  } else if (tipo === 'localizacao') {
    extra = {
      lat: interno.degreesLatitude,
      lng: interno.degreesLongitude,
      nome: interno.name || null,
      endereco: interno.address || null,
      thumb: base64(interno.jpegThumbnail),
    };
  } else if (tipoBruto === 'contactMessage') {
    extra = { contatos: [{ nome: interno.displayName || 'Contato', telefones: telefonesDoVcard(interno.vcard) }] };
  } else if (tipoBruto === 'contactsArrayMessage') {
    extra = { contatos: (interno.contacts || []).map((c) => ({ nome: c.displayName || 'Contato', telefones: telefonesDoVcard(c.vcard) })) };
  } else if (tipo === 'enquete') {
    extra = { pergunta: interno.name || '', opcoes: (interno.options || []).map((o) => o.optionName) };
    legenda = interno.name || null;
  }

  let texto = rotulo;
  if (tipo === 'audio' && midia?.segundos) texto = `${midia.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio'} (${duracao(midia.segundos)})`;
  else if (tipo === 'documento' && midia?.nome) texto = `📄 ${midia.nome}`;
  else if (tipo === 'contato' && extra?.contatos?.length) texto = `👤 ${extra.contatos.map((c) => c.nome).join(', ')}`;
  else if (tipo === 'localizacao' && extra?.nome) texto = `📍 ${extra.nome}`;
  if (legenda && tipo !== 'enquete') texto = `${texto}: ${legenda}`;
  else if (tipo === 'enquete' && legenda) texto = `📊 ${legenda}`;

  return { tipo, texto, legenda, midia, extra, contexto };
}

export function duracao(segundos) {
  const s = Math.max(0, Math.round(segundos || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// O horário vem em segundos, às vezes como objeto Long
export function horarioDaMensagem(ts) {
  if (ts === null || ts === undefined) return new Date().toISOString();
  const segundos = numero(ts);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000).toISOString() : new Date().toISOString();
}

// Extensão do arquivo a partir do tipo (MIME)
const EXTENSOES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr', 'audio/webm': '.webm', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'application/pdf': '.pdf', 'application/zip': '.zip', 'text/plain': '.txt', 'text/csv': '.csv',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export function extensaoDe(mime, nome) {
  const doNome = String(nome || '').match(/\.[a-z0-9]{1,6}$/i)?.[0];
  if (doNome) return doNome.toLowerCase();
  return EXTENSOES[String(mime || '').split(';')[0].trim().toLowerCase()] || '.bin';
}
