// Módulo de estatísticas: entrada de leads, respostas, tempo de resposta, follow-up, funil e equipe
import { get, all } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin } from '../auth/middleware.js';

const PERIODOS = new Set([7, 30, 90]);
const DIA_MS = 86400000;

function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

const pct = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : null);

export function calcularEstatisticas({ dias = 30, fusoMin = 0 } = {}) {
  const agoraMs = Date.now();
  const desde = new Date(agoraMs - dias * DIA_MS).toISOString();
  const anterior = new Date(agoraMs - 2 * dias * DIA_MS).toISOString();
  const fuso = `${fusoMin >= 0 ? '+' : ''}${Math.trunc(fusoMin)} minutes`;
  const horas = config.followupHours;
  const atrasoSql = `(julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?`;

  // --- Entrada e resposta ---
  const novos = get('SELECT count(*) n FROM leads WHERE created_at >= ?', [desde]).n;
  const novosAntes = get('SELECT count(*) n FROM leads WHERE created_at >= ? AND created_at < ?', [anterior, desde]).n;
  const respondidos = get('SELECT count(*) n FROM leads WHERE created_at >= ? AND first_contact_at IS NOT NULL', [desde]).n;
  const respondidosAntes = get(
    'SELECT count(*) n FROM leads WHERE created_at >= ? AND created_at < ? AND first_contact_at IS NOT NULL',
    [anterior, desde]
  ).n;
  const tempos = all(
    `SELECT max(0, (julianday(first_contact_at) - julianday(created_at)) * 1440) AS minutos
       FROM leads WHERE created_at >= ? AND first_contact_at IS NOT NULL`,
    [desde]
  ).map((r) => r.minutos);
  const em1h = tempos.filter((m) => m <= 60).length;

  // --- Situação agora ---
  const abertos = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open'").n;
  const atrasados = get(`SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND ${atrasoSql}`, [horas]).n;
  const aguardando = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND l.waiting_since IS NOT NULL").n;
  const nuncaContatados = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND l.first_contact_at IS NULL").n;

  // --- Resultados no período ---
  const resultado = (kind) =>
    get('SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = ? AND l.stage_changed_at >= ?', [kind, desde]).n;
  const ganhos = resultado('won');
  const perdidos = resultado('lost');
  const reunioes = get("SELECT count(*) n, sum(status = 'canceled') canceladas FROM calendly_events WHERE created_at >= ?", [desde]);
  const mensagens = get('SELECT sum(from_me = 0) recebidas, sum(from_me = 1) enviadas FROM wa_messages WHERE timestamp >= ?', [desde]);

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
           FROM leads l WHERE l.source = 'yayforms' AND l.created_at >= ?
       )`,
    [desde]
  );
  const nf = (v) => v || 0;

  // --- Por dia (no fuso de quem está vendo) ---
  const inicioSerie = new Date(agoraMs - (dias - 1) * DIA_MS);
  const porDiaBanco = new Map(
    all(
      `SELECT date(created_at, ?) AS dia, count(*) AS entradas, sum(first_contact_at IS NOT NULL) AS respondidos
         FROM leads WHERE created_at >= ? GROUP BY dia`,
      [fuso, new Date(agoraMs - (dias + 1) * DIA_MS).toISOString()]
    ).map((r) => [r.dia, r])
  );
  const porDia = [];
  for (let i = 0; i < dias; i++) {
    const local = new Date(inicioSerie.getTime() + i * DIA_MS + fusoMin * 60000);
    const dia = local.toISOString().slice(0, 10);
    const r = porDiaBanco.get(dia);
    porDia.push({ dia, entradas: r?.entradas || 0, respondidos: r?.respondidos || 0 });
  }

  // --- Por origem, formulário, etapa e responsável ---
  const porOrigem = all('SELECT source AS origem, count(*) AS total FROM leads WHERE created_at >= ? GROUP BY source ORDER BY total DESC', [desde]);
  const porFormulario = all(
    `SELECT json_extract(extra, '$.formulario') AS formulario, count(*) AS total,
            sum(first_contact_at IS NOT NULL) AS respondidos
       FROM leads WHERE created_at >= ? AND json_extract(extra, '$.formulario') IS NOT NULL
      GROUP BY formulario ORDER BY total DESC LIMIT 8`,
    [desde]
  );
  const porEtapa = all(
    `SELECT s.id, s.name AS nome, s.color AS cor, s.kind AS tipo, count(l.id) AS total
       FROM stages s LEFT JOIN leads l ON l.stage_id = s.id
      GROUP BY s.id ORDER BY s.position, s.id`
  );
  const porResponsavel = all(
    `SELECT COALESCE(u.name, 'Sem responsável') AS nome,
            sum(s.kind = 'open') AS abertos,
            sum(s.kind = 'open' AND ${atrasoSql}) AS atrasados,
            sum(s.kind = 'open' AND l.waiting_since IS NOT NULL) AS aguardando,
            sum(l.created_at >= ? AND l.first_contact_at IS NOT NULL) AS respondidos_periodo,
            sum(s.kind = 'won' AND l.stage_changed_at >= ?) AS ganhos_periodo
       FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id
      GROUP BY l.owner_id ORDER BY abertos DESC`,
    [horas, desde, desde]
  );

  return {
    periodo: { dias, desde },
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
  };
}

export default {
  name: 'estatisticas',
  register(app) {
    app.get('/api/estatisticas', exigirLogin, (req, res) => {
      const dias = PERIODOS.has(Number(req.query.dias)) ? Number(req.query.dias) : 30;
      const fusoMin = Math.max(-840, Math.min(840, Number(req.query.fuso) || 0));
      res.json(calcularEstatisticas({ dias, fusoMin }));
    });
  },
};
