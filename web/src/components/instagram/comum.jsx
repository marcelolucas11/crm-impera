// Peças pequenas usadas em várias telas do Instagram
import { useState } from 'react';
import { Camera as IconeInstagram } from 'lucide-react';
import { rota } from '../../base.js';
import { iniciais } from '../../utils.js';

/** Foto de quem conversa no Direct (baixada pelo CRM) ou as iniciais */
export function FotoContato({ conversa, tamanho = 49 }) {
  const [erro, setErro] = useState(false);
  const nome = conversa?.nome || conversa?.username || '';
  const comFoto = conversa?.foto && !erro;
  return (
    <span className={`foto-perfil ig-foto-contato ${conversa?.lead_id ? 'foto-perfil-lead' : ''} ${comFoto ? 'com-foto' : ''}`}
      style={{ width: tamanho, height: tamanho, flexBasis: tamanho, fontSize: Math.max(10, Math.round(tamanho * 0.34)) }} aria-hidden="true">
      {comFoto
        ? <img src={rota(`/api/instagram/conversas/${conversa.id}/foto`)} alt="" onError={() => setErro(true)} draggable={false} />
        : nome ? iniciais(nome.replace(/^@/, '')) : <IconeInstagram size={Math.round(tamanho * 0.45)} />}
    </span>
  );
}

export const nomeDaConversa = (c) => c?.nome || (c?.username ? `@${c.username}` : 'Instagram');

// Casas decimais só quando vier um número (as tabelas chamam formatar(valor, linha))
const casasValidas = (c, padrao) => (Number.isInteger(c) && c >= 0 && c <= 6 ? c : padrao);

/** 12345 → "12.345" · null → "—" */
export const numero = (n, casas = 0) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
  ? '—'
  : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casasValidas(casas, 0), minimumFractionDigits: 0 }));

/** 0.0534 → "5,3%" */
export const porcento = (n, casas = 1) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
  ? '—'
  : `${(Number(n) * 100).toLocaleString('pt-BR', { maximumFractionDigits: casasValidas(casas, 1), minimumFractionDigits: 0 })}%`);

/** 12345 → "12,3 mil" (números grandes nos cartões) */
export function compacto(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e4) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** Valor em reais (gasto dos anúncios) */
export const reais = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
  ? '—'
  : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }));

/** Miniatura de uma publicação (o CRM guarda uma cópia, porque os links da Meta expiram) */
export function Miniatura({ post, tamanho = 56, className = '' }) {
  const [erro, setErro] = useState(false);
  return (
    <span className={`ig-miniatura ${className}`} style={{ width: tamanho, height: tamanho, flexBasis: tamanho }}>
      {!erro && post?.id && post.miniatura !== false
        ? <img src={rota(`/api/instagram/posts/${encodeURIComponent(post.id)}/miniatura`)} alt="" loading="lazy" onError={() => setErro(true)} />
        : <IconeInstagram size={Math.round(tamanho * 0.4)} />}
    </span>
  );
}

/** Período no formato da API: últimos N dias ou de/até (dias inteiros no fuso do navegador) */
export function paramsDoPeriodo(periodo, perfil) {
  const p = new URLSearchParams();
  if (perfil) p.set('perfil', perfil);
  if (periodo.tipo === 'personalizado' && periodo.de && periodo.ate) {
    const [a1, m1, d1] = periodo.de.split('-').map(Number);
    const [a2, m2, d2] = periodo.ate.split('-').map(Number);
    p.set('inicio', new Date(a1, m1 - 1, d1).toISOString());
    p.set('fim', new Date(a2, m2 - 1, d2 + 1).toISOString());
  } else p.set('dias', String(periodo.dias || 30));
  return p;
}
