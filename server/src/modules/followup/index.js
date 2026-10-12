// Módulo de follow-up: quantos e quais leads estão sem contato há mais tempo que o limite
import { Router } from 'express';
import { query } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin } from '../auth/middleware.js';
import { BASE_LEADS } from '../leads/service.js';

export default {
  name: 'followup',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/resumo', async (req, res) => {
      const { rows } = await query(
        `WITH base AS (${BASE_LEADS})
         SELECT id, name, phone, stage_name, owner_name, last_activity_at
           FROM base WHERE followup_overdue
          ORDER BY last_activity_at ASC`,
        [config.followupHours]
      );
      res.json({ horas: config.followupHours, atrasados: rows.length, lista: rows.slice(0, 50) });
    });

    app.use('/api/followup', r);
  },
};
