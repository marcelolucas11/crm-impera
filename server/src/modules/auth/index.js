// Módulo de login: entrar, sair, quem sou eu, trocar a própria senha
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { get, run, agora } from '../../db.js';
import { exigirLogin } from './middleware.js';

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' },
});

const publico = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

export default {
  name: 'auth',
  register(app) {
    const r = Router();

    r.post('/login', limiteLogin, async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const senha = String(req.body?.senha || '');
      if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha' });

      const user = get('SELECT * FROM users WHERE lower(email) = ?', [email]);
      const valido = user && user.active && (await bcrypt.compare(senha, user.password_hash));
      if (!valido) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

      await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
      req.session.userId = user.id;
      run('UPDATE users SET last_login_at = ? WHERE id = ?', [agora(), user.id]);
      res.json({ user: publico(user) });
    });

    r.post('/logout', (req, res) => {
      req.session.destroy(() => {
        res.clearCookie('crm.sid');
        res.json({ ok: true });
      });
    });

    r.get('/me', exigirLogin, (req, res) => res.json({ user: publico(req.user) }));

    r.post('/senha', exigirLogin, async (req, res) => {
      const atual = String(req.body?.atual || '');
      const nova = String(req.body?.nova || '');
      if (nova.length < 8) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres' });
      const { password_hash } = get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
      if (!(await bcrypt.compare(atual, password_hash))) {
        return res.status(400).json({ erro: 'Senha atual incorreta' });
      }
      run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nova, 12), req.user.id]);
      res.json({ ok: true });
    });

    app.use('/api/auth', r);
  },
};
