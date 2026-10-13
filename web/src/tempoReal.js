// Atualização em tempo real: uma única conexão (/api/eventos) por aba, compartilhada pelas telas.
// O servidor só avisa "mudou algo em X"; quem escuta busca os dados de novo.
import { useEffect, useRef } from 'react';
import { rota } from './base.js';

let fonte = null;
const ouvintes = new Map(); // tipo → Set(funções)
const anexados = new Set();
let caiu = false;

function despachar(tipo, dados) {
  for (const fn of ouvintes.get(tipo) || []) {
    try { fn(dados); } catch { /* um ouvinte com erro não derruba os outros */ }
  }
}

function anexar(tipo) {
  if (!fonte || anexados.has(tipo)) return;
  anexados.add(tipo);
  fonte.addEventListener(tipo, (ev) => {
    let dados = {};
    try { dados = JSON.parse(ev.data); } catch { /* sem dados */ }
    despachar(tipo, dados);
  });
}

function garantirConexao() {
  if (fonte || typeof EventSource === 'undefined') return;
  fonte = new EventSource(rota('/api/eventos'));
  anexados.clear();
  for (const tipo of ouvintes.keys()) anexar(tipo);
  fonte.onopen = () => {
    // Voltou depois de cair: pode ter perdido avisos, então todo mundo recarrega
    if (caiu) for (const tipo of ouvintes.keys()) despachar(tipo, { reconectou: true });
    caiu = false;
  };
  fonte.onerror = () => { caiu = true; };
}

export function encerrarTempoReal() {
  fonte?.close();
  fonte = null;
  anexados.clear();
}

// Versão sem React: devolve a função para parar de ouvir
export function ouvir(tipo, fn) {
  if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
  ouvintes.get(tipo).add(fn);
  garantirConexao();
  anexar(tipo);
  return () => ouvintes.get(tipo)?.delete(fn);
}

// Chama fn sempre que o servidor avisar uma mudança do tipo indicado
export function useEvento(tipo, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const ouvinte = (d) => ref.current(d);
    if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
    ouvintes.get(tipo).add(ouvinte);
    garantirConexao();
    anexar(tipo);
    return () => ouvintes.get(tipo)?.delete(ouvinte);
  }, [tipo]);
}
