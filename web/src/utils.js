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

export function dataCurta(data) {
  if (!data) return '';
  const d = new Date(data);
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86400000);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
  if (d.toDateString() === amanha.toDateString()) return `amanhã ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

export function horaMensagem(data) {
  if (!data) return '';
  const d = new Date(data);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

export function iniciais(nome) {
  if (!nome) return '?';
  const partes = nome.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '#';
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}
