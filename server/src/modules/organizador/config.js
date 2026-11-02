// Configuração do Organizador do kanban por IA. Fica no banco (integration_state 'organizador') e é editada
// na tela "IA → Organizador do kanban". Usa a mesma chave da API da Anthropic da IA de primeiro contato.
import { lerEstado, salvarEstado } from '../../estado.js';
import { get } from '../../db.js';
import { ErroHttp } from '../../util.js';
import { MODELOS, chaveApi, lerConfig as lerConfigIa } from '../ia/config.js';

const ESTADO = 'organizador';

// Preço em US$ por milhão de tokens. O Haiku 5.5 cobra mais caro quando o pedido passa de 100 mil tokens.
// Modelo desconhecido usa o preço do Opus (melhor sobrar margem no limite diário do que estourar).
const PRECOS = {
  'claude-haiku-5-5': { entrada: 0.10, saida: 0.50, escrita: 0.125, leitura: 0.01, acima: { limite: 100000, entrada: 0.50, saida: 2.50, escrita: 0.625, leitura: 0.05 } },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, escrita: 2.5, leitura: 0.10 },
  'claude-opus-5-5': { entrada: 4, saida: 20, escrita: 5, leitura: 0.20 },
  'claude-fable-5-1': { entrada: 10, saida: 50, escrita: 12.5, leitura: 0.25 },
};

/** Custo em US$ de uma chamada, a partir do "usage" devolvido pela API */
export function custoDaChamada(modelo, uso) {
  if (!uso) return 0;
  let p = PRECOS[modelo] || PRECOS['claude-opus-5-5'];
  const entrada = uso.input_tokens || 0;
  const escrita = uso.cache_creation_input_tokens || 0;
  const leitura = uso.cache_read_input_tokens || 0;
  if (p.acima && entrada + escrita + leitura > p.acima.limite) p = p.acima;
  return (entrada * p.entrada + escrita * p.escrita + leitura * p.leitura + (uso.output_tokens || 0) * p.saida) / 1e6;
}

export const PROMPT_QUALIFICADO_PADRAO = [
  'Um lead é QUALIFICADO quando a conversa mostra que ele tem um negócio real no nicho (rifas, sorteios ou ações premiadas) e demonstrou interesse concreto em contratar a gestão de tráfego da Impera.',
  'Conta como qualificado quando pelo menos um destes aparece:',
  '- aceitou (ou não fez objeção) ao investimento mínimo em anúncios no Meta Ads e ao valor da mão de obra;',
  '- disse que quer começar logo ou perguntou como funciona para contratar, prazos ou próximos passos;',
  '- já tem experiência no nicho e está buscando escalar.',
  'NÃO é qualificado quem só pediu informação genérica, disse que não tem verba, que vai pensar sem data, ou não respondeu às perguntas.',
].join('\n');

export const PADRAO = {
  ativo: false,
  modelo: 'claude-haiku-5-5',
  // De quanto em quanto tempo a varredura olha as conversas novas (minutos)
  intervalo_min: 5,
  // Gasto máximo por dia (US$) nas varreduras automáticas. Zera à meia-noite no fuso da IA.
  limite_diario_usd: 2,
  // No máximo N leads lidos pela IA por varredura (o resto fica para a próxima)
  max_leads_rodada: 25,
  // Período padrão do "Organizar tudo"
  organizar_dias: 30,
  // Critérios: o que a IA procura na conversa e para qual etapa o lead vai quando o critério é atendido.
  // O "qualificado" é fixo (vai para a etapa com o papel "qualificado"); os outros têm etapa escolhida na tela.
  criterios: [
    { id: 'qualificado', titulo: 'Lead qualificado', prompt: PROMPT_QUALIFICADO_PADRAO, papel: 'qualificado', etapa_id: null, ativo: true, fixo: true },
  ],
  // Controle interno da varredura
  inicio_msg_id: 0,
  cursor_msg_id: 0,
  ultima_varredura: null,
};

