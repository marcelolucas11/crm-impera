// Funções utilitárias compartilhadas pelos módulos
import crypto from 'node:crypto';

export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Mantém só os dígitos do telefone. Números com 10 ou 11 dígitos (DDD + número, padrão do Brasil)
// recebem o DDI padrão na frente, para o mesmo lead não virar dois e o WhatsApp funcionar depois.
// Números escritos com "+" já são internacionais e ficam como estão.
export function normalizarTelefone(valor) {
  if (valor === null || valor === undefined) return null;
  const internacional = String(valor).trim().startsWith('+');
  let digitos = String(valor).replace(/\D/g, '').replace(/^0+/, '');
  const ddi = (process.env.DDI_PADRAO ?? '55').replace(/\D/g, '');
  if (!internacional && ddi && (digitos.length === 10 || digitos.length === 11)) {
    digitos = ddi + digitos;
  }
  return digitos.length >= 8 ? digitos : null;
}

// Variações do mesmo número no Brasil: com e sem o 9º dígito (contas antigas do WhatsApp usam sem)
export function variantesTelefone(phone) {
  if (!phone) return [];
  const variantes = new Set([String(phone)]);
  const m = String(phone).match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    const [, ddd, numero] = m;
    if (numero.length === 9 && numero.startsWith('9')) variantes.add(`55${ddd}${numero.slice(1)}`);
    if (numero.length === 8 && /^[6-9]/.test(numero)) variantes.add(`55${ddd}9${numero}`);
  }
  return [...variantes];
}

export function normalizarEmail(valor) {
  if (!valor) return null;
  const email = String(valor).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function texto(valor, max = 500) {
  if (valor === null || valor === undefined) return null;
  const t = String(valor).trim();
  return t ? t.slice(0, max) : null;
}

export function idValido(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Compara dois textos secretos (tokens, assinaturas) sem vazar pelo tempo de resposta quantos caracteres bateram
export function iguaisSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ba = crypto.createHash('sha256').update(a).digest();
  const bb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ba, bb) && a.length === b.length;
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Embrulha uma rota assíncrona com o tratamento de erro padrão dos módulos:
 *  - ErroHttp e os erros das integrações (classes em "conhecidos", com .status) voltam com a mensagem para a tela;
 *  - Error simples (validações escritas para a pessoa ler) volta com a mensagem e status 400 ou 500, como antes;
 *  - erros do sistema (banco, arquivos, falhas de programação) viram "Erro interno": o detalhe fica só no log,
 *    para não mostrar caminhos de arquivo nem trechos de SQL na tela.
 * mensagemSimples: false = Error simples também vira "Erro interno" (módulos que só usam ErroHttp para a tela).
 */
export function criarRota(modulo, conhecidos = [], { mensagemSimples = true, statusSimples = 500 } = {}) {
  return (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const conhecido = err instanceof ErroHttp || conhecidos.some((C) => err instanceof C);
      const simples = !conhecido && err?.constructor === Error && !err.code;
      const status = conhecido ? Number(err.status) || 400 : simples ? statusSimples : 500;
      if (status >= 500) console.error(`[${modulo}]`, err);
      if (res.headersSent) return;
      const mostrar = conhecido || (simples && mensagemSimples);
      res.status(status).json({ erro: mostrar && err?.message ? err.message : 'Erro interno' });
    }
  };
}
