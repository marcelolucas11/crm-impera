// Formatação de telefone, tempo e iniciais

export function formatarTelefone(digitos) {
  if (!digitos) return '';
  const d = String(digitos);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    return `(${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
  }
  return `+${d}`;
}

export function linkWhatsApp(digitos) {
  return digitos ? `https://wa.me/${digitos}` : null;
}

export function tempoDesde(data) {
  if (!data) return '';
  const min = Math.max(0, Math.floor((Date.now() - new Date(data).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

export function dataHora(data) {
  if (!data) return '';
  return new Date(data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function iniciais(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}
