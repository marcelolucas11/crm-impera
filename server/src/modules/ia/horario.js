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
