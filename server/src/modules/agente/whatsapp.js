// Entrega no WhatsApp: converte o Markdown da Alice para a formatação do WhatsApp e envia pelo número do CRM
// (para o "mensagem para mim" do próprio número, outro telefone ou um grupo). Sem número conectado, não envia.
import { get } from '../../db.js';
import { ErroHttp, normalizarTelefone } from '../../util.js';
import { socketConectado, carregarBaileys } from '../whatsapp/instancias.js';

/** Markdown → texto de WhatsApp (*negrito*, _itálico_, listas com •, tabelas em linhas) */
export function paraWhatsApp(md) {
  const linhas = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const saida = [];
  for (let l of linhas) {
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)) continue; // separador de tabela
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · ');
    const titulo = l.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (titulo) l = `*${titulo[1].replace(/\*+/g, '').trim()}*`;
    l = l.replace(/^(\s*)[-*+]\s+/, '$1• ');
    l = l.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '_$1_');
    l = l.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
    saida.push(l);
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Divide textos longos em partes (por parágrafo), para o WhatsApp mostrar bem */
export function dividir(texto, max = 3500) {
  if (texto.length <= max) return [texto];
  const partes = [];
  let atual = '';
  for (const p of texto.split('\n\n')) {
    if ((atual + '\n\n' + p).length > max && atual) { partes.push(atual); atual = p; } else atual = atual ? `${atual}\n\n${p}` : p;
    while (atual.length > max) { partes.push(atual.slice(0, max)); atual = atual.slice(max); }
  }
  if (atual) partes.push(atual);
  return partes;
}

/** Jid do próprio número conectado ("mensagem para mim") */
export async function jidProprio(numeroId) {
  const e = socketConectado(numeroId);
  if (!e?.sock?.user?.id) return null;
  const lib = await carregarBaileys();
  return lib.jidNormalizedUser(e.sock.user.id);
}

/**
 * Resolve o destino { tipo, numero_id, telefone, jid } para { numeroId, destino, descricao }.
 * Lança erro se o número estiver desconectado.
 */
export async function resolverEntrega(destino) {
  const numeroId = Number(destino?.numero_id) || get('SELECT id FROM wa_instances ORDER BY id LIMIT 1')?.id;
  if (!numeroId) throw new ErroHttp(409, 'Nenhum número de WhatsApp cadastrado no CRM');
  const numero = get('SELECT name, phone FROM wa_instances WHERE id = ?', [numeroId]);
  if (!socketConectado(numeroId)) throw new ErroHttp(409, `O WhatsApp ${numero?.name || numeroId} está desconectado`);
  if (destino.tipo === 'proprio') {
    const jid = await jidProprio(numeroId);
    if (!jid) throw new ErroHttp(409, 'Não consegui identificar o próprio número conectado');
    return { numeroId, destino: { jid }, descricao: `"mensagem para mim" de ${numero?.name || 'o número do CRM'}` };
  }
  if (destino.tipo === 'numero') {
    const t = normalizarTelefone(destino.telefone);
    if (!t) throw new ErroHttp(400, 'Telefone de destino inválido');
    return { numeroId, destino: { jid: `${t}@s.whatsapp.net` }, descricao: `+${t}` };
  }
  if (destino.tipo === 'grupo') {
    if (!/@g\.us$/.test(destino.jid || '')) throw new ErroHttp(400, 'Grupo de destino inválido');
    const nome = get('SELECT name FROM wa_chats WHERE jid = ?', [destino.jid])?.name || 'grupo';
    return { numeroId, destino: { jid: destino.jid }, descricao: `grupo "${nome}"` };
  }
  throw new ErroHttp(400, 'Destino inválido');
}

/** Envia o texto (dividido se for longo). Devolve a descrição do destino. */
export async function entregar(destino, texto, userId = null) {
  const { enviar } = await import('../whatsapp/envio.js');
  const alvo = await resolverEntrega(destino);
  for (const parte of dividir(paraWhatsApp(texto))) {
    await enviar(alvo.numeroId, alvo.destino, { texto: parte, origem: 'alice', semPrevia: true }, userId);
  }
  return alvo.descricao;
}
