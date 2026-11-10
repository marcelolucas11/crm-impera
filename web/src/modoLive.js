// Modo Live: para compartilhar a tela e apresentar o CRM sem expor os leads.
// Fica salvo só neste navegador (cada computador liga o seu) e vale para todas as abas abertas.
//
// Como funciona, sem mexer em cada tela:
// 1. Toda resposta da API passa por `coletarSensiveis`, que guarda os nomes, e-mails, telefones e @ dos
//    leads/contatos (só de objetos que são pessoas: têm telefone, jid, lead_id... — nunca etapas,
//    usuários da equipe ou números conectados).
// 2. Com o modo ligado, um observador da página troca na hora (antes de a tela ser pintada) esses
//    textos por uma versão parcial — "João Silva" → "Jo•• Si•••", "(11) 98765-4321" → "(11) 9••••-••21".
//    Telefones, e-mails e @ soltos em qualquer texto (mensagens, respostas do formulário) também são cobertos.
// 3. Só o que aparece na tela muda: os dados de verdade continuam iguais, então enviar mensagem, mover
//    card e salvar a ficha funcionam normalmente. Campos de digitação com dado sensível ficam desfocados.
// 4. Ao desligar, os textos originais voltam no lugar.
import { useSyncExternalStore } from 'react';

const CHAVE = 'crm-modo-live';
const PADRAO = { ativo: false, fotos: true, mensagens: false };
const PONTO = '•';

// ---------- Estado (salvo no navegador) ----------

function ler() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (salvo && typeof salvo === 'object') return { ...PADRAO, ...salvo };
  } catch { /* navegador sem armazenamento */ }
  return { ...PADRAO };
}

let config = ler();
const ouvintes = new Set();

function avisar() {
  for (const fn of ouvintes) { try { fn(); } catch { /* ignora */ } }
}

export function configModoLive() { return config; }
export function modoLiveAtivo() { return config.ativo; }

export function definirModoLive(parcial) {
  config = { ...config, ...parcial };
  try { localStorage.setItem(CHAVE, JSON.stringify(config)); } catch { /* sem armazenamento */ }
  aplicar();
  avisar();
}

export const alternarModoLive = () => definirModoLive({ ativo: !config.ativo });

