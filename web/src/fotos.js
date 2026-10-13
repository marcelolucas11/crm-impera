// Fotos de perfil do WhatsApp. Os avatares visíveis na tela pedem em lote quais contatos têm foto;
// o servidor busca no WhatsApp aos poucos e avisa (evento "fotos") quando chegam fotos novas.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { ouvir } from './tempoReal.js';
import { rota } from './base.js';

const versoes = new Map(); // chave → versão (texto) ou null
const assinantes = new Map(); // chave → Set(setState)
const pendentes = new Set();
let timer = null;

function avisar(chave) {
  for (const fn of assinantes.get(chave) || []) fn(versoes.get(chave) ?? null);
}

function consultarEmLote() {
  timer = null;
  const chaves = [...pendentes].slice(0, 500);
  chaves.forEach((c) => pendentes.delete(c));
  if (pendentes.size) timer = setTimeout(consultarEmLote, 50);
  if (!chaves.length) return;
  api('/whatsapp/fotos/consultar', { method: 'POST', body: { chaves } })
    .then((d) => {
      for (const chave of chaves) {
        versoes.set(chave, d.fotos?.[chave] ?? null);
        avisar(chave);
      }
    })
    .catch(() => {});
}

function pedir(chave) {
  pendentes.add(chave);
  if (!timer) timer = setTimeout(consultarEmLote, 120);
}

// Chegaram fotos novas no servidor: pergunta de novo pelos contatos que ainda estão sem foto na tela
function aoChegarFotos() {
  for (const [chave, fns] of assinantes) {
    if (fns.size && !versoes.get(chave)) pedir(chave);
  }
}

let ouvindo = false;

export function useFoto(chave) {
  const [versao, setVersao] = useState(() => (chave ? versoes.get(chave) ?? null : null));
  useEffect(() => {
    if (!chave) return undefined;
    if (!ouvindo) { ouvindo = true; ouvir('fotos', aoChegarFotos); }
    setVersao(versoes.get(chave) ?? null);
    if (!assinantes.has(chave)) assinantes.set(chave, new Set());
    assinantes.get(chave).add(setVersao);
    if (!versoes.has(chave)) pedir(chave);
    return () => assinantes.get(chave)?.delete(setVersao);
  }, [chave]);
  return versao;
}

export const urlFoto = (chave, versao) => rota(`/api/whatsapp/fotos/${encodeURIComponent(chave)}?v=${versao}`);
