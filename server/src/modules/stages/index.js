// Módulo de etapas do kanban
import { Router } from 'express';
import { query } from '../../db.js';
import { exigirLogin } from '../auth/middleware.js';

export default {
  name: 'stages',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', async (req, res) => {
      const { rows } = await query('SELECT id, name, position, color, kind FROM stages ORDER BY position, id');
      res.json({ stages: rows });
    });

    app.use('/api/stages', r);
  },
};
