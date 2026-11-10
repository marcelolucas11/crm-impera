// Estudo do tempo entre o Yay! Forms e o Calendly, para escolher quanto a IA espera antes da 1ª mensagem.
//
// Para cada lead do Yay! Forms que agendou reunião, mede (em minutos):
//  - duracao_formulario: início do formulário → fim do formulário (quanto a pessoa leva para responder tudo)
//  - cadastro_ate_fim:   1º aviso do formulário no CRM (é aqui que a espera da IA começa) → formulário completo
//  - fim_ate_agendar:    formulário completo → agendou no Calendly (horário do próprio Calendly)
//  - agendar_ate_crm:    agendou no Calendly → reunião apareceu no CRM (atraso da sincronização)
//  - cadastro_ate_agendar: 1º aviso → agendou no Calendly  (o que a espera precisa cobrir: o CRM confere o Calendly
//                          logo antes de enviar, então o atraso da sincronização não conta)
//  - cadastro_ate_crm:   1º aviso → reunião no CRM (como era antes da conferência na hora)
// A sugestão é o percentil 90 de "cadastro_ate_agendar" + 2 min de folga, arredondado para cima.
import { all } from '../../db.js';

const MIN = 60000;
// Quem agenda muito depois (outro dia) não é o caso de "está agendando agora": fica fora das contas da espera
export const LIMITE_AGENDOU_JA_MIN = 120;
// Reunião que entrou no CRM horas depois de agendada = carga antiga (CRM desligado, 1ª sincronização): não mede atraso
const LIMITE_ATRASO_CRM_MIN = 60;

const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);
const minutos = (de, ate) => {
  const a = ms(de);
  const b = ms(ate);
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / MIN : null;
};

export function percentil(valores, p) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p;
  const baixo = Math.floor(i);
  const alto = Math.ceil(i);
  return v[baixo] + (v[alto] - v[baixo]) * (i - baixo);
}

const arred = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

export function resumir(valores) {
  const v = valores.filter((x) => Number.isFinite(x) && x >= 0);
  if (!v.length) return { n: 0 };
  return {
    n: v.length,
    media: arred(v.reduce((a, b) => a + b, 0) / v.length),
    mediana: arred(percentil(v, 0.5)),
    p75: arred(percentil(v, 0.75)),
    p90: arred(percentil(v, 0.9)),
    p95: arred(percentil(v, 0.95)),
    maximo: arred(Math.max(...v)),
  };
}

/** Lê os leads do Yay! Forms dos últimos "dias" e devolve as medidas e a espera sugerida. */
export function estudarEsperaFormulario({ dias = 60, esperaAtualMin = null } = {}) {
  const desde = new Date(Date.now() - dias * 24 * 3600000).toISOString();
  const leads = all(
    `SELECT l.id, l.created_at, l.form_started_at,
            (SELECT min(e.created_at) FROM lead_events e WHERE e.lead_id = l.id AND e.type IN ('form_submitted', 'form_completed')) AS fim_form,
            (SELECT min(c.booked_at) FROM calendly_events c WHERE c.lead_id = l.id AND c.booked_at IS NOT NULL) AS agendou,
            (SELECT min(c.created_at) FROM calendly_events c WHERE c.lead_id = l.id) AS no_crm
       FROM leads l
      WHERE l.source = 'yayforms' AND l.created_at >= ?`,
    [desde]
  );

  const m = { duracao_formulario: [], cadastro_ate_fim: [], fim_ate_agendar: [], agendar_ate_crm: [], cadastro_ate_agendar: [], cadastro_ate_crm: [] };
  let completos = 0;
  let agendaram = 0;
  let agendaramDepois = 0;
  let cargaAntiga = 0;
  for (const l of leads) {
    if (l.fim_form) completos++;
    const duracao = minutos(l.form_started_at, l.fim_form);
    if (duracao !== null && duracao >= 0 && duracao < 180) m.duracao_formulario.push(duracao);
    const ateFim = minutos(l.created_at, l.fim_form);
    if (ateFim !== null && ateFim >= 0 && ateFim < 180) m.cadastro_ate_fim.push(ateFim);
    if (!l.agendou) continue;
    agendaram++;
    // Agendou antes do 1º aviso do formulário: o CRM já sabia da reunião (ou a pessoa agendou por outro caminho) — conta como 0
    const ateAgendar = Math.max(0, minutos(l.created_at, l.agendou) ?? NaN);
    if (!Number.isFinite(ateAgendar)) continue;
    if (ateAgendar > LIMITE_AGENDOU_JA_MIN) { agendaramDepois++; continue; }
    m.cadastro_ate_agendar.push(ateAgendar);
    const fimAgendar = minutos(l.fim_form, l.agendou);
    if (fimAgendar !== null && fimAgendar >= 0) m.fim_ate_agendar.push(fimAgendar);
    const atraso = minutos(l.agendou, l.no_crm);
    if (atraso === null) continue;
    if (atraso > LIMITE_ATRASO_CRM_MIN) { cargaAntiga++; continue; }
    m.agendar_ate_crm.push(Math.max(0, atraso));
    const ateCrm = minutos(l.created_at, l.no_crm);
    if (ateCrm !== null) m.cadastro_ate_crm.push(Math.max(0, ateCrm));
  }

  const medidas = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, resumir(v)]));
  const base = medidas.cadastro_ate_agendar;
  // Precisa de um mínimo de casos para sugerir; até lá, a sugestão é só uma referência
  const sugestao = base.n ? Math.min(120, Math.max(3, Math.ceil(base.p90 + 2))) : null;
  const cobertura = (min) => (base.n && Number.isFinite(min)
    ? Math.round((m.cadastro_ate_agendar.filter((x) => x <= min).length / base.n) * 100)
    : null);
  return {
    dias,
    leads_formulario: leads.length,
    completos,
    agendaram,
    agendaram_depois: agendaramDepois,
    limite_agendou_ja_min: LIMITE_AGENDOU_JA_MIN,
    excluidos_carga_antiga: cargaAntiga,
    medidas,
    sugestao_min: sugestao,
    poucos_dados: base.n < 10,
    // % de quem agendou "na hora" que já teria agendado quando a IA chamasse
    // Como era antes (1ª mensagem 1 a 2 min depois do cadastro, sem conferir o Calendly na hora)
    cobertura_antes: base.n ? Math.round((m.cadastro_ate_crm.filter((x) => x <= 1.5).length / Math.max(1, m.cadastro_ate_crm.length)) * 100) : null,
    espera_atual_min: esperaAtualMin,
    cobertura_atual: esperaAtualMin === null ? null : cobertura(Number(esperaAtualMin)),
    cobertura_sugestao: sugestao === null ? null : cobertura(sugestao),
  };
}
