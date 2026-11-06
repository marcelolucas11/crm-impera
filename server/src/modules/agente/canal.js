// Canal do WhatsApp: conversar com a Alice pelo WhatsApp.
//  - Mensagens (texto, áudio, foto, documento) que chegam dos números pessoais cadastrados na Alice de um usuário vão
//    para a Alice dele, não para o fluxo de lead (a IA de primeiro contato ignora esses números).
//  - "Mensagem para mim": o que o usuário escreve na conversa com o próprio número conectado também vai para a Alice
//    (se ele ligou essa opção e o número é dele).
//  - "SIM 12" / "NÃO 12" aprova ou recusa a ação 12, só vindo do próprio dono. "nova conversa" começa outra conversa.
//  - Mensagens seguidas são juntadas (espera 4 s) antes de responder.
import { get } from '../../db.js';
import { lerJson } from '../../events.js';
import { ErroHttp } from '../../util.js';
import { ErroIA } from '../ia/cliente.js';
import { socketConectado } from '../whatsapp/instancias.js';
import { donoDoTelefone, lerConfig, usuariosComAlice } from './config.js';
import { criarConversa, gravarMensagemUsuario, executarTurno } from './motor.js';
import { aprovar, recusar, obterAcao, mapearAcao } from './acoes.js';
import { paraWhatsApp, dividir, jidProprio } from './whatsapp.js';
import * as transcricao from './transcricao.js';

const ESPERA_MS = 4000;
const pendentes = new Map(); // userId → { timer, itens: [], resposta: { numeroId, jid } }
const ocupados = new Set();

async function responder(userId, alvo, texto) {
  const { enviar } = await import('../whatsapp/envio.js');
  const cfg = lerConfig(userId);
  const numeroId = (cfg.whatsapp_numero_id && socketConectado(cfg.whatsapp_numero_id)) ? cfg.whatsapp_numero_id : alvo.numeroId;
  if (!socketConectado(numeroId)) return;
  for (const parte of dividir(paraWhatsApp(texto))) {
    await enviar(numeroId, { jid: alvo.jid }, { texto: parte, origem: 'alice', semPrevia: true }, userId);
  }
}

function conversaDoWhatsApp(userId) {
  const atual = get("SELECT id FROM agente_conversas WHERE user_id = ? AND origem = 'whatsapp' AND arquivada = 0 ORDER BY updated_at DESC LIMIT 1", [userId]);
  return atual?.id || criarConversa(userId, { titulo: '📱 WhatsApp', origem: 'whatsapp' });
}

// Texto da mensagem recebida (áudio transcrito; mídia vira referência para ver_midia)
async function textoDaLinha(linhaId) {
  const m = get('SELECT id, type, body, legenda, media_name FROM wa_messages WHERE id = ?', [linhaId]);
  if (!m) return null;
  if (m.type === 'texto') return m.body || '';
  if (m.type === 'audio') {
    try {
      return `[áudio] ${await transcricao.transcreverMensagem(m.id)}`;
    } catch (err) {
      return `[mandei um áudio (msg ${m.id}), mas não deu para transcrever: ${err.message}]`;
    }
  }
  if (['imagem', 'documento'].includes(m.type)) return `[mandei ${m.type === 'imagem' ? 'uma imagem' : `o arquivo "${m.media_name || ''}"`} (msg ${m.id}): use ver_midia]${m.legenda ? ` ${m.legenda}` : ''}`;
  return null;
}

