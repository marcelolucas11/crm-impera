// Ajudantes da tela de Estatísticas: números, datas, período e preferências salvas no navegador
const nf = new Intl.NumberFormat('pt-BR');
export const num = (v) => (v === null || v === undefined ? '—' : nf.format(v));
export const pct = (v) => (v === null || v === undefined ? '—' : `${nf.format(v)}%`);
export const taxa = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : null);

export const dois = (n) => String(n).padStart(2, '0');
export const fmtDiaMes = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
export const fmtHora = (d) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
export const isoDia = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

// Preferências por pessoa e navegador (período, funil, UTMs). Sem armazenamento, a tela funciona com o padrão.
export function lerPref(chave, padrao) {
  try {
    const v = JSON.parse(localStorage.getItem(`crm-estatisticas-${chave}`));
    return v ?? padrao;
  } catch {
    return padrao;
  }
}
export function salvarPref(chave, valor) {
  try { localStorage.setItem(`crm-estatisticas-${chave}`, JSON.stringify(valor)); } catch { /* ignora */ }
}

// Períodos fixos: hoje, ontem, últimos 3/7/30/90 dias (contando hoje) e personalizado (de/até, dias inteiros)
export const PERIODOS = ['hoje', 'ontem', '3', '7', '30', '90'];

function diaLocal(texto) {
  const [a, m, d] = String(texto || '').split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}
function somarDias(data, n) {
  const x = new Date(data);
  x.setDate(x.getDate() + n);
  return x;
}

export function janelaDoPeriodo(sel) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const amanha = somarDias(hoje, 1);
  if (sel?.tipo === 'personalizado') {
    const de = diaLocal(sel.de);
    const ate = diaLocal(sel.ate);
    if (de && ate && ate >= de) return { inicio: de, fim: somarDias(ate, 1) };
  }
  if (sel?.tipo === 'hoje') return { inicio: hoje, fim: amanha };
  if (sel?.tipo === 'ontem') return { inicio: somarDias(hoje, -1), fim: hoje };
  const n = Number(sel?.tipo) || 30;
  return { inicio: somarDias(hoje, -(n - 1)), fim: amanha };
}

// Escala do eixo: arredonda o máximo para um número "redondo"
export function topoBonito(max) {
  if (max <= 4) return 4;
  const ordem = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * ordem >= max) return m * ordem;
  return 10 * ordem;
}

// Etapas pelas quais o lead passou: a atual, as do histórico e a primeira etapa do kanban (todo lead nasce nela)
export function etapasDoLead(lead, primeiraEtapa) {
  const s = new Set(lead.p);
  s.add(lead.s);
  if (primeiraEtapa) s.add(primeiraEtapa);
  return s;
}
