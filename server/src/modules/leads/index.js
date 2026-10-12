// Módulo de leads: listar (kanban), criar, editar, mover de etapa, registrar contato e notas
import { Router } from 'express';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento, lerJson } from '../../events.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { normalizarTelefone, normalizarEmail, texto, idValido, ErroHttp } from '../../util.js';
import { buscarLead, listarLeads, criarLead, registrarContatoLead, vincularConversasExistentes } from './service.js';

const ROTULOS = { name: 'nome', phone: 'telefone', email: 'e-mail', company: 'empresa', notes: 'observações' };

function lerCampos(body) {
  const campos = {};
  if (body.name !== undefined) campos.name = texto(body.name, 200);
  if (body.phone !== undefined) campos.phone = body.phone ? normalizarTelefone(body.phone) : null;
  if (body.email !== undefined) campos.email = body.email ? normalizarEmail(body.email) : null;
  if (body.company !== undefined) campos.company = texto(body.company, 200);
  if (body.notes !== undefined) campos.notes = texto(body.notes, 5000);
  return campos;
}

export default {
  name: 'leads',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    // Lista para o kanban. Etapas finais (ganho/perdido) mostram só os últimos 30 dias, exceto em buscas.
    r.get('/', (req, res) => {
      const busca = String(req.query.q || '').trim();
      const filtros = [];
      const valores = [];

      if (busca) {
        const termo = `%${busca}%`;
        const digitos = busca.replace(/\D/g, '');
        let cond = 'name LIKE ? OR email LIKE ? OR company LIKE ? OR form_name LIKE ?';
        valores.push(termo, termo, termo, termo);
        if (digitos.length >= 4) {
          cond += ' OR phone LIKE ?';
          valores.push(`%${digitos}%`);
        }
        filtros.push(`(${cond})`);
      } else {
        filtros.push("(stage_kind = 'open' OR julianday('now') - julianday(stage_changed_at) < 30)");
      }
      if (req.query.atrasados === '1') filtros.push('followup_overdue');
      if (req.query.responsavel === 'eu') {
        filtros.push('owner_id = ?');
        valores.push(req.user.id);
      }

      res.json({ leads: listarLeads(filtros, valores), followup_horas: config.followupHours });
    });

    r.post('/', (req, res) => {
      const campos = lerCampos(req.body || {});
      if (!campos.name && !campos.phone && !campos.email) {
        return res.status(400).json({ erro: 'Informe pelo menos nome, telefone ou e-mail' });
      }
      const stageId = idValido(req.body?.stage_id);
      if (stageId && !get('SELECT 1 FROM stages WHERE id = ?', [stageId])) return res.status(400).json({ erro: 'Etapa não existe' });
      const ownerId = idValido(req.body?.owner_id) || req.user.id;
      const id = tx(() => criarLead({ ...campos, stage_id: stageId, owner_id: ownerId, source: 'manual' }, { userId: req.user.id }));
      res.status(201).json({ lead: buscarLead(id) });
    });

    r.get('/:id', (req, res) => {
      const id = idValido(req.params.id);
      const lead = id && buscarLead(id);
      if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });
      const eventos = all(
        `SELECT e.id, e.type, e.data, e.created_at, u.name AS user_name
           FROM lead_events e LEFT JOIN users u ON u.id = e.user_id
          WHERE e.lead_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 300`,
        [id]
      ).map((e) => ({ ...e, data: lerJson(e.data) }));
      res.json({ lead, eventos });
    });

    r.patch('/:id', (req, res) => {
      const id = idValido(req.params.id);
      if (!id) return res.status(400).json({ erro: 'ID inválido' });
      const body = req.body || {};

      tx(() => {
        const atual = get('SELECT * FROM leads WHERE id = ?', [id]);
        if (!atual) throw new ErroHttp(404, 'Lead não encontrado');

        const campos = lerCampos(body);
        const alterados = Object.keys(campos).filter((k) => (campos[k] ?? null) !== (atual[k] ?? null));
        const sets = [];
        const vals = [];
        const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };
        alterados.forEach((k) => add(k, campos[k]));

        // Mudança de etapa
        if (body.stage_id !== undefined) {
          const novaEtapa = idValido(body.stage_id);
          if (!novaEtapa) throw new ErroHttp(400, 'Etapa inválida');
          if (novaEtapa !== atual.stage_id) {
            const de = get('SELECT name FROM stages WHERE id = ?', [atual.stage_id]);
            const para = get('SELECT name FROM stages WHERE id = ?', [novaEtapa]);
            if (!para) throw new ErroHttp(400, 'Etapa não existe');
            add('stage_id', novaEtapa);
            add('stage_changed_at', agora());
            registrarEvento({ leadId: id, userId: req.user.id, type: 'stage_changed', data: { de: de?.name, para: para.name } });
          }
        }

        // Mudança de responsável
        if (body.owner_id !== undefined) {
          const novoDono = body.owner_id === null || body.owner_id === '' ? null : idValido(body.owner_id);
          if (novoDono !== atual.owner_id) {
            let nomeDono = null;
            if (novoDono) {
              const u = get('SELECT name FROM users WHERE id = ?', [novoDono]);
              if (!u) throw new ErroHttp(400, 'Responsável não existe');
              nomeDono = u.name;
            }
            add('owner_id', novoDono);
            registrarEvento({ leadId: id, userId: req.user.id, type: 'owner_changed', data: { para: nomeDono } });
          }
        }

        if (alterados.length) {
          registrarEvento({ leadId: id, userId: req.user.id, type: 'updated', data: { campos: alterados.map((k) => ROTULOS[k] || k) } });
        }
        if (sets.length) {
          add('updated_at', agora());
          run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
        }
        if (alterados.includes('phone') && campos.phone) vincularConversasExistentes(id, campos.phone);
      });

      res.json({ lead: buscarLead(id) });
    });

    // Registrar que houve contato com o lead (zera o contador de follow-up)
    r.post('/:id/contato', (req, res) => {
      const id = idValido(req.params.id);
      const canal = texto(req.body?.canal, 40) || 'whatsapp';
      const nota = texto(req.body?.nota, 2000);
      const ok = tx(() => {
        if (!get('SELECT 1 FROM leads WHERE id = ?', [id])) return false;
        registrarContatoLead(id, agora());
        registrarEvento({ leadId: id, userId: req.user.id, type: 'contact', data: { canal, nota } });
        return true;
      });
      if (!ok) return res.status(404).json({ erro: 'Lead não encontrado' });
      res.json({ lead: buscarLead(id) });
    });

    // Liga/desliga o aviso "aguardando minha resposta"
    r.post('/:id/aguardando', (req, res) => {
      const id = idValido(req.params.id);
      const ativo = Boolean(req.body?.ativo);
      const nota = texto(req.body?.nota, 300);
      const ok = tx(() => {
        const lead = get('SELECT waiting_since FROM leads WHERE id = ?', [id]);
        if (!lead) return false;
        if (ativo) {
          run('UPDATE leads SET waiting_since = COALESCE(waiting_since, ?), waiting_by = ?, waiting_note = ?, updated_at = ? WHERE id = ?', [
            agora(), req.user.id, nota, agora(), id,
          ]);
          if (!lead.waiting_since) registrarEvento({ leadId: id, userId: req.user.id, type: 'waiting_on', data: { nota } });
        } else if (lead.waiting_since) {
          run('UPDATE leads SET waiting_since = NULL, waiting_by = NULL, waiting_note = NULL, updated_at = ? WHERE id = ?', [agora(), id]);
          registrarEvento({ leadId: id, userId: req.user.id, type: 'waiting_off', data: {} });
        }
        return true;
      });
      if (!ok) return res.status(404).json({ erro: 'Lead não encontrado' });
      res.json({ lead: buscarLead(id) });
    });

    r.post('/:id/notas', (req, res) => {
      const id = idValido(req.params.id);
      const conteudo = texto(req.body?.texto, 5000);
      if (!conteudo) return res.status(400).json({ erro: 'Escreva a nota' });
      if (!get('SELECT 1 FROM leads WHERE id = ?', [id])) return res.status(404).json({ erro: 'Lead não encontrado' });
      registrarEvento({ leadId: id, userId: req.user.id, type: 'note', data: { texto: conteudo } });
      res.status(201).json({ ok: true });
    });

    r.delete('/:id', exigirAdmin, (req, res) => {
      const id = idValido(req.params.id);
      const { changes } = run('DELETE FROM leads WHERE id = ?', [id]);
      if (!changes) return res.status(404).json({ erro: 'Lead não encontrado' });
      res.json({ ok: true });
    });

    app.use('/api/leads', r);
  },
};
