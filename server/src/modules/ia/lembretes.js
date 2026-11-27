// Lembretes de reunião: a Alice avisa o lead 3 dias, 24 h, 12 h, 3 h e 30 min antes da reunião do Calendly.
//
//  - Sai mesmo que alguém da equipe esteja conversando com o lead (não depende do estado da IA na conversa).
//  - Cada lembrete sai uma vez por reunião e horário (reagendou: valem de novo para o novo horário).
//  - Só sai se o lead agendou ANTES daquele momento (quem agenda para daqui a 2 h recebe só o de 30 min) e dentro da
//    tolerância de cada um (servidor desligado não dispara lembrete atrasado demais).
//  - Textos com variáveis e várias versões separadas por "---" (sorteia uma: o texto varia, menos risco de ban).
//  - Prioridade sobre descanso e intervalo entre leads (hora marcada), mas para com o freio de falhas do número.
//  - As mensagens saem com origem "lembrete": o link do Meet que vai nelas não conta como prova de reunião feita.
//  - Nunca fora do horário comercial (padrão: o mesmo horário da aba Primeiro contato; dá para usar uma janela própria).
//    Um lembrete que cairia de madrugada ou à noite (ex.: "12 h antes" de uma reunião às 15h = 3h da manhã) é
//    adiantado ou atrasado para dentro do horário, sem passar do lembrete seguinte; se não couber, é pulado.
import { get, all, run, agora } from '../../db.js';
import { registrarEvento } from '../../events.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { lerConfig as lerConfigIa } from './config.js';
import { primeiroNome } from './prompt.js';
import { registrar, ErroIA } from './cliente.js';
import { depoisDeEnviar, falhaDeEnvio, ocuparEnvio, liberarEnvio, envioOcupado } from './protecao.js';
import { faixasDaJanela, dentroDasFaixas, primeiroDentro, ultimoDentro } from './horario.js';
import { variantesTelefone } from '../../util.js';
import { sortearVersao } from './followup.js';

const ESTADO = 'ia_lembretes';
const MIN = 60000;

// Marcos: quantos minutos antes e até quanto tempo depois do marco o lembrete ainda vale (tolerância)
export const MARCOS = [
  { id: '3d', minutos: 3 * 24 * 60, tolerancia: 6 * 60 },
  { id: '24h', minutos: 24 * 60, tolerancia: 3 * 60 },
  { id: '12h', minutos: 12 * 60, tolerancia: 2 * 60 },
  { id: '3h', minutos: 3 * 60, tolerancia: 60 },
  { id: '30m', minutos: 30, tolerancia: 20 },
];

const TEXTOS = {
  '3d': 'Oi, {nome}! Aqui é a {atendente}, da {empresa} 😊 Passando para lembrar da nossa reunião {quando}. Está confirmado para você?\n---\nOi, {nome}, tudo bem? Só lembrando que a nossa reunião ficou para {quando}. Se surgir algum imprevisto, me avisa por aqui!',
  '24h': 'Oi, {nome}! Amanhã é o dia da nossa reunião: {quando}. Te espero lá 😊\n---\n{nome}, lembrete rápido: nossa conversa é amanhã, {quando}. Tudo certo para você?',
  '12h': '{nome}, nossa reunião é {quando}. Deixa o link à mão: {link}\n---\nOi, {nome}! Lembrando da reunião {quando}. O link é este: {link}',
  '3h': 'Oi, {nome}! Daqui a pouco, às {hora}, temos a nossa reunião. É só entrar por aqui: {link}\n---\n{nome}, hoje às {hora} é a nossa reunião 😊 Link: {link}',
  '30m': '{nome}, falta meia hora para a nossa reunião ({hora}) 🙂 Link: {link}\n---\nJá já começa, {nome}! Às {hora}, neste link: {link}',
};

// Quanto cada lembrete pode ser adiantado/atrasado para cair dentro do horário (minutos) — mais longe da reunião,
// mais folga; o de 30 min quase não mexe (senão perde o sentido)
const DESLOCAMENTO_MAX = { '3d': 12 * 60, '24h': 8 * 60, '12h': 7 * 60, '3h': 90, '30m': 20 };
// Distância mínima entre dois lembretes da mesma reunião depois do ajuste (minutos)
const DISTANCIA_MIN = 90;

