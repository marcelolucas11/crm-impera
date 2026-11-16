// Nicho do lead: o que ele respondeu no formulário sobre o tipo de negócio (rifas, sorteios, e-commerce...).
// Ordem: 1) a pergunta escolhida em Equipe e integrações → Notificações; 2) uma pergunta que fale de nicho/segmento/ramo;
// 3) o nicho levantado pela Alice no Instagram. Sem nada disso, fica vazio.
import { all } from '../../db.js';
import { lerJson } from '../../events.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { rotuloPergunta } from '../yayforms/catalogo.js';

const ESTADO = 'notificacoes';
const RE_NICHO = /nicho|segmento|ramo\b|área de atuação|area de atuacao|tipo de neg[oó]cio|qual (?:é |e )?(?:o )?seu neg[oó]cio|o que (?:você |voce )?vende|trabalha com o qu[eê]/i;
// Perguntas que só citam o nicho mas perguntam outra coisa ("Tem experiência no nicho?", "Há quanto tempo...")
const RE_NAO_NICHO = /experi[eê]ncia|tempo|h[aá] quanto|anos?\b|j[aá] anuncia|investimento|or[cç]amento|fatura|valor|contrato|urg[eê]ncia/i;
const ehPerguntaDeNicho = (p) => RE_NICHO.test(p) && !RE_NAO_NICHO.test(p);
const MAX = 80;

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const limitar = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX ? `${t.slice(0, MAX - 1)}…` : t;
};

/** Configuração das notificações (ligado e a pergunta do nicho), com os padrões */
export function configNotificacoes() {
  const e = lerEstado(ESTADO) || {};
  return {
    ligado: e.ligado !== false,
    pergunta_nicho: typeof e.pergunta_nicho === 'string' ? e.pergunta_nicho : '',
  };
}

export function salvarConfigNotificacoes(dados) {
  const atual = configNotificacoes();
  const novo = { ...atual };
  if (typeof dados?.ligado === 'boolean') novo.ligado = dados.ligado;
  if (typeof dados?.pergunta_nicho === 'string') novo.pergunta_nicho = dados.pergunta_nicho.trim().slice(0, 300);
  salvarEstado(ESTADO, novo);
  return novo;
}

/** extra: objeto (ou texto JSON) do lead. Devolve o nicho em texto curto, ou null. */
export function nichoDoLead(extra, { pergunta = configNotificacoes().pergunta_nicho } = {}) {
  const e = typeof extra === 'string' ? lerJson(extra) : extra || {};
  const respostas = (Array.isArray(e.respostas) ? e.respostas : [])
    .filter((r) => r && typeof r === 'object' && String(r.resposta ?? '').trim())
    .map((r) => ({ id: r.id || null, pergunta: rotuloPergunta(r.pergunta, r.id) || '', resposta: r.resposta }));

  if (pergunta) {
    const alvo = normalizar(pergunta);
    const escolhida = respostas.find((r) => normalizar(r.pergunta) === alvo || (r.id && normalizar(r.id) === alvo));
    if (escolhida) return limitar(escolhida.resposta);
  }
  const achada = respostas.find((r) => ehPerguntaDeNicho(r.pergunta));
  if (achada) return limitar(achada.resposta);
  const ig = e.entrevista_instagram?.nicho;
  if (ig && String(ig).trim()) return limitar(ig);
  return null;
}

/** Perguntas que aparecem nos formulários dos leads (para escolher qual delas é o nicho), as mais comuns primeiro */
export function perguntasConhecidas(limite = 80) {
  const contagem = new Map();
  for (const row of all("SELECT extra FROM leads WHERE json_extract(extra, '$.respostas') IS NOT NULL ORDER BY id DESC LIMIT 800")) {
    const e = lerJson(row.extra);
    for (const r of Array.isArray(e.respostas) ? e.respostas : []) {
      const p = rotuloPergunta(r?.pergunta, r?.id);
      if (!p || !String(r?.resposta ?? '').trim()) continue;
      const atual = contagem.get(p) || { pergunta: p, leads: 0, exemplo: '', nicho: ehPerguntaDeNicho(p) };
      atual.leads++;
      if (!atual.exemplo) atual.exemplo = limitar(r.resposta);
      contagem.set(p, atual);
    }
  }
  return [...contagem.values()].sort((a, b) => Number(b.nicho) - Number(a.nicho) || b.leads - a.leads).slice(0, limite);
}
