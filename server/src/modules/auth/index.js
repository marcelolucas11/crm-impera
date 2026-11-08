// Módulo de login: entrar, sair, quem sou eu, trocar a própria senha
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { get, run, agora } from '../../db.js';
import { exigirLogin } from './middleware.js';
import { resolverPermissoes } from './permissoes.js';
import { encerrarSessoesDoUsuario } from '../../sessoes.js';

// Por endereço: 10 erros em 15 minutos. Logins certos não contam (uma equipe inteira atrás do mesmo IP do escritório
// pode entrar à vontade; antes o 11º login do escritório em 15 minutos era bloqueado)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' },
});
// Também por conta: tentativas espalhadas por vários endereços contra o mesmo e-mail param depois de 30 erros.
// Logins certos não contam.
const limitePorConta = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `conta:${String(req.body?.email || '').trim().toLowerCase().slice(0, 200)}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas para esta conta. Aguarde 15 minutos.' },
});

// Conferência com um hash qualquer quando o e-mail não existe: a resposta demora o mesmo tanto,
// então não dá para descobrir pelo tempo quais e-mails têm conta no CRM
const HASH_FALSO = bcrypt.hashSync('senha-que-nao-existe-' + Math.random(), 12);

// permissoes: telas e funções liberadas para a pessoa (a tela esconde o que não está liberado)
const publico = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, foto: u.photo_at || null, permissoes: resolverPermissoes(u) });

export default {
  name: 'auth',
  register(app) {
    const r = Router();

    r.post('/login', limiteLogin, limitePorConta, async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
      const senha = String(req.body?.senha || '').slice(0, 200);
      if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha' });

      const user = get('SELECT * FROM users WHERE lower(email) = ?', [email]);
      const confere = await bcrypt.compare(senha, user?.password_hash || HASH_FALSO);
      const valido = Boolean(user && user.active && confere);
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
      if (nova.length > 200) return res.status(400).json({ erro: 'Senha longa demais (máximo 200 caracteres)' });
      if (nova.length < 8) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres' });
      const { password_hash } = get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
      if (!(await bcrypt.compare(atual, password_hash))) {
        return res.status(400).json({ erro: 'Senha atual incorreta' });
      }
      run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nova, 12), req.user.id]);
      // Senha nova: quem estava logado com a senha antiga em outro aparelho sai (este aparelho continua)
      encerrarSessoesDoUsuario(req.user.id, req.sessionID);
      res.json({ ok: true });
    });

    app.use('/api/auth', r);
  },
};
