// Configuração da IA de primeiro contato. Fica no banco (integration_state 'ia') e é editada na tela "IA".
// A chave da API da Anthropic pode ser colada na tela (guardada só no servidor) ou vir do .env (ANTHROPIC_API_KEY).
// Nenhuma resposta da API devolve a chave: só os 4 últimos caracteres.
import { lerEstado, salvarEstado } from '../../estado.js';
import { ErroHttp } from '../../util.js';

const ESTADO = 'ia';

// Modelo mais barato da Anthropic (Haiku). Pode ser trocado no .env por IA_MODELO.
export const MODELO_PADRAO = process.env.IA_MODELO || 'claude-haiku-5-5';
export const API_URL = (process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/+$/, '');

export const PADRAO = {
  ativo: false,
  // sugestao = copiloto (a IA escreve, alguém aprova) | automatico = a IA envia sozinha
  modo: 'sugestao',
  // No modo copiloto, fora do horário comercial a IA responde sozinha (ninguém está lá para aprovar)
  automatico_fora_horario: true,
  // Números de WhatsApp em que a IA atua (vazio = todos)
  numero_ids: [],
  nome_atendente: 'Marcelo',
  empresa: 'Impera Services',
  apresentacao: 'Aqui é o Marcelo, da Impera Services.',
  sobre_empresa:
    'A Impera Services é uma agência de marketing digital focada em nichos sensíveis: negócios que precisam de cuidado ' +
    'extra com as regras das plataformas de anúncio. Trabalhamos com gestão de tráfego pago no Meta Ads (Facebook e Instagram), ' +
    'geração de leads e estratégia de campanhas. Cada projeto é avaliado individualmente por um especialista.',
  // Como o Marcelo atende (gerado a partir das conversas antigas na tela "IA" e editável)
  playbook: '',
  // Link de agendamento (Calendly) que a IA pode mandar quando o lead quiser conversar. Vazio = não manda link.
  link_agenda: '',
  fuso: process.env.IA_FUSO || process.env.DISPAROS_FUSO || 'America/Sao_Paulo',
  // Horário com atendimento humano de prontidão. dia da semana: 0 = domingo ... 6 = sábado. null = sem atendimento
  horario: {
    1: { inicio: '07:00', fim: '18:00' },
    2: { inicio: '07:00', fim: '18:00' },
    3: { inicio: '07:00', fim: '18:00' },
    4: { inicio: '07:00', fim: '18:00' },
    5: { inicio: '07:00', fim: '18:00' },
    6: { inicio: '07:00', fim: '16:00' },
    0: null,
  },
  aviso_fora_horario:
    'No momento a Impera não está com atendimento humano de prontidão, então seu atendimento pode levar algumas horas. ' +
    'Já deixei tudo anotado e assim que alguém da equipe estiver disponível, retorna para você.',
  // Só é "lead novo" quem não tem nenhuma mensagem mais antiga que isto na conversa
  janela_lead_novo_horas: 72,
  // Depois de quantas mensagens da IA ela passa a conversa para um humano de qualquer jeito
  max_mensagens_ia: 6,
  // Lead novo do Yay! Forms: a IA manda a primeira mensagem (se a saudação automática dos Disparos estiver desligada)
  iniciar_formulario: true,
  // Proteção do número: no máximo N mensagens da IA por hora (somando todas as conversas)
  limite_por_hora: 30,
  // Espera o lead terminar de mandar mensagens antes de responder (segundos)
  espera_agrupar_seg: 15,
  api_key_painel: null,
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function chaveApi() {
  return lerEstado(ESTADO).api_key_painel || process.env.ANTHROPIC_API_KEY || '';
}

// Workspace do Console: chaves que não pertencem a um workspace precisam dizer qual usar (cabeçalho anthropic-workspace-id)
export function workspaceApi() {
  return lerEstado(ESTADO).workspace_id_painel || process.env.ANTHROPIC_WORKSPACE_ID || '';
}

export function lerConfig() {
  const salvo = lerEstado(ESTADO);
  return { ...PADRAO, ...salvo, horario: { ...PADRAO.horario, ...(salvo.horario || {}) } };
}

// O que a tela recebe (nunca a chave)
export function configPublica() {
  const { api_key_painel, workspace_id_painel, ...resto } = lerConfig();
  const chave = chaveApi();
  return {
    ...resto,
    modelo: MODELO_PADRAO,
    chave_configurada: Boolean(chave),
    chave_origem: api_key_painel ? 'painel' : chave ? 'env' : null,
    chave_final: chave ? `••••${chave.slice(-4)}` : null,
    workspace_id: workspaceApi(),
  };
}

const textoLimpo = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const inteiro = (v, min, max, padrao) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

function validarHorario(entrada, atual) {
  const h = {};
  for (const dia of [0, 1, 2, 3, 4, 5, 6]) {
    const v = entrada?.[dia] === undefined ? atual[dia] : entrada[dia];
    if (!v) { h[dia] = null; continue; }
    if (!HORA.test(v.inicio || '') || !HORA.test(v.fim || '') || v.inicio >= v.fim) {
      throw new ErroHttp(400, 'Horário inválido: use HH:MM e o fim depois do início');
    }
    h[dia] = { inicio: v.inicio, fim: v.fim };
  }
  return h;
}

function validarFuso(fuso) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return fuso;
  } catch {
    throw new ErroHttp(400, 'Fuso horário inválido');
  }
}

