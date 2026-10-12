// Lê o payload do webhook do Yay! Forms (formato V2, com suporte ao V1) e extrai
// nome, telefone, e-mail, as respostas legíveis e os parâmetros UTM.
import { normalizarTelefone, normalizarEmail, texto } from '../../util.js';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_TELEFONE = /^[+()\-.\s\d]{8,22}$/;

// Converte o conteúdo de uma resposta (texto, lista, objeto) em texto legível
function paraTexto(valor) {
  if (valor === null || valor === undefined) return '';
  if (Array.isArray(valor)) return valor.map(paraTexto).filter(Boolean).join(', ');
  if (typeof valor === 'object') {
    for (const k of ['text', 'value', 'label', 'answer', 'content', 'choice', 'number', 'phone', 'email', 'url']) {
      if (valor[k] !== undefined && valor[k] !== null && typeof valor[k] !== 'object') return String(valor[k]);
    }
    if (valor.labels) return paraTexto(valor.labels);
    if (valor.choices) return paraTexto(valor.choices);
    return JSON.stringify(valor);
  }
  return String(valor);
}

// Procura definições de perguntas (id + título) dentro do bloco do formulário
function mapaDeTitulos(body) {
  const mapa = {};
  const visitar = (no, profundidade) => {
    if (!no || typeof no !== 'object' || profundidade > 4) return;
    if (Array.isArray(no)) {
      no.forEach((item) => {
        if (item && typeof item === 'object' && (item.id || item._id) && (item.title || item.label || item.question)) {
          mapa[item.id || item._id] = { titulo: paraTexto(item.title || item.label || item.question), tipo: item.type || '' };
        }
        visitar(item, profundidade + 1);
      });
      return;
    }
    Object.values(no).forEach((v) => visitar(v, profundidade + 1));
  };
  visitar(body.form || body.data?.form || {}, 0);
  return mapa;
}

function listaDeRespostas(body) {
  const bruto =
    body.response?.answers ?? body.answers ?? body.data?.answers ?? body.data?.response?.answers ?? body.submission?.answers;
  if (!bruto) return [];
  const titulos = mapaDeTitulos(body);
  const entradas = Array.isArray(bruto)
    ? bruto.map((a) => [a?.id || a?.field_id || a?.question_id || '', a])
    : Object.entries(bruto);

  return entradas.map(([id, a]) => {
    const obj = a && typeof a === 'object' && !Array.isArray(a) ? a : { content: a };
    const def = titulos[id] || {};
    const titulo =
      paraTexto(obj.title || obj.question?.title || obj.field?.title || obj.label || obj.question_title) || def.titulo || id;
    const tipo = String(obj.type || obj.field?.type || obj.question?.type || def.tipo || '').toLowerCase();
    const valorBruto = obj.content ?? obj.value ?? obj.answer ?? obj.text;
    return { id: String(id), titulo, tipo, valor: paraTexto(valorBruto), valorBruto };
  });
}

// Parâmetros UTM e campos ocultos (busca rasa no payload)
function extrairUtm(body) {
  const utm = {};
  const visitar = (no, profundidade) => {
    if (!no || typeof no !== 'object' || profundidade > 3) return;
    for (const [k, v] of Object.entries(no)) {
      if (/^utm_/i.test(k) && v !== null && typeof v !== 'object') utm[k.toLowerCase()] = String(v);
      else if (typeof v === 'object') visitar(v, profundidade + 1);
    }
  };
  visitar(body, 0);
  return utm;
}

export function interpretarPayload(body, opcoes = {}) {
  const respostas = listaDeRespostas(body);
  const porId = (id) => (id ? respostas.find((r) => r.id === id) : null);

  let email = normalizarEmail(porId(opcoes.campoEmail)?.valor);
  let phone = normalizarTelefone(porId(opcoes.campoTelefone)?.valor);
  let name = texto(porId(opcoes.campoNome)?.valor, 200);

  if (!email) {
    const r =
      respostas.find((x) => x.tipo.includes('email')) ||
      respostas.find((x) => /e-?mail/i.test(x.titulo) && RE_EMAIL.test(x.valor.trim())) ||
      respostas.find((x) => RE_EMAIL.test(x.valor.trim()));
    email = normalizarEmail(r?.valor);
  }
  if (!phone) {
    const r =
      respostas.find((x) => x.tipo.includes('phone') || x.tipo.includes('tel')) ||
      respostas.find((x) => /telefone|whats|celular|fone|phone|contato/i.test(x.titulo) && /\d{8,}/.test(x.valor.replace(/\D/g, ''))) ||
      respostas.find((x) => RE_TELEFONE.test(x.valor.trim()) && x.valor.replace(/\D/g, '').length >= 10);
    phone = normalizarTelefone(r?.valor);
  }
  if (!name) {
    const r =
      respostas.find((x) => /\bnome\b|\bname\b/i.test(x.titulo) && !RE_EMAIL.test(x.valor) && x.valor.length <= 120) ||
      respostas.find((x) => (x.tipo.includes('short') || x.tipo === 'text') && !RE_EMAIL.test(x.valor) && !RE_TELEFONE.test(x.valor));
    name = texto(r?.valor, 200);
  }

  const formulario =
    paraTexto(body.form?.title || body.form?.name || body.form_name || body.formTitle || body.data?.form?.title) || null;

  return {
    name,
    phone,
    email,
    formulario,
    respostas: respostas.map(({ id, titulo, valor }) => ({ id, pergunta: titulo, resposta: valor })),
    utm: extrairUtm(body),
  };
}
