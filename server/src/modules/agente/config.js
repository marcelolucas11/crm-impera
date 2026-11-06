// Configuração da Alice de cada usuário (tabela agente_usuarios). Cada pessoa cadastrada no CRM tem a sua Alice,
// com nome, modelos, tetos de custo, fuso e canal do WhatsApp próprios. A chave da Anthropic é a mesma da tela "IA".
import { get, run, all, agora } from '../../db.js';
import { lerJson } from '../../events.js';
import { ErroHttp } from '../../util.js';
import { MODELOS, chaveApi } from '../ia/config.js';

export const LIMITE_CONTEXTO = 40000;
const MAX_VERSOES_CONTEXTO = 15;
const FUSO_PADRAO = process.env.IA_FUSO || process.env.DISPAROS_FUSO || 'America/Sao_Paulo';

export const PADRAO = {
  nome: 'Alice',
  // Modelo do chat (pode ser trocado em cada mensagem), dos agendados e da leitura do CRM
  modelo_chat: 'claude-sonnet-5-5',
  modelo_agendados: 'claude-haiku-5-5',
  modelo_contexto: 'claude-opus-5-5',
  // Tetos de gasto por dia, separados (US$). Ao bater, aquele uso para até a meia-noite do fuso do usuário
  teto_chat_dia: 2,
  teto_agendados_dia: 2,
  fuso: FUSO_PADRAO,
  // Melhoria automática do contexto do CRM a cada N dias (lê só o que é novo)
  contexto_auto: false,
  contexto_auto_dias: 7,
  // Canal do WhatsApp: conversar com a Alice pelo WhatsApp
  whatsapp_ativo: false,
  // Seus números pessoais (só mensagens destes números chegam na Alice)
  whatsapp_telefones: [],
  // Também atende no "mensagem para mim" (conversa com o próprio número conectado)
  whatsapp_proprio: true,
  // Número do CRM que responde (vazio = o mesmo em que a mensagem chegou)
  whatsapp_numero_id: null,
};

const modeloValido = (id, padrao) => (MODELOS.some((m) => m.id === id) ? id : padrao);
const numeroEntre = (v, min, max, padrao) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
function fusoValido(f) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: String(f) });
    return String(f);
  } catch { return null; }
}
const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');

function garantirLinha(userId) {
  run('INSERT INTO agente_usuarios (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', [userId]);
  return get('SELECT * FROM agente_usuarios WHERE user_id = ?', [userId]);
}

export function lerConfig(userId) {
  const linha = garantirLinha(userId);
  const salvo = lerJson(linha.config) || {};
  const cfg = { ...PADRAO, ...salvo };
  cfg.nome = String(cfg.nome || 'Alice').slice(0, 40);
  cfg.whatsapp_telefones = Array.isArray(cfg.whatsapp_telefones) ? cfg.whatsapp_telefones : [];
  return cfg;
}

/** Contexto do CRM (o prompt gerado) e seus metadados */
export function lerCerebro(userId) {
  const l = garantirLinha(userId);
  return {
    contexto: l.contexto || '',
    contexto_origem: l.contexto_origem,
    contexto_atualizado_em: l.contexto_atualizado_em,
    contexto_lido_ate: l.contexto_lido_ate,
  };
}

