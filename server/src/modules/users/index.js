// Módulo de equipe: listar, criar e editar usuários
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run } from '../../db.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { normalizarEmail, texto, idValido } from '../../util.js';

const CAMPOS = 'id, name, email, role, active, last_login_at, created_at';
const mapear = (u) => (u ? { ...u, active: Boolean(u.active) } : null);
const buscar = (id) => mapear(get(`SELECT ${CAMPOS} FROM users WHERE id = ?`, [id]));

export default {
  name: 'users',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', (req, res) => {
      res.json({ users: all(`SELECT ${CAMPOS} FROM users ORDER BY active DESC, name`).map(mapear) });
    });

    r.post('/', exigirAdmin, async (req, res) => {
      const name = texto(req.body?.name, 120);
      const email = normalizarEmail(req.body?.email);
      const senha = String(req.body?.senha || '');
      const role = req.body?.role === 'admin' ? 'admin' : 'member';
      if (!name || !email) return res.status(400).json({ erro: 'Nome e e-mail válidos são obrigatórios' });
      if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres' });
      if (get('SELECT 1 FROM users WHERE lower(email) = ?', [email])) {
        return res.status(409).json({ erro: 'Já existe um usuário com esse e-mail' });
      }
      const hash = await bcrypt.hash(senha, 12);
      const { lastInsertRowid } = run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name, email, hash, role]);
      res.status(201).json({ user: buscar(Number(lastInsertRowid)) });
    });

    r.patch('/:id', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!id) return res.status(400).json({ erro: 'ID inválido' });
      if (!get('SELECT 1 FROM users WHERE id = ?', [id])) return res.status(404).json({ erro: 'Usuário não encontrado' });

      const sets = [];
      const vals = [];
      const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

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

      run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
      res.json({ user: buscar(id) });
    });

    app.use('/api/users', r);
  },
};