export function lerConfig() {
  const salvo = lerEstado(ESTADO);
  const cfg = { ...PADRAO, ...salvo };
  if (!Array.isArray(cfg.criterios) || !cfg.criterios.some((c) => c.id === 'qualificado')) {
    cfg.criterios = [PADRAO.criterios[0], ...(Array.isArray(cfg.criterios) ? cfg.criterios : [])];
  }
  return cfg;
}

export function salvarInterno(dados) {
  return salvarEstado(ESTADO, dados);
}

const textoLimpo = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const numero = (v, min, max, padrao) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

function validarCriterios(lista, atuais) {
  if (!Array.isArray(lista)) return atuais;
  const saida = [];
  const ids = new Set();
  for (const c of lista.slice(0, 20)) {
    const fixo = c?.id === 'qualificado';
    let id = fixo ? 'qualificado' : textoLimpo(c?.id, 40).replace(/[^a-z0-9_-]/gi, '');
    if (!id || ids.has(id)) id = `c${Date.now().toString(36)}${saida.length}`;
    ids.add(id);
    const prompt = textoLimpo(c?.prompt, 4000);
    if (fixo) {
      saida.push({ id, titulo: 'Lead qualificado', prompt: prompt || PROMPT_QUALIFICADO_PADRAO, papel: 'qualificado', etapa_id: null, ativo: c?.ativo !== false, fixo: true });
      continue;
    }
    const etapaId = Number(c?.etapa_id);
    const etapa = Number.isInteger(etapaId) ? get('SELECT id, kind, name FROM stages WHERE id = ?', [etapaId]) : null;
    if (!etapa) throw new ErroHttp(400, `Escolha para qual etapa vai o lead do critério "${textoLimpo(c?.titulo, 60) || 'sem nome'}"`);
    if (etapa.kind !== 'open') throw new ErroHttp(400, `A etapa "${etapa.name}" é final (ganho/perdido): só você move leads para lá`);
    if (!prompt) throw new ErroHttp(400, `Escreva o que a IA deve procurar no critério "${textoLimpo(c?.titulo, 60) || 'sem nome'}"`);
    saida.push({ id, titulo: textoLimpo(c?.titulo, 60) || 'Critério', prompt, papel: null, etapa_id: etapa.id, ativo: c?.ativo !== false, fixo: false });
  }
  if (!saida.some((c) => c.id === 'qualificado')) saida.unshift(atuais.find((c) => c.id === 'qualificado') || PADRAO.criterios[0]);
  return saida;
}

export function salvarConfig(entrada = {}, { maxMsgId = 0 } = {}) {
  const atual = lerConfig();
  const v = (campo) => (entrada[campo] === undefined ? atual[campo] : entrada[campo]);
  const modelo = String(v('modelo') || PADRAO.modelo);
  if (!MODELOS.some((m) => m.id === modelo)) throw new ErroHttp(400, `Modelo desconhecido: ${modelo}`);
  const novo = {
    ativo: Boolean(v('ativo')),
    modelo,
    intervalo_min: Math.round(numero(v('intervalo_min'), 1, 120, 5)),
    limite_diario_usd: Math.round(numero(v('limite_diario_usd'), 0.05, 500, 2) * 100) / 100,
    max_leads_rodada: Math.round(numero(v('max_leads_rodada'), 1, 200, 25)),
    organizar_dias: Math.round(numero(v('organizar_dias'), 1, 365, 30)),
    criterios: validarCriterios(entrada.criterios, atual.criterios),
  };
  if (novo.ativo && !chaveApi()) throw new ErroHttp(400, 'Cole a chave da API da Anthropic (IA → Chave da API) antes de ligar o organizador');
  // Ao ligar, a varredura passa a olhar só as conversas a partir de agora (as antigas são do "Organizar tudo")
  if (novo.ativo && !atual.ativo) {
    novo.inicio_msg_id = maxMsgId;
    novo.cursor_msg_id = maxMsgId;
  }
  salvarEstado(ESTADO, novo);
  return lerConfig();
}

export function fusoDoDia() {
  return lerConfigIa().fuso || 'America/Sao_Paulo';
}

export { MODELOS };
