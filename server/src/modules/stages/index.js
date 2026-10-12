// Módulo de etapas do kanban
import { Router } from 'express';
import { all } from '../../db.js';
import { exigirLogin } from '../auth/middleware.js';

export default {
  name: 'stages',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', (req, res) => {
      res.json({ stages: all('SELECT id, name, position, color, kind FROM stages ORDER BY position, id') });
    });

    app.use('/api/stages', r);
  },
};
