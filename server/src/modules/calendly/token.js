// Token pessoal do Calendly: pode ser colado na tela do CRM (guardado no banco, só no servidor) ou vir do .env.
// O token nunca sai do servidor: nenhuma resposta da API devolve o valor, só os 4 últimos caracteres.
import { config } from '../../config.js';
import { get } from '../../db.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { ErroCalendly } from './cliente.js';

const FORMATO = /^[A-Za-z0-9._~+/=-]{20,4000}$/;

// O que foi colado na tela tem prioridade sobre o .env
export function tokenCalendly() {
  return lerEstado('calendly').token_painel || config.calendly.token || '';
}

export function origemToken() {
  if (lerEstado('calendly').token_painel) return 'painel';
  return config.calendly.token ? 'env' : null;
}

const final = (t) => (t ? `••••${t.slice(-4)}` : null);

// Aceita o token com espaços, quebras de linha ou o prefixo "Bearer " (comum ao copiar)
export function limparToken(bruto) {
  const t = String(bruto ?? '').replace(/\s+/g, '').replace(/^bearer/i, '');
  if (!FORMATO.test(t)) throw new ErroCalendly(400, 'Esse não parece um token do Calendly. Copie o token completo, sem aspas.');
  return t;
}

// Pergunta ao Calendly quem é o dono do token (também serve para conferir se ele vale)
async function consultarUsuario(token) {
  let resposta;
  try {
    resposta = await fetch(`${config.calendly.apiUrl}/users/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ErroCalendly(502, 'Não consegui falar com o Calendly agora. Tente de novo em instantes.');
  }
  if (resposta.status === 401 || resposta.status === 403) throw new ErroCalendly(400, 'O Calendly recusou esse token. Gere um novo e cole de novo.');
  if (!resposta.ok) throw new ErroCalendly(502, `Calendly respondeu ${resposta.status}`);
  const r = (await resposta.json())?.resource;
  if (!r?.uri) throw new ErroCalendly(502, 'Resposta inesperada do Calendly');
  return r;
}

// Confere o token e só então guarda. Troca de conta: zera o que era da conta anterior.
export async function conectarComToken(bruto) {
  const token = limparToken(bruto);
  const eu = await consultarUsuario(token);
  salvarEstado('calendly', {
    token_painel: token,
    usuario_uri: eu.uri,
    usuario_nome: eu.name,
    usuario_email: eu.email,
    ultimo_erro: null,
  });
  return { nome: eu.name, email: eu.email };
}

export function removerToken() {
  salvarEstado('calendly', { token_painel: null, usuario_uri: null, usuario_nome: null, usuario_email: null });
}

// Resumo para a tela. Nunca inclui o token.
export function montarStatus() {
  const estado = lerEstado('calendly');
  const token = tokenCalendly();
  const futuras = get(
    "SELECT count(*) AS n FROM calendly_events WHERE status = 'active' AND start_time > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
  ).n;
  return {
    configurado: Boolean(token),
    origem_token: origemToken(),
    token_final: final(token),
    intervalo_min: config.calendly.intervaloMin,
    conta: estado.usuario_nome ? { nome: estado.usuario_nome, email: estado.usuario_email } : null,
    ultima_sincronizacao: estado.ultima_sincronizacao || null,
    ultimo_resumo: estado.ultimo_resumo || null,
    ultimo_erro: estado.ultimo_erro || null,
    reunioes_futuras: futuras,
  };
}
