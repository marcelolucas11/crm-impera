// Importação do histórico do WhatsApp (padrão: 90 dias, WHATSAPP_HISTORICO_DIAS).
//
// 1) Ao conectar pelo QR code, o celular manda o histórico em lotes (INITIAL_BOOTSTRAP, RECENT, FULL...).
//    Todos os lotes são processados; só entra o que estiver dentro da janela de dias.
// 2) Se o celular mandou menos que a janela, o CRM completa conversa por conversa com
//    fetchMessageHistory (um pedido de cada vez, com intervalo), até cobrir a janela ou o celular não ter mais.
// 3) Números já conectados: o botão "Importar 3 meses de histórico" faz o passo 2 sem desconectar.
//    (O passo 1 só acontece numa conexão nova: conversas que o CRM nunca viu só chegam reconectando.)
// O progresso vai para a tela em tempo real (evento "importacao").
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { emitir } from '../../tempoReal.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { ErroHttp } from '../../util.js';
import { horarioDaMensagem } from './conteudo.js';
import { estado, socketConectado, avisar, esperar } from './instancias.js';
import { gravarLote, aplicarMapeamentos, aoAtualizarContatos, aplicarEstadoChats } from './recebimento.js';
import { religarTudo } from './ligacao.js';

const POR_PEDIDO = 50;
const INTERVALO_PEDIDOS_MS = Number(process.env.WHATSAPP_HISTORICO_INTERVALO_MS || 2500);
const ESPERA_RESPOSTA_MS = Number(process.env.WHATSAPP_HISTORICO_ESPERA_MS || 25000);
const SILENCIO_ANTES_DE_COMPLETAR_MS = Number(process.env.WHATSAPP_HISTORICO_SILENCIO_MS || 90000);
const MAX_PEDIDOS_POR_CONVERSA = 40;

const nomeEstado = (id) => `whatsapp_historico_${id}`;
export const limiteDaJanela = (dias = config.whatsapp.historicoDias) => Date.now() - dias * 86400000;

// Progresso da importação de um número (fica na memória e no banco, para sobreviver a reinícios)
export function progressoDe(id) {
  return estado(id).historico || lerEstado(nomeEstado(id)) || null;
}

function atualizarProgresso(id, dados, { gravar = false } = {}) {
  const e = estado(id);
  e.historico = { ...(e.historico || lerEstado(nomeEstado(id)) || {}), ...dados, numero: id, atualizado_em: agora() };
  if (gravar) salvarEstado(nomeEstado(id), e.historico);
  emitir('importacao', e.historico);
  return e.historico;
}

// Religação com os leads depois de lotes de histórico (agrupada: no máximo uma a cada 3 s)
let religarTimer = null;
export function agendarReligar() {
  if (religarTimer) return;
  religarTimer = setTimeout(() => {
    religarTimer = null;
    try {
      const n = religarTudo();
      if (n) avisar({ historico: true });
    } catch (err) {
      console.error('[whatsapp] erro ao religar conversas e leads:', err.message);
    }
  }, 3000);
  religarTimer.unref?.();
}

// Pedidos ao celular em andamento: chat → { resolver, manual }
const pedidos = new Map();
const chavePedido = (id, jid) => `${id}|${jid}`;

/**
 * Lote de histórico vindo do celular (evento messaging-history.set).
 */