async function tratarComando(userId, texto) {
  const t = String(texto || '').trim();
  const sim = t.match(/^(sim|aprovo|aprovar|ok)\s*#?(\d+)$/i);
  const nao = t.match(/^(n[aã]o|recuso|recusar)\s*#?(\d+)$/i);
  if (sim) {
    try {
      const a = await aprovar(Number(sim[2]), userId, {}, { papel: get('SELECT role FROM users WHERE id = ?', [userId])?.role });
      return `✅ Feito (#${a.id}): ${a.resumo}`;
    } catch (err) { return `⚠️ Ação #${sim[2]}: ${err.message}`; }
  }
  if (nao) {
    try { const a = recusar(Number(nao[2]), userId); return `✖️ Recusado (#${a.id}): ${a.resumo}`; } catch (err) { return `⚠️ Ação #${nao[2]}: ${err.message}`; }
  }
  if (/^\/?nova(\s+conversa)?$/i.test(t)) {
    criarConversa(userId, { titulo: '📱 WhatsApp', origem: 'whatsapp' });
    return '🆕 Comecei uma conversa nova.';
  }
  return null;
}

async function processar(userId) {
  const fila = pendentes.get(userId);
  if (!fila) return;
  if (ocupados.has(userId)) { fila.timer = setTimeout(() => processar(userId), ESPERA_MS); return; }
  pendentes.delete(userId);
  ocupados.add(userId);
  try {
    const textos = [];
    for (const id of fila.itens) {
      const t = await textoDaLinha(id);
      if (t) textos.push(t);
    }
    if (!textos.length) return;
    if (textos.length === 1) {
      const comando = await tratarComando(userId, textos[0]);
      if (comando) { await responder(userId, fila.resposta, comando); return; }
    }
    const conversaId = conversaDoWhatsApp(userId);
    const msg = await gravarMensagemUsuario(userId, conversaId, { texto: textos.join('\n') });
    let r;
    try {
      r = await executarTurno({ userId, conversaId, conteudoUsuario: msg.conteudo, origem: 'whatsapp' });
    } catch (err) {
      await responder(userId, fila.resposta, `⚠️ ${err instanceof ErroIA || err instanceof ErroHttp ? err.message : 'Não consegui responder agora.'}`);
      return;
    }
    let texto = r.texto;
    if (r.acoes.length) {
      const linhas = r.acoes.map((id) => { const a = mapearAcao(obterAcao(id, userId)); return `#${a.id} — ${a.resumo}${a.dados.texto ? `\n“${String(a.dados.texto).slice(0, 300)}”` : ''}`; });
      texto += `\n\n*Para aprovar:* responda SIM <número> (ou NÃO <número>)\n${linhas.join('\n')}`;
    }
    await responder(userId, fila.resposta, texto);
  } catch (err) {
    console.error('[agente] canal WhatsApp:', err.message);
  } finally {
    ocupados.delete(userId);
  }
}

function enfileirar(userId, linhaId, resposta) {
  const atual = pendentes.get(userId) || { itens: [], resposta };
  clearTimeout(atual.timer);
  atual.itens.push(linhaId);
  atual.resposta = resposta;
  atual.timer = setTimeout(() => processar(userId), ESPERA_MS);
  atual.timer.unref?.();
  pendentes.set(userId, atual);
}

/** Gancho: mensagem nova de um contato (ao vivo) */
export function aoReceber({ instanciaId, chatJid, phone, linhaId }) {
  if (!linhaId || !phone) return false;
  const dono = donoDoTelefone(phone);
  if (!dono?.cfg.whatsapp_ativo) return false;
  enfileirar(dono.userId, linhaId, { numeroId: instanciaId, jid: chatJid });
  return true;
}

/** Gancho: mensagem nossa mandada pelo celular. Se for na conversa com o próprio número, vai para a Alice. */
export async function aoMensagemPropria({ instanciaId, jid, linhaId }) {
  if (!linhaId || !instanciaId || !jid) return false;
  const linha = get('SELECT extra FROM wa_messages WHERE id = ?', [linhaId]);
  if (lerJson(linha?.extra).origem) return false; // resposta da própria Alice (ou outra automação)
  const proprio = await jidProprio(instanciaId);
  if (!proprio || proprio !== jid) return false;
  const telefoneNumero = get('SELECT phone FROM wa_instances WHERE id = ?', [instanciaId])?.phone || proprio.split('@')[0];
  const candidatos = usuariosComAlice().filter((u) => u.cfg.whatsapp_ativo && u.cfg.whatsapp_proprio
    && (u.cfg.whatsapp_numero_id === Number(instanciaId) || u.cfg.whatsapp_telefones.some((t) => String(telefoneNumero).endsWith(t) || t.endsWith(String(telefoneNumero)))));
  if (candidatos.length !== 1) return false;
  enfileirar(candidatos[0].user_id, linhaId, { numeroId: instanciaId, jid: proprio });
  return true;
}

export const _paraTeste = { pendentes, processar, tratarComando };
