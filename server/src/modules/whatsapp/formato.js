// Formato em que a mensagem original do WhatsApp fica guardada no banco (coluna raw)
import { get } from '../../db.js';

// Mensagem original guardada no banco, codificada no formato do próprio WhatsApp (protobuf).
// Preserva as chaves da mídia (para baixar depois) e permite citar a mensagem numa resposta.
export function serializar(lib, msg) {
  try {
    const pb = lib.proto.WebMessageInfo;
    return `pb:${Buffer.from(pb.encode(pb.fromObject(msg)).finish()).toString('base64')}`;
  } catch {
    return null;
  }
}

export function desserializar(lib, raw) {
  if (!raw) return null;
  try {
    if (raw.startsWith('pb:')) return lib.proto.WebMessageInfo.decode(Buffer.from(raw.slice(3), 'base64'));
    return JSON.parse(raw, lib.BufferJSON.reviver);
  } catch {
    return null;
  }
}

export function mensagemOriginal(lib, waId) {
  const linha = get('SELECT raw FROM wa_messages WHERE wa_id = ? AND raw IS NOT NULL LIMIT 1', [waId]);
  return linha ? desserializar(lib, linha.raw) : null;
}

