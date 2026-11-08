// Configuração do Instagram (integration_state 'instagram'), editada em Equipe e integrações → Instagram (conexão)
// e na aba Instagram → Ajustes (Alice, comentários, relatórios). O segredo do app fica só no servidor.
import crypto from 'node:crypto';
import { lerEstado, salvarEstado } from '../../estado.js';
import { ErroHttp } from '../../util.js';
import { MODELOS, lerConfig as lerConfigIa } from '../ia/config.js';

const ESTADO = 'instagram';
export const VERSAO_API_PADRAO = process.env.META_API_VERSAO || 'v25.0';
export const GRAPH_URL = (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, '');

export const PROMPT_SDR_PADRAO = [
  'Entrevista curta (uma pergunta por vez, no ritmo da conversa; pule o que a pessoa já respondeu):',
  '1. Qual é o negócio ou nicho dela (ex.: rifas, sorteios, ações premiadas, e-commerce, outro).',
  '2. Há quanto tempo atua e se já anuncia no Meta Ads (Facebook e Instagram).',
  '3. O que está buscando agora (começar, escalar, resolver bloqueio de conta, melhorar resultados…).',
  '4. Quando pretende começar.',
  'Depois disso (ou antes, se a pessoa já demonstrar interesse claro em contratar), peça o WhatsApp com DDD para um especialista continuar o atendimento por lá.',
  'Se a pessoa não quiser passar o WhatsApp, respeite: diga que a equipe continua por aqui mesmo e passe para o humano.',
].join('\n');

export const PROMPT_ANALISTA_PADRAO = [
  'Você é o analista de Instagram da Impera Services (agência de tráfego pago no Meta Ads para nichos como rifas, sorteios e ações premiadas).',
  'Para a Impera, bom resultado no Instagram é: crescer seguidores, aumentar visualizações e engajamento (curtidas, comentários, salvamentos, compartilhamentos) e, principalmente, gerar conversas no Direct e leads (Direct e formulário do Yay! Forms).',
  'Analise os números do período comparando com o período anterior. Diga o que cresceu, o que caiu e o motivo provável, apontando as publicações que puxaram (ou derrubaram) o resultado.',
  'Mostre qual formato (Reels, carrossel, foto, Stories) e quais horários funcionaram melhor, o que repetir, o que cortar e o que testar na próxima semana.',
  'Quando houver anúncios, separe o orgânico do pago e diga quanto custou cada conversa e cada lead.',
  'Seja direto e use números. Termine com uma lista curta de ações para a próxima semana.',
].join('\n');

export const PADRAO = {
  // Conexão com a Meta (app criado em developers.facebook.com)
  app_id: '',
  // Login do Facebook para Empresas: ID da configuração (vazio = login comum com a lista de permissões)
  config_id: '',
  versao_api: VERSAO_API_PADRAO,
  // Direct
  direct_ativo: true,
  // Busca conversas novas pela API quando os webhooks não chegam (segundos)
  intervalo_direct_seg: 60,
  // Comentários (vem desligado de fábrica)
  comentarios_ativo: false,
  comentarios_intervalo_min: 10,
  comentarios_dias: 14,
  // Alice (SDR) no Direct — a mesma Alice da tela IA; aqui só o que é do Instagram
  prompt_sdr: PROMPT_SDR_PADRAO,
  // Quantas mensagens a Alice manda numa conversa antes de passar para a equipe (a entrevista precisa de mais que no WhatsApp)
  alice_max_mensagens: 14,
  // Quando a Alice pega o WhatsApp: a IA de primeiro contato do WhatsApp também manda a primeira mensagem por lá
  alice_continuar_whatsapp: false,
  // Relatórios da IA
  relatorio_semanal: true,
  // 0 = domingo … 6 = sábado
  relatorio_dia: 1,
  relatorio_hora: '08:00',
  relatorio_modelo: 'claude-sonnet-5-5',
  prompt_analista: PROMPT_ANALISTA_PADRAO,
  // Teto de gasto por dia com relatórios (US$)
  teto_relatorios_dia: 3,
  // Coleta das métricas
  coleta_hora: '04:30',
  anuncios_ativo: true,
  // Quantos dias para trás buscar os números dos anúncios na primeira vez
  anuncios_dias: 365,
  // Publicações com até N dias guardam a evolução dia a dia
  posts_diario_dias: 90,
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const textoLimpo = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const inteiro = (v, min, max, padrao) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};
const numero = (v, min, max, padrao) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

export function lerConfig() {
  const salvo = lerEstado(ESTADO);
  const cfg = { ...PADRAO, ...salvo };
  // Token de verificação do webhook: criado uma vez e guardado
  if (!cfg.verify_token) {
    cfg.verify_token = crypto.randomBytes(18).toString('base64url');
    salvarEstado(ESTADO, { verify_token: cfg.verify_token });
  }
  return cfg;
}

