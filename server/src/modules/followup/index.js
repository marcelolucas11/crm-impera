// Módulo de follow-up: quantos e quais leads estão sem contato há mais tempo que o limite
import { Router } from 'express';
import { config } from '../../config.js';
import { get } from '../../db.js';
import { exigirLogin } from '../auth/middleware.js';
import { listarLeads } from '../leads/service.js';

export default {
  name: 'followup',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/resumo', (req, res) => {
      const atrasados = listarLeads(['followup_overdue'], []);
      const lista = atrasados
        .sort((a, b) => a.last_activity_at.localeCompare(b.last_activity_at))
        .slice(0, 50)
        .map(({ id, name, phone, stage_name, owner_name, last_activity_at }) => ({ id, name, phone, stage_name, owner_name, last_activity_at }));
      const aguardando = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND l.waiting_since IS NOT NULL").n;
      const conversasNaoLidas = get(
        // Como no WhatsApp: conversas silenciadas ou arquivadas não contam no contador
        `SELECT count(DISTINCT COALESCE('l' || lead_id, chat_jid)) n FROM wa_messages
          WHERE from_me = 0 AND read_at IS NULL AND hidden_at IS NULL
            AND chat_jid NOT IN (SELECT jid FROM wa_chats WHERE archived = 1 OR muted_until > ?)`,
        [new Date().toISOString()]
      ).n;
      res.json({ horas: config.followupHours, atrasados: atrasados.length, lista, aguardando, conversas_nao_lidas: conversasNaoLidas });
    });

    app.use('/api/followup', r);
  },
};