export async function aoReceberHistorico(id, sock, lib, dados = {}) {
  const { messages = [], contacts = [], chats = [], lidPnMappings = [], syncType, progress } = dados;
  const tipos = lib.proto.HistorySync.HistorySyncType;
  const sobDemanda = syncType === tipos.ON_DEMAND;
  if (lidPnMappings?.length) aplicarMapeamentos(lib, lidPnMappings);
  if (contacts?.length) aoAtualizarContatos(lib, contacts);
  if (chats?.length) aplicarEstadoChats(lib, id, chats);
  if (!sobDemanda && config.whatsapp.historicoDias === 0) return { novas: 0 };

  // Conversas pedidas à mão (botão na conversa) trazem tudo; o resto respeita a janela de dias
  const manuais = new Set();
  if (sobDemanda) {
    for (const m of messages) {
      const jid = m?.key?.remoteJid && lib.jidNormalizedUser(m.key.remoteJid);
      if (pedidos.get(chavePedido(id, jid))?.manual) manuais.add(jid);
    }
  }
  const limite = limiteDaJanela();
  const dentro = messages
    .filter((m) => {
      const jid = m?.key?.remoteJid && lib.jidNormalizedUser(m.key.remoteJid);
      return manuais.has(jid) || new Date(horarioDaMensagem(m.messageTimestamp)).getTime() >= limite;
    })
    .sort((a, b) => horarioDaMensagem(a.messageTimestamp).localeCompare(horarioDaMensagem(b.messageTimestamp)));

  const anterior = progressoDe(id) || {};
  if (!sobDemanda) {
    atualizarProgresso(id, {
      fase: 'recebendo',
      progresso: typeof progress === 'number' ? progress : anterior.progresso ?? null,
      importadas: anterior.importadas || 0,
      erro: null,
    });
  }

  const { novas, chats: tocados } = dentro.length
    ? await gravarLote(id, sock, lib, dentro, 'historico', (_feitas, novasAgora) => {
      if (!sobDemanda) atualizarProgresso(id, { importadas: (anterior.importadas || 0) + novasAgora });
    })
    : { novas: 0, chats: new Set() };

  // Nomes da agenda chegam junto: aplica de novo agora que as conversas existem
  if (contacts?.length && novas) aoAtualizarContatos(lib, contacts);

  const maisAntiga = dentro[0] ? horarioDaMensagem(dentro[0].messageTimestamp) : null;
  const atual = progressoDe(id) || {};
  atualizarProgresso(id, {
    importadas: (sobDemanda ? atual.importadas || 0 : anterior.importadas || 0) + novas,
    mais_antiga: [atual.mais_antiga, maisAntiga].filter(Boolean).sort()[0] || null,
    fase: sobDemanda ? atual.fase : progress === 100 ? 'recebido' : 'recebendo',
  }, { gravar: true });

  // Avisa quem estava esperando a resposta de um pedido
  const respondidos = new Set([...tocados, ...messages.map((m) => m?.key?.remoteJid && lib.jidNormalizedUser(m.key.remoteJid)).filter(Boolean)]);
  for (const jid of respondidos) pedidos.get(chavePedido(id, jid))?.resolver?.();
  // Resposta vazia: o celular não tem nada mais antigo
  if (sobDemanda && !messages.length) for (const [k, p] of pedidos) if (k.startsWith(`${id}|`)) p.resolver?.();

  if (novas) {
    console.log(`[whatsapp #${id}] histórico${sobDemanda ? ' (pedido)' : ''}: ${novas} mensagens importadas`);
    avisar({ historico: true });
    agendarReligar();
  }
  if (!sobDemanda) agendarComplemento(id);
  return { novas };
}

// ---------------------------------------------------------------- complemento (fetchMessageHistory)

const timersComplemento = new Map();

/**
 * Depois que o celular para de mandar lotes, completa a janela de dias conversa por conversa.
 * Só roda sozinho depois de uma conexão nova (QR code) ou para retomar uma importação interrompida.
 */
export function agendarComplemento(id, atraso = SILENCIO_ANTES_DE_COMPLETAR_MS) {
  if (!config.whatsapp.historicoDias) return;
  const e = estado(id);
  if (!e.complementarAoTerminar) return;
  clearTimeout(timersComplemento.get(id));
  const t = setTimeout(() => {
    timersComplemento.delete(id);
    importarHistorico(id, { automatico: true }).catch((err) => console.error(`[whatsapp #${id}] complemento do histórico:`, err.message));
  }, atraso);
  t.unref?.();
  timersComplemento.set(id, t);
}

// Na conexão: decide se o complemento deve rodar sozinho
export function aoConectar(id, { conexaoNova = false } = {}) {
  const e = estado(id);
  const salvo = lerEstado(nomeEstado(id));
  e.historico = e.historico || salvo || null;
  // Conexão nova pelo QR code, ou importação que ficou pela metade (CRM reiniciado no meio)
  e.complementarAoTerminar = conexaoNova || salvo?.fase === 'completando';
  if (e.complementarAoTerminar) agendarComplemento(id, conexaoNova ? SILENCIO_ANTES_DE_COMPLETAR_MS : 15000);
}

function conversasParaCompletar(id) {
  const limite = new Date(limiteDaJanela()).toISOString();
  const margem = new Date(limiteDaJanela() + 86400000).toISOString();
  return all(
    `SELECT m.chat_jid, min(m.timestamp) AS mais_antiga, max(m.timestamp) AS mais_nova
       FROM wa_messages m LEFT JOIN wa_chats c ON c.jid = m.chat_jid
      WHERE m.instance_id = ? AND COALESCE(c.history_done, 0) = 0 AND m.raw IS NOT NULL
      GROUP BY m.chat_jid
     HAVING mais_nova >= ? AND mais_antiga > ?
      ORDER BY mais_nova DESC`,
    [id, limite, margem]
  );
}

function maisAntigaDaConversa(id, jid) {
  return get(
    `SELECT wa_id, from_me, timestamp, participant_jid FROM wa_messages
      WHERE instance_id = ? AND chat_jid = ? AND raw IS NOT NULL ORDER BY timestamp ASC, id ASC LIMIT 1`,
    [id, jid]
  );
}

function esperarResposta(id, jid, manual = false) {
  return new Promise((resolve) => {
    const k = chavePedido(id, jid);
    const timer = setTimeout(() => { pedidos.delete(k); resolve(false); }, ESPERA_RESPOSTA_MS);
    pedidos.set(k, {
      manual,
      resolver: () => { clearTimeout(timer); pedidos.delete(k); resolve(true); },
      cancelar: () => { clearTimeout(timer); pedidos.delete(k); resolve(false); },
    });
  });
}

