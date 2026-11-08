// Módulo de equipe: listar, criar e editar usuários
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run } from '../../db.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { resolverPermissoes, validarPermissoes, PERMISSOES } from '../auth/permissoes.js';
import { normalizarEmail, texto, idValido } from '../../util.js';
import { salvarFoto, removerFoto, arquivoDaFoto, lerImagem } from './foto.js';
import { encerrarSessoesDoUsuario } from '../../sessoes.js';

// foto = versão da foto (data em que mudou) ou null; a imagem vem de /api/users/:id/foto?v=<foto>
const CAMPOS = 'id, name, email, role, active, last_login_at, created_at, photo_at AS foto, permissoes';
// permissoes = efetivas (o que a pessoa pode usar agora); permissoes_salvas = o que o administrador marcou
const mapear = (u) => {
  if (!u) return null;
  const { permissoes, ...resto } = u;
  let salvas = {};
  try { salvas = JSON.parse(permissoes || '{}') || {}; } catch { /* vazio */ }
  return { ...resto, active: Boolean(u.active), permissoes: resolverPermissoes(u), permissoes_salvas: salvas };
};
const buscar = (id) => mapear(get(`SELECT ${CAMPOS} FROM users WHERE id = ?`, [id]));

export default {
  name: 'users',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', (req, res) => {
      const lista = all(`SELECT ${CAMPOS} FROM users ORDER BY active DESC, name`).map(mapear);
      // Quem não é administrador vê a equipe (nomes e fotos dos cartões), sem as permissões dos outros
      res.json({ users: req.user.role === 'admin' ? lista : lista.map(({ permissoes, permissoes_salvas, ...u }) => u) });
    });

    // Lista das permissões que existem (telas e funções), para a tela de permissões
    r.get('/permissoes', exigirAdmin, (req, res) => res.json({ permissoes: PERMISSOES }));

    r.post('/', exigirAdmin, async (req, res) => {
      const name = texto(req.body?.name, 120);
      const email = normalizarEmail(req.body?.email);
      const senha = String(req.body?.senha || '');
      if (senha.length > 200) return res.status(400).json({ erro: 'Senha longa demais (máximo 200 caracteres)' });
      const role = req.body?.role === 'admin' ? 'admin' : 'member';
      const permissoes = JSON.stringify(validarPermissoes(req.body?.permissoes));
      if (!name || !email) return res.status(400).json({ erro: 'Nome e e-mail válidos são obrigatórios' });
      if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres' });
      // Foto opcional já no cadastro: confere antes de criar, para não sobrar usuário pela metade
      if (req.body?.foto) lerImagem(req.body.foto);
      if (get('SELECT 1 FROM users WHERE lower(email) = ?', [email])) {
        return res.status(409).json({ erro: 'Já existe um usuário com esse e-mail' });
      }
      const hash = await bcrypt.hash(senha, 12);
      const { lastInsertRowid } = run('INSERT INTO users (name, email, password_hash, role, permissoes) VALUES (?, ?, ?, ?, ?)', [name, email, hash, role, permissoes]);
      const id = Number(lastInsertRowid);
      if (req.body?.foto) salvarFoto(id, req.body.foto);
      res.status(201).json({ user: buscar(id) });
    });

    // Foto da pessoa (qualquer um da equipe vê; é a que aparece no cartão do kanban)
    r.get('/:id/foto', (req, res) => {
      const arq = arquivoDaFoto(idValido(req.params.id));
      if (!arq) return res.status(404).json({ erro: 'Sem foto' });
      res.setHeader('Content-Type', arq.mime);
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(arq.caminho);
    });

    // Trocar/remover a foto: o administrador muda a de qualquer pessoa; cada um muda a própria
    const podeMudarFoto = (req, res, next) => {
      const id = idValido(req.params.id);
      if (!id) return res.status(400).json({ erro: 'ID inválido' });
      if (req.user.role !== 'admin' && req.user.id !== id) return res.status(403).json({ erro: 'Você só pode mudar a sua própria foto' });
      req.alvoId = id;
      next();
    };
    r.put('/:id/foto', podeMudarFoto, (req, res) => {
      salvarFoto(req.alvoId, req.body?.foto);
      res.json({ user: buscar(req.alvoId) });
    });
    r.delete('/:id/foto', podeMudarFoto, (req, res) => {
      removerFoto(req.alvoId);
      res.json({ user: buscar(req.alvoId) });
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
      if (req.body?.permissoes !== undefined) {
        // Guarda exatamente o que foi marcado na tela (chaves desconhecidas são ignoradas)
        add('permissoes', JSON.stringify(validarPermissoes(req.body.permissoes)));
      }
      if (req.body?.senha !== undefined) {
        const senha = String(req.body.senha);
        if (senha.length > 200) return res.status(400).json({ erro: 'Senha longa demais (máximo 200 caracteres)' });
        if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres' });
        add('password_hash', await bcrypt.hash(senha, 12));
      }
      if (!sets.length) return res.status(400).json({ erro: 'Nada para alterar' });

      run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
      // Senha trocada ou acesso desligado: as sessões abertas dessa pessoa terminam na hora
      if (req.body?.senha !== undefined || req.body?.active === false) encerrarSessoesDoUsuario(id, id === req.user.id ? req.sessionID : null);
      res.json({ user: buscar(id) });
    });

    app.use('/api/users', r);
  },
};
