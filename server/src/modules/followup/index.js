// Módulo de follow-up: quantos e quais leads estão sem contato há mais tempo que o limite
import { Router } from 'express';
import { config } from '../../config.js';
import { get, all } from '../../db.js';
import { exigirLogin } from '../auth/middleware.js';
import { responderJson } from '../../cache.js';

// Atrasado = etapa em andamento e sem contato há mais de FOLLOWUP_HORAS (a mesma regra dos cartões do kanban)
const ATRASADO = `s.kind = 'open' AND (julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?`;

// Contadores do topo (abas Kanban e WhatsApp). A tela pede a cada poucos segundos em todas as abas abertas:
// antes isto montava a ficha completa de todos os leads só para contar; agora são consultas diretas e o resultado é
// reaproveitado até mudar algo no banco.
function calcularResumo() {
  const horas = config.followupHours;
  const atrasados = get(`SELECT count(*) AS n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE ${ATRASADO}`, [horas]).n;
  const lista = all(
    `SELECT l.id, l.name, l.phone, s.name AS stage_name, u.name AS owner_name, COALESCE(l.last_contact_at, l.created_at) AS last_activity_at
       FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id
      WHERE ${ATRASADO}
      ORDER BY last_activity_at ASC LIMIT 50`,
    [horas]
  );
  const aguardando = get("SELECT count(*) n FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.kind = 'open' AND l.waiting_since IS NOT NULL").n;
  const conversasNaoLidas = get(
    // Como no WhatsApp: conversas silenciadas ou arquivadas não contam no contador
    `SELECT count(DISTINCT COALESCE('l' || lead_id, chat_jid)) n FROM wa_messages
      WHERE from_me = 0 AND read_at IS NULL AND hidden_at IS NULL
        AND chat_jid NOT IN (SELECT jid FROM wa_chats WHERE archived = 1 OR muted_until > ?)`,
    [new Date().toISOString()]
  ).n;
  return { horas, atrasados, lista, aguardando, conversas_nao_lidas: conversasNaoLidas };
}

export default {
  name: 'followup',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/resumo', (req, res) => {
      responderJson(req, res, { chave: 'followup|resumo', tabelas: ['leads', 'stages', 'users', 'wa_messages', 'wa_chats'], ttlMs: 20000 }, calcularResumo);
    });

    app.use('/api/followup', r);
  },
};
