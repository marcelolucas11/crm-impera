// Catálogo de nomes do Yay! Forms. O webhook (V2) manda só códigos: o ID do formulário e, às vezes, só o ID da pergunta.
// Aqui o CRM guarda formId → nome do formulário e fieldId → texto da pergunta, para nunca mostrar código na tela.
//
// De onde vêm os nomes (o primeiro que existir vale):
//   1) nome dado à mão em Equipe e integrações (estado 'yayforms'.nomes);
//   2) API do Yay! Forms, com o token da conta (GET /forms/{id} e GET /forms/{id}/fields);
//   3) títulos que vieram dentro dos próprios webhooks guardados ("fieldTitle").
//
// Ao ligar o CRM (inclusive logo depois de uma atualização), aplicarNomes() passa por TODOS os leads e pelo histórico
// já gravados e troca os códigos pelos nomes. Não depende de chegar resposta nova.
import { all, run, tx, agora, iterar } from '../../db.js';
import { config } from '../../config.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { lerJson } from '../../events.js';
import { ErroHttp } from '../../util.js';

const ESTADO = 'yayforms_catalogo';
const RE_ID = /^[0-9a-f]{24}$/i;
const FORMATO_TOKEN = /^[A-Za-z0-9._~+/=|:-]{16,4000}$/;
const TIPOS_FORM = ['form_submitted', 'form_resubmitted', 'form_partial', 'form_completed', 'form_updated', 'created'];
// Formulário já buscado na API é consultado de novo depois deste tempo (o nome pode ter mudado no Yay! Forms)
const REBUSCAR_MS = 24 * 60 * 60 * 1000;

// ---------- Estado (com cópia em memória: a lista de leads consulta o catálogo para cada cartão) ----------
let cache = null;
function catalogo() {
  if (!cache) {
    const e = lerEstado(ESTADO) || {};
    cache = { ...e, formularios: e.formularios || {}, perguntas: e.perguntas || {} };
  }
  return cache;
}
function salvar(dados) {
  cache = null;
  return salvarEstado(ESTADO, dados);
}
// Os testes trocam o banco por baixo; isto zera a cópia em memória
export function esquecerCache() {
  cache = null;
}

// ---------- Token ----------
export function tokenYay() {
  return catalogo().token_painel || config.yayforms.apiToken || '';
}
function origemToken() {
  if (catalogo().token_painel) return 'painel';
  return config.yayforms.apiToken ? 'env' : null;
}

export class ErroYay extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

