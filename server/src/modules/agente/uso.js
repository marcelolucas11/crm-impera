// Gasto da Alice com a API da Anthropic, por usuário e por tipo de uso. Os tetos do chat e dos agendados são
// separados e zeram à meia-noite do fuso do usuário.
import { get, run } from '../../db.js';
import { custoDaChamada } from '../organizador/config.js';
import { meiaNoiteNoFuso } from '../ia/protecao.js';
import { lerConfig } from './config.js';

// Usos que contam em cada teto (a leitura do CRM e o "Melhorar prompt" contam no chat; o canal do WhatsApp também)
export const MODOS_DO_TETO = {
  chat: ['chat', 'whatsapp', 'contexto', 'prompt'],
  agendados: ['agendado'],
};

export function registrarUso(userId, modo, modelo, uso) {
  if (!uso) return 0;
  const custo = custoDaChamada(modelo, uso);
  run(
    `INSERT INTO agente_uso (user_id, modo, modelo, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, modo, modelo, uso.input_tokens || 0, uso.output_tokens || 0, uso.cache_read_input_tokens || 0, uso.cache_creation_input_tokens || 0, custo]
  );
  return custo;
}

export function inicioDoDia(userId, agoraMs = Date.now()) {
  return new Date(meiaNoiteNoFuso(agoraMs, lerConfig(userId).fuso)).toISOString();
}

export function gastoHoje(userId, teto = 'chat', agoraMs = Date.now()) {
  const modos = MODOS_DO_TETO[teto] || [teto];
  return get(
    `SELECT COALESCE(sum(custo_usd), 0) AS v FROM agente_uso WHERE user_id = ? AND created_at >= ? AND modo IN (${modos.map(() => '?').join(', ')})`,
    [userId, inicioDoDia(userId, agoraMs), ...modos]
  ).v;
}

/** { gasto, teto, atingido, volta_em } do teto pedido */
export function statusTeto(userId, teto = 'chat', agoraMs = Date.now()) {
  const cfg = lerConfig(userId);
  const limite = teto === 'agendados' ? cfg.teto_agendados_dia : cfg.teto_chat_dia;
  const gasto = gastoHoje(userId, teto, agoraMs);
  const atingido = gasto >= limite;
  return {
    gasto, teto: limite, atingido,
    volta_em: atingido ? new Date(meiaNoiteNoFuso(agoraMs, cfg.fuso, 1)).toISOString() : null,
  };
}

export function resumoUso(userId) {
  const desde30 = new Date(Date.now() - 30 * 86400000).toISOString();
  return {
    chat: statusTeto(userId, 'chat'),
    agendados: statusTeto(userId, 'agendados'),
    ultimos_30_dias: get('SELECT COALESCE(sum(custo_usd), 0) AS v FROM agente_uso WHERE user_id = ? AND created_at >= ?', [userId, desde30]).v,
  };
}
