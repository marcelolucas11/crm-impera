// O que a IA sabe do formulário do lead: se preencheu parcial ou completo, se tem reunião marcada no Calendly
// e as respostas (pergunta: resposta). Telefone e e-mail ficam de fora: a IA não precisa deles.
import { get } from '../../db.js';
import { lerJson } from '../../events.js';

const PARECE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARECE_TELEFONE = /^[+()\-.\s\d]{8,22}$/;

function dataDaReuniao(iso, fuso) {
  try {
    const d = new Date(iso);
    const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: '2-digit', month: '2-digit' }).format(d);
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(d);
    return `${dia} às ${hora}`;
  } catch {
    return iso;
  }
}

/** Devolve null quando o lead não veio de formulário (ou não existe). */
export function dadosDoFormulario(leadId, cfg) {
  if (!leadId) return null;
  const lead = get('SELECT extra, source FROM leads WHERE id = ?', [leadId]);
  if (!lead) return null;
  const extra = lerJson(lead.extra) || {};
  const respostasBrutas = Array.isArray(extra.respostas) ? extra.respostas : [];
  if (lead.source !== 'yayforms' && !respostasBrutas.length) return null;

  const respostas = respostasBrutas
    .filter((r) => {
      const tipo = String(r?.tipo || '').toLowerCase();
      const valor = String(r?.valor || '').trim();
      if (!valor || tipo.includes('phone') || tipo.includes('email') || tipo.includes('tel')) return false;
      return !PARECE_EMAIL.test(valor) && !PARECE_TELEFONE.test(valor);
    })
    .map((r) => ({ titulo: r.titulo, valor: r.valor }));

  let reuniao = null;
  try {
    const ev = get(
      "SELECT start_time FROM calendly_events WHERE lead_id = ? AND status = 'active' AND start_time >= ? ORDER BY start_time LIMIT 1",
      [leadId, new Date(Date.now() - 2 * 3600000).toISOString()]
    );
    if (ev) reuniao = dataDaReuniao(ev.start_time, cfg?.fuso || 'America/Sao_Paulo');
  } catch { /* sem Calendly */ }

  const situacao = extra.parcial ? 'parcial' : reuniao ? 'completo_com_reuniao' : 'completo_sem_reuniao';
  return { situacao, reuniao, respostas };
}
