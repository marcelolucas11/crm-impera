// Módulo de etapas do kanban: listar, criar, renomear, mudar cor/tipo/papel, reordenar e apagar
// (ao apagar, os leads da etapa vão para outra etapa — nenhum lead é apagado)
import { Router } from 'express';
import { get, all, run, tx, agora } from '../../db.js';
import { registrarEvento } from '../../events.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido, texto, ErroHttp } from '../../util.js';

const TIPOS = new Set(['open', 'won', 'lost']);
const PAPEIS = new Set(['entrada', 'reuniao']);
const corValida = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

function listar() {
  return all(
    `SELECT s.id, s.name, s.position, s.color, s.kind, s.role,
            (SELECT count(*) FROM leads l WHERE l.stage_id = s.id) AS total
       FROM stages s ORDER BY s.position, s.id`
  );
}

function renumerar(ids) {
  ids.forEach((id, i) => run('UPDATE stages SET position = ? WHERE id = ?', [i + 1, id]));
}

function definirPapel(stageId, papel) {
  if (papel === null) {
    if (get('SELECT role FROM stages WHERE id = ?', [stageId])?.role === 'entrada') {
      throw new ErroHttp(400, 'Escolha outra etapa como entrada de leads novos antes de tirar desta');
    }
    run('UPDATE stages SET role = NULL WHERE id = ?', [stageId]);
    return;
  }
  if (!PAPEIS.has(papel)) throw new ErroHttp(400, 'Papel inválido');
  if (get('SELECT kind FROM stages WHERE id = ?', [stageId])?.kind !== 'open') {
    throw new ErroHttp(400, 'Só etapas em andamento podem receber leads automaticamente');
  }
  run('UPDATE stages SET role = NULL WHERE role = ?', [papel]);
  run('UPDATE stages SET role = ? WHERE id = ?', [papel, stageId]);
}

export default {
  name: 'stages',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', (req, res) => res.json({ stages: listar() }));

    // Criar etapa (no fim ou logo depois de outra)
    r.post('/', exigirAdmin, (req, res) => {
      const nome = texto(req.body?.name, 40);
      if (!nome) return res.status(400).json({ erro: 'Dê um nome para a etapa' });
      const tipo = TIPOS.has(req.body?.kind) ? req.body.kind : 'open';
      const cor = corValida(req.body?.color) || '#8a8f98';
      const depoisDe = idValido(req.body?.depois_de);
      tx(() => {
        const { lastInsertRowid } = run('INSERT INTO stages (name, position, color, kind) VALUES (?, 9999, ?, ?)', [nome, cor, tipo]);
        const novo = Number(lastInsertRowid);
        const ids = all('SELECT id FROM stages WHERE id != ? ORDER BY position, id', [novo]).map((s) => s.id);
        const i = depoisDe ? ids.indexOf(depoisDe) : -1;
        if (i >= 0) ids.splice(i + 1, 0, novo); else ids.push(novo);
        renumerar(ids);
      });
      res.status(201).json({ stages: listar() });
    });

    // Reordenar: recebe a lista completa de ids na nova ordem
    r.post('/ordem', exigirAdmin, (req, res) => {
      const ids = (req.body?.ids || []).map(idValido);
      const atuais = all('SELECT id FROM stages').map((s) => s.id);
      if (ids.length !== atuais.length || ids.some((id) => !atuais.includes(id))) {
        return res.status(400).json({ erro: 'Lista de etapas incompleta' });
      }
      tx(() => renumerar(ids));
      res.json({ stages: listar() });
    });

    r.patch('/:id', exigirAdmin, (req, res) => {
      const id = idValido(req.params.id);
      const etapa = id && get('SELECT * FROM stages WHERE id = ?', [id]);
      if (!etapa) return res.status(404).json({ erro: 'Etapa não encontrada' });
      const b = req.body || {};
      tx(() => {
        if (b.name !== undefined) {
          const nome = texto(b.name, 40);
          if (!nome) throw new ErroHttp(400, 'O nome não pode ficar vazio');
          run('UPDATE stages SET name = ? WHERE id = ?', [nome, id]);
        }
        if (b.color !== undefined) {
          const cor = corValida(b.color);
          if (!cor) throw new ErroHttp(400, 'Cor inválida');
          run('UPDATE stages SET color = ? WHERE id = ?', [cor, id]);
        }
        if (b.kind !== undefined) {
          if (!TIPOS.has(b.kind)) throw new ErroHttp(400, 'Tipo inválido');
          if (b.kind !== 'open' && etapa.role === 'entrada') throw new ErroHttp(400, 'A etapa de entrada precisa ser "em andamento"');
          if (b.kind !== 'open' && etapa.kind === 'open' && get("SELECT count(*) n FROM stages WHERE kind = 'open'").n <= 1) {
            throw new ErroHttp(400, 'O kanban precisa de pelo menos uma etapa em andamento');
          }
          run('UPDATE stages SET kind = ? WHERE id = ?', [b.kind, id]);
          if (b.kind !== 'open') run('UPDATE stages SET role = NULL WHERE id = ?', [id]);
        }
        if (b.role !== undefined) definirPapel(id, b.role || null);
      });
      res.json({ stages: listar() });
    });

    // Apagar: os leads vão para a etapa indicada em mover_para
    r.delete('/:id', exigirAdmin, (req, res) => {
      const id = idValido(req.params.id);
      const etapa = id && get('SELECT * FROM stages WHERE id = ?', [id]);
      if (!etapa) return res.status(404).json({ erro: 'Etapa não encontrada' });
      const destino = idValido(req.query.mover_para || req.body?.mover_para);
      const total = get('SELECT count(*) n FROM leads WHERE stage_id = ?', [id]).n;

      if (etapa.kind === 'open' && get("SELECT count(*) n FROM stages WHERE kind = 'open'").n <= 1) {
        return res.status(400).json({ erro: 'O kanban precisa de pelo menos uma etapa em andamento' });
      }
      const alvo = destino && destino !== id ? get('SELECT * FROM stages WHERE id = ?', [destino]) : null;
      if (total > 0 && !alvo) return res.status(400).json({ erro: 'Escolha para qual etapa vão os leads desta coluna' });

      tx(() => {
        if (total > 0) {
          const leads = all('SELECT id FROM leads WHERE stage_id = ?', [id]);
          const momento = agora();
          run('UPDATE leads SET stage_id = ?, stage_changed_at = ?, updated_at = ? WHERE stage_id = ?', [alvo.id, momento, momento, id]);
          for (const l of leads) {
            registrarEvento({ leadId: l.id, userId: req.user.id, type: 'stage_changed', data: { de: etapa.name, para: alvo.name, motivo: 'etapa removida' } });
          }
        }
        if (etapa.role === 'entrada') {
          const novaEntrada = alvo?.kind === 'open' ? alvo.id : get("SELECT id FROM stages WHERE kind = 'open' AND id != ? ORDER BY position LIMIT 1", [id]).id;
          run("UPDATE stages SET role = 'entrada' WHERE id = ?", [novaEntrada]);
        }
        run('DELETE FROM stages WHERE id = ?', [id]);
        renumerar(all('SELECT id FROM stages ORDER BY position, id').map((s) => s.id));
      });
      res.json({ stages: listar(), movidos: total });
    });

    app.use('/api/stages', r);
  },
};
