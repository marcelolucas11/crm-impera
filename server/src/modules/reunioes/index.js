// Lista rápida de reuniões (botão "Reuniões" do kanban): programadas e anteriores, com o nome e o nicho de cada lead.
// Vem das reuniões do Calendly já sincronizadas; só leitura.
import { all } from '../../db.js';
import { exigirLogin } from '../auth/middleware.js';
import { nichoDoLead } from './nicho.js';

const DIA = 24 * 60 * 60 * 1000;
const entre = (v, min, max, padrao) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

/** Reuniões ativas entre (agora - antes dias) e (agora + depois dias), da mais antiga para a mais nova */
export function listarReunioes({ antes = 30, depois = 120 } = {}) {
  const agora = Date.now();
  const desde = new Date(agora - antes * DIA).toISOString();
  const ate = new Date(agora + depois * DIA).toISOString();
  return all(
    `SELECT c.uri, c.event_name, c.start_time, c.end_time, c.join_url, c.no_show, c.booked_at, c.lead_id,
            c.invitee_name, c.invitee_email, c.invitee_phone,
            l.name AS lead_name, l.phone AS lead_phone, l.extra AS lead_extra, l.company AS lead_company,
            s.name AS stage_name, s.color AS stage_color, u.name AS owner_name
       FROM calendly_events c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN stages s ON s.id = l.stage_id
       LEFT JOIN users u ON u.id = l.owner_id
      WHERE c.status = 'active' AND c.start_time >= ? AND c.start_time <= ?
      ORDER BY c.start_time ASC
      LIMIT 600`,
    [desde, ate]
  ).map((r) => ({
    uri: r.uri,
    evento: r.event_name,
    inicio: r.start_time,
    fim: r.end_time,
    link: r.join_url,
    no_show: Boolean(r.no_show),
    agendada_em: r.booked_at,
    lead_id: r.lead_id,
    nome: r.lead_name || r.invitee_name || r.invitee_email || null,
    telefone: r.lead_phone || r.invitee_phone || null,
    nicho: r.lead_id ? nichoDoLead(r.lead_extra) : null,
    empresa: r.lead_company || null,
    etapa: r.stage_name || null,
    etapa_cor: r.stage_color || null,
    responsavel: r.owner_name || null,
  }));
}

export default {
  name: 'reunioes',
  register(app) {
    app.get('/api/reunioes', exigirLogin, (req, res) => {
      const antes = entre(req.query.antes, 1, 365, 30);
      const depois = entre(req.query.depois, 1, 365, 120);
      res.json({ reunioes: listarReunioes({ antes, depois }), agora: new Date().toISOString(), antes, depois });
    });
  },
};