async function chamarYay(caminho, token = tokenYay(), tentativa = 1) {
  let resposta;
  try {
    resposta = await fetch(`${config.yayforms.apiUrl}${caminho}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ErroYay(502, 'Não consegui falar com o Yay! Forms agora.');
  }
  if (resposta.status === 429 && tentativa <= 3) {
    const espera = Math.min(30, Number(resposta.headers?.get?.('retry-after')) || 5);
    await new Promise((r) => setTimeout(r, espera * 1000));
    return chamarYay(caminho, token, tentativa + 1);
  }
  if (resposta.status === 401 || resposta.status === 403) throw new ErroYay(401, 'O Yay! Forms recusou o token da API. Gere um novo e cole de novo.');
  if (resposta.status === 404) throw new ErroYay(404, 'Não encontrado no Yay! Forms');
  if (!resposta.ok) throw new ErroYay(502, `Yay! Forms respondeu ${resposta.status}`);
  return resposta.json();
}

export function limparToken(bruto) {
  const t = String(bruto ?? '').replace(/\s+/g, '').replace(/^bearer/i, '');
  if (!FORMATO_TOKEN.test(t)) throw new ErroHttp(400, 'Esse não parece um token da API do Yay! Forms. Copie o token completo, sem aspas.');
  return t;
}

// Confere o token com o Yay! Forms antes de guardar
export async function conectarComToken(bruto) {
  const token = limparToken(bruto);
  try {
    await chamarYay('/workspaces?limit=1', token);
  } catch (err) {
    throw new ErroHttp(err.status === 401 ? 400 : 502, err.message);
  }
  salvar({ token_painel: token, ultimo_erro: null });
}

export function removerToken() {
  salvar({ token_painel: null });
}

// ---------- Textos ----------
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Títulos do Yay! Forms podem vir com HTML (negrito, quebras) e entidades
export function limparTitulo(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTIDADES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export const pareceId = (v) => RE_ID.test(String(v ?? '').trim());

// O ID do Yay! Forms guarda a data de criação nos 8 primeiros caracteres
export function criadoEm(id) {
  if (!pareceId(id)) return null;
  const ms = parseInt(String(id).slice(0, 8), 16) * 1000;
  return ms > Date.UTC(2015, 0, 1) && ms < Date.now() + 86400000 ? new Date(ms) : null;
}
const dataCurta = (d) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

// ---------- Consultas ----------
export function nomeFormulario(formId) {
  if (!formId) return null;
  const manual = (lerEstado('yayforms') || {}).nomes?.[formId];
  return manual || catalogo().formularios[formId]?.titulo || null;
}

// Sempre devolve algo legível, mesmo sem nome em lugar nenhum
export function rotuloFormulario(formId, nomeGravado = null) {
  const nome = nomeFormulario(formId) || (nomeGravado && !pareceId(nomeGravado) ? nomeGravado : null);
  if (nome) return nome;
  if (!formId) return null;
  const d = criadoEm(formId);
  const quando = d ? ` (criado em ${dataCurta(d)})` : '';
  return catalogo().formularios[formId]?.removido ? `Formulário apagado no Yay! Forms${quando}` : `Formulário sem nome${quando}`;
}

export function tituloPergunta(fieldId) {
  return (fieldId && catalogo().perguntas[fieldId]?.titulo) || null;
}

// Pergunta guardada só com o código: troca pelo texto; sem texto conhecido, um rótulo curto
export function rotuloPergunta(pergunta, id = null) {
  const p = String(pergunta ?? '').trim();
  if (p && !pareceId(p)) return p;
  const chave = id || p;
  return tituloPergunta(chave) || (chave ? `Pergunta sem título (…${String(chave).slice(-5)})` : p);
}

// Opções para o parser do webhook: nomes de formulários (manual > API) e textos das perguntas
export function opcoesDoParser() {
  const c = catalogo();
  const nomes = Object.fromEntries(Object.entries(c.formularios).filter(([, f]) => f.titulo).map(([id, f]) => [id, f.titulo]));
  return {
    campoNome: config.yayforms.fieldName,
    campoTelefone: config.yayforms.fieldPhone,
    campoEmail: config.yayforms.fieldEmail,
    nomesFormularios: { ...nomes, ...((lerEstado('yayforms') || {}).nomes || {}) },
    titulosPerguntas: Object.fromEntries(Object.entries(c.perguntas).map(([id, p]) => [id, p.titulo])),
  };
}

// ---------- Aprender com os webhooks já guardados (não precisa de token) ----------
function respostasDoPayload(body) {
  const r = body?.response || body?.data?.response || body || {};
  const bruto = r.answers ?? body?.answers ?? body?.data?.answers;
  if (!bruto) return [];
  return Array.isArray(bruto) ? bruto.map((a) => [a?.id || a?.field_id || a?.question_id || a?.fieldId, a]) : Object.entries(bruto);
}

// Sem lista: lê todos os webhooks guardados. Com lista: só os payloads informados (o que acabou de chegar).
export function aprenderDosPayloads(corpos = null) {
  const c = catalogo();
  const formularios = { ...c.formularios };
  const perguntas = { ...c.perguntas };
  let novas = 0;
  let mudou = false;
  // Sem lista: percorre os webhooks guardados um por um (antes carregava e abria todos de uma vez na memória)
  const lista = corpos || (function* () {
    for (const ev of iterar("SELECT payload FROM webhook_events WHERE source = 'yayforms'")) yield lerJson(ev.payload) || {};
  })();
  for (const body of lista) {
    const formId = String(body.response?.formId || body.formId || body.form?.id || '') || null;
    if (formId && !formularios[formId]) {
      formularios[formId] = {};
      mudou = true;
    }
    const tituloForm = limparTitulo(body.form?.title || body.form?.name || body.form_name || body.formTitle);
    if (formId && tituloForm && !formularios[formId].titulo) {
      formularios[formId] = { ...formularios[formId], titulo: tituloForm, fonte: 'webhook' };
      mudou = true;
    }
    for (const [id, a] of respostasDoPayload(body)) {
      if (!id || !a || typeof a !== 'object') continue;
      const titulo = limparTitulo(a.fieldTitle || a.title || a.question?.title || a.field?.title || a.label);
      // O que veio da API vale mais que o webhook; entre webhooks, fica o primeiro título visto
      if (titulo && !pareceId(titulo) && !perguntas[id]) {
        perguntas[id] = { titulo, form_id: formId, fonte: 'webhook' };
        novas++;
      }
    }
  }
  if (mudou || novas) salvar({ formularios, perguntas });
  return { novas };
}

// ---------- Buscar na API ----------
// Todos os formulários que já mandaram respostas ou aparecem em algum lead
export function formulariosConhecidos() {
  const ids = new Set(Object.keys(catalogo().formularios));
  for (const r of all("SELECT DISTINCT json_extract(payload, '$.response.formId') AS id FROM webhook_events WHERE source = 'yayforms'")) if (r.id) ids.add(String(r.id));
  for (const r of all("SELECT DISTINCT json_extract(extra, '$.form_id') AS id FROM leads WHERE json_extract(extra, '$.form_id') IS NOT NULL")) if (r.id) ids.add(String(r.id));
  return [...ids].filter((id) => /^[\w-]{1,64}$/.test(id));
}

function camposDaResposta(r) {
  const lista = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
  const saida = [];
  const visitar = (f) => {
    if (!f || typeof f !== 'object') return;
    if (f.id) saida.push(f);
    // Grupos de perguntas trazem as filhas dentro (nomes variam)
    for (const k of ['fields', 'children', 'properties']) if (Array.isArray(f[k])) f[k].forEach(visitar);
  };
  lista.forEach(visitar);
  return saida;
}

let rodando = null;
// Busca na API os formulários que ainda não têm nome (ou todos, com forcar). Devolve um resumo.
export function sincronizar({ forcar = false, somente = null } = {}) {
  if (rodando) return rodando;
  rodando = (async () => {
    const token = tokenYay();
    if (!token) return { sem_token: true };
    const resumo = { formularios: 0, perguntas: 0, apagados: 0, erros: 0 };
    const c = catalogo();
    const formularios = { ...c.formularios };
    const perguntas = { ...c.perguntas };
    const alvo = somente ? [somente] : formulariosConhecidos();
    let erroGeral = null;
    for (const formId of alvo) {
      const atual = formularios[formId] || {};
      const recente = atual.buscado_em && Date.now() - Date.parse(atual.buscado_em) < REBUSCAR_MS;
      if (!forcar && recente) continue;
      try {
        const form = (await chamarYay(`/forms/${encodeURIComponent(formId)}`, token))?.data || {};
        const titulo = limparTitulo(form.title || form.fullTitle);
        formularios[formId] = { ...atual, titulo: titulo || atual.titulo || null, removido: false, fonte: titulo ? 'api' : atual.fonte, buscado_em: agora() };
        if (titulo) resumo.formularios++;
        const campos = camposDaResposta(await chamarYay(`/forms/${encodeURIComponent(formId)}/fields`, token));
        for (const f of campos) {
          const t = limparTitulo(f.plainTitle || f.title);
          if (!t) continue;
          if (perguntas[f.id]?.titulo !== t) resumo.perguntas++;
          perguntas[f.id] = { titulo: t, form_id: formId, fonte: 'api' };
        }
      } catch (err) {
        if (err.status === 404) {
          formularios[formId] = { ...atual, removido: true, buscado_em: agora() };
          resumo.apagados++;
        } else if (err.status === 401) {
          erroGeral = err.message;
          break;
        } else {
          resumo.erros++;
          erroGeral = err.message;
        }
      }
    }
    salvar({ formularios, perguntas, ultima_sincronizacao: agora(), ultimo_erro: erroGeral, ultimo_resumo: resumo });
    return resumo;
  })().finally(() => {
    rodando = null;
  });
  return rodando;
}

// ---------- Aplicar nos leads e no histórico já gravados ----------
function corrigirRespostas(lista) {
  if (!Array.isArray(lista)) return { lista, mudou: false };
  let mudou = false;
  const nova = lista.map((r) => {
    if (!r || typeof r !== 'object') return r;
    // O formato do lead usa "pergunta"; o do payload interpretado usa "titulo"
    const campo = 'pergunta' in r ? 'pergunta' : 'titulo' in r ? 'titulo' : 'pergunta';
    const atual = r[campo];
    const id = r.id || (pareceId(atual) ? atual : null);
    if (atual && !pareceId(atual)) return r;
    const titulo = tituloPergunta(id);
    if (!titulo) return r;
    mudou = true;
    return { ...r, [campo]: titulo };
  });
  return { lista: nova, mudou };
}

function corrigirDetalhes(dados) {
  if (!dados || typeof dados !== 'object') return null;
  let mudou = false;
  const novo = { ...dados };
  const formId = dados.form_id || null;
  const nome = nomeFormulario(formId);
  if (nome && dados.formulario !== nome) {
    novo.formulario = nome;
    mudou = true;
  }
  const r = corrigirRespostas(dados.respostas);
  if (r.mudou) {
    novo.respostas = r.lista;
    mudou = true;
  }
  return mudou ? novo : null;
}

// Passa por todos os leads do Yay! Forms e pelo histórico deles. Só grava o que mudou; pode rodar quantas vezes quiser.
export function aplicarNomes() {
  cache = null;
  const resumo = { leads: 0, eventos: 0 };
  const leads = all("SELECT id, extra FROM leads WHERE json_extract(extra, '$.form_id') IS NOT NULL OR json_extract(extra, '$.respostas') IS NOT NULL");
  const eventos = all(
    `SELECT id, data FROM lead_events
      WHERE type IN (${TIPOS_FORM.map(() => '?').join(',')})
        AND (json_extract(data, '$.form_id') IS NOT NULL OR json_extract(data, '$.respostas') IS NOT NULL)`,
    TIPOS_FORM
  );
  tx(() => {
    for (const l of leads) {
      const novo = corrigirDetalhes(lerJson(l.extra));
      if (novo) {
        run('UPDATE leads SET extra = ? WHERE id = ?', [JSON.stringify(novo), l.id]);
        resumo.leads++;
      }
    }
    for (const e of eventos) {
      const novo = corrigirDetalhes(lerJson(e.data));
      if (novo) {
        run('UPDATE lead_events SET data = ? WHERE id = ?', [JSON.stringify(novo), e.id]);
        resumo.eventos++;
      }
    }
  });
  return resumo;
}

// Ao ligar o CRM: aprende com os webhooks guardados, aplica em tudo, busca o que falta na API e aplica de novo
export async function prepararCatalogo({ log = console.log } = {}) {
  try {
    aprenderDosPayloads();
    const r1 = aplicarNomes();
    if (r1.leads || r1.eventos) log(`[yayforms] nomes aplicados em ${r1.leads} lead(s) e ${r1.eventos} registro(s) do histórico já existentes`);
    if (!tokenYay()) {
      if (formulariosConhecidos().some((id) => !nomeFormulario(id))) {
        log('[yayforms] sem token da API — cole o token em Equipe e integrações para o CRM buscar os nomes dos formulários');
      }
      return;
    }
    const s = await sincronizar();
    if (s.sem_token) return;
    const r2 = aplicarNomes();
    if (r2.leads || r2.eventos) log(`[yayforms] nomes do Yay! Forms aplicados em ${r2.leads} lead(s) e ${r2.eventos} registro(s) do histórico`);
  } catch (err) {
    console.error('[yayforms] não consegui preparar os nomes dos formulários:', err.message);
  }
}

// Depois de cada webhook: aprende os textos de pergunta que vieram nele e, se o formulário (ou alguma pergunta)
// ainda não está no catálogo, busca no Yay! Forms em segundo plano. Nunca derruba o recebimento.
export function conhecerFormulario(body) {
  try {
    if (aprenderDosPayloads([body]).novas) aplicarNomes();
  } catch (err) {
    console.error('[yayforms] não consegui aprender os nomes do webhook:', err.message);
  }
  const formId = body?.response?.formId ? String(body.response.formId) : null;
  if (!formId || !/^[\w-]{1,64}$/.test(formId) || !tokenYay()) return;
  const idsPerguntas = respostasDoPayload(body).map(([id]) => id).filter(Boolean);
  const c = catalogo();
  const conhecido = c.formularios[formId]?.buscado_em && idsPerguntas.every((id) => c.perguntas[id]);
  if (conhecido) return;
  sincronizar({ forcar: true, somente: formId })
    .then(() => aplicarNomes())
    .catch((err) => console.error('[yayforms] não consegui buscar o nome do formulário:', err.message));
}

// Resumo para a tela. Nunca inclui o token.
export function montarStatus() {
  const c = catalogo();
  const token = tokenYay();
  const ids = formulariosConhecidos();
  return {
    configurado: Boolean(token),
    origem_token: origemToken(),
    token_final: token ? `••••${token.slice(-4)}` : null,
    ultima_sincronizacao: c.ultima_sincronizacao || null,
    ultimo_resumo: c.ultimo_resumo || null,
    ultimo_erro: c.ultimo_erro || null,
    formularios_total: ids.length,
    formularios_com_nome: ids.filter((id) => nomeFormulario(id)).length,
  };
}

// Linha da tabela "Nomes dos formulários"
export function infoFormulario(formId) {
  const f = catalogo().formularios[formId] || {};
  const manual = (lerEstado('yayforms') || {}).nomes?.[formId] || null;
  return { nome: manual, nome_yay: f.titulo || null, removido: Boolean(f.removido), rotulo: rotuloFormulario(formId), criado_em: criadoEm(formId)?.toISOString() || null };
}
