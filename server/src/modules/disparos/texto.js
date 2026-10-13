// Texto das mensagens dos disparos: variáveis ({{primeiro_nome}}, {{saudacao}}...), Spintax ({Oi|Olá})
// e a chave única de telefone usada para não repetir o mesmo número (com e sem o 9º dígito).
import { normalizarTelefone } from '../../util.js';

// Fuso dos leads (saudação e janela de horário). Padrão: horário de Brasília; mude com DISPAROS_FUSO no .env
export const FUSO = process.env.DISPAROS_FUSO || 'America/Sao_Paulo';

// Telefone canônico: só dígitos, com DDI e, no Brasil, sempre com o 9º dígito (celular).
// "(11) 9 8765-4321", "11987654321", "551187654321" e "5511987654321" viram o mesmo número.
export function chaveTelefone(valor) {
  const n = normalizarTelefone(valor);
  if (!n) return null;
  const m = n.match(/^55(\d{2})(\d{8})$/);
  if (m && /^[6-9]/.test(m[2])) return `55${m[1]}9${m[2]}`;
  return n;
}

export function formatarTelefone(digitos) {
  if (!digitos) return '';
  const d = String(digitos);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    return `(${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
  }
  return `+${d}`;
}

// Hora local (no fuso dos disparos) de uma data
export function horaLocal(data = new Date(), fuso = FUSO) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(data);
  const valor = (t) => partes.find((p) => p.type === t)?.value;
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hora: Number(valor('hour')), minuto: Number(valor('minute')), diaSemana: dias[valor('weekday')] };
}

export function saudacao(data = new Date(), fuso = FUSO) {
  const { hora } = horaLocal(data, fuso);
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

// "marcelo SILVA" → "Marcelo"
export function primeiroNome(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!p) return '';
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}

// "Qual o seu orçamento mensal?" → "qual_o_seu_orcamento_mensal"
export function slug(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

// Variáveis que existem para todo contato (as do formulário entram por lead)
export const VARIAVEIS_PADRAO = ['nome', 'primeiro_nome', 'telefone', 'email', 'etapa_kanban', 'saudacao'];

/**
 * Monta as variáveis de um contato.
 *  contato: { nome, phone, email, etapa, extra (do lead: respostas, utm, variaveis, formulario) }
 */
export function variaveisDoContato(contato = {}, data = new Date()) {
  const v = {};
  const extra = contato.extra || {};
  // Respostas do formulário: pelo título da pergunta ("qual_seu_orcamento") e pelo id ("campo_<id>")
  for (const r of Array.isArray(extra.respostas) ? extra.respostas : []) {
    if (!r || r.resposta == null) continue;
    const chave = slug(r.pergunta);
    if (chave && !(chave in v)) v[chave] = String(r.resposta);
    if (r.id) v[`campo_${slug(r.id)}`] = String(r.resposta);
  }
  for (const [k, val] of Object.entries(extra.utm || {})) v[slug(k)] = String(val);
  for (const [k, val] of Object.entries(extra.variaveis || {})) v[slug(k)] = String(val);
  if (extra.formulario) v.formulario = String(extra.formulario);
  // As padrão por último: nunca são trocadas por uma pergunta com o mesmo nome
  Object.assign(v, {
    nome: contato.nome || '',
    primeiro_nome: primeiroNome(contato.nome),
    telefone: formatarTelefone(contato.phone),
    email: contato.email || '',
    etapa_kanban: contato.etapa || '',
    saudacao: saudacao(data),
  });
  return v;
}

// Escolhe uma opção de cada {a|b|c}, de dentro para fora (aceita Spintax aninhado).
// Chaves sem "|" ({texto}) ficam como estão.
export function aplicarSpintax(texto, sorteio = Math.random) {
  let atual = String(texto ?? '');
  const re = /\{([^{}]*\|[^{}]*)\}/;
  for (let i = 0; i < 500 && re.test(atual); i++) {
    atual = atual.replace(re, (_, dentro) => {
      const opcoes = dentro.split('|');
      return opcoes[Math.floor(sorteio() * opcoes.length)] ?? '';
    });
  }
  return atual;
}

// {{variavel}} ou {{variavel|padrão}} (o padrão entra quando a variável está vazia)
export function aplicarVariaveis(texto, variaveis = {}) {
  return String(texto ?? '').replace(/\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g, (_, nome, padrao) => {
    const valor = variaveis[nome] ?? variaveis[slug(nome)];
    return valor !== undefined && valor !== null && String(valor).trim() !== '' ? String(valor) : (padrao ?? '').trim();
  });
}

// Texto final de um bloco: variáveis primeiro (o valor delas nunca vira Spintax), depois Spintax
export function renderizar(texto, variaveis, sorteio) {
  const marcados = [];
  const comMarcas = String(texto ?? '').replace(/\{\{\s*[\w.-]+\s*(?:\|[^}]*)?\}\}/g, (m) => {
    marcados.push(aplicarVariaveis(m, variaveis));
    return `\u0000${marcados.length - 1}\u0000`;
  });
  return aplicarSpintax(comMarcas, sorteio)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => marcados[Number(i)] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
