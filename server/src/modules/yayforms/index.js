// Módulo Yay! Forms: recebe o webhook de cada resposta e cria (ou atualiza) o lead.
// URL para colar no Yay! Forms: <PUBLIC_URL>/webhooks/yayforms/<YAYFORMS_WEBHOOK_TOKEN>  (formato V2)
import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento, lerJson } from '../../events.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { criarLead, encontrarExistente } from '../leads/service.js';
import { interpretarPayload, extrairInicio } from './parser.js';
import { idValido } from '../../util.js';
import { lerEstado, salvarEstado } from '../../estado.js';

function iguaisSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Confere a assinatura HMAC SHA256 (só se YAYFORMS_WEBHOOK_SECRET estiver definido).
// Aceita qualquer cabeçalho com "signature" no nome, em hex ou base64, com ou sem prefixo "sha256=".
function assinaturaValida(req) {
  if (!config.yayforms.secret) return true;
  const digest = crypto.createHmac('sha256', config.yayforms.secret).update(req.rawBody || Buffer.alloc(0)).digest();
  const hex = digest.toString('hex');
  const base64 = digest.toString('base64');
  return Object.entries(req.headers)
    .filter(([nome]) => nome.toLowerCase().includes('signature'))
    .some(([, valor]) => {
      const v = String(valor).trim().replace(/^sha256=/i, '');
      return iguaisSeguro(v.toLowerCase(), hex) || iguaisSeguro(v, base64);
    });
}

function processar(body) {
  const dados = interpretarPayload(body, {
    campoNome: config.yayforms.fieldName,
    campoTelefone: config.yayforms.fieldPhone,
    campoEmail: config.yayforms.fieldEmail,
    nomesFormularios: lerEstado('yayforms').nomes || {},
  });
  const detalhes = {
    formulario: dados.formulario,
    form_id: dados.formId,
    resposta_id: dados.respostaId,
    respostas: dados.respostas,
    utm: dados.utm,
    variaveis: dados.variaveis,
    analise_ia: dados.analiseIa,
    iniciado_em: dados.iniciadoEm,
    campo_inicio: dados.campoInicio,
  };

  return tx(() => {
    const existente = encontrarExistente({ phone: dados.phone, email: dados.email });
    if (existente) {
      // Mesmo lead respondeu de novo: completa dados que faltavam e registra no histórico
      run(
        `UPDATE leads SET
           name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?),
           form_started_at = COALESCE(form_started_at, ?), updated_at = ?
         WHERE id = ?`,
        [dados.name, dados.phone, dados.email, dados.iniciadoEm, agora(), existente]
      );
      registrarEvento({ leadId: existente, type: 'form_resubmitted', data: detalhes });
      return { leadId: existente, novo: false };
    }

    const leadId = criarLead({ name: dados.name, phone: dados.phone, email: dados.email, source: 'yayforms', extra: detalhes });
    if (dados.iniciadoEm) run('UPDATE leads SET form_started_at = ? WHERE id = ?', [dados.iniciadoEm, leadId]);
    registrarEvento({ leadId, type: 'form_submitted', data: detalhes });
    return { leadId, novo: true };
  });
}

// Leads que vieram do Yay! Forms antes da versão com "form_started_at": lê o início do formulário
// nos webhooks guardados. Roda ao ligar o CRM e só mexe em leads que ainda estão sem o horário.
function preencherInicioDosAntigos() {
  try {
    const pendentes = all(
      `SELECT e.lead_id, e.payload FROM webhook_events e JOIN leads l ON l.id = e.lead_id
        WHERE e.source = 'yayforms' AND e.status = 'processed' AND l.form_started_at IS NULL
        ORDER BY e.id`
    );
    let preenchidos = 0;
    const feitos = new Set();
    for (const ev of pendentes) {
      if (feitos.has(ev.lead_id)) continue;
      const { iniciadoEm } = extrairInicio(lerJson(ev.payload) || {});
      if (!iniciadoEm) continue;
      run('UPDATE leads SET form_started_at = ? WHERE id = ? AND form_started_at IS NULL', [iniciadoEm, ev.lead_id]);
      feitos.add(ev.lead_id);
      preenchidos++;
    }
    if (preenchidos) console.log(`[yayforms] horário de início do formulário preenchido em ${preenchidos} lead(s) antigo(s)`);
  } catch (err) {
    console.error('[yayforms] não consegui preencher o início dos leads antigos:', err.message);
  }
}

