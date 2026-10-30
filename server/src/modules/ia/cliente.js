// Chamada à API da Anthropic (Messages API) direto com fetch — sem biblioteca externa.
// O texto fixo (regras + empresa + playbook) vai marcado para cache, o que barateia as chamadas seguidas.
import { run } from '../../db.js';
import { API_URL, MODELO_PADRAO, chaveApi } from './config.js';

// status é o que o CRM devolve para a tela. Erros da Anthropic viram 4xx de propósito: o proxy da VPS troca
// respostas 502/503 por uma página própria e a mensagem explicando o problema se perderia.
export class ErroIA extends Error {
  constructor(mensagem, { status = 422, temporario = false, tipo = null } = {}) {
    super(mensagem);
    this.status = status;
    this.temporario = temporario;
    this.tipo = tipo;
  }
}

// Mensagens da Anthropic em português, com o que fazer
export function traduzirErro(status, msg = '') {
  const m = String(msg).toLowerCase();
  const detalhe = msg ? ` (Anthropic: ${msg})` : '';
  if (status === 401 || m.includes('invalid x-api-key') || m.includes('authentication')) {
    return new ErroIA(`A Anthropic recusou a chave: confira se copiou a chave inteira e se ela não foi apagada no Console.${detalhe}`, { status: 400, tipo: 'chave' });
  }
  if (status === 403) return new ErroIA(`Esta chave não tem permissão para usar a API.${detalhe}`, { status: 400, tipo: 'chave' });
  if (m.includes('credit balance') || m.includes('billing') || m.includes('credits')) {
    return new ErroIA(`A organização dessa chave está sem créditos de API. Adicione créditos em console.anthropic.com → Billing (ou vincule os créditos mensais do plano Max/Team) e tente de novo.${detalhe}`, { status: 422, tipo: 'creditos' });
  }
  if (status === 404 || m.includes('model')) {
    return new ErroIA(`O modelo configurado (${process.env.IA_MODELO || 'claude-haiku-5-5'}) não está disponível para esta chave.${detalhe}`, { status: 422, tipo: 'modelo' });
  }
  if (status === 429) return new ErroIA(`Limite de uso da API atingido; tente de novo em instantes.${detalhe}`, { status: 429, temporario: true, tipo: 'limite' });
  if (status >= 500) return new ErroIA(`A API da Anthropic está instável agora; tente de novo em alguns minutos.${detalhe}`, { status: 422, temporario: true, tipo: 'instavel' });
  return new ErroIA(`A API da Anthropic respondeu com erro ${status}.${detalhe}`, { status: 422 });
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
    const tempo = err?.name === 'TimeoutError' ? 'a Anthropic demorou demais para responder' : err.message;
    throw new ErroIA(`O servidor do CRM não conseguiu falar com a API da Anthropic (${tempo}). Confira se a VPS tem acesso à internet.`, { status: 422, temporario: true, tipo: 'rede' });
  }
  let dados = null;
  try { dados = await resposta.json(); } catch { /* sem corpo */ }
  if (!resposta.ok) throw traduzirErro(resposta.status, dados?.error?.message || '');
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
