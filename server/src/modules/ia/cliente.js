// Chamada à API da Anthropic (Messages API) direto com fetch — sem biblioteca externa.
// O texto fixo (regras + empresa + playbook) vai marcado para cache, o que barateia as chamadas seguidas.
import { run } from '../../db.js';
import { API_URL, MODELO_PADRAO, chaveApi, workspaceApi, lerConfig, nomeDoModelo } from './config.js';

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
export function traduzirErro(status, msg = '', modelo = null) {
  const m = String(msg).toLowerCase();
  const detalhe = msg ? ` (Anthropic: ${msg})` : '';
  if (status === 401 || m.includes('invalid x-api-key') || m.includes('authentication')) {
    return new ErroIA(`A Anthropic recusou a chave: confira se copiou a chave inteira e se ela não foi apagada no Console.${detalhe}`, { status: 400, tipo: 'chave' });
  }
  if (m.includes('workspace')) {
    return new ErroIA('Esta chave não pertence a um workspace. Informe o ID do workspace no campo abaixo da chave (Console → Settings → Workspaces) ou crie uma chave dentro de um workspace e cole de novo.' + detalhe, { status: 422, tipo: 'workspace' });
  }
  if (status === 403) return new ErroIA(`Esta chave não tem permissão para usar a API.${detalhe}`, { status: 400, tipo: 'chave' });
  if (m.includes('credit balance') || m.includes('billing') || m.includes('credits')) {
    return new ErroIA(`A organização dessa chave está sem créditos de API. Adicione créditos em console.anthropic.com → Billing (ou vincule os créditos mensais do plano Max/Team) e tente de novo.${detalhe}`, { status: 422, tipo: 'creditos' });
  }
  if (status === 404 || m.includes('model')) {
    return new ErroIA(`O modelo escolhido (${modelo ? nomeDoModelo(modelo) : MODELO_PADRAO}) não está disponível para esta chave.${detalhe}`, { status: 422, tipo: 'modelo' });
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
 * Manda o pedido ao modelo e devolve { texto, uso, parada }.
 *  sistema: texto fixo (cacheado) | mensagens: [{ role, content }] | maxTokens
 *  modelo: id do modelo (padrão: o escolhido na tela para responder os leads)
 *  pensar: liga o raciocínio do modelo antes de responder (análises longas, como o playbook)
 *  tempoMs: quanto esperar a resposta
 */
export async function perguntarModelo({ sistema, mensagens, maxTokens = 500, modelo = null, pensar = false, tempoMs = 45000 }) {
  const corpo = {
    model: modelo || lerConfig().modelo_atendimento || MODELO_PADRAO,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: mensagens,
  };
  if (pensar) {
    corpo.thinking = { type: 'adaptive' };
    corpo.output_config = { effort: 'high' };
  }
  if (chamadaFalsa) return chamadaFalsa(corpo);

  const chave = chaveApi();
  if (!chave) throw new ErroIA('A chave da API da Anthropic não está configurada', { status: 400 });
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
    throw new ErroIA(`O servidor do CRM não conseguiu falar com a API da Anthropic (${tempo}). Confira se a VPS tem acesso à internet.`, { status: 422, temporario: true, tipo: 'rede' });
  }
  let dados = null;
  try { dados = await resposta.json(); } catch { /* sem corpo */ }
  if (!resposta.ok) throw traduzirErro(resposta.status, dados?.error?.message || '', corpo.model);
  const texto = (dados?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { texto, uso: dados?.usage || null, parada: dados?.stop_reason || null };
}

// Lê o objeto JSON da resposta. Tolera o que o modelo às vezes faz: texto em volta, bloco ```json,
// quebra de linha "crua" dentro das mensagens e a chave "mensagem" (singular) no lugar de "mensagens".
export function lerJsonDaResposta(texto) {
  const t = String(texto || '').replace(/```(?:json)?/gi, '');
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  const bruto = t.slice(ini, fim + 1);
  let obj = null;
  try { obj = JSON.parse(bruto); } catch {
    try { obj = JSON.parse(escaparQuebrasNasStrings(bruto)); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.mensagens === undefined && obj.mensagem !== undefined) obj.mensagens = obj.mensagem;
  if (typeof obj.mensagens === 'string') obj.mensagens = [obj.mensagens];
  if (!Array.isArray(obj.mensagens)) return null;
  obj.mensagens = obj.mensagens.map((m) => String(m ?? '').trim()).filter(Boolean);
  if (obj.acao !== 'passar_humano') obj.acao = obj.handoff === true ? 'passar_humano' : 'responder';
  return obj;
}

// Troca quebras de linha e tabs que estão DENTRO de strings por \n e \t (JSON não aceita crus)
function escaparQuebrasNasStrings(json) {
  let saida = '';
  let dentro = false;
  let escape = false;
  for (const c of json) {
    if (dentro) {
      if (escape) { escape = false; saida += c; continue; }
      if (c === '\\') { escape = true; saida += c; continue; }
      if (c === '"') dentro = false;
      else if (c === '\n') { saida += '\\n'; continue; }
      else if (c === '\r') continue;
      else if (c === '\t') { saida += '\\t'; continue; }
    } else if (c === '"') dentro = true;
    saida += c;
  }
  return saida;
}

// Pergunta ao modelo e garante o formato combinado: se a resposta não vier legível (cortada ou fora do JSON),
// pede de novo uma vez, avisando o modelo do problema. Devolve { resposta, texto, uso, parada, tentativas }.
export const LIMITE_TOKENS_RESPOSTA = 900;

export async function perguntarNoFormato({ sistema, mensagens, maxTokens = LIMITE_TOKENS_RESPOSTA }) {
  const primeira = await perguntarModelo({ sistema, mensagens, maxTokens });
  const resposta = lerJsonDaResposta(primeira.texto);
  if (resposta) return { ...primeira, resposta, tentativas: 1 };

  const motivo = primeira.parada === 'max_tokens'
    ? 'Sua resposta anterior ficou longa demais e foi cortada.'
    : 'Sua resposta anterior não veio no formato combinado.';
  const segunda = await perguntarModelo({
    sistema,
    mensagens: [
      ...mensagens,
      { role: 'assistant', content: primeira.texto.slice(0, 4000) || '(vazio)' },
      { role: 'user', content: `${motivo} Responda de novo SOMENTE com o objeto JSON combinado, sem texto antes ou depois, com mensagens curtas e resumo de no máximo 2 frases.` },
    ],
    maxTokens,
  });
  const uso = somarUso(primeira.uso, segunda.uso);
  return { ...segunda, uso, resposta: lerJsonDaResposta(segunda.texto), tentativas: 2, primeiraParada: primeira.parada };
}

export function somarUso(a, b) {
  if (!a) return b;
  if (!b) return a;
  const r = { ...a };
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) r[k] = (a[k] || 0) + (b[k] || 0);
  return r;
}
