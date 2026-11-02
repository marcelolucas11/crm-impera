// Módulo Organizador do kanban por IA: lê as conversas dos leads e avança cada um pelas etapas sozinho.
// Telas: "IA → Organizador do kanban". Tirar este módulo da lista não quebra nada (o kanban continua manual).
import { Router } from 'express';
import { get, all } from '../../db.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido, ErroHttp } from '../../util.js';
import { ErroIA } from '../ia/cliente.js';
import { meiaNoiteNoFuso } from '../ia/protecao.js';
import { lerConfig, salvarConfig, custoDaChamada, fusoDoDia, MODELOS } from './config.js';
import { etapasAbertas, PAPEIS, desfazerMovimento } from './etapas.js';
import {
  varrer, gastoHoje, maxMsgId, iniciarOrganizacao, aplicarOrganizacao, cancelarOrganizacao, estadoTarefa, leadsDoPeriodo,
  iniciarRelogio, pararRelogio,
} from './motor.js';
import { emitir } from '../../tempoReal.js';

const rota = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err instanceof ErroHttp || err instanceof ErroIA ? err.status || 400 : 500;
    if (status === 500) console.error('[organizador]', err);
    res.status(status).json({ erro: status === 500 ? (err.message || 'Erro interno') : err.message });
  }
};

function movimentos(limite = 40) {
  return all(
    `SELECT m.id, m.lead_id, l.name AS lead_nome, m.de_nome, m.para_nome, m.origem, m.modo, m.motivo, m.trecho,
            m.desfeito_em, u.name AS desfeito_por_nome, m.created_at
       FROM organizador_movimentos m LEFT JOIN leads l ON l.id = m.lead_id LEFT JOIN users u ON u.id = m.desfeito_por
      ORDER BY m.id DESC LIMIT ?`, [limite]
  );
}

function estado() {
  const cfg = lerConfig();
  const etapas = etapasAbertas();
  const gasto = gastoHoje();
  const pendentes = get("SELECT count(*) AS n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.ia_pendente_desde IS NOT NULL AND s.kind = 'open'").n;
  const hoje = new Date(meiaNoiteNoFuso(Date.now(), fusoDoDia())).toISOString();
  const movidosHoje = get('SELECT count(*) AS n FROM organizador_movimentos WHERE created_at >= ? AND desfeito_em IS NULL', [hoje]).n;
  const { inicio_msg_id, cursor_msg_id, ...publica } = cfg;
  return {
    config: publica,
    modelos: MODELOS,
    etapas: etapas.map((s) => ({ id: s.id, nome: s.name, papel: s.role, cor: s.color })),
    // Papéis que o organizador precisa e se cada um tem etapa definida (em "Editar etapas")
    papeis: PAPEIS.filter((p) => p !== 'entrada').map((p) => ({ papel: p, etapa: etapas.find((s) => s.role === p)?.name || null })),
    status: {
      gasto_hoje: gasto,
      limite_atingido: gasto >= cfg.limite_diario_usd,
      volta_em: gasto >= cfg.limite_diario_usd ? new Date(meiaNoiteNoFuso(Date.now(), fusoDoDia(), 1)).toISOString() : null,
      pendentes,
      movidos_hoje: movidosHoje,
      ultima_varredura: cfg.ultima_varredura,
    },
    tarefa: estadoTarefa(),
    movimentos: movimentos(),
  };
}

// Custo médio por lead (do histórico; sem histórico, uma conversa média de ~5 mil tokens)
function estimar(dias) {
  const cfg = lerConfig();
  const leads = leadsDoPeriodo(dias);
  const comConversa = leads.filter((l) => get("SELECT 1 AS ok FROM wa_messages WHERE lead_id = ? AND type <> 'chamada' LIMIT 1", [l.id])).length;
  const media = get(
    `SELECT avg(tokens_entrada + tokens_cache_leitura + tokens_cache_escrita) AS e, avg(tokens_saida) AS s FROM
       (SELECT * FROM organizador_uso ORDER BY id DESC LIMIT 200)`
  );
  const porLead = custoDaChamada(cfg.modelo, { input_tokens: Math.round(media?.e || 5000), output_tokens: Math.round(media?.s || 350) });
  return { total: leads.length, com_conversa: comConversa, custo_por_lead: porLead, custo_estimado: porLead * comConversa, modelo: cfg.modelo };
}

export default {
  name: 'organizador',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/', rota((req, res) => res.json(estado())));

    r.put('/config', exigirAdmin, rota((req, res) => {
      salvarConfig(req.body || {}, { maxMsgId: maxMsgId() });
      emitir('organizador', { config: true });
      res.json(estado());
    }));

    r.post('/varrer', exigirAdmin, rota(async (req, res) => {
      if (!lerConfig().ativo) throw new ErroHttp(400, 'Ligue o organizador para varrer as conversas');
      const resultado = await varrer();
      res.json({ resultado, ...estado() });
    }));

    r.get('/estimativa', rota((req, res) => {
      const dias = Math.min(365, Math.max(1, Math.round(Number(req.query.dias) || lerConfig().organizar_dias)));
      res.json(estimar(dias));
    }));

    r.post('/organizar', exigirAdmin, rota((req, res) => {
      const dias = Math.min(365, Math.max(1, Math.round(Number(req.body?.dias) || lerConfig().organizar_dias)));
      const limiteUsd = Math.min(500, Math.max(0.05, Number(req.body?.limite_usd) || 5));
      try {
        res.json({ tarefa: iniciarOrganizacao({ dias, limiteUsd, userId: req.user.id }) });
      } catch (err) { throw new ErroHttp(409, err.message); }
    }));

    r.get('/organizar', rota((req, res) => res.json({ tarefa: estadoTarefa() })));

    r.post('/organizar/aplicar', exigirAdmin, rota((req, res) => {
      const ids = Array.isArray(req.body?.lead_ids) ? req.body.lead_ids.map(Number).filter(Number.isInteger) : null;
      try {
        res.json({ tarefa: aplicarOrganizacao(ids) });
      } catch (err) { throw new ErroHttp(409, err.message); }
    }));

    r.delete('/organizar', exigirAdmin, rota((req, res) => res.json({ tarefa: cancelarOrganizacao() })));

    r.get('/movimentos', rota((req, res) => res.json({ movimentos: movimentos(Math.min(200, Number(req.query.limite) || 40)) })));

    r.post('/movimentos/:id/desfazer', rota((req, res) => {
      const id = idValido(req.params.id);
      if (!id) throw new ErroHttp(400, 'Movimentação inválida');
      const r2 = desfazerMovimento(id, req.user.id);
      if (r2.erro) throw new ErroHttp(409, r2.erro);
      emitir('organizador', { varredura: true });
      res.json({ ok: true, movimentos: movimentos() });
    }));

    app.use('/api/organizador', r);
  },
  start() {
    iniciarRelogio();
    const cfg = lerConfig();
    console.log(`[organizador] ${cfg.ativo ? `ligado (a cada ${cfg.intervalo_min} min, limite US$ ${cfg.limite_diario_usd}/dia)` : 'desligado'}`);
  },
  stop() {
    pararRelogio();
  },
};