export const PADRAO = {
  ativo: false,
  marcos: Object.fromEntries(MARCOS.map((m) => [m.id, { ativo: true, texto: TEXTOS[m.id] }])),
  // Horário em que os lembretes podem sair: 'comercial' = o horário de atendimento da aba Primeiro contato;
  // 'personalizado' = a janela abaixo (início, fim e dias da semana, 0 = domingo)
  horario: 'comercial',
  janela_inicio: '08:00',
  janela_fim: '19:00',
  dias: [1, 2, 3, 4, 5, 6],
};

const HORA_TXT = /^([01]\d|2[0-3]):[0-5]\d$/;

export function lerConfigLembretes() {
  const salvo = lerEstado(ESTADO);
  const marcos = Object.fromEntries(MARCOS.map((m) => [m.id, { ...PADRAO.marcos[m.id], ...(salvo.marcos?.[m.id] || {}) }]));
  return { ...PADRAO, ...salvo, marcos };
}

export function salvarConfigLembretes(entrada = {}) {
  const atual = lerConfigLembretes();
  const v = (campo) => (entrada[campo] === undefined ? atual[campo] : entrada[campo]);
  const marcos = {};
  for (const m of MARCOS) {
    const e = entrada.marcos?.[m.id] || atual.marcos[m.id];
    const texto = String(e.texto ?? '').replace(/\r/g, '').trim().slice(0, 3000);
    const ativo = e.ativo === undefined ? true : Boolean(e.ativo);
    if (ativo && !texto) throw new ErroHttp(400, `Escreva o texto do lembrete de ${m.id} ou desligue esse lembrete`);
    marcos[m.id] = { ativo, texto: texto || TEXTOS[m.id] };
  }
  const horario = v('horario') === 'personalizado' ? 'personalizado' : 'comercial';
  const ini = String(v('janela_inicio') || '').trim();
  const fim = String(v('janela_fim') || '').trim();
  const dias = [...new Set((Array.isArray(v('dias')) ? v('dias') : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (horario === 'personalizado') {
    if (!HORA_TXT.test(ini) || !HORA_TXT.test(fim) || ini >= fim) throw new ErroHttp(400, 'Horário dos lembretes inválido: use HH:MM e o fim depois do início');
    if (!dias.length) throw new ErroHttp(400, 'Escolha ao menos um dia da semana para os lembretes');
  }
  const novo = {
    ativo: entrada.ativo === undefined ? atual.ativo : Boolean(entrada.ativo),
    marcos,
    horario,
    janela_inicio: HORA_TXT.test(ini) ? ini : atual.janela_inicio,
    janela_fim: HORA_TXT.test(fim) ? fim : atual.janela_fim,
    dias: dias.length ? dias : atual.dias,
  };
  salvarEstado(ESTADO, novo);
  emitir('ia', { lembretes: true });
  return lerConfigLembretes();
}

/** Faixas de horário em que os lembretes podem sair (por dia da semana). */
export function faixasDosLembretes(cfg = lerConfigLembretes(), ia = lerConfigIa()) {
  if (cfg.horario === 'personalizado') return faixasDaJanela({ inicio: cfg.janela_inicio, fim: cfg.janela_fim, dias: cfg.dias });
  return ia.horario || {};
}

/**
 * Quando cada lembrete de uma reunião sai, já respeitando o horário permitido.
 * Vai do lembrete mais próximo da reunião para o mais distante: cada um fica no horário ideal se ele estiver dentro
 * do horário; senão é adiantado ou atrasado (o que mexer menos, até DESLOCAMENTO_MAX) sem encostar no lembrete
 * seguinte. Se não couber, fica sem horário (pulado).
 * Devolve { [marco]: { ideal, em, motivo } } — em = null quando o lembrete não vai sair.
 */
export function planoDaReuniao({ inicioMs, agendouMs = 0, ativos, faixas, fuso }) {
  const plano = {};
  let seguinte = null; // horário do lembrete mais próximo da reunião que vai sair
  for (const m of [...ativos].sort((a, b) => a.minutos - b.minutos)) {
    const ideal = inicioMs - m.minutos * MIN;
    if (agendouMs > ideal - 5 * MIN) { plano[m.id] = { ideal, em: null, motivo: 'agendou_depois' }; continue; }
    const piso = agendouMs + 5 * MIN;
    const teto = Math.min(inicioMs - (m.minutos <= 30 ? 5 : 10) * MIN, seguinte === null ? Infinity : seguinte - DISTANCIA_MIN * MIN);
    const folga = (DESLOCAMENTO_MAX[m.id] ?? 60) * MIN;
    const cabe = (t) => t !== null && t >= piso && t <= teto;
    let em = null;
    if (cabe(ideal) && dentroDasFaixas(faixas, fuso, ideal)) em = ideal;
    else {
      const depois = primeiroDentro(faixas, fuso, ideal, ideal + folga);
      const antes = ultimoDentro(faixas, fuso, Math.min(ideal, teto), ideal - folga);
      const opcoes = [depois, antes].filter(cabe).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
      em = opcoes[0] ?? null;
    }
    plano[m.id] = { ideal, em, motivo: em === null ? 'fora_horario' : em === ideal ? null : 'ajustado' };
    if (em !== null) seguinte = em;
  }
  return plano;
}

function bloqueado(phone) {
  const v = variantesTelefone(phone);
  return v.length ? Boolean(get(`SELECT 1 AS ok FROM disparo_bloqueio WHERE phone IN (${v.map(() => '?').join(',')})`, v)) : false;
}

// ------------------------------------------------------------------ dependências (trocadas nos testes)

const deps = {
  async enviar(numeroId, destino, dados) {
    const { enviar } = await import('../whatsapp/envio.js');
    return enviar(numeroId, destino, dados, null);
  },
  async digitando(numeroId, jid, estado) {
    const { avisarDigitando } = await import('../whatsapp/envio.js');
    return avisarDigitando(numeroId, jid, estado);
  },
  async numeroDisponivel(preferidos) {
    const { socketConectado, algumConectado } = await import('../whatsapp/instancias.js');
    for (const id of preferidos) if (socketConectado(id)) return Number(id);
    return algumConectado()?.id || null;
  },
  async emAtendimentoAlice() {
    const { emAtendimento } = await import('./motor.js');
    return emAtendimento().length > 0;
  },
  esperar: (t) => new Promise((r) => setTimeout(r, t)),
  aleatorio: Math.random,
  agora: () => Date.now(),
};
export function definirDependencias(novas) {
  Object.assign(deps, novas);
}

// ------------------------------------------------------------------ texto

function partes(isoTxt, fuso) {
  const d = new Date(isoTxt);
  const f = (op) => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, ...op }).format(d);
  return { dia: f({ weekday: 'long' }), data: f({ day: '2-digit', month: '2-digit' }), hora: f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), ymd: f({ year: 'numeric', month: '2-digit', day: '2-digit' }) };
}

