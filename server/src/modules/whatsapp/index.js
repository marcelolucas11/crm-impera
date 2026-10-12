// Módulo WhatsApp (QR code, vários números): conectar números, conversa no lead, envio pelo CRM.
// Mensagens enviadas para um lead (pelo CRM ou pelo celular) zeram o contador de follow-up.
import { Router } from 'express';
import QRCode from 'qrcode';
import { all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido, texto } from '../../util.js';
import {
  listarNumeros, conectar, desconectar, removerNumero, criarNumero, enviarMensagem,
  iniciarTodos, pararTodos, numeroExiste,
} from './gerenciador.js';

async function comQr(numeros, admin) {
  return Promise.all(
    numeros.map(async (n) => ({
      ...n,
      qr: admin && n.qr ? await QRCode.toDataURL(n.qr, { margin: 1, width: 280 }) : null,
    }))
  );
}

export default {
  name: 'whatsapp',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/numeros', async (req, res) => {
      res.json({ numeros: await comQr(listarNumeros(), req.user.role === 'admin'), ativo: config.whatsapp.ativo });
    });

    r.post('/numeros', exigirAdmin, async (req, res) => {
      const nome = texto(req.body?.nome, 60) || 'WhatsApp';
      const id = criarNumero(nome);
      await conectar(id);
      res.status(201).json({ id });
    });

    r.post('/numeros/:id/conectar', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      await conectar(id);
      res.json({ ok: true });
    });

    r.post('/numeros/:id/desconectar', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      await desconectar(id);
      res.json({ ok: true });
    });

    r.patch('/numeros/:id', exigirAdmin, (req, res) => {
      const id = idValido(req.params.id);
      const nome = texto(req.body?.nome, 60);
      if (!nome) return res.status(400).json({ erro: 'Informe o nome' });
      run('UPDATE wa_instances SET name = ? WHERE id = ?', [nome, id]);
      res.json({ ok: true });
    });

    r.delete('/numeros/:id', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      await removerNumero(id);
      res.json({ ok: true });
    });

    app.use('/api/whatsapp', r);

    // Conversa do lead
    app.get('/api/leads/:id/mensagens', exigirLogin, (req, res) => {
      const id = idValido(req.params.id);
      const mensagens = all(
        `SELECT * FROM (
           SELECT m.id, m.from_me, m.type, m.body, m.timestamp, m.instance_id, m.read_at,
                  i.name AS numero_nome, u.name AS enviado_por
             FROM wa_messages m
             LEFT JOIN wa_instances i ON i.id = m.instance_id
             LEFT JOIN users u ON u.id = m.sent_by
            WHERE m.lead_id = ?
            ORDER BY m.timestamp DESC, m.id DESC LIMIT 300
         ) ORDER BY timestamp ASC, id ASC`,
        [id]
      ).map((m) => ({ ...m, from_me: Boolean(m.from_me) }));
      // Abrir a conversa marca as mensagens recebidas como lidas
      run('UPDATE wa_messages SET read_at = ? WHERE lead_id = ? AND from_me = 0 AND read_at IS NULL', [agora(), id]);
      const ultimoNumero = mensagens.length ? mensagens[mensagens.length - 1].instance_id : null;
      res.json({ mensagens, ultimo_numero: ultimoNumero });
    });

    app.post('/api/leads/:id/mensagens', exigirLogin, async (req, res) => {
      const leadId = idValido(req.params.id);
      const numeroId = idValido(req.body?.numero_id);
      const conteudo = texto(req.body?.texto, 4000);
      if (!conteudo) return res.status(400).json({ erro: 'Escreva a mensagem' });
      if (!numeroId) return res.status(400).json({ erro: 'Escolha o número que vai enviar' });
      const r = await enviarMensagem(numeroId, leadId, conteudo, req.user.id);
      res.status(201).json({ ok: true, ...r });
    });
  },

  start() {
    if (!config.whatsapp.ativo) {
      console.log('[whatsapp] desligado (WHATSAPP_ATIVO=0)');
      return;
    }
    iniciarTodos().catch((err) => console.error('[whatsapp] erro ao iniciar:', err.message));
  },

  stop() {
    pararTodos();
  },
};
