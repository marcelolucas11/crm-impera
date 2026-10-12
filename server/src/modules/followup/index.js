// Módulo de follow-up: quantos e quais leads estão sem contato há mais tempo que o limite
import { Router } from 'express';
import { config } from '../../config.js';
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
      res.json({ horas: config.followupHours, atrasados: atrasados.length, lista });
    });

    app.use('/api/followup', r);
  },
};