export function useModoLive() {
  return useSyncExternalStore(
    (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    () => config,
  );
}

// ---------- Máscaras (mantêm o mesmo tamanho do texto original) ----------

const LETRA = /[\p{L}\p{N}]/u;

function cobrirPalavra(p) {
  const chars = Array.from(p);
  const letras = chars.filter((c) => LETRA.test(c)).length;
  if (letras <= 2) return p; // "de", "da", "e"
  const manter = letras >= 4 ? 2 : 1;
  let vistas = 0;
  return chars.map((c) => {
    if (!LETRA.test(c)) return c;
    vistas += 1;
    return vistas <= manter ? c : PONTO.repeat(c.length);
  }).join('');
}

export function mascararNome(nome) {
  if (!nome) return nome;
  return String(nome).split(/(\s+)/).map((p) => (/^\s+$/.test(p) ? p : cobrirPalavra(p))).join('');
}

// Mantém DDI/DDD e os 2 últimos dígitos; o resto vira ponto, preservando parênteses, espaços e traços.
function cobrirTelefone(t) {
  const total = (t.match(/\d/g) || []).length;
  const inicio = total >= 12 ? 4 : 2;
  let i = 0;
  return t.replace(/\d/g, (d) => {
    i += 1;
    return i <= inicio || i > total - 2 ? d : PONTO;
  });
}

function cobrirEmail(e) {
  const [local, dominio] = e.split('@');
  return `${local.slice(0, 2)}${PONTO.repeat(Math.max(0, local.length - 2))}@${dominio}`;
}

const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_TELEFONE = /(?<![\w•])\+?\d[\d\s().-]{7,}\d(?![\w•])/g;
const RE_ARROBA = /(?<![^\s([,;:"'])@([\w.]{2,30})(?![\w.•])/g;

// ---------- Dicionário de nomes dos leads ----------

const sensiveis = new Set(); // nomes, empresas e @ vindos da API
let regexNomes = null;
let dicionarioMudou = false;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function guardar(valor) {
  if (typeof valor !== 'string') return;
  const v = valor.trim();
  if (v.length < 3 || v.length > 80 || sensiveis.has(v)) return;
  if (!/\p{L}/u.test(v)) return; // só número (telefone) é coberto pela regra de telefones
  if (v.includes('@') && !v.startsWith('@')) return; // e-mail é coberto pela regra de e-mails
  sensiveis.add(v);
  regexNomes = null;
  dicionarioMudou = true;
}

function obterRegexNomes() {
  if (regexNomes || !sensiveis.size) return regexNomes;
  const lista = [...sensiveis].sort((a, b) => b.length - a.length).map(escapar);
  regexNomes = new RegExp(`(?<![\\p{L}\\p{N}])(?:${lista.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return regexNomes;
}

// Objetos que representam uma pessoa (lead, contato, conversa, membro de lista, convidado do Calendly...)
const MARCAS_PESSOA = ['phone', 'telefone', 'lead_telefone', 'jid', 'push_name', 'pushName', 'lead_id',
  'invitee_email', 'invitee_phone', 'perfil_username'];
const CAMPOS_NOME = ['name', 'nome', 'push_name', 'pushName', 'full_name', 'username', 'email', 'empresa', 'company',
  'invitee_name', 'invitee_email', 'contato_nome', 'lead_nome'];
// Campos que são sempre de lead, em qualquer objeto
const CAMPOS_SEMPRE = ['lead_nome', 'contato_nome', 'invitee_name', 'invitee_email'];
const PERGUNTA_PESSOAL = /nome|name|empresa|company|negócio|negocio|loja|marca|instagram|insta|@|e-?mail|cpf|cnpj|site|cidade/i;

function ehPessoa(o) {
  if ('role' in o || 'qr' in o || 'historico' in o) return false; // equipe e números conectados
  return MARCAS_PESSOA.some((k) => o[k] !== undefined && o[k] !== null);
}

function percorrer(v, chavePai, prof) {
  if (!v || typeof v !== 'object' || prof > 8) return;
  if (Array.isArray(v)) { for (const x of v) percorrer(x, chavePai, prof + 1); return; }
  const pessoa = ehPessoa(v);
  for (const k of CAMPOS_SEMPRE) guardar(v[k]);
  if (pessoa) for (const k of CAMPOS_NOME) guardar(v[k]);
  if (chavePai === 'instagram' && v.username) guardar(v.username); // lead.extra.instagram
  if (v.post_id && v.texto && v.username) guardar(v.username); // comentário do Instagram
  if (v.pergunta && v.resposta && PERGUNTA_PESSOAL.test(String(v.pergunta))) guardar(v.resposta);
  for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') percorrer(x, k, prof + 1);
}

// Chamado pela api.js em toda resposta (mesmo com o modo desligado, para estar pronto ao ligar)
export function coletarSensiveis(dados) {
  try { percorrer(dados, '', 0); } catch { /* nunca atrapalha a resposta */ }
  if (dicionarioMudou && config.ativo) agendarVarredura();
  dicionarioMudou = false;
}

export function mascararTexto(texto) {
  if (!texto || typeof texto !== 'string') return texto;
  let s = texto.replace(RE_EMAIL, cobrirEmail);
  const re = obterRegexNomes();
  if (re) { re.lastIndex = 0; s = s.replace(re, mascararNome); }
  s = s.replace(RE_TELEFONE, (m) => {
    const n = (m.match(/\d/g) || []).length;
    return n >= 10 && n <= 13 ? cobrirTelefone(m) : m;
  });
  s = s.replace(RE_ARROBA, (m, u) => `@${u.slice(0, 1)}${PONTO.repeat(u.length - 1)}`);
  return s;
}

// Para textos que saem da página (notificações do sistema)
export const textoParaExibir = (texto) => (config.ativo ? mascararTexto(texto) : texto);

// ---------- Aplicação na página ----------

const originaisTexto = new WeakMap(); // nó de texto → { original, coberto }
const originaisAttr = new WeakMap(); // elemento → { attr: { original, coberto } }
const ATRIBUTOS = ['title', 'alt', 'aria-label'];
const IGNORAR = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'svg', 'SVG']);
let observador = null;
let varreduraAgendada = false;

function ignorado(el) {
  for (let e = el; e; e = e.parentElement) {
    if (IGNORAR.has(e.tagName) || e.isContentEditable || e.hasAttribute?.('data-live-livre')) return true;
    if (e === document.body) return false;
  }
  return false;
}

function cobrirNoTexto(no) {
  const atual = no.nodeValue;
  if (!atual || atual.length < 3) return;
  const reg = originaisTexto.get(no);
  if (reg && reg.coberto === atual) return; // já coberto por nós
  const coberto = mascararTexto(atual);
  if (coberto === atual) { if (reg) originaisTexto.delete(no); return; }
  originaisTexto.set(no, { original: atual, coberto });
  no.nodeValue = coberto;
}

// Nome dividido em pedaços (busca destacada com <mark>): cobre o conjunto e redistribui pelos pedaços
function cobrirPorPedacos(el) {
  const nos = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) nos.push(n);
  const originais = nos.map((n) => {
    const reg = originaisTexto.get(n);
    return reg && reg.coberto === n.nodeValue ? reg.original : n.nodeValue;
  });
  const junto = originais.join('');
  const coberto = mascararTexto(junto);
  if (coberto.length !== junto.length) return;
  let pos = 0;
  nos.forEach((n, i) => {
    const pedaco = coberto.slice(pos, pos + originais[i].length);
    pos += originais[i].length;
    if (pedaco !== originais[i]) {
      originaisTexto.set(n, { original: originais[i], coberto: pedaco });
      if (n.nodeValue !== pedaco) n.nodeValue = pedaco;
    }
  });
}

function cobrirAtributos(el) {
  let regs = originaisAttr.get(el);
  for (const a of ATRIBUTOS) {
    const atual = el.getAttribute(a);
    if (!atual) continue;
    if (regs?.[a]?.coberto === atual) continue;
    const coberto = mascararTexto(atual);
    if (coberto === atual) continue;
    if (!regs) { regs = {}; originaisAttr.set(el, regs); }
    regs[a] = { original: atual, coberto };
    el.setAttribute(a, coberto);
  }
}

function cobrirCampos(raiz = document) {
  for (const c of raiz.querySelectorAll('input, textarea')) {
    const tipo = (c.type || 'text').toLowerCase();
    if (c.tagName === 'INPUT' && !['text', 'search', 'tel', 'email', 'url', ''].includes(tipo)) continue;
    const sensivel = Boolean(c.value) && mascararTexto(c.value) !== c.value;
    c.classList.toggle('live-campo-oculto', sensivel);
  }
}

function processar(raiz) {
  if (raiz.nodeType === Node.TEXT_NODE) {
    const pai = raiz.parentElement;
    if (!pai || ignorado(pai)) return;
    const comMark = pai.closest('mark') ? pai.closest('mark').parentElement : (pai.querySelector(':scope > mark') ? pai : null);
    if (comMark) cobrirPorPedacos(comMark);
    else cobrirNoTexto(raiz);
    return;
  }
  if (raiz.nodeType !== Node.ELEMENT_NODE || ignorado(raiz)) return;
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && IGNORAR.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const marks = new Set();
  cobrirAtributos(raiz);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (n.isContentEditable || n.hasAttribute('data-live-livre')) continue;
      cobrirAtributos(n);
      if (n.tagName === 'MARK' && n.parentElement) marks.add(n.parentElement);
    } else if (!n.parentElement?.isContentEditable) {
      cobrirNoTexto(n);
    }
  }
  for (const el of marks) cobrirPorPedacos(el);
}

function varrerTudo() {
  varreduraAgendada = false;
  if (!config.ativo || !document.body) return;
  processar(document.body);
  cobrirCampos();
}

function agendarVarredura() {
  if (varreduraAgendada) return;
  varreduraAgendada = true;
  requestAnimationFrame(varrerTudo);
}

function aoMudar(registros) {
  for (const r of registros) {
    if (r.type === 'characterData') processar(r.target);
    else if (r.type === 'attributes') { if (!ignorado(r.target)) cobrirAtributos(r.target); }
    else for (const n of r.addedNodes) processar(n);
  }
  cobrirCampos();
}

function restaurarTudo() {
  if (!document.body) return;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const reg = originaisTexto.get(n);
      if (reg && n.nodeValue === reg.coberto) n.nodeValue = reg.original;
      originaisTexto.delete(n);
    } else {
      const regs = originaisAttr.get(n);
      if (regs) {
        for (const [a, r] of Object.entries(regs)) if (n.getAttribute(a) === r.coberto) n.setAttribute(a, r.original);
        originaisAttr.delete(n);
      }
      n.classList?.remove('live-campo-oculto');
    }
  }
}

function aplicar() {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.toggle('modo-live', config.ativo);
  html.classList.toggle('modo-live-fotos', config.ativo && config.fotos);
  html.classList.toggle('modo-live-mensagens', config.ativo && config.mensagens);
  if (config.ativo) {
    if (!observador) {
      observador = new MutationObserver(aoMudar);
      observador.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS,
      });
      document.addEventListener('input', aoDigitar, true);
    }
    varrerTudo();
  } else {
    if (observador) {
      observador.disconnect();
      observador = null;
      document.removeEventListener('input', aoDigitar, true);
    }
    restaurarTudo();
  }
}

function aoDigitar(e) {
  const c = e.target;
  if (c?.matches?.('input, textarea')) c.classList.toggle('live-campo-oculto', Boolean(c.value) && mascararTexto(c.value) !== c.value);
}

// Atalho: Alt + Shift + L (Option + Shift + L no Mac) liga/desliga de qualquer tela
function aoTeclar(e) {
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyL') {
    e.preventDefault();
    alternarModoLive();
  }
}

// Outra aba do CRM ligou/desligou: acompanha
function aoArmazenar(e) {
  if (e.key !== CHAVE) return;
  config = ler();
  aplicar();
  avisar();
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', aoTeclar, true);
  window.addEventListener('storage', aoArmazenar);
  // Liga já no carregamento (antes do 1º desenho do React) se ficou ligado da última vez
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar, { once: true });
  else aplicar();
}
