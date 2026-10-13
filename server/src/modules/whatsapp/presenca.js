// Presença dos contatos: "online", "visto por último", "digitando…", "gravando áudio…".
// O WhatsApp só manda a presença de quem a conversa "assinou" (presenceSubscribe), como o WhatsApp Web
// faz ao abrir uma conversa. Os avisos vão para a tela pelo evento "presenca".
import { emitir } from '../../tempoReal.js';

const presencas = new Map(); // jid da conversa → { estado, quem, nome, visto, em }
const VALIDADE_DIGITANDO_MS = 25000;

export function aoAtualizarPresenca(lib, { id, presences } = {}) {
  if (!id || !presences) return;
  const conversa = lib.jidNormalizedUser(id);
  const grupo = lib.isJidGroup(conversa);
  let atual = presencas.get(conversa) || {};
  for (const [quem, p] of Object.entries(presences)) {
    const estadoBruto = p?.lastKnownPresence;
    if (!estadoBruto) continue;
    const visto = p.lastSeen ? new Date(Number(p.lastSeen) * 1000).toISOString() : atual.visto || null;
    if (grupo) {
      // No grupo só interessa quem está digitando
      if (estadoBruto === 'composing' || estadoBruto === 'recording') atual = { estado: estadoBruto, quem: lib.jidNormalizedUser(quem), em: Date.now() };
      else if (atual.quem === lib.jidNormalizedUser(quem)) atual = {};
    } else {
      atual = { estado: estadoBruto, visto: estadoBruto === 'unavailable' ? visto || new Date().toISOString() : visto, em: Date.now() };
    }
  }
  presencas.set(conversa, atual);
  emitir(`presenca`, { jid: conversa, ...publica(atual) });
}

function publica(p) {
  if (!p?.estado) return { estado: null, visto: p?.visto || null };
  const digitando = p.estado === 'composing' || p.estado === 'recording';
  if (digitando && Date.now() - p.em > VALIDADE_DIGITANDO_MS) return { estado: 'available', visto: p.visto || null };
  return { estado: p.estado, visto: p.visto || null, quem: p.quem || null };
}

export function presencaDe(jids) {
  for (const jid of jids) {
    const p = presencas.get(jid);
    if (p?.estado) return publica(p);
  }
  return { estado: null, visto: null };
}

// Conversas com alguém digitando agora (para a lista de conversas)
export function digitandoAgora() {
  const r = {};
  for (const [jid, p] of presencas) {
    const pub = publica(p);
    if (pub.estado === 'composing' || pub.estado === 'recording') r[jid] = pub.estado;
  }
  return r;
}