/** "hoje às 15:00", "amanhã às 15:00", "segunda-feira (17/11) às 15:00" — no fuso da IA */
export function quandoPorExtenso(inicioIso, agoraMs, fuso) {
  const r = partes(inicioIso, fuso);
  const hoje = partes(new Date(agoraMs).toISOString(), fuso).ymd;
  const amanha = partes(new Date(agoraMs + 24 * 60 * MIN).toISOString(), fuso).ymd;
  if (r.ymd === hoje) return `hoje às ${r.hora}`;
  if (r.ymd === amanha) return `amanhã às ${r.hora}`;
  return `${r.dia} (${r.data}) às ${r.hora}`;
}

/** Monta o texto do lembrete: sorteia uma versão, troca as variáveis e tira as linhas com {link} quando não há link. */
export function montarTexto(modelo, { evento, lead, ia, agoraMs = deps.agora(), aleatorio = deps.aleatorio }) {
  let texto = sortearVersao(modelo, aleatorio);
  const link = /^https?:\/\//i.test(evento.join_url || '') ? evento.join_url : '';
  const p = partes(evento.start_time, ia.fuso);
  const vars = {
    nome: primeiroNome(lead.name) || '', dia: p.dia, data: p.data, hora: p.hora, quando: quandoPorExtenso(evento.start_time, agoraMs, ia.fuso),
    link, evento: evento.event_name || 'reunião', atendente: ia.nome_atendente, empresa: ia.empresa,
  };
  if (!link) texto = texto.split('\n').map(semLink).filter(Boolean).join('\n');
  return texto.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))
    .replace(/ {2,}/g, ' ').replace(/[ \t]+([!?.,])/g, '$1').trim();
}

