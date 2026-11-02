// Módulo de estatísticas: entrada de leads, respostas, tempo de resposta, follow-up, funil, UTMs e equipe
import { get, all } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin } from '../auth/middleware.js';

const DIA_MS = 86400000;
const MAX_DIAS = 400;

function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

const pct = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : null);

function lerJsonSeguro(texto) {
  if (!texto) return {};
  try { return JSON.parse(texto) || {}; } catch { return {}; }
}

// Janela [inicioMs, fimMs). Sem início/fim explícitos, vale "últimos N dias" a partir de agora.
function janela({ dias, inicio, fim }) {
  const agoraMs = Date.now();
  const i = Date.parse(inicio);
  const f = Date.parse(fim);
  if (Number.isFinite(i) && Number.isFinite(f) && f > i) {
    const fimMs = Math.min(f, agoraMs + DIA_MS);
    const inicioMs = Math.max(i, fimMs - MAX_DIAS * DIA_MS);
    return { inicioMs, fimMs };
  }
  const d = Math.max(1, Math.min(MAX_DIAS, Number(dias) || 30));
  // fim um pouco à frente: o lead criado neste mesmo milissegundo ainda entra
  return { inicioMs: agoraMs - d * DIA_MS, fimMs: agoraMs + 1000 };
}

export function calcularEstatisticas({ dias = 30, inicio, fim, fusoMin = 0 } = {}) {
  const { inicioMs, fimMs } = janela({ dias, inicio, fim });
  const duracaoMs = fimMs - inicioMs;
  const desde = new Date(inicioMs).toISOString();
  const ate = new Date(fimMs).toISOString();
  const anterior = new Date(inicioMs - duracaoMs).toISOString();
  const fuso = `${fusoMin >= 0 ? '+' : ''}${Math.trunc(fusoMin)} minutes`;
  const horas = config.followupHours;
  const atrasoSql = `(julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?`;
  const noPeriodo = 'created_at >= ? AND created_at < ?';
  const p = [desde, ate];

  // --- Entrada e resposta ---
  const novos = get(`SELECT count(*) n FROM leads WHERE ${noPeriodo}`, p).n;
  const novosAntes = get(`SELECT count(*) n FROM leads WHERE ${noPeriodo}`, [anterior, desde]).n;
  const respondidos = get(`SELECT count(*) n FROM leads WHERE ${noPeriodo} AND first_contact_at IS NOT NULL`, p).n;
  const respondidosAntes = get(
    `SELECT count(*) n FROM leads WHERE ${noPeriodo} AND first_contact_at IS NOT NULL`,
    [anterior, desde]
  ).n;
  const tempos = all(
    `SELECT max(0, (julianday(first_contact_at) - julianday(created_at)) * 1440) AS minutos
       FROM leads WHERE ${noPeriodo} AND first_contact_at IS NOT NULL`,
    p
  ).map((r) => r.minutos);
  const em1h = tempos.filter((m) => m <= 60).length;

  // --- Situação agora ---
  const abertos = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open'").n;
  const atrasados = get(`SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND ${atrasoSql}`, [horas]).n;
  const aguardando = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND l.waiting_since IS NOT NULL").n;
  const nuncaContatados = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND l.first_contact_at IS NULL").n;

  // --- Resultados no período ---
  const resultado = (kind) =>
    get(
      'SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = ? AND l.stage_changed_at >= ? AND l.stage_changed_at < ?',
      [kind, desde, ate]
    ).n;
  const ganhos = resultado('won');
  const perdidos = resultado('lost');
  const reunioes = get(`SELECT count(*) n, sum(status = 'canceled') canceladas FROM calendly_events WHERE ${noPeriodo}`, p);
  const mensagens = get(
    'SELECT sum(from_me = 0) recebidas, sum(from_me = 1) enviadas FROM wa_messages WHERE timestamp >= ? AND timestamp < ?',
    p
  );

  // --- Funil do formulário: iniciaram → completaram → agendaram (Calendly) ---
  // Só leads que vieram do Yay! Forms e entraram no período. "Agendou" = tem ao menos uma reunião ativa (passada ou futura).
  const funilForms = get(
    `SELECT count(*) AS iniciaram,
            sum(completo) AS completaram,
            sum(agendou) AS agendaram,
            sum(completo AND agendou) AS completaram_e_agendaram,
            sum(completo AND NOT agendou) AS completaram_sem_agendar,
            sum(NOT completo AND agendou) AS parciais_que_agendaram
       FROM (
         SELECT COALESCE(json_extract(l.extra, '$.parcial'), 0) = 0 AS completo,
                EXISTS (SELECT 1 FROM calendly_events c WHERE c.lead_id = l.id AND c.status = 'active') AS agendou
           FROM leads l WHERE l.source = 'yayforms' AND l.created_at >= ? AND l.created_at < ?
       )`,
    p
  );
  const nf = (v) => v || 0;

  // --- Por dia (no fuso de quem está vendo), do primeiro ao último dia da janela ---
  const diaLocal = (ms) => new Date(ms + fusoMin * 60000).toISOString().slice(0, 10);
  const porDiaBanco = new Map(
    all(
      `SELECT date(created_at, ?) AS dia, count(*) AS entradas, sum(first_contact_at IS NOT NULL) AS respondidos
         FROM leads WHERE ${noPeriodo} GROUP BY dia`,
      [fuso, ...p]
    ).map((r) => [r.dia, r])
  );
  const porDia = [];
  const ultimoDia = diaLocal(fimMs - 1);
  for (let dia = diaLocal(inicioMs), guarda = 0; dia <= ultimoDia && guarda <= MAX_DIAS + 1; guarda++) {
    const r = porDiaBanco.get(dia);
    porDia.push({ dia, entradas: r?.entradas || 0, respondidos: r?.respondidos || 0 });
    dia = new Date(Date.parse(`${dia}T00:00:00Z`) + DIA_MS).toISOString().slice(0, 10);
  }

  // --- Por origem (Calendly não é origem: é onde o lead do formulário marca a reunião), formulário, etapa e responsável ---
  const porOrigem = all(
    `SELECT source AS origem, count(*) AS total FROM leads WHERE ${noPeriodo} AND source <> 'calendly' GROUP BY source ORDER BY total DESC`,
    p
  );
  const porFormulario = all(
    `SELECT COALESCE(json_extract(extra, '$.formulario'), 'Formulário ' || json_extract(extra, '$.form_id')) AS formulario,
            count(*) AS total, sum(first_contact_at IS NOT NULL) AS respondidos
       FROM leads
      WHERE ${noPeriodo} AND source <> 'calendly'
        AND COALESCE(json_extract(extra, '$.formulario'), json_extract(extra, '$.form_id')) IS NOT NULL
      GROUP BY formulario ORDER BY total DESC LIMIT 8`,
    p
  );
  const porEtapa = all(
    `SELECT s.id, s.name AS nome, s.color AS cor, s.kind AS tipo, s.position AS posicao, count(l.id) AS total
       FROM stages s LEFT JOIN leads l ON l.stage_id = s.id
      GROUP BY s.id ORDER BY s.position, s.id`
  );
  const porResponsavel = all(
    `SELECT COALESCE(u.name, 'Sem responsável') AS nome,
            sum(s.kind = 'open') AS abertos,
            sum(s.kind = 'open' AND ${atrasoSql}) AS atrasados,
            sum(s.kind = 'open' AND l.waiting_since IS NOT NULL) AS aguardando,
            sum(l.created_at >= ? AND l.created_at < ? AND l.first_contact_at IS NOT NULL) AS respondidos_periodo,
            sum(s.kind = 'won' AND l.stage_changed_at >= ? AND l.stage_changed_at < ?) AS ganhos_periodo
       FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id
      GROUP BY l.owner_id ORDER BY abertos DESC`,
    [horas, desde, ate, desde, ate]
  );

  // --- Leads do período, um a um: base do funil, das UTMs, da entrada por hora e do mapa dia × hora ---
  // Etapas pelas quais o lead já passou vêm do histórico (stage_changed guarda o nome da etapa de destino).
  const idPorNome = new Map(porEtapa.map((s) => [String(s.nome).trim().toLowerCase(), s.id]));
  const passou = new Map();
  for (const h of all(
    `SELECT e.lead_id, json_extract(e.data, '$.para') AS para
       FROM lead_events e JOIN leads l ON l.id = e.lead_id
      WHERE e.type = 'stage_changed' AND l.created_at >= ? AND l.created_at < ?`,
    p
  )) {
    const id = idPorNome.get(String(h.para || '').trim().toLowerCase());
    if (!id) continue;
    if (!passou.has(h.lead_id)) passou.set(h.lead_id, new Set());
    passou.get(h.lead_id).add(id);
  }
  const chavesUtm = new Set();
  const leadsPeriodo = all(
    `SELECT id, name, created_at, stage_id, source, first_contact_at IS NOT NULL AS respondido,
            json_extract(extra, '$.utm') AS utm
       FROM leads WHERE ${noPeriodo} ORDER BY created_at`,
    p
  ).map((l) => {
    const utm = {};
    for (const [k, v] of Object.entries(lerJsonSeguro(l.utm))) {
      if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
      const chave = String(k).toLowerCase();
      utm[chave] = String(v).slice(0, 200);
      chavesUtm.add(chave);
    }
    return {
      id: l.id,
      n: l.name || null,
      c: l.created_at,
      s: l.stage_id,
      p: [...(passou.get(l.id) || [])],
      r: l.respondido ? 1 : 0,
      o: l.source,
      u: utm,
    };
  });

  return {
    periodo: { dias: Math.round(duracaoMs / DIA_MS), desde, ate },
    followup_horas: horas,
    entrada: {
      novos,
      anteriores: novosAntes,
      variacao: novosAntes ? Math.round(((novos - novosAntes) / novosAntes) * 1000) / 10 : null,
      respondidos,
      taxa_resposta: pct(respondidos, novos),
      taxa_resposta_anterior: pct(respondidosAntes, novosAntes),
      tempo_resposta_mediana_min: tempos.length ? Math.round(mediana(tempos)) : null,
      tempo_resposta_media_min: tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null,
      respondidos_em_1h: em1h,
      taxa_resposta_1h: pct(em1h, novos),
    },
    agora: {
      abertos,
      atrasados,
      em_dia: abertos - atrasados,
      taxa_followup_em_dia: pct(abertos - atrasados, abertos),
      aguardando,
      nunca_contatados: nuncaContatados,
    },
    resultados: {
      ganhos,
      perdidos,
      taxa_conversao: pct(ganhos, novos),
      reunioes_agendadas: reunioes.n || 0,
      reunioes_canceladas: reunioes.canceladas || 0,
      mensagens_recebidas: mensagens.recebidas || 0,
      mensagens_enviadas: mensagens.enviadas || 0,
    },
    funil_forms: {
      iniciaram: nf(funilForms.iniciaram),
      completaram: nf(funilForms.completaram),
      agendaram: nf(funilForms.agendaram),
      completaram_e_agendaram: nf(funilForms.completaram_e_agendaram),
      completaram_sem_agendar: nf(funilForms.completaram_sem_agendar),
      parciais_que_agendaram: nf(funilForms.parciais_que_agendaram),
      taxa_conclusao: pct(nf(funilForms.completaram), nf(funilForms.iniciaram)),
      taxa_agendamento: pct(nf(funilForms.completaram_e_agendaram), nf(funilForms.completaram)),
    },
    por_dia: porDia,
    por_origem: porOrigem,
    por_formulario: porFormulario,
    por_etapa: porEtapa,
    por_responsavel: porResponsavel,
    leads: leadsPeriodo,
    chaves_utm: [...chavesUtm].sort(),
  };
}

export default {
  name: 'estatisticas',
  register(app) {
    app.get('/api/estatisticas', exigirLogin, (req, res) => {
      const fusoMin = Math.max(-840, Math.min(840, Number(req.query.fuso) || 0));
      res.json(calcularEstatisticas({ dias: req.query.dias, inicio: req.query.inicio, fim: req.query.fim, fusoMin }));
    });
  },
};
