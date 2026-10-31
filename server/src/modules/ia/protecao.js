// Contingência do número: travas que deixam o ritmo da IA parecido com o de uma pessoa e evitam que o WhatsApp
// (conectado por QR code, que não é oficial) marque o número como spam.
//
//  - Um lead por vez: a IA só atende uma conversa de cada vez (o relógio do motor cuida disso).
//  - Intervalo entre leads: depois de responder um lead, espera um tempo aleatório antes de ir para OUTRO lead.
//  - Pausas de descanso: a cada N mensagens enviadas, para por um tempo aleatório entre X e Y minutos.
//  - Limites: mensagens por hora, mensagens em 24 h e leads novos (primeira mensagem da IA) em 24 h.
//    O contador de leads novos é uma janela móvel de 24 h ou, com zerar_novos_meia_noite, zera à meia-noite (no fuso
//    configurado). Dá também para zerar na mão (zerarLeadsNovos): só conta quem foi abordado depois daquele momento.
//  - Freio de falhas: 3 erros de envio seguidos pausam a IA por 30 minutos (pode ser o número sendo limitado).
//
// Nada é perdido quando uma trava segura a IA: a conversa só fica para depois (proxima_em) e é atendida quando liberar.
// O estado fica em integration_state 'ia_protecao'.
import { get, run } from '../../db.js';
import { lerEstado, salvarEstado } from '../../estado.js';

const ESTADO = 'ia_protecao';
const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
export const FALHAS_PARA_PAUSAR = 3;
export const PAUSA_FALHAS_MIN = 30;

const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => (v ? new Date(v).getTime() : 0);
const entre = (min, max, aleatorio) => min + (max - min) * aleatorio();

function contarEnviadas(desdeMs) {
  return get("SELECT count(*) AS n FROM ia_registro WHERE tipo = 'enviada' AND created_at >= ?", [iso(desdeMs)]).n;
}

// Meia-noite (início do dia) no fuso, em ms. desloca = 1 dá a próxima meia-noite.
export function meiaNoiteNoFuso(agoraMs, fuso = 'America/Sao_Paulo', desloca = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(agoraMs)).map((x) => [x.type, Number(x.value)]));
  const offset = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - agoraMs) / MIN) * MIN;
  return Date.UTC(p.year, p.month - 1, p.day + desloca) - offset;
}

// Desde quando contam os leads novos: últimas 24 h ou desde a meia-noite, e nunca antes de um "zerar" manual
function inicioJanelaNovos(cfg, agoraMs) {
  const base = cfg.zerar_novos_meia_noite ? meiaNoiteNoFuso(agoraMs, cfg.fuso) : agoraMs - DIA;
  return Math.max(base, ms(lerEstado(ESTADO).novos_zerado_em));
}

// Quando abre vaga de lead novo: na próxima meia-noite, ou quando o lead mais antigo sai da janela de 24 h
function quandoLiberaNovos(cfg, agoraMs) {
  if (cfg.zerar_novos_meia_noite) return meiaNoiteNoFuso(agoraMs, cfg.fuso, 1);
  const t = get(`SELECT min(t) AS t FROM (SELECT min(created_at) AS t FROM ia_registro WHERE tipo = 'enviada' AND conversa_id IS NOT NULL
          GROUP BY conversa_id) WHERE t >= ?`, [iso(inicioJanelaNovos(cfg, agoraMs))])?.t;
  return t ? ms(t) + DIA + 1000 : null;
}

// Conversas que receberam a PRIMEIRA mensagem da IA dentro da janela (= leads novos abordados)
function contarLeadsNovos(desdeMs) {
  return get(
    `SELECT count(*) AS n FROM (SELECT conversa_id, min(created_at) AS t FROM ia_registro
      WHERE tipo = 'enviada' AND conversa_id IS NOT NULL GROUP BY conversa_id) WHERE t >= ?`,
    [iso(desdeMs)]
  ).n;
}

// Quando a mensagem mais antiga da janela "sai" dela, abre uma vaga
function quandoLibera(janelaMs, agoraMs) {
  const t = get("SELECT min(created_at) AS t FROM ia_registro WHERE tipo = 'enviada' AND created_at >= ?", [iso(agoraMs - janelaMs)])?.t;
  const libera = t ? ms(t) + janelaMs + 1000 : agoraMs + 5 * MIN;
  return Math.max(libera, agoraMs + 30000);
}

/**
 * Alguma trava segura a IA agora? Devolve null (pode enviar) ou { tipo, motivo, ate } (ate em ms).
 * conversa: { id, mensagens_ia } — leads novos só contam para quem ainda não recebeu mensagem da IA.
 */
