// Conversa com a API do Calendly (v2) usando o token pessoal do .env
import { config } from '../../config.js';
import { lerEstado } from '../../estado.js';

export class ErroCalendly extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Aceita caminho ("/users/me") ou URL completa devolvida pelo próprio Calendly
function montarUrl(caminhoOuUrl, parametros) {
  let caminho = caminhoOuUrl;
  if (/^https?:\/\//.test(caminhoOuUrl)) {
    const u = new URL(caminhoOuUrl);
    caminho = u.pathname + u.search;
  }
  const url = new URL(config.calendly.apiUrl + caminho);
  for (const [k, v] of Object.entries(parametros || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function chamar(caminho, parametros, tentativa = 1) {
  const resposta = await fetch(montarUrl(caminho, parametros), {
    headers: { Authorization: `Bearer ${lerEstado('calendly').token_painel || config.calendly.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (resposta.status === 429 && tentativa <= 3) {
    const espera = Math.min(60, Number(resposta.headers.get('retry-after')) || 10);
    await new Promise((r) => setTimeout(r, espera * 1000));
    return chamar(caminho, parametros, tentativa + 1);
  }
  if (!resposta.ok) {
    let detalhe = '';
    try { detalhe = (await resposta.json())?.message || ''; } catch { /* sem corpo */ }
    if (resposta.status === 401) throw new ErroCalendly(401, 'Token do Calendly inválido ou expirado');
    throw new ErroCalendly(resposta.status, `Calendly respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`);
  }
  return resposta.json();
}

// Percorre as páginas de uma listagem (limite de segurança)
export async function listarTudo(caminho, parametros, maxPaginas = 10) {
  const itens = [];
  let token = null;
  for (let i = 0; i < maxPaginas; i++) {
    const r = await chamar(caminho, { ...parametros, count: 100, page_token: token });
    itens.push(...(r.collection || []));
    token = r.pagination?.next_page_token;
    if (!token) break;
  }
  return itens;
}
