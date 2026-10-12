// Módulo de leads: listar (kanban), criar, editar, mover de etapa, registrar contato e notas
import { Router } from 'express';
import { query, tx } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento } from '../../events.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { normalizarTelefone, normalizarEmail, texto, idValido } from '../../util.js';
import { BASE_LEADS, buscarLead, criarLead } from './service.js';

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
    r.get('/', async (req, res) => {
      const busca = String(req.query.q || '').trim();
      const vals = [config.followupHours];
      const filtros = [];

      if (busca) {
        vals.push(`%${busca}%`);
        const p = `$${vals.length}`;
        const digitos = busca.replace(/\D/g, '');
        let condTelefone = '';
        if (digitos.length >= 4) {
          vals.push(`%${digitos}%`);
          condTelefone = ` OR phone LIKE $${vals.length}`;
        }
        filtros.push(`(name ILIKE ${p} OR email ILIKE ${p} OR company ILIKE ${p} OR form_name ILIKE ${p}${condTelefone})`);
      } else {
        filtros.push(`(stage_kind = 'open' OR stage_changed_at > now() - interval '30 days')`);
      }
      if (req.query.atrasados === '1') filtros.push('followup_overdue');
      if (req.query.responsavel === 'eu') {
        vals.push(req.user.id);
        filtros.push(`owner_id = $${vals.length}`);
      }

      const { rows } = await query(
        `WITH base AS (${BASE_LEADS})
         SELECT * FROM base
         WHERE ${filtros.join(' AND ')}
         ORDER BY followup_overdue DESC,
                  CASE WHEN followup_overdue THEN last_activity_at END ASC NULLS LAST,
                  created_at DESC
         LIMIT 2000`,
        vals
      );
      res.json({ leads: rows, followup_horas: config.followupHours });
    });

    r.post('/', async (req, res) => {
      const campos = lerCampos(req.body || {});
      if (!campos.name && !campos.phone && !campos.email) {
        return res.status(400).json({ erro: 'Informe pelo menos nome, telefone ou e-mail' });
      }
      const stageId = idValido(req.body?.stage_id);
      const ownerId = idValido(req.body?.owner_id) || req.user.id;
      const id = await tx((client) =>
        criarLead({ ...campos, stage_id: stageId, owner_id: ownerId, source: 'manual' }, { userId: req.user.id, executor: client })
      );
      res.status(201).json({ lead: await buscarLead(id) });
    });

    r.get('/:id', async (req, res) => {
      const id = idValido(req.params.id);
      const lead = id && (await buscarLead(id));
      if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });
      const { rows: eventos } = await query(
        `SELECT e.id, e.type, e.data, e.created_at, u.name AS user_name
           FROM lead_events e LEFT JOIN users u ON u.id = e.user_id
          WHERE e.lead_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 300`,
        [id]
      );
      res.json({ lead, eventos });
    });

    r.patch('/:id', async (req, res) => {
      const id = idValido(req.params.id);
      if (!id) return res.status(400).json({ erro: 'ID inválido' });
      const body = req.body || {};

      await tx(async (client) => {
        const { rows } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id]);
        const atual = rows[0];
        if (!atual) { const e = new Error('Lead não encontrado'); e.status = 404; throw e; }

        const campos = lerCampos(body);
        const alterados = Object.keys(campos).filter((k) => (campos[k] ?? null) !== (atual[k] ?? null));
        const sets = [];
        const vals = [];
        const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
        alterados.forEach((k) => add(k, campos[k]));

        // Mudança de etapa
        if (body.stage_id !== undefined) {
          const novaEtapa = idValido(body.stage_id);
          if (!novaEtapa) { const e = new Error('Etapa inválida'); e.status = 400; throw e; }
          if (novaEtapa !== atual.stage_id) {
            const { rows: et } = await client.query('SELECT id, name FROM stages WHERE id = ANY($1)', [[atual.stage_id, novaEtapa]]);
            const nome = (sid) => et.find((s) => s.id === sid)?.name;
            if (!nome(novaEtapa)) { const e = new Error('Etapa não existe'); e.status = 400; throw e; }
            add('stage_id', novaEtapa);
            sets.push('stage_changed_at = now()');
            await registrarEvento({ leadId: id, userId: req.user.id, type: 'stage_changed', data: { de: nome(atual.stage_id), para: nome(novaEtapa) } }, client);
          }
        }

        // Mudança de responsável
        if (body.owner_id !== undefined) {
          const novoDono = body.owner_id === null || body.owner_id === '' ? null : idValido(body.owner_id);
          if (novoDono !== atual.owner_id) {
            let nomeDono = null;
            if (novoDono) {
              const { rows: us } = await client.query('SELECT name FROM users WHERE id = $1', [novoDono]);
              if (!us[0]) { const e = new Error('Responsável não existe'); e.status = 400; throw e; }
              nomeDono = us[0].name;
            }
            add('owner_id', novoDono);
            await registrarEvento({ leadId: id, userId: req.user.id, type: 'owner_changed', data: { para: nomeDono } }, client);
          }
        }

        if (alterados.length) {
          await registrarEvento({ leadId: id, userId: req.user.id, type: 'updated', data: { campos: alterados.map((k) => ROTULOS[k] || k) } }, client);
        }
        if (sets.length) {
          sets.push('updated_at = now()');
          vals.push(id);
          await client.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
        }
      });

      res.json({ lead: await buscarLead(id) });
    });

    // Registrar que houve contato com o lead (zera o contador de follow-up)
    r.post('/:id/contato', async (req, res) => {
      const id = idValido(req.params.id);
      const canal = texto(req.body?.canal, 40) || 'whatsapp';
      const nota = texto(req.body?.nota, 2000);
      const { rowCount } = await query('UPDATE leads SET last_contact_at = now(), updated_at = now() WHERE id = $1', [id]);
      if (!rowCount) return res.status(404).json({ erro: 'Lead não encontrado' });
      await registrarEvento({ leadId: id, userId: req.user.id, type: 'contact', data: { canal, nota } });
      res.json({ lead: await buscarLead(id) });
    });

    r.post('/:id/notas', async (req, res) => {
      const id = idValido(req.params.id);
      const conteudo = texto(req.body?.texto, 5000);
      if (!conteudo) return res.status(400).json({ erro: 'Escreva a nota' });
      const { rowCount } = await query('SELECT 1 FROM leads WHERE id = $1', [id]);
      if (!rowCount) return res.status(404).json({ erro: 'Lead não encontrado' });
      await registrarEvento({ leadId: id, userId: req.user.id, type: 'note', data: { texto: conteudo } });
      res.status(201).json({ ok: true });
    });

    r.delete('/:id', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      const { rowCount } = await query('DELETE FROM leads WHERE id = $1', [id]);
      if (!rowCount) return res.status(404).json({ erro: 'Lead não encontrado' });
      res.json({ ok: true });
    });

    app.use('/api/leads', r);
  },
};