export const segredoApp = () => lerEstado(ESTADO).app_secret || process.env.META_APP_SECRET || '';
export const idApp = () => lerConfig().app_id || process.env.META_APP_ID || '';
export const versaoApi = () => lerConfig().versao_api || VERSAO_API_PADRAO;

/** Fuso usado nos dias das métricas e nos horários dos relatórios (o mesmo da IA) */
export function fuso() {
  try { return lerConfigIa().fuso || 'America/Sao_Paulo'; } catch { return 'America/Sao_Paulo'; }
}

/** O que a tela recebe (nunca o segredo do app) */
export function configPublica() {
  const { app_secret, ...resto } = lerConfig();
  const segredo = segredoApp();
  return {
    ...resto,
    app_id: idApp(),
    segredo_configurado: Boolean(segredo),
    segredo_final: segredo ? `••••${segredo.slice(-4)}` : null,
    modelos: MODELOS,
    fuso: fuso(),
  };
}

function validarModelo(id, padrao) {
  const m = String(id || '').trim();
  if (!m) return padrao;
  if (!MODELOS.some((x) => x.id === m)) throw new ErroHttp(400, `Modelo desconhecido: ${m}`);
  return m;
}

/** Ajustes do app da Meta (só administrador) */
export function salvarApp({ app_id, app_secret, config_id, versao_api } = {}) {
  const novo = {};
  if (app_id !== undefined) {
    const id = String(app_id).trim();
    if (id && !/^\d{5,25}$/.test(id)) throw new ErroHttp(400, 'O ID do app tem só números (App ID no painel da Meta)');
    novo.app_id = id;
  }
  if (app_secret !== undefined && String(app_secret).trim()) {
    const s = String(app_secret).trim();
    if (!/^[a-f0-9]{32}$/i.test(s)) throw new ErroHttp(400, 'A chave secreta do app tem 32 letras e números (Configurações do app → Básico → Chave secreta do app)');
    novo.app_secret = s;
  }
  if (config_id !== undefined) {
    const c = String(config_id).trim();
    if (c && !/^\d{5,25}$/.test(c)) throw new ErroHttp(400, 'O ID da configuração tem só números (Login do Facebook para Empresas → Configurações)');
    novo.config_id = c;
  }
  if (versao_api !== undefined && String(versao_api).trim()) {
    const v = String(versao_api).trim();
    if (!/^v\d{2}\.\d$/.test(v)) throw new ErroHttp(400, 'Versão da API no formato v25.0');
    novo.versao_api = v;
  }
  salvarEstado(ESTADO, novo);
  return configPublica();
}

/** Ajustes do dia a dia (aba Instagram → Ajustes) */
export function salvarAjustes(entrada = {}) {
  const atual = lerConfig();
  const v = (k) => (entrada[k] === undefined ? atual[k] : entrada[k]);
  const hora = (k) => {
    const h = String(v(k) || '').trim();
    if (!HORA.test(h)) throw new ErroHttp(400, 'Horário no formato HH:MM');
    return h;
  };
  const novo = {
    direct_ativo: Boolean(v('direct_ativo')),
    intervalo_direct_seg: inteiro(v('intervalo_direct_seg'), 30, 900, 60),
    comentarios_ativo: Boolean(v('comentarios_ativo')),
    comentarios_intervalo_min: inteiro(v('comentarios_intervalo_min'), 5, 240, 10),
    comentarios_dias: inteiro(v('comentarios_dias'), 1, 90, 14),
    prompt_sdr: textoLimpo(v('prompt_sdr'), 6000) || PROMPT_SDR_PADRAO,
    alice_max_mensagens: inteiro(v('alice_max_mensagens'), 2, 40, 14),
    alice_continuar_whatsapp: Boolean(v('alice_continuar_whatsapp')),
    relatorio_semanal: Boolean(v('relatorio_semanal')),
    relatorio_dia: inteiro(v('relatorio_dia'), 0, 6, 1),
    relatorio_hora: hora('relatorio_hora'),
    relatorio_modelo: validarModelo(v('relatorio_modelo'), PADRAO.relatorio_modelo),
    prompt_analista: textoLimpo(v('prompt_analista'), 8000) || PROMPT_ANALISTA_PADRAO,
    teto_relatorios_dia: numero(v('teto_relatorios_dia'), 0.05, 200, 3),
    coleta_hora: hora('coleta_hora'),
    anuncios_ativo: Boolean(v('anuncios_ativo')),
    anuncios_dias: inteiro(v('anuncios_dias'), 7, 1095, 365),
    posts_diario_dias: inteiro(v('posts_diario_dias'), 7, 730, 90),
  };
  salvarEstado(ESTADO, novo);
  return configPublica();
}

export function removerSegredo() {
  salvarEstado(ESTADO, { app_secret: null });
}