// Reunião sem link: tira o pedaço que apresenta o link ("Link: {link}", "O link é este: {link}") voltando até o fim da
// frase anterior (ponto, exclamação, vírgula, parêntese ou emoji)
function semLink(linha) {
  let out = linha;
  while (out.includes('{link}')) {
    const i = out.indexOf('{link}');
    const antes = out.slice(0, i).match(/^(.*[.!?,)\p{Extended_Pictographic}])/su)?.[1] || '';
    out = antes.replace(/,\s*$/, '') + out.slice(i + 6).replace(/^[.!]/, '');
  }
  return out.trim();
}

// ------------------------------------------------------------------ o que está para sair

/**
 * Lembretes que deveriam sair agora: [{ evento, marco, lead }]. Os que perderam a vez (agendou depois do marco,
 * marco mais distante passado junto com um mais próximo) são marcados como "pulado" para não voltarem.
 */
export function lembretesVencidos(cfg = lerConfigLembretes(), agoraMs = deps.agora(), ia = lerConfigIa()) {
  const ativos = MARCOS.filter((m) => cfg.marcos[m.id]?.ativo);
  if (!ativos.length) return [];
  const maior = Math.max(...ativos.map((m) => m.minutos + (DESLOCAMENTO_MAX[m.id] ?? 60)));
  const faixas = faixasDosLembretes(cfg, ia);
  const agoraDentro = dentroDasFaixas(faixas, ia.fuso, agoraMs);
  const eventos = all(
    `SELECT e.uri, e.lead_id, e.event_name, e.start_time, e.join_url, e.booked_at, e.created_at, l.name, l.phone
       FROM calendly_events e JOIN leads l ON l.id = e.lead_id
      WHERE e.status = 'active' AND COALESCE(e.no_show, 0) = 0 AND e.start_time > ? AND e.start_time <= ?
        AND l.phone IS NOT NULL AND trim(l.phone) <> ''
      ORDER BY e.start_time`,
    [new Date(agoraMs).toISOString(), new Date(agoraMs + (maior + 60) * MIN).toISOString()]
  );
  const saida = [];
  for (const ev of eventos) {
    const inicio = Date.parse(ev.start_time);
    const agendouEm = Date.parse(ev.booked_at || ev.created_at) || 0;
    const ja = new Set(all('SELECT marco FROM ia_lembretes WHERE evento_uri = ? AND inicio = ?', [ev.uri, ev.start_time]).map((r) => r.marco));
    const plano = planoDaReuniao({ inicioMs: inicio, agendouMs: agendouEm, ativos, faixas, fuso: ia.fuso });
    const numeroBloqueado = bloqueado(ev.phone);
    // Do mais próximo da reunião para o mais distante: só sai o mais próximo que venceu; os anteriores ficam "pulados"
    let escolhido = null;
    for (const m of [...ativos].sort((a, b) => a.minutos - b.minutos)) {
      if (ja.has(m.id)) { if (!escolhido) escolhido = 'feito'; continue; }
      const p = plano[m.id];
      const pular = (detalhe) => {
        run('INSERT INTO ia_lembretes (evento_uri, inicio, marco, lead_id, status, detalhe) VALUES (?, ?, ?, ?, \'pulado\', ?) ON CONFLICT DO NOTHING', [ev.uri, ev.start_time, m.id, ev.lead_id, detalhe]);
      };
      // Sem horário possível: registra como pulado quando o horário ideal passa (para aparecer na lista)
      if (p.em === null) {
        if (agoraMs >= p.ideal) pular(p.motivo === 'agendou_depois' ? 'Agendou depois deste momento' : 'Cairia fora do horário comercial');
        continue;
      }
      if (agoraMs < p.em) continue;
      if (escolhido) { pular('Já saiu um lembrete mais próximo da reunião'); continue; }
      if (numeroBloqueado) { pular('Número na lista de bloqueio'); continue; }
      if (agoraMs > p.em + m.tolerancia * MIN || agoraMs > inicio - 3 * MIN) { pular('Passou da hora (servidor fora do ar?)'); continue; }
      // Nunca fora do horário: espera a janela abrir (se ainda estiver dentro da tolerância)
      if (!agoraDentro) continue;
      escolhido = m;
      saida.push({ evento: ev, marco: m, lead: { id: ev.lead_id, name: ev.name, phone: ev.phone }, momento: p.em });
    }
  }
  return saida;
}

// ------------------------------------------------------------------ envio