export function bloqueioAgora(cfg, conversa, agoraMs = Date.now()) {
  const e = lerEstado(ESTADO);
  if (ms(e.pausa_falhas_ate) > agoraMs) {
    return { tipo: 'pausa_falhas', motivo: `Pausada por ${FALHAS_PARA_PAUSAR} erros de envio seguidos`, ate: ms(e.pausa_falhas_ate) };
  }
  if (cfg.descanso_ativo && ms(e.descanso_ate) > agoraMs) {
    return { tipo: 'descanso', motivo: 'Pausa de descanso', ate: ms(e.descanso_ate) };
  }
  if (contarEnviadas(agoraMs - DIA) >= cfg.limite_por_dia) {
    return { tipo: 'limite_dia', motivo: `Limite de ${cfg.limite_por_dia} mensagens em 24 h`, ate: quandoLibera(DIA, agoraMs) };
  }
  if (contarEnviadas(agoraMs - HORA) >= cfg.limite_por_hora) {
    return { tipo: 'limite_hora', motivo: `Limite de ${cfg.limite_por_hora} mensagens por hora`, ate: quandoLibera(HORA, agoraMs) };
  }
  if (!conversa?.mensagens_ia && contarLeadsNovos(inicioJanelaNovos(cfg, agoraMs)) >= cfg.limite_novos_por_dia) {
    const libera = quandoLiberaNovos(cfg, agoraMs) || agoraMs + 5 * MIN;
    return { tipo: 'limite_novos', motivo: `Limite de ${cfg.limite_novos_por_dia} leads novos ${cfg.zerar_novos_meia_noite ? 'no dia' : 'em 24 h'}`, ate: Math.max(libera, agoraMs + 30000) };
  }
  if (e.ultima_conversa_id && conversa?.id !== e.ultima_conversa_id && ms(e.proximo_lead_em) > agoraMs) {
    return { tipo: 'intervalo_leads', motivo: 'Intervalo entre um lead e outro', ate: ms(e.proximo_lead_em) };
  }
  return null;
}

/** Depois que a IA enviou n mensagens para a conversa: conta para o descanso e marca o intervalo até o próximo lead. */
export function depoisDeEnviar(cfg, conversaId, n, { aleatorio = Math.random, agoraMs = Date.now() } = {}) {
  if (!n) return lerEstado(ESTADO);
  const e = lerEstado(ESTADO);
  const novo = {
    falhas_envio: 0,
    ultima_conversa_id: conversaId,
    proximo_lead_em: iso(agoraMs + Math.round(entre(cfg.intervalo_leads_min_seg, cfg.intervalo_leads_max_seg, aleatorio)) * 1000),
    enviadas_desde_descanso: (e.enviadas_desde_descanso || 0) + n,
  };
  if (cfg.descanso_ativo && novo.enviadas_desde_descanso >= cfg.descanso_a_cada) {
    const minutos = entre(cfg.descanso_min_min, cfg.descanso_max_min, aleatorio);
    novo.descanso_ate = iso(agoraMs + Math.round(minutos * MIN));
    novo.enviadas_desde_descanso = 0;
    console.log(`[ia] pausa de descanso de ~${Math.round(minutos)} min (depois de ${cfg.descanso_a_cada} mensagens)`);
  }
  return salvarEstado(ESTADO, novo);
}

/** Erro ao enviar pelo WhatsApp: depois de 3 seguidos, pausa a IA por 30 minutos. Devolve true se pausou. */
export function falhaDeEnvio({ agoraMs = Date.now() } = {}) {
  const falhas = (lerEstado(ESTADO).falhas_envio || 0) + 1;
  if (falhas >= FALHAS_PARA_PAUSAR) {
    salvarEstado(ESTADO, { falhas_envio: 0, pausa_falhas_ate: iso(agoraMs + PAUSA_FALHAS_MIN * MIN) });
    console.warn(`[ia] ${FALHAS_PARA_PAUSAR} erros de envio seguidos: IA pausada por ${PAUSA_FALHAS_MIN} min para proteger o número`);
    return true;
  }
  salvarEstado(ESTADO, { falhas_envio: falhas });
  return false;
}

/** Libera as pausas na hora (botão "retomar agora" da tela). */
export function retomarAgora() {
  salvarEstado(ESTADO, { descanso_ate: null, pausa_falhas_ate: null, falhas_envio: 0, enviadas_desde_descanso: 0 });
}

/** Zera na mão o contador de leads novos: a IA volta a abordar quem estava esperando vaga. */
export function zerarLeadsNovos(agoraMs = Date.now()) {
  salvarEstado(ESTADO, { novos_zerado_em: iso(agoraMs) });
  // Quem ficou para depois por falta de vaga (ainda sem mensagem da IA) é chamado de novo agora; o motor confere as outras travas
  run(`UPDATE ia_conversas SET proxima_em = ? WHERE status = 'ativa' AND mensagens_ia = 0 AND proxima_em IS NOT NULL AND proxima_em > ?`,
    [iso(agoraMs + 5000), iso(agoraMs + 60000)]);
}

/** O que a tela mostra: pausas em andamento e quanto de cada limite já foi usado. */
export function statusProtecao(cfg, agoraMs = Date.now()) {
  const e = lerEstado(ESTADO);
  const futuro = (v) => (ms(v) > agoraMs ? v : null);
  return {
    descanso_ate: cfg.descanso_ativo ? futuro(e.descanso_ate) : null,
    pausa_falhas_ate: futuro(e.pausa_falhas_ate),
    proximo_lead_em: futuro(e.proximo_lead_em),
    enviadas_desde_descanso: e.enviadas_desde_descanso || 0,
    enviadas_hora: contarEnviadas(agoraMs - HORA),
    enviadas_dia: contarEnviadas(agoraMs - DIA),
    leads_novos_dia: contarLeadsNovos(inicioJanelaNovos(cfg, agoraMs)),
    novos_libera_em: (() => { const t = quandoLiberaNovos(cfg, agoraMs); return t ? iso(t) : null; })(),
    novos_zerado_em: e.novos_zerado_em || null,
  };
}

// Para os testes
export function zerarProtecao() {
  salvarEstado(ESTADO, {
    descanso_ate: null, pausa_falhas_ate: null, falhas_envio: 0, enviadas_desde_descanso: 0, ultima_conversa_id: null, proximo_lead_em: null, novos_zerado_em: null,
  });
}