function validarLink(link) {
  const l = textoLimpo(link, 300);
  if (!l) return '';
  try {
    const u = new URL(l);
    if (u.protocol !== 'https:') throw new Error();
    return u.toString();
  } catch {
    throw new ErroHttp(400, 'O link de agendamento precisa começar com https://');
  }
}

export function salvarConfig(entrada = {}) {
  const atual = lerConfig();
  const v = (campo) => (entrada[campo] === undefined ? atual[campo] : entrada[campo]);
  const novo = {
    ativo: Boolean(v('ativo')),
    modo: v('modo') === 'automatico' ? 'automatico' : 'sugestao',
    automatico_fora_horario: Boolean(v('automatico_fora_horario')),
    numero_ids: (Array.isArray(v('numero_ids')) ? v('numero_ids') : []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    nome_atendente: textoLimpo(v('nome_atendente'), 60) || PADRAO.nome_atendente,
    empresa: textoLimpo(v('empresa'), 80) || PADRAO.empresa,
    apresentacao: textoLimpo(v('apresentacao'), 300) || PADRAO.apresentacao,
    sobre_empresa: textoLimpo(v('sobre_empresa'), 2000) || PADRAO.sobre_empresa,
    playbook: textoLimpo(v('playbook'), 8000),
    link_agenda: validarLink(v('link_agenda')),
    fuso: validarFuso(textoLimpo(v('fuso'), 60) || PADRAO.fuso),
    horario: validarHorario(entrada.horario, atual.horario),
    aviso_fora_horario: textoLimpo(v('aviso_fora_horario'), 500) || PADRAO.aviso_fora_horario,
    janela_lead_novo_horas: inteiro(v('janela_lead_novo_horas'), 1, 24 * 30, 72),
    max_mensagens_ia: inteiro(v('max_mensagens_ia'), 1, 20, 6),
    iniciar_formulario: Boolean(v('iniciar_formulario')),
    limite_por_hora: inteiro(v('limite_por_hora'), 1, 200, 30),
    espera_agrupar_seg: inteiro(v('espera_agrupar_seg'), 3, 120, 15),
  };
  if (novo.ativo && !chaveApi()) throw new ErroHttp(400, 'Cole a chave da API da Anthropic antes de ligar a IA');
  salvarEstado(ESTADO, novo);
  return configPublica();
}

const FORMATO_CHAVE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

export function guardarChave(bruta) {
  const chave = String(bruta ?? '').replace(/\s+/g, '').replace(/^bearer/i, '');
  if (!FORMATO_CHAVE.test(chave)) throw new ErroHttp(400, 'Essa não parece uma chave da API da Anthropic (começa com sk-ant-).');
  salvarEstado(ESTADO, { api_key_painel: chave });
}

const FORMATO_WORKSPACE = /^[A-Za-z0-9_-]{3,120}$/;

// Vazio remove o workspace
export function guardarWorkspace(bruto) {
  const w = String(bruto ?? '').trim();
  if (w && !FORMATO_WORKSPACE.test(w)) throw new ErroHttp(400, 'ID do workspace inválido: copie do Console (Settings → Workspaces), algo como wrkspc_…');
  salvarEstado(ESTADO, { workspace_id_painel: w || null });
}

export function removerChave() {
  salvarEstado(ESTADO, { api_key_painel: null, ativo: false });
}
