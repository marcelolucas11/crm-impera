// Funções utilitárias compartilhadas pelos módulos

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