// Pede ao celular as mensagens anteriores à mais antiga que o CRM tem desta conversa
export async function pedirAnteriores(e, jid, linha, manual = false) {
  const chave = { remoteJid: jid, fromMe: Boolean(linha.from_me), id: linha.wa_id };
  if (linha.participant_jid) chave.participant = linha.participant_jid;
  const resposta = esperarResposta(e.id, jid, manual);
  try {
    // O campo do protocolo é em milissegundos (oldestMsgTimestampMs)
    await e.sock.fetchMessageHistory(POR_PEDIDO, chave, new Date(linha.timestamp).getTime());
  } catch (err) {
    pedidos.get(chavePedido(e.id, jid))?.cancelar?.();
    throw err;
  }
  return { resposta };
}

/**
 * Completa o histórico de todas as conversas de um número até a janela de dias.
 * Um pedido de cada vez, com intervalo. Pode ser chamado pelo botão (sem desconectar).
 */
export async function importarHistorico(id, { automatico = false } = {}) {
  const e = socketConectado(id);
  if (!e) throw new ErroHttp(409, 'Este número não está conectado');
  if (!config.whatsapp.historicoDias) throw new ErroHttp(400, 'A importação de histórico está desligada (WHATSAPP_HISTORICO_DIAS=0)');
  if (e.importando) return progressoDe(id);
  if (typeof e.sock.fetchMessageHistory !== 'function') throw new ErroHttp(501, 'Esta versão da biblioteca do WhatsApp não permite buscar histórico');
  e.importando = true;
  e.complementarAoTerminar = false;
  const limite = limiteDaJanela();
  try {
    const lista = conversasParaCompletar(id);
    atualizarProgresso(id, {
      fase: 'completando', total: lista.length, feitas: 0, erro: null, automatico, dias: config.whatsapp.historicoDias,
      iniciado_em: agora(),
    }, { gravar: true });

    let feitas = 0;
    for (const conversa of lista) {
      if (!socketConectado(id)) throw new Error('O número desconectou no meio da importação. Ela continua quando ele voltar.');
      let pedidosFeitos = 0;
      let antes = maisAntigaDaConversa(id, conversa.chat_jid);
      while (antes && new Date(antes.timestamp).getTime() > limite && pedidosFeitos < MAX_PEDIDOS_POR_CONVERSA) {
        pedidosFeitos++;
        let respondeu = false;
        try {
          respondeu = await (await pedirAnteriores(e, conversa.chat_jid, antes)).resposta;
        } catch (err) {
          console.error(`[whatsapp #${id}] pedido de histórico falhou:`, err.message);
        }
        await esperar(INTERVALO_PEDIDOS_MS);
        const depois = maisAntigaDaConversa(id, conversa.chat_jid);
        if (!respondeu || !depois || depois.timestamp >= antes.timestamp) {
          // Nada mais antigo: o celular não tem (ou não quis mandar). Não pede de novo nesta conversa.
          run(
            `INSERT INTO wa_chats (jid, instance_id, history_done, history_checked_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(jid) DO UPDATE SET history_done = 1, history_checked_at = excluded.history_checked_at`,
            [conversa.chat_jid, id, agora()]
          );
          break;
        }
        antes = depois;
      }
      feitas++;
      atualizarProgresso(id, { feitas }, { gravar: feitas % 10 === 0 });
    }
    religarTudo();
    atualizarProgresso(id, { fase: 'concluido', feitas, concluido_em: agora() }, { gravar: true });
    avisar({ historico: true });
  } catch (err) {
    atualizarProgresso(id, { fase: 'interrompido', erro: err.message }, { gravar: true });
    if (!automatico) throw err;
  } finally {
    e.importando = false;
  }
  return progressoDe(id);
}

// Botão "Buscar mensagens anteriores no celular" dentro de uma conversa (sem limite de dias)
export async function buscarMaisAntigas(chatJids, instanciaPreferida = null) {
  if (!chatJids?.length) throw new ErroHttp(400, 'Conversa sem mensagens');
  const linha = get(
    `SELECT instance_id, chat_jid, wa_id, from_me, timestamp, participant_jid FROM wa_messages
      WHERE chat_jid IN (${chatJids.map(() => '?').join(',')}) AND raw IS NOT NULL ORDER BY timestamp ASC, id ASC LIMIT 1`,
    chatJids
  );
  if (!linha) throw new ErroHttp(400, 'Conversa sem mensagens que o celular reconheça');
  const e = socketConectado(linha.instance_id) || socketConectado(instanciaPreferida);
  if (!e) throw new ErroHttp(409, 'O número desta conversa não está conectado');
  run('UPDATE wa_chats SET history_done = 0 WHERE jid = ?', [linha.chat_jid]);
  await pedirAnteriores(e, linha.chat_jid, linha, true);
}
