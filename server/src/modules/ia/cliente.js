// Chamada à API da Anthropic (Messages API) direto com fetch — sem biblioteca externa.
// O texto fixo (regras + empresa + playbook) vai marcado para cache, o que barateia as chamadas seguidas.
import { run } from '../../db.js';
import { API_URL, MODELO_PADRAO, chaveApi } from './config.js';

export class ErroIA extends Error {
  constructor(mensagem, { status = 502, temporario = false } = {}) {
    super(mensagem);
    this.status = status;
    this.temporario = temporario;
  }
}

// Permite trocar a chamada real nos testes
let chamadaFalsa = null;
export function definirChamadaFalsa(fn) {
  chamadaFalsa = fn;
}

export function registrar(conversaId, tipo, detalhe = null, uso = null) {
  run('INSERT INTO ia_registro (conversa_id, tipo, detalhe, tokens_entrada, tokens_saida, tokens_cache) VALUES (?, ?, ?, ?, ?, ?)', [
    conversaId || null,
    tipo,
    detalhe ? String(detalhe).slice(0, 1000) : null,
    uso?.input_tokens || 0,
    uso?.output_tokens || 0,
    (uso?.cache_read_input_tokens || 0) + (uso?.cache_creation_input_tokens || 0),
  ]);
}

/**
 * Manda o pedido ao modelo e devolve { texto, uso }.
 *  sistema: texto fixo (cacheado) | mensagens: [{ role, content }] | maxTokens
 */
export async function perguntarModelo({ sistema, mensagens, maxTokens = 500 }) {
  const corpo = {
    model: MODELO_PADRAO,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: mensagens,
  };
  if (chamadaFalsa) return chamadaFalsa(corpo);

  const chave = chaveApi();
  if (!chave) throw new ErroIA('A chave da API da Anthropic não está configurada', { status: 400 });
  let resposta;
  try {
    resposta = await fetch(`${API_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    throw new ErroIA(`Não consegui falar com a API da Anthropic: ${err.message}`, { temporario: true });
  }
  let dados = null;
  try { dados = await resposta.json(); } catch { /* sem corpo */ }
  if (!resposta.ok) {
    const msg = dados?.error?.message || `erro ${resposta.status}`;
    if (resposta.status === 401 || resposta.status === 403) throw new ErroIA(`A Anthropic recusou a chave da API (${msg})`, { status: 400 });
    throw new ErroIA(`A API da Anthropic respondeu: ${msg}`, { temporario: resposta.status === 429 || resposta.status >= 500 });
  }
  const texto = (dados?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { texto, uso: dados?.usage || null };
}

// Lê o primeiro objeto JSON da resposta (o modelo às vezes coloca texto em volta)
export function lerJsonDaResposta(texto) {
  const t = String(texto || '');
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}
