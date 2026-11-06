// Chamada à API da Anthropic com ferramentas (tool use), para a Alice. Usa a mesma chave e o mesmo tratamento
// de erros da IA de primeiro contato. O texto fixo (regras + cérebro) e as ferramentas vão marcados para cache:
// as chamadas seguidas da mesma conversa (e as rodadas de ferramenta) custam bem menos.
import { API_URL, chaveApi, workspaceApi } from '../ia/config.js';
import { ErroIA, traduzirErro } from '../ia/cliente.js';

let chamadaFalsa = null;
/** Testes: troca a chamada real por uma função (corpo) => resposta no formato da API ({ content, usage, stop_reason }) */
export function definirChamadaFalsaAgente(fn) {
  chamadaFalsa = fn;
}

/**
 * sistema: [{ texto, cache }] | mensagens: formato da API | ferramentas: [{ name, description, input_schema }]
 * Devolve a resposta crua da API: { content: [...], usage, stop_reason }.
 */
export async function chamarModelo({ sistema, mensagens, ferramentas = [], modelo, maxTokens = 8000, tempoMs = 180000, pensar = false, toolChoice = null }) {
  const system = (Array.isArray(sistema) ? sistema : [{ texto: sistema, cache: true }])
    .filter((b) => b?.texto)
    .map((b) => ({ type: 'text', text: b.texto, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) }));
  const tools = ferramentas.map((f, i) => (i === ferramentas.length - 1 ? { ...f, cache_control: { type: 'ephemeral' } } : f));
  const corpo = {
    model: modelo,
    max_tokens: maxTokens,
    system,
    messages: marcarCacheNaUltima(mensagens),
    ...(tools.length ? { tools } : {}),
    ...(tools.length && toolChoice ? { tool_choice: toolChoice } : {}),
  };
  if (pensar) {
    corpo.thinking = { type: 'adaptive' };
    corpo.output_config = { effort: 'high' };
  }
  if (chamadaFalsa) return chamadaFalsa(corpo);

  const chave = chaveApi();
  if (!chave) throw new ErroIA('A chave da API da Anthropic não está configurada (tela IA → Primeiro contato)', { status: 400, tipo: 'chave' });
  let resposta;
  try {
    resposta = await fetch(`${API_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01',
        ...(workspaceApi() ? { 'anthropic-workspace-id': workspaceApi() } : {}),
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(tempoMs),
    });
  } catch (err) {
    const tempo = err?.name === 'TimeoutError' ? 'a Anthropic demorou demais para responder' : err.message;
    throw new ErroIA(`O servidor do CRM não conseguiu falar com a API da Anthropic (${tempo}).`, { status: 422, temporario: true, tipo: 'rede' });
  }
  let dados = null;
  try { dados = await resposta.json(); } catch { /* sem corpo */ }
  if (!resposta.ok) throw traduzirErro(resposta.status, dados?.error?.message || '', corpo.model);
  return { content: dados?.content || [], usage: dados?.usage || null, stop_reason: dados?.stop_reason || null };
}

// Marca a última mensagem para cache: a próxima rodada de ferramentas lê todo o começo da conversa do cache
function marcarCacheNaUltima(mensagens) {
  if (!mensagens.length) return mensagens;
  const copia = mensagens.map((m) => ({ ...m }));
  const ultima = copia[copia.length - 1];
  const blocos = typeof ultima.content === 'string' ? [{ type: 'text', text: ultima.content }] : ultima.content.map((b) => ({ ...b }));
  // Não marca bloco vazio nem pensamento (a API recusa)
  for (let i = blocos.length - 1; i >= 0; i--) {
    if (!['thinking', 'redacted_thinking'].includes(blocos[i].type) && !(blocos[i].type === 'text' && !blocos[i].text)) {
      blocos[i] = { ...blocos[i], cache_control: { type: 'ephemeral' } };
      break;
    }
  }
  ultima.content = blocos;
  return copia;
}

export const textoDaResposta = (r) => (r?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
