// Horário comercial da equipe (atendimento humano de prontidão), no fuso configurado.

const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, 'sáb': 6 };

// Dia da semana (0 = domingo) e hora "HH:MM" no fuso
export function momentoNoFuso(data = new Date(), fuso = 'America/Sao_Paulo') {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(data)
      .map((p) => [p.type, p.value])
  );
  const dia = DIAS[String(partes.weekday || '').toLowerCase().replace('.', '')];
  return { dia, hora: `${partes.hour}:${partes.minute}` };
}

export function dentroDoHorario(cfg, data = new Date()) {
  const { dia, hora } = momentoNoFuso(data, cfg.fuso);
  const faixa = cfg.horario?.[dia];
  return Boolean(faixa && hora >= faixa.inicio && hora < faixa.fim);
}

// "bom dia" / "boa tarde" / "boa noite" no fuso
export function saudacaoDoMomento(cfg, data = new Date()) {
  const h = Number(momentoNoFuso(data, cfg.fuso).hora.slice(0, 2));
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// ------------------------------------------------------------------ janelas de envio (lembretes)

/**
 * Faixas de horário por dia da semana ({ 0..6: { inicio, fim } | null }) a partir de uma janela simples
 * (início, fim e dias) — o mesmo formato do horário comercial da IA.
 */
export function faixasDaJanela({ inicio, fim, dias }) {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, dias.includes(d) ? { inicio, fim } : null]));
}

/** O instante (ms) cai dentro das faixas? */
export function dentroDasFaixas(faixas, fuso, quandoMs) {
  const { dia, hora } = momentoNoFuso(new Date(quandoMs), fuso);
  const f = faixas?.[dia];
  return Boolean(f && hora >= f.inicio && hora < f.fim);
}

const PASSO = 5 * 60000;

/** Primeiro instante >= desdeMs dentro das faixas, procurando até `ateMs` (de 5 em 5 min). null se não achar. */
export function primeiroDentro(faixas, fuso, desdeMs, ateMs) {
  if (dentroDasFaixas(faixas, fuso, desdeMs)) return desdeMs;
  for (let t = Math.ceil(desdeMs / PASSO) * PASSO; t <= ateMs; t += PASSO) if (dentroDasFaixas(faixas, fuso, t)) return t;
  return null;
}

/** Último instante <= ateMs dentro das faixas, procurando até `desdeMs` (de 5 em 5 min). null se não achar. */
export function ultimoDentro(faixas, fuso, ateMs, desdeMs) {
  if (dentroDasFaixas(faixas, fuso, ateMs)) return ateMs;
  for (let t = Math.floor(ateMs / PASSO) * PASSO; t >= desdeMs; t -= PASSO) if (dentroDasFaixas(faixas, fuso, t)) return t;
  return null;
}