/** Envia um lembrete. Devolve { feito, texto? }. */
export async function enviarLembrete(item, cfg = lerConfigLembretes()) {
  const { evento, marco, lead } = item;
  const ia = lerConfigIa();
  const agoraMs = deps.agora();
  // Última conferência do horário (o item pode ter esperado na fila): fora do horário comercial não sai
  if (!dentroDasFaixas(faixasDosLembretes(cfg, ia), ia.fuso, agoraMs)) return { feito: 'fora_horario' };
  // Freio de falhas do número ligado: não insiste agora (o lembrete continua valendo até a tolerância)
  const e = lerEstado('ia_protecao');
  if (e.pausa_falhas_ate && Date.parse(e.pausa_falhas_ate) > agoraMs) return { feito: 'pausa_falhas' };
  // Conversa acontecendo neste minuto (mensagem há menos de 60 s): espera um pouco para não cortar ninguém,
  // até metade da tolerância — depois disso manda de qualquer jeito
  const ultima = get('SELECT max(timestamp) AS t FROM wa_messages WHERE lead_id = ? AND type <> \'chamada\'', [lead.id])?.t;
  const momento = item.momento ?? Date.parse(evento.start_time) - marco.minutos * MIN;
  if (ultima && agoraMs - Date.parse(ultima) < 60000 && agoraMs < momento + (marco.tolerancia * MIN) / 2) return { feito: 'conversa_em_andamento' };

  const numeroId = await deps.numeroDisponivel(ia.numero_ids || []);
  if (!numeroId) return { feito: 'sem_numero' };
  const texto = montarTexto(cfg.marcos[marco.id].texto, { evento, lead, ia, agoraMs });
  if (!texto) {
    run('INSERT INTO ia_lembretes (evento_uri, inicio, marco, lead_id, status, detalhe) VALUES (?, ?, ?, ?, \'pulado\', ?) ON CONFLICT DO NOTHING', [evento.uri, evento.start_time, marco.id, lead.id, 'Texto vazio']);
    return { feito: 'pulado' };
  }
  // Reserva o lembrete antes de enviar: se o servidor cair no meio, não manda duas vezes
  const reserva = run('INSERT INTO ia_lembretes (evento_uri, inicio, marco, lead_id, status, texto) VALUES (?, ?, ?, ?, \'enviando\', ?) ON CONFLICT DO NOTHING', [
    evento.uri, evento.start_time, marco.id, lead.id, texto,
  ]);
  if (!reserva.changes) return { feito: 'ja_enviado' };
  try {
    const jid = get('SELECT jid FROM wa_contacts WHERE lead_id = ? LIMIT 1', [lead.id])?.jid || null;
    await deps.esperar(1500 + Math.round(deps.aleatorio() * 2000));
    if (jid) await Promise.race([deps.digitando(numeroId, jid, 'composing'), deps.esperar(10000)]).catch(() => {});
    await deps.esperar(Math.min(1200 + texto.length * 40, 9000));
    await Promise.race([
      deps.enviar(numeroId, { leadId: lead.id }, { texto, automatico: true, origem: 'lembrete', semPrevia: false }),
      new Promise((_, rej) => setTimeout(() => rej(new ErroIA('O WhatsApp não respondeu ao envio a tempo', { temporario: true })), 90000).unref?.()),
    ]);
  } catch (err) {
    falhaDeEnvio();
    // Libera para tentar de novo no próximo ciclo (ainda dentro da tolerância)
    run("DELETE FROM ia_lembretes WHERE evento_uri = ? AND inicio = ? AND marco = ? AND status = 'enviando'", [evento.uri, evento.start_time, marco.id]);
    registrar(null, 'lembrete_erro', `lead #${lead.id} (${marco.id}): ${err.message}`.slice(0, 300));
    console.error(`[lembretes] lead #${lead.id} (${marco.id}): ${err.message}`);
    return { feito: 'erro', motivo: err.message };
  }
  run("UPDATE ia_lembretes SET status = 'enviado', created_at = ? WHERE evento_uri = ? AND inicio = ? AND marco = ?", [agora(), evento.uri, evento.start_time, marco.id]);
  registrar(null, 'enviada', `lembrete ${marco.id}: ${texto}`.slice(0, 200));
  registrar(null, 'lembrete_enviado', `lead #${lead.id} (${marco.id})`);
  registrarEvento({ leadId: lead.id, type: 'lembrete_reuniao', data: { marco: marco.id, inicio: evento.start_time, evento: evento.event_name || null } });
  depoisDeEnviar(ia, `lb${lead.id}`, 1, { aleatorio: deps.aleatorio, agoraMs: deps.agora() });
  emitir('ia', { lembretes: true });
  return { feito: 'enviado', texto };
}

