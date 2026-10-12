// Módulo de equipe: listar, criar e editar usuários
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../../db.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { normalizarEmail, texto, idValido } from '../../util.js';

const CAMPOS = 'id, name, email, role, active, last_login_at, created_at';

export default {
  name: 'users',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', async (req, res) => {
      const { rows } = await query(`SELECT ${CAMPOS} FROM users ORDER BY active DESC, name`);
      res.json({ users: rows });
    });

    r.post('/', exigirAdmin, async (req, res) => {
      const name = texto(req.body?.name, 120);
      const email = normalizarEmail(req.body?.email);
      const senha = String(req.body?.senha || '');
      const role = req.body?.role === 'admin' ? 'admin' : 'member';
      if (!name || !email) return res.status(400).json({ erro: 'Nome e e-mail válidos são obrigatórios' });
      if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres' });

      const existe = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
      if (existe.rowCount) return res.status(409).json({ erro: 'Já existe um usuário com esse e-mail' });

      const { rows } = await query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ${CAMPOS}`,
        [name, email, await bcrypt.hash(senha, 12), role]
      );
      res.status(201).json({ user: rows[0] });
    });

    r.patch('/:id', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!id) return res.status(400).json({ erro: 'ID inválido' });
      const sets = [];
      const vals = [];
      const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

      if (req.body?.name !== undefined) {
        const name = texto(req.body.name, 120);
        if (!name) return res.status(400).json({ erro: 'Nome inválido' });
        add('name', name);
      }
      if (req.body?.role !== undefined) {
        if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode mudar o seu próprio papel' });
        add('role', req.body.role === 'admin' ? 'admin' : 'member');
      }
      if (req.body?.active !== undefined) {
        if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode desativar a si mesmo' });
        add('active', Boolean(req.body.active));
      }
      if (req.body?.senha !== undefined) {
        const senha = String(req.body.senha);
        if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres' });
        add('password_hash', await bcrypt.hash(senha, 12));
      }
      if (!sets.length) return res.status(400).json({ erro: 'Nada para alterar' });

      vals.push(id);
      const { rows } = await query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${CAMPOS}`,
        vals
      );
      if (!rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado' });
      res.json({ user: rows[0] });
    });

    app.use('/api/users', r);
  },
};
