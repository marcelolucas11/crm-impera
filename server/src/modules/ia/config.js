// Configuração da IA de primeiro contato. Fica no banco (integration_state 'ia') e é editada na tela "IA".
// A chave da API da Anthropic pode ser colada na tela (guardada só no servidor) ou vir do .env (ANTHROPIC_API_KEY).
// Nenhuma resposta da API devolve a chave: só os 4 últimos caracteres.
import { lerEstado, salvarEstado } from '../../estado.js';
import { ErroHttp } from '../../util.js';

const ESTADO = 'ia';

// Modelos que podem ser escolhidos na tela "IA" (do mais barato ao mais potente). Preço em US$ por milhão de tokens (entrada / saída).
export const MODELOS = [
  { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5', nivel: 'Mais barato e rápido', preco: 'a partir de US$ 0,10 / 0,50' },
  { id: 'claude-sonnet-5-5', nome: 'Claude Sonnet 5.5', nivel: 'Equilibrado', preco: 'US$ 2 / 10' },
  { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5', nivel: 'Potente', preco: 'US$ 4 / 20' },
  { id: 'claude-fable-5-1', nome: 'Claude Fable 5.1', nivel: 'O mais potente (e caro)', preco: 'US$ 10 / 50' },
];
// Modelo que responde os leads quando nada foi escolhido na tela (o mais barato). Pode ser trocado no .env por IA_MODELO.
export const MODELO_PADRAO = process.env.IA_MODELO || 'claude-haiku-5-5';
// Modelo da análise das conversas que monta o playbook (roda poucas vezes, então vale um mais potente)
export const MODELO_PLAYBOOK_PADRAO = process.env.IA_MODELO_PLAYBOOK || 'claude-opus-5-5';
if (!MODELOS.some((m) => m.id === MODELO_PADRAO)) MODELOS.push({ id: MODELO_PADRAO, nome: MODELO_PADRAO, nivel: 'Definido no .env', preco: '' });
if (!MODELOS.some((m) => m.id === MODELO_PLAYBOOK_PADRAO)) MODELOS.push({ id: MODELO_PLAYBOOK_PADRAO, nome: MODELO_PLAYBOOK_PADRAO, nivel: 'Definido no .env', preco: '' });
export const nomeDoModelo = (id) => MODELOS.find((m) => m.id === id)?.nome || id;
export const LIMITE_PLAYBOOK = 20000;
const MAX_VERSOES_PLAYBOOK = 10;
export const API_URL = (process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/+$/, '');

export const PADRAO = {
  ativo: false,
  // sugestao = copiloto (a IA escreve, alguém aprova) | automatico = a IA envia sozinha
  modo: 'sugestao',
  // No modo copiloto, fora do horário comercial a IA responde sozinha (ninguém está lá para aprovar)
  automatico_fora_horario: true,
  // Números de WhatsApp em que a IA atua (vazio = todos)
  numero_ids: [],
  // Nome e gênero da atendente virtual (é assim que a IA se chama e fala com o lead)
  nome_atendente: 'Alice',
  genero_atendente: 'feminino',
  empresa: 'Impera Services',
  apresentacao: 'Aqui é a Alice, da Impera Services.',
  sobre_empresa:
    'A Impera Services é uma agência de marketing digital focada em nichos sensíveis: negócios que precisam de cuidado ' +
    'extra com as regras das plataformas de anúncio. Trabalhamos com gestão de tráfego pago no Meta Ads (Facebook e Instagram), ' +
    'geração de leads e estratégia de campanhas. Cada projeto é avaliado individualmente por um especialista.',
  // Como o Marcelo atende (gerado a partir das conversas antigas na tela "IA" e editável)
  playbook: '',
  // Modelo que conversa com os leads e modelo que analisa as conversas para montar o playbook
  modelo_atendimento: MODELO_PADRAO,
  modelo_playbook: MODELO_PLAYBOOK_PADRAO,
  // Até quando as conversas já foram lidas para o playbook (a melhoria lê só o que veio depois)
  playbook_lido_ate: null,
  playbook_atualizado_em: null,
  // Melhoria automática: a cada N dias lê as conversas novas e complementa o playbook sozinha
  playbook_auto: false,
  playbook_auto_dias: 7,
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
  // Quando a resposta tem mais de um bloco, espera este tempo (com "digitando…") entre um e outro
  intervalo_blocos_seg: 2,
  // Contingência do número (ver protecao.js)
  // Atende um lead por vez: só começa a próxima conversa quando termina de responder a atual
  um_por_vez: true,
  // Depois de responder um lead, espera um tempo aleatório entre estes valores antes de ir para OUTRO lead (segundos)
  intervalo_leads_min_seg: 30,
  intervalo_leads_max_seg: 90,
  // Pausas de descanso: a cada N mensagens enviadas, para por um tempo aleatório entre X e Y minutos
  descanso_ativo: true,
  descanso_a_cada: 15,
  descanso_min_min: 5,
  descanso_max_min: 15,
  // No máximo N mensagens da IA em 24 horas e N leads novos abordados (primeira mensagem) em 24 horas
  limite_por_dia: 150,
  limite_novos_por_dia: 40,
  // O contador de leads novos zera todo dia à meia-noite (no fuso acima) em vez de ser uma janela móvel de 24 h
  zerar_novos_meia_noite: true,
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
  const { api_key_painel, workspace_id_painel, playbook_historico, ...resto } = lerConfig();
  const chave = chaveApi();
  return {
    ...resto,
    modelo: resto.modelo_atendimento,
    modelo_nome: nomeDoModelo(resto.modelo_atendimento),
    modelos: MODELOS,
    // Versões anteriores do playbook: só a lista (o texto vem pela rota /ia/playbook/versoes/:indice)
    playbook_versoes: (playbook_historico || []).map((v, i) => ({ indice: i, em: v.em, origem: v.origem, tamanho: v.texto.length })),
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

// "de X a Y": se vier invertido, troca
const faixa = (a, b, campoMin, campoMax) => ({ [campoMin]: Math.min(a, b), [campoMax]: Math.max(a, b) });

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

function validarModelo(id, padrao) {
  const m = String(id || '').trim();
  if (!m) return padrao;
  if (!MODELOS.some((x) => x.id === m)) throw new ErroHttp(400, `Modelo desconhecido: ${m}`);
  return m;
}

function dataValida(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Texto de uma versão anterior do playbook (0 = a mais recente)
export function versaoDoPlaybook(indice) {
  const v = (lerConfig().playbook_historico || [])[indice];
  if (!v) throw new ErroHttp(404, 'Versão não encontrada');
  return v;
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
    genero_atendente: v('genero_atendente') === 'masculino' ? 'masculino' : 'feminino',
    empresa: textoLimpo(v('empresa'), 80) || PADRAO.empresa,
    apresentacao: textoLimpo(v('apresentacao'), 300) || PADRAO.apresentacao,
    sobre_empresa: textoLimpo(v('sobre_empresa'), 2000) || PADRAO.sobre_empresa,
    playbook: textoLimpo(v('playbook'), LIMITE_PLAYBOOK),
    modelo_atendimento: validarModelo(v('modelo_atendimento'), MODELO_PADRAO),
    modelo_playbook: validarModelo(v('modelo_playbook'), MODELO_PLAYBOOK_PADRAO),
    playbook_auto: Boolean(v('playbook_auto')),
    playbook_auto_dias: inteiro(v('playbook_auto_dias'), 1, 60, 7),
    playbook_lido_ate: dataValida(v('playbook_lido_ate')),
    link_agenda: validarLink(v('link_agenda')),
    fuso: validarFuso(textoLimpo(v('fuso'), 60) || PADRAO.fuso),
    horario: validarHorario(entrada.horario, atual.horario),
    aviso_fora_horario: textoLimpo(v('aviso_fora_horario'), 500) || PADRAO.aviso_fora_horario,
    janela_lead_novo_horas: inteiro(v('janela_lead_novo_horas'), 1, 24 * 30, 72),
    max_mensagens_ia: inteiro(v('max_mensagens_ia'), 1, 20, 6),
    iniciar_formulario: Boolean(v('iniciar_formulario')),
    limite_por_hora: inteiro(v('limite_por_hora'), 1, 200, 30),
    espera_agrupar_seg: inteiro(v('espera_agrupar_seg'), 3, 120, 15),
    intervalo_blocos_seg: inteiro(v('intervalo_blocos_seg'), 0, 15, 2),
    um_por_vez: Boolean(v('um_por_vez')),
    ...faixa(inteiro(v('intervalo_leads_min_seg'), 0, 1800, 30), inteiro(v('intervalo_leads_max_seg'), 0, 1800, 90), 'intervalo_leads_min_seg', 'intervalo_leads_max_seg'),
    descanso_ativo: Boolean(v('descanso_ativo')),
    descanso_a_cada: inteiro(v('descanso_a_cada'), 2, 500, 15),
    ...faixa(inteiro(v('descanso_min_min'), 1, 240, 5), inteiro(v('descanso_max_min'), 1, 240, 15), 'descanso_min_min', 'descanso_max_min'),
    limite_por_dia: inteiro(v('limite_por_dia'), 1, 3000, 150),
    limite_novos_por_dia: inteiro(v('limite_novos_por_dia'), 1, 1000, 40),
    zerar_novos_meia_noite: Boolean(v('zerar_novos_meia_noite')),
  };
  // Mais por hora do que por dia não faz sentido: o limite de 24 h manda
  if (novo.limite_por_hora > novo.limite_por_dia) novo.limite_por_hora = novo.limite_por_dia;
  if (novo.ativo && !chaveApi()) throw new ErroHttp(400, 'Cole a chave da API da Anthropic antes de ligar a IA');
  // Playbook mudou: guarda a versão anterior (dá para voltar na tela) e marca quando foi atualizado
  if (novo.playbook !== (atual.playbook || '')) {
    novo.playbook_atualizado_em = new Date().toISOString();
    if (atual.playbook?.trim()) {
      novo.playbook_historico = [{ texto: atual.playbook, em: atual.playbook_atualizado_em || null, origem: atual.playbook_origem || 'manual' }, ...(atual.playbook_historico || [])].slice(0, MAX_VERSOES_PLAYBOOK);
    }
    novo.playbook_origem = ['analise', 'melhoria', 'automatica'].includes(entrada.playbook_origem) ? entrada.playbook_origem : 'manual';
  }
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

// Textos que mudam com o gênero da atendente virtual
export function falas(cfg) {
  const fem = cfg.genero_atendente !== 'masculino';
  return {
    fem,
    artigo: fem ? 'a' : 'o',
    obrigado: fem ? 'obrigada' : 'obrigado',
    assistente: fem ? 'a assistente virtual' : 'o assistente virtual',
  };
}

// Respostas prontas (sem chamar o modelo). A IA fala por si e passa o lead para a equipe.
export function respostasProntas(cfg) {
  return {
    soDuvidas: `Por aqui eu consigo te ajudar só com dúvidas básicas sobre a ${cfg.empresa} ou chamar alguém da equipe. Quer que eu chame?`,
    insistiu: `Por aqui eu só consigo ajudar com dúvidas básicas sobre a ${cfg.empresa}. Vou deixar a equipe a par da conversa, tudo bem?`,
    pediuPessoa: 'Claro! Já avisei a equipe, alguém vai continuar seu atendimento por aqui. 😊',
    limite: 'Vou passar você para a equipe, que consegue te explicar tudo com mais detalhes. Alguém continua por aqui. 😊',
    naoSabe: 'Essa a equipe vai saber te responder melhor. Já deixei avisado, alguém continua por aqui. 😊',
  };
}
