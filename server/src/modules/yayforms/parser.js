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

  return entradas
    .map(([id, a]) => {
      const obj = a && typeof a === 'object' && !Array.isArray(a) ? a : { content: a };
      const def = titulos[id] || {};
      // O Yay! Forms (V2) manda o título da pergunta em "fieldTitle"
      const titulo =
        limparTitulo(paraTexto(obj.fieldTitle || obj.title || obj.question?.title || obj.field?.title || obj.label || obj.question_title)) ||
        def.titulo ||
        id;
      const tipo = String(obj.type || obj.fieldType || obj.field?.type || obj.question?.type || def.tipo || '').toLowerCase();
      const valorBruto = obj.content ?? obj.value ?? obj.answer ?? obj.text;
      return { id: String(id), titulo, tipo, valor: paraTexto(valorBruto).trim(), valorBruto };
    })
    // Telas de boas-vindas e textos informativos não têm resposta
    .filter((r) => r.valor && !TEXTOS_SEM_RESPOSTA.has(r.valor));
}

// Conteúdo que o Yay! Forms coloca em telas que são só texto (não são respostas)
const TEXTOS_SEM_RESPOSTA = new Set(['This is a statement.']);

function limparTitulo(t) {
  return t.replace(/\s+/g, ' ').trim().slice(0, 300);
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

// ---- Horário em que a pessoa começou a preencher o formulário ----
// O Yay! Forms manda o horário de início dentro da resposta. Os nomes variam entre versões do webhook,
// então procuramos primeiro os nomes que significam "início" e só depois "criado em".
const CAMPOS_INICIO = [
  'startedAt', 'started_at', 'startDate', 'start_date', 'startTime', 'start_time', 'startAt', 'start_at',
  'landedAt', 'landed_at', 'openedAt', 'opened_at', 'initiatedAt', 'initiated_at', 'beganAt',
  'createdAt', 'created_at', 'created', 'dateCreated', 'date_created',
];
const CAMPOS_ENVIO = ['submittedAt', 'submitted_at', 'completedAt', 'completed_at', 'finishedAt', 'finished_at', 'submitDate'];

// Aceita ISO (com ou sem fuso), "AAAA-MM-DD HH:MM:SS" (tratado como UTC) e epoch em segundos ou milissegundos
export function lerDataYay(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  let d = null;
  if (typeof valor === 'number' || /^\d{9,13}$/.test(String(valor).trim())) {
    const n = Number(valor);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else if (typeof valor === 'string') {
    let t = valor.trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t = t.replace(' ', 'T') + 'Z';
    d = new Date(t);
  } else if (typeof valor === 'object' && valor.$date) {
    return lerDataYay(valor.$date);
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  // Descarta datas absurdas (antes de 2020 ou mais de 5 minutos no futuro)
  if (d.getTime() < Date.UTC(2020, 0, 1) || d.getTime() > Date.now() + 5 * 60000) return null;
  return d;
}

function primeiraData(blocos, campos) {
  for (const campo of campos) {
    for (const bloco of blocos) {
      if (bloco && typeof bloco === 'object' && bloco[campo] !== undefined) {
        const d = lerDataYay(bloco[campo]);
        if (d) return { data: d, campo };
      }
    }
  }
  return null;
}

// Devolve { iniciadoEm: ISO | null, campo: nome do campo usado | null }
export function extrairInicio(body) {
  const r = body.response || body.data?.response || body.submission || body.data || {};
  const blocos = [r, r.metadata, r.meta, body.metadata, body.meta, body];
  const envio = primeiraData(blocos, CAMPOS_ENVIO);
  const inicio = primeiraData(blocos, CAMPOS_INICIO);
  if (!inicio) return { iniciadoEm: null, campo: null };
  // O início nunca pode ser depois do envio
  if (envio && inicio.data.getTime() > envio.data.getTime() + 1000) return { iniciadoEm: null, campo: null };
  return { iniciadoEm: inicio.data.toISOString(), campo: inicio.campo };
}

// ---- Resposta completa ou parcial ----
// Com "Enviar respostas incompletas" ligado no formulário, o Yay! Forms manda a resposta parcial depois do tempo de
// inatividade e, se a pessoa voltar e terminar, a completa com o MESMO ID de resposta. Procuramos primeiro um indicador
// explícito; sem ele, "submittedAt" vazio = parcial. Sem nenhum sinal, conta como completa (comportamento de antes).
const CAMPOS_COMPLETO = ['completed', 'isCompleted', 'is_completed', 'complete', 'isComplete', 'finished', 'isFinished', 'submitted', 'isSubmitted'];
const CAMPOS_PARCIAL = ['partial', 'isPartial', 'is_partial', 'incomplete', 'isIncomplete', 'draft', 'isDraft'];
const RE_PARCIAL = /partial|parcial|incomplet|draft|abandon/i;
const RE_COMPLETO = /\b(complete|completed|completa|submitted|finished)\b/i;

// Devolve { completo: boolean, sinal: nome do campo que decidiu | null }
export function extrairSituacao(body) {
  const r = body.response || body.data?.response || body.submission || {};
  const blocos = [r, body];
  for (const b of blocos) for (const c of CAMPOS_COMPLETO) if (typeof b?.[c] === 'boolean') return { completo: b[c], sinal: c };
  for (const b of blocos) for (const c of CAMPOS_PARCIAL) if (typeof b?.[c] === 'boolean') return { completo: !b[c], sinal: c };
  for (const b of blocos) {
    for (const c of ['status', 'state', 'event', 'trigger']) {
      const v = b?.[c];
      if (typeof v !== 'string') continue;
      if (RE_PARCIAL.test(v)) return { completo: false, sinal: `${c}=${v}` };
      if (RE_COMPLETO.test(v)) return { completo: true, sinal: `${c}=${v}` };
    }
  }
  for (const c of CAMPOS_ENVIO) {
    if (r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, c)) return { completo: Boolean(lerDataYay(r[c])), sinal: c };
  }
  return { completo: true, sinal: null };
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

  const r = body.response || {};
  const inicio = extrairInicio(body);
  const situacao = extrairSituacao(body);
  // O webhook V2 não traz o nome do formulário, só o formId; o nome vem do cadastro em "Equipe e integrações"
  const formId = String(r.formId || body.formId || body.form?.id || '') || null;
  const formulario =
    paraTexto(body.form?.title || body.form?.name || body.form_name || body.formTitle || body.data?.form?.title) ||
    (formId && opcoes.nomesFormularios?.[formId]) ||
    null;

  // Variáveis do formulário (ex.: pontuação de qualificação) — só valores simples
  const variaveis = Object.fromEntries(
    Object.entries(r.variables || {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').map(([k, v]) => [k, String(v)])
  );

  return {
    name,
    phone,
    email,
    formulario,
    formId,
    respostaId: r.id ? String(r.id) : null,
    analiseIa: texto(r.aiFeedback, 6000),
    variaveis,
    respostas: respostas.map(({ id, titulo, valor }) => ({ id, pergunta: titulo, resposta: valor })),
    utm: extrairUtm(body),
    iniciadoEm: inicio.iniciadoEm,
    campoInicio: inicio.campo,
    completo: situacao.completo,
    sinalSituacao: situacao.sinal,
  };
}