// Lembretes "enviando" de um servidor que caiu no meio: viram "enviado?" (não repete, mas aparece na lista)
function limparPresos() {
  run("UPDATE ia_lembretes SET status = 'erro', detalhe = 'O servidor reiniciou durante o envio (pode ter saído)' WHERE status = 'enviando' AND created_at < ?", [
    new Date(deps.agora() - 10 * MIN).toISOString(),
  ]);
}

export function painelLembretes() {
  const cfg = lerConfigLembretes();
  const ia = lerConfigIa();
  const agoraMs = deps.agora();
  const ativos = MARCOS.filter((m) => cfg.marcos[m.id]?.ativo);
  const faixas = faixasDosLembretes(cfg, ia);
  const proximas = all(
    `SELECT e.uri, e.lead_id, e.event_name, e.start_time, e.booked_at, e.created_at, l.name FROM calendly_events e JOIN leads l ON l.id = e.lead_id
      WHERE e.status = 'active' AND COALESCE(e.no_show, 0) = 0 AND e.start_time > ? AND l.phone IS NOT NULL AND trim(l.phone) <> '' ORDER BY e.start_time LIMIT 30`,
    [new Date(agoraMs).toISOString()]
  ).map((ev) => {
    const feitos = Object.fromEntries(all('SELECT marco, status FROM ia_lembretes WHERE evento_uri = ? AND inicio = ?', [ev.uri, ev.start_time]).map((r) => [r.marco, r.status]));
    const agendouEm = Date.parse(ev.booked_at || ev.created_at) || 0;
    const plano = planoDaReuniao({ inicioMs: Date.parse(ev.start_time), agendouMs: agendouEm, ativos, faixas, fuso: ia.fuso });
    const marcos = ativos.map((m) => {
      const p = plano[m.id];
      let status = feitos[m.id];
      if (!status) {
        if (p.em === null) status = p.motivo === 'fora_horario' ? 'fora_horario' : 'nao_vale';
        else status = agoraMs > p.em + m.tolerancia * MIN ? 'nao_vale' : 'agendado';
      }
      return { id: m.id, em: new Date(p.em ?? p.ideal).toISOString(), ajustado: p.motivo === 'ajustado', status };
    });
    return { lead_id: ev.lead_id, nome: ev.name, evento: ev.event_name, inicio: ev.start_time, marcos };
  });
  const enviados = all(
    `SELECT b.marco, b.status, b.texto, b.detalhe, b.inicio, b.created_at, b.lead_id, l.name AS nome FROM ia_lembretes b LEFT JOIN leads l ON l.id = b.lead_id
      WHERE b.status IN ('enviado', 'erro') ORDER BY b.created_at DESC LIMIT 30`
  );
  return { config: cfg, marcos: MARCOS, fuso: ia.fuso, horario_comercial: ia.horario, proximas, enviados };
}

// ------------------------------------------------------------------ relógio

let relogio = null;
let rodando = false;

export async function verificarLembretes() {
  if (rodando) return;
  const cfg = lerConfigLembretes();
  if (!cfg.ativo) return;
  rodando = true;
  try {
    limparPresos();
    const lista = lembretesVencidos(cfg);
    for (const item of lista) {
      // Um envio por vez no número: se a Alice ou o follow-up estão escrevendo, tenta no próximo ciclo (20 s)
      if (envioOcupado() || await deps.emAtendimentoAlice()) break;
      if (!ocuparEnvio('lembrete')) break;
      try {
        await enviarLembrete(item, cfg);
      } finally {
        liberarEnvio('lembrete');
      }
    }
  } catch (err) {
    console.error('[lembretes]', err.message);
  } finally {
    rodando = false;
  }
}

export function iniciarRelogioLembretes() {
  if (relogio) return;
  relogio = setInterval(() => verificarLembretes().catch(() => {}), 20000);
  relogio.unref?.();
}

export function pararRelogioLembretes() {
  if (relogio) clearInterval(relogio);
  relogio = null;
}
