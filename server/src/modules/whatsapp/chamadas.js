// Chamadas de voz e vídeo.
//
// O Baileys não transmite o áudio/vídeo de chamadas (não implementa VoIP), então o CRM:
//  - avisa na tela quando alguém liga (evento "chamada"), com nome, foto e se é vídeo;
//  - permite recusar (rejectCall) e recusar com mensagem;
//  - registra a chamada na conversa e no histórico do lead (perdida, recusada, atendida no celular, duração);
//  - gera um link de chamada do WhatsApp (createCallLink) para enviar ao contato, depois de confirmação.
// A alternativa oficial para atender chamadas no computador é a WhatsApp Business Calling API (API oficial da Meta).
import { get, tx, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { descreverChamada } from './conteudo.js';
import { estado, socketConectado, avisar, carregarBaileys } from './instancias.js';
import { aplicarPreparada, resolverTelefone } from './recebimento.js';
import { leadDoTelefone, telefoneDoJid } from './ligacao.js';

const ativas = new Map(); // id da chamada → dados

function nomeDe(jid, telefone) {
  const lead = leadDoTelefone(telefone).leadId;
  if (lead) return get('SELECT name FROM leads WHERE id = ?', [lead])?.name || `+${telefone}`;
  const c = get(
    `SELECT COALESCE(l.name, c.name, c.push_name) AS nome FROM wa_contacts c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.jid = ?`,
    [jid]
  );
  return c?.nome || (telefone ? `+${telefone}` : null);
}

function chaveDaConversa(jid, telefone) {
  const c = get('SELECT lead_id, phone FROM wa_contacts WHERE jid = ?', [jid]);
  if (c?.lead_id) return `l:${c.lead_id}`;
  const lead = leadDoTelefone(c?.phone || telefone).leadId;
  if (lead) return `l:${lead}`;
  if (c?.phone || telefone) return `t:${c?.phone || telefone}`;
  return `j:${jid}`;
}

const publica = (c) => ({
  id: c.id, numero: c.numero, video: c.video, chave: c.chave, nome: c.nome, telefone: c.telefone,
  status: c.status, inicio: c.inicio, atendida_em: c.atendidaEm || null, grupo: c.grupo,
});

export function chamadasAtivas() {
  return [...ativas.values()].filter((c) => c.status === 'tocando' || c.status === 'em_andamento').map(publica);
}

async function finalizar(instanciaId, c, resultado, fim = new Date()) {
  if (c.finalizada) return;
  c.finalizada = true;
  if (!(fim instanceof Date) || Number.isNaN(fim.getTime())) fim = new Date();
  ativas.delete(c.id);
  const duracao = c.atendidaEm ? Math.max(1, Math.round((fim.getTime() - new Date(c.atendidaEm).getTime()) / 1000)) : null;
  const extra = { video: c.video, resultado, duracao, recebida: true };
  if (!c.grupo) {
    const p = {
      acao: 'nova', chatJid: c.jid, grupo: false, fromMe: false, horario: c.inicio, modo: 'ao_vivo', waId: `call-${c.id}`,
      telefone: c.telefone, pushName: null, participante: null,
      info: { tipo: 'chamada', texto: descreverChamada(extra), legenda: null, midia: null, extra },
      citacao: { id: null, texto: null, deMim: null }, raw: null, status: null, recibos: {},
    };
    try { tx(() => aplicarPreparada(instanciaId, p)); } catch (err) { console.error('[whatsapp] não consegui registrar a chamada:', err.message); }
    avisar({ chat: c.jid });
  }
  emitir('chamada', { ...publica(c), status: 'encerrada', resultado, duracao });
}

/** Evento "call" do Baileys */
export async function aoReceberChamadas(instanciaId, sock, lib, lista) {
  for (const call of lista || []) {
    if (!call?.id) continue;
    let c = ativas.get(call.id);
    if (!c && (call.status === 'offer' || call.status === 'ringing')) {
      const jid = lib.jidNormalizedUser(call.from);
      const telefone = call.callerPn ? lib.jidDecode(call.callerPn)?.user : telefoneDoJid(jid) || await resolverTelefone(lib, sock, jid);
      c = {
        id: call.id, numero: instanciaId, from: call.from, jid, telefone, video: Boolean(call.isVideo), grupo: Boolean(call.isGroup),
        inicio: (call.date instanceof Date ? call.date : new Date()).toISOString(), status: 'tocando',
      };
      c.nome = nomeDe(jid, telefone);
      c.chave = chaveDaConversa(jid, telefone);
      ativas.set(call.id, c);
      // Chamadas que chegam com o CRM desligado (offline) só ficam registradas
      if (!call.offline) emitir('chamada', publica(c));
      continue;
    }
    if (!c) continue;
    if (call.isVideo !== undefined && call.isVideo !== null) c.video = Boolean(call.isVideo) || c.video;
    if (call.status === 'accept') {
      c.status = 'em_andamento';
      c.atendidaEm = (call.date instanceof Date ? call.date : new Date()).toISOString();
      emitir('chamada', publica(c));
    } else if (call.status === 'reject') {
      await finalizar(instanciaId, c, c.recusadaPeloCrm ? 'recusada' : c.atendidaEm ? 'atendida_em_outro_aparelho' : 'recusada', call.date);
    } else if (call.status === 'timeout') {
      await finalizar(instanciaId, c, 'perdida', call.date);
    } else if (call.status === 'terminate') {
      await finalizar(instanciaId, c, c.atendidaEm ? 'atendida_em_outro_aparelho' : c.recusadaPeloCrm ? 'recusada' : 'perdida', call.date instanceof Date ? call.date : new Date());
    }
  }
}

export async function recusarChamada(callId) {
  const c = ativas.get(callId);
  if (!c) throw new ErroHttp(404, 'Esta chamada já terminou');
  const e = socketConectado(c.numero);
  if (!e) throw new ErroHttp(409, 'O número que recebeu a chamada não está conectado');
  c.recusadaPeloCrm = true;
  await e.sock.rejectCall(c.id, c.from);
  await finalizar(c.numero, c, 'recusada');
  return c;
}

// Link de chamada do WhatsApp (abre a chamada no celular/computador de quem clicar)
export async function criarLinkDeChamada(numeroId, video) {
  const e = socketConectado(numeroId);
  if (!e) throw new ErroHttp(409, 'Este número não está conectado');
  if (typeof e.sock.createCallLink !== 'function') throw new ErroHttp(501, 'Esta versão da biblioteca do WhatsApp não cria links de chamada');
  let token;
  try {
    token = await e.sock.createCallLink(video ? 'video' : 'audio', undefined, 15000);
  } catch (err) {
    throw new ErroHttp(502, `O WhatsApp não criou o link: ${err.message}`);
  }
  if (!token) throw new ErroHttp(502, 'O WhatsApp não devolveu o link da chamada');
  await carregarBaileys();
  return { link: `https://call.whatsapp.com/${video ? 'video' : 'voice'}/${token}`, video, criado_em: agora() };
}

export const _chamadasParaTeste = { ativas, estado };
