// Revisão dos atendimentos da IA: confere quem está em "IA atendendo" e se ficou alguém sem resposta.
//
// Por que existe: a IA reage a eventos (mensagem chegando ao vivo, cadastro novo). Mensagens que chegam enquanto o CRM
// está reiniciando/atualizando ou o WhatsApp está reconectando são gravadas depois ("offline") e não acordam a IA. Um
// reinício no meio de um atendimento também pode deixar a conversa "ativa" sem nada agendado. Nesses casos o lead fica
// esperando para sempre.
//
// A revisão roda sozinha (1,5 min depois de ligar o servidor e a cada 5 min) e também pelo botão "Revisar agora":
//  - lê todas as conversas com status "ativa";
//  - vê se a última mensagem da conversa é do lead (ou, no formulário/fila, se a 1ª mensagem nunca saiu);
//  - se a conversa não está agendada nem sendo atendida, volta o ponteiro de leitura para antes das mensagens sem
//    resposta e agenda a IA para retomar de onde parou (as travas de proteção e o horário continuam valendo);
//  - se alguém da equipe já respondeu, marca "Equipe assumiu"; se já tentou retomar 3 vezes em 6 h, passa para a equipe;
//  - solta um atendimento que ficou preso mais de 10 min (para o "um lead por vez" não travar a fila inteira).
import { get, all, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { lerConfig } from './config.js';
import { registrar } from './cliente.js';
import {
  contatoDaConversa, historicoDaConversa, teveContatoHumano, atualizar, passarParaHumano, emAtendimento, soltarAtendimento,
} from './motor.js';

const ORIGENS_PROATIVAS = ['yayforms', 'fila'];
export const MAX_RETOMADAS = 3;
const JANELA_RETOMADAS_MS = 6 * 3600000;
const ATENDIMENTO_TRAVADO_MS = 10 * 60000;
const PRIMEIRA_REVISAO_MS = 90 * 1000;
const INTERVALO_REVISAO_MS = 5 * 60000;

let ultimaRevisao = null;

/**
 * Situação de uma conversa ativa. Devolve null se está em dia (a última mensagem é nossa) ou
 * { pendentes: [mensagens do lead sem resposta], desde, primeiraMensagem, contato }.
 */
function semResposta(conversa) {
  const contato = contatoDaConversa(conversa);
  const historico = historicoDaConversa(contato);
  // Ligada à mão: a IA só responde o que o lead mandou depois de ligada
  const considerado = conversa.origem === 'manual'
    ? historico.filter((m) => m.from_me || new Date(m.timestamp).getTime() >= new Date(conversa.ativada_em).getTime())
    : historico;
  const ultima = considerado.at(-1);
  if (!ultima) {
    // Formulário/fila: a IA devia mandar a 1ª mensagem e ela nunca saiu
    if (ORIGENS_PROATIVAS.includes(conversa.origem) && !historico.some((m) => m.from_me)) {
      return { pendentes: [], desde: conversa.ativada_em, primeiraMensagem: true, contato };
    }
    return null;
  }
  if (ultima.from_me) return null;
  // Mensagens do lead depois da nossa última
  const pendentes = [];
  for (let i = considerado.length - 1; i >= 0 && !considerado[i].from_me; i--) pendentes.unshift(considerado[i]);
  return { pendentes, desde: pendentes[0].timestamp, primeiraMensagem: false, contato };
}

function retomadasRecentes(conversaId) {
  const desde = new Date(Date.now() - JANELA_RETOMADAS_MS).toISOString();
  return get("SELECT count(*) AS n FROM ia_registro WHERE conversa_id = ? AND tipo = 'retomada' AND created_at >= ?", [conversaId, desde]).n;
}

function nomeDe(c) {
  const lead = c.lead_id ? get('SELECT name FROM leads WHERE id = ?', [c.lead_id])?.name : null;
  const contato = c.jid ? get('SELECT COALESCE(name, push_name) AS n FROM wa_contacts WHERE jid = ?', [c.jid])?.n : null;
  return lead || contato || null;
}

/**
 * Lê todas as conversas em "IA atendendo" e devolve como está cada uma que tem lead sem resposta.
 * situacao: parada (ninguém vai responder — a revisão corrige) | agendada | atendendo_agora | travada | aguardando_aprovacao
 */
export function diagnosticar() {
  const ativas = all("SELECT * FROM ia_conversas WHERE status = 'ativa' ORDER BY id");
  const atendendo = new Map(emAtendimento().map((a) => [a.id, a.desde]));
  const lista = [];
  for (const c of ativas) {
    const s = semResposta(c);
    if (!s) continue;
    const sugestao = get("SELECT 1 AS ok FROM ia_sugestoes WHERE conversa_id = ? AND status = 'pendente' LIMIT 1", [c.id]);
    let situacao;
    if (sugestao) situacao = 'aguardando_aprovacao';
    else if (atendendo.has(c.id)) situacao = Date.now() - atendendo.get(c.id) > ATENDIMENTO_TRAVADO_MS ? 'travada' : 'atendendo_agora';
    else if (c.proxima_em) situacao = 'agendada';
    else situacao = 'parada';
    const trava = situacao === 'agendada'
      ? get("SELECT tipo, detalhe FROM ia_registro WHERE conversa_id = ? ORDER BY id DESC LIMIT 1", [c.id])
      : null;
    lista.push({
      conversa_id: c.id, chave: c.chave, lead_id: c.lead_id, phone: c.phone, nome: nomeDe(c), origem: c.origem,
      situacao, proxima_em: c.proxima_em, sem_resposta_desde: s.desde, mensagens_sem_resposta: s.pendentes.length,
      primeira_mensagem: s.primeiraMensagem, ultima_mensagem: s.pendentes.at(-1)?.body?.slice(0, 140) || null,
      motivo_espera: trava && !['enviada', 'chamada_modelo', 'inicio', 'retomada'].includes(trava.tipo) ? trava.detalhe : null,
      retomadas: retomadasRecentes(c.id),
      _s: s, _c: c,
    });
  }
  return { total_ativas: ativas.length, lista };
}

const publico = ({ _s, _c, ...resto }) => resto;

/** Revisa e corrige: retoma as conversas paradas de onde pararam. origem: 'automatica' | nome de quem clicou */
export async function revisarAtendimentos({ origem = 'automatica' } = {}) {
  const cfg = lerConfig();
  const resultado = { em: agora(), origem, ativa: cfg.ativo, conversas_ativas: 0, retomadas: 0, equipe_assumiu: 0, passadas_para_equipe: 0, soltas: 0, pendencias: [] };
  if (!cfg.ativo) {
    ultimaRevisao = resultado;
    return resultado;
  }
  const { total_ativas, lista } = diagnosticar();
  resultado.conversas_ativas = total_ativas;
  let ordem = 0;
  for (const item of lista) {
    const { _s: s, _c: c } = item;
    if (item.situacao === 'travada') {
      soltarAtendimento(c.id);
      resultado.soltas++;
      registrar(c.id, 'revisao', 'Atendimento preso há mais de 10 min foi solto pela revisão');
      item.situacao = c.proxima_em ? 'agendada' : 'parada';
    }
    if (item.situacao !== 'parada') {
      resultado.pendencias.push(publico(item));
      continue;
    }
    // Alguém da equipe respondeu (ex.: pelo celular enquanto o CRM estava fora): a IA sai da conversa
    if (teveContatoHumano(s.contato, c.ativada_em)) {
      atualizar(c.id, { status: 'humano', motivo: 'Equipe assumiu a conversa', proxima_em: null });
      registrar(c.id, 'humano_assumiu', 'Visto na revisão');
      resultado.equipe_assumiu++;
      continue;
    }
    if (item.retomadas >= MAX_RETOMADAS) {
      await passarParaHumano(c, { motivo: `A IA tentou retomar ${MAX_RETOMADAS} vezes e não conseguiu responder — responda você` });
      resultado.passadas_para_equipe++;
      continue;
    }
    // Volta o ponteiro de leitura para antes das mensagens sem resposta, para a IA lê-las de novo
    const campos = { proxima_em: new Date(Date.now() + 5000 + ordem * 3000).toISOString() };
    if (s.pendentes.length) {
      const primeira = Math.min(...s.pendentes.map((m) => m.id));
      if (c.ultima_lida_id >= primeira) campos.ultima_lida_id = primeira - 1;
    }
    atualizar(c.id, campos);
    const detalhe = s.primeiraMensagem
      ? 'Primeira mensagem não tinha saído: a IA vai mandar agora'
      : `${s.pendentes.length} mensagem(ns) do lead sem resposta desde ${new Date(s.desde).toLocaleString('pt-BR')}`;
    registrar(c.id, 'retomada', `${detalhe}${origem === 'automatica' ? '' : ` (revisão pedida por ${origem})`}`);
    console.log(`[ia] revisão: retomando conversa #${c.id} (${c.chave}) — ${detalhe}`);
    emitir('ia', { conversa: c.id, chave: c.chave });
    resultado.retomadas++;
    ordem++;
    resultado.pendencias.push({ ...publico(item), situacao: 'retomada', proxima_em: campos.proxima_em, retomadas: item.retomadas + 1 });
  }
  if (resultado.retomadas || resultado.equipe_assumiu || resultado.passadas_para_equipe || resultado.soltas) emitir('ia', { revisao: true });
  ultimaRevisao = resultado;
  return resultado;
}

/** Estado para a tela: pendências de agora + resultado da última revisão */
export function estadoRevisao() {
  const { total_ativas, lista } = diagnosticar();
  return { conversas_ativas: total_ativas, pendencias: lista.map(publico), ultima_revisao: ultimaRevisao };
}

// ------------------------------------------------------------------ relógio

let primeira = null;
let periodica = null;

export function iniciarRevisao() {
  if (periodica) return;
  const rodar = () => revisarAtendimentos().catch((err) => console.error('[ia] revisão:', err.message));
  // Espera o WhatsApp reconectar e gravar as mensagens que chegaram com o CRM fora antes da primeira revisão
  primeira = setTimeout(rodar, PRIMEIRA_REVISAO_MS);
  periodica = setInterval(rodar, INTERVALO_REVISAO_MS);
  primeira.unref?.();
  periodica.unref?.();
}

export function pararRevisao() {
  clearTimeout(primeira);
  clearInterval(periodica);
  primeira = null;
  periodica = null;
}