export default {
  name: 'yayforms',
  register(app) {
    preencherInicioDosAntigos();
    const r = Router();

    r.post('/:token', (req, res) => {
      if (!config.yayforms.token || !iguaisSeguro(req.params.token, config.yayforms.token)) {
        return res.status(404).json({ erro: 'Não encontrado' });
      }
      if (!assinaturaValida(req)) {
        console.warn('[yayforms] assinatura inválida — cabeçalhos recebidos:', Object.keys(req.headers).join(', '));
        return res.status(401).json({ erro: 'Assinatura inválida' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};

      // 1) Guarda o payload bruto antes de qualquer coisa: nenhum lead se perde
      const eventoId = Number(run('INSERT INTO webhook_events (source, payload) VALUES (?, ?)', ['yayforms', JSON.stringify(body)]).lastInsertRowid);

      // A mesma resposta chegando de novo (reenvio ou botão "Test" repetido) não vira registro duplicado
      const respostaId = body.response?.id ? String(body.response.id) : null;
      const jaProcessada = respostaId && get(
        `SELECT lead_id FROM webhook_events
          WHERE source = 'yayforms' AND status = 'processed' AND id != ? AND json_extract(payload, '$.response.id') = ?
          LIMIT 1`,
        [eventoId, respostaId]
      );
      if (jaProcessada) {
        run("UPDATE webhook_events SET status = 'duplicado', lead_id = ? WHERE id = ?", [jaProcessada.lead_id, eventoId]);
        return res.json({ ok: true, lead_id: jaProcessada.lead_id, duplicado: true });
      }

      // 2) Processa
      try {
        const { leadId, novo } = processar(body);
        run("UPDATE webhook_events SET status = 'processed', lead_id = ? WHERE id = ?", [leadId, eventoId]);
        console.log(`[yayforms] ${novo ? 'novo lead' : 'lead existente atualizado'} #${leadId}`);
        res.json({ ok: true, lead_id: leadId, novo });
      } catch (err) {
        run("UPDATE webhook_events SET status = 'error', error = ? WHERE id = ?", [err.message, eventoId]);
        console.error('[yayforms] erro ao processar:', err.message);
        // Responde 200 mesmo assim: o payload está salvo e pode ser reprocessado
        res.json({ ok: false, guardado: true });
      }
    });

    app.use('/webhooks/yayforms', r);

    // Administração: ver os últimos webhooks recebidos e reprocessar os que deram erro
    const adm = Router();
    adm.use(exigirLogin, exigirAdmin);

    adm.get('/eventos', (req, res) => {
      const eventos = all(
        `SELECT id, status, error, lead_id, received_at FROM webhook_events
          WHERE source = 'yayforms' ORDER BY received_at DESC, id DESC LIMIT 50`
      );
      res.json({ eventos });
    });

    adm.post('/eventos/:id/reprocessar', (req, res) => {
      const id = idValido(req.params.id);
      const evento = id ? get("SELECT payload FROM webhook_events WHERE id = ? AND source = 'yayforms'", [id]) : null;
      if (!evento) return res.status(404).json({ erro: 'Evento não encontrado' });
      const { leadId, novo } = processar(lerJson(evento.payload));
      run("UPDATE webhook_events SET status = 'processed', error = NULL, lead_id = ? WHERE id = ?", [leadId, id]);
      res.json({ ok: true, lead_id: leadId, novo });
    });

    // Formulários que já mandaram respostas (o webhook só traz o ID; aqui dá para dar um nome)
    adm.get('/formularios', (req, res) => {
      const nomes = lerEstado('yayforms').nomes || {};
      const vistos = all(
        `SELECT json_extract(payload, '$.response.formId') AS form_id, count(*) AS respostas, max(received_at) AS ultima
           FROM webhook_events
          WHERE source = 'yayforms' AND json_extract(payload, '$.response.formId') IS NOT NULL
          GROUP BY form_id ORDER BY ultima DESC`
      );
      res.json({ formularios: vistos.map((f) => ({ ...f, nome: nomes[f.form_id] || null })) });
    });

    adm.put('/formularios/:formId', (req, res) => {
      const formId = String(req.params.formId || '').slice(0, 64);
      const nome = String(req.body?.nome || '').trim().slice(0, 120);
      if (!/^[\w-]+$/.test(formId)) return res.status(400).json({ erro: 'Formulário inválido' });
      const nomes = { ...(lerEstado('yayforms').nomes || {}) };
      if (nome) nomes[formId] = nome; else delete nomes[formId];
      tx(() => {
        salvarEstado('yayforms', { nomes });
        // Atualiza os leads que já vieram desse formulário
        run(
          `UPDATE leads SET extra = json_set(extra, '$.formulario', ?) WHERE json_extract(extra, '$.form_id') = ?`,
          [nome || null, formId]
        );
      });
      res.json({ ok: true });
    });

    adm.get('/config', (req, res) => {
      res.json({
        caminho: `${config.basePath}/webhooks/yayforms/${config.yayforms.token}`,
        url: config.publicOrigin
          ? `${config.publicOrigin}${config.basePath}/webhooks/yayforms/${config.yayforms.token}`
          : null,
        assinatura_ativa: Boolean(config.yayforms.secret),
      });
    });

    app.use('/api/yayforms', adm);
  },
};
