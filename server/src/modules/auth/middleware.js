import { get } from '../../db.js';

// Exige usuário logado e ativo. Disponibiliza req.user.
export function exigirLogin(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ erro: 'Faça login para continuar' });
  const user = get('SELECT id, name, email, role, active FROM users WHERE id = ?', [userId]);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ erro: 'Sessão inválida, faça login de novo' });
  }
  req.user = user;
  next();
}

export function exigirAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores' });
  next();
}