export function salvarConfig(userId, entrada = {}) {
  const atual = lerConfig(userId);
  const novo = { ...atual };
  const e = entrada || {};
  if (e.nome !== undefined) {
    const nome = String(e.nome).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!nome) throw new ErroHttp(400, 'Dê um nome para a sua assistente');
    novo.nome = nome;
  }
  if (e.modelo_chat !== undefined) novo.modelo_chat = modeloValido(e.modelo_chat, atual.modelo_chat);
  if (e.modelo_agendados !== undefined) novo.modelo_agendados = modeloValido(e.modelo_agendados, atual.modelo_agendados);
  if (e.modelo_contexto !== undefined) novo.modelo_contexto = modeloValido(e.modelo_contexto, atual.modelo_contexto);
  if (e.teto_chat_dia !== undefined) novo.teto_chat_dia = numeroEntre(e.teto_chat_dia, 0.05, 500, atual.teto_chat_dia);
  if (e.teto_agendados_dia !== undefined) novo.teto_agendados_dia = numeroEntre(e.teto_agendados_dia, 0.05, 500, atual.teto_agendados_dia);
  if (e.fuso !== undefined) {
    const f = fusoValido(e.fuso);
    if (!f) throw new ErroHttp(400, 'Fuso horário inválido');
    novo.fuso = f;
  }
  if (e.contexto_auto !== undefined) novo.contexto_auto = Boolean(e.contexto_auto);
  if (e.contexto_auto_dias !== undefined) novo.contexto_auto_dias = Math.round(numeroEntre(e.contexto_auto_dias, 1, 60, atual.contexto_auto_dias));
  if (e.whatsapp_ativo !== undefined) novo.whatsapp_ativo = Boolean(e.whatsapp_ativo);
  if (e.whatsapp_proprio !== undefined) novo.whatsapp_proprio = Boolean(e.whatsapp_proprio);
  if (e.whatsapp_numero_id !== undefined) novo.whatsapp_numero_id = Number(e.whatsapp_numero_id) > 0 ? Number(e.whatsapp_numero_id) : null;
  if (e.whatsapp_telefones !== undefined) {
    const lista = (Array.isArray(e.whatsapp_telefones) ? e.whatsapp_telefones : String(e.whatsapp_telefones).split(/[,;\n]/))
      .map(soDigitos).filter((t) => t.length >= 8 && t.length <= 15);
    novo.whatsapp_telefones = [...new Set(lista)].slice(0, 5);
    // O mesmo telefone não pode ser de duas Alices (a mensagem precisa saber de quem é)
    for (const outro of all('SELECT user_id, config FROM agente_usuarios WHERE user_id <> ?', [userId])) {
      const tels = lerJson(outro.config)?.whatsapp_telefones || [];
      const repetido = novo.whatsapp_telefones.find((t) => tels.includes(t));
      if (repetido) throw new ErroHttp(409, `O número ${repetido} já está ligado à assistente de outro usuário`);
    }
  }
  run('UPDATE agente_usuarios SET config = ?, updated_at = ? WHERE user_id = ?', [JSON.stringify(novo), agora(), userId]);
  return novo;
}

/** Salva o contexto do CRM, guardando a versão anterior */
export function salvarContexto(userId, texto, { origem = 'manual', lidoAte = undefined } = {}) {
  const atual = lerCerebro(userId);
  const limpo = String(texto ?? '').replace(/\r\n?/g, '\n').slice(0, LIMITE_CONTEXTO);
  if (atual.contexto && atual.contexto !== limpo) {
    run('INSERT INTO agente_contexto_versoes (user_id, texto, origem) VALUES (?, ?, ?)', [userId, atual.contexto, atual.contexto_origem || 'manual']);
    run(
      `DELETE FROM agente_contexto_versoes WHERE user_id = ? AND id NOT IN
         (SELECT id FROM agente_contexto_versoes WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
      [userId, userId, MAX_VERSOES_CONTEXTO]
    );
  }
  run(
    `UPDATE agente_usuarios SET contexto = ?, contexto_origem = ?, contexto_atualizado_em = ?,
            contexto_lido_ate = COALESCE(?, contexto_lido_ate), updated_at = ? WHERE user_id = ?`,
    [limpo, origem, agora(), lidoAte ?? null, agora(), userId]
  );
  return lerCerebro(userId);
}

export function versoesDoContexto(userId) {
  return all('SELECT id, origem, length(texto) AS tamanho, created_at FROM agente_contexto_versoes WHERE user_id = ? ORDER BY id DESC', [userId]);
}

export function versaoDoContexto(userId, id) {
  const v = get('SELECT id, texto, origem, created_at FROM agente_contexto_versoes WHERE user_id = ? AND id = ?', [userId, id]);
  if (!v) throw new ErroHttp(404, 'Versão não encontrada');
  return v;
}

/** O que a tela recebe (sem nada sigiloso) */
export function configPublica(userId) {
  return { ...lerConfig(userId), chave_configurada: Boolean(chaveApi()) };
}

/** Usuário dono de um telefone (canal do WhatsApp). Devolve { userId, cfg } ou null. */
export function donoDoTelefone(telefone) {
  const t = soDigitos(telefone);
  if (!t) return null;
  const variantes = new Set([t]);
  const m = t.match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    if (m[2].length === 9) variantes.add(`55${m[1]}${m[2].slice(1)}`);
    else variantes.add(`55${m[1]}9${m[2]}`);
  }
  for (const linha of all("SELECT a.user_id, a.config FROM agente_usuarios a JOIN users u ON u.id = a.user_id WHERE u.active = 1 AND a.config LIKE '%whatsapp_telefones%'")) {
    const cfg = { ...PADRAO, ...(lerJson(linha.config) || {}) };
    if ((cfg.whatsapp_telefones || []).some((x) => variantes.has(soDigitos(x)))) return { userId: linha.user_id, cfg };
  }
  return null;
}

export function usuariosComAlice() {
  return all('SELECT a.user_id, u.name FROM agente_usuarios a JOIN users u ON u.id = a.user_id WHERE u.active = 1').map((l) => ({ ...l, cfg: lerConfig(l.user_id) }));
}
