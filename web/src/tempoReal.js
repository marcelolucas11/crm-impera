// Atualização em tempo real: uma única conexão (/api/eventos) por aba, compartilhada pelas telas.
// O servidor só avisa "mudou algo em X"; quem escuta busca os dados de novo.
import { useEffect, useRef } from 'react';
import { rota } from './base.js';
import { coletarSensiveis } from './modoLive.js';

let fonte = null;
const ouvintes = new Map(); // tipo → Set(funções)
const anexados = new Set();
let caiu = false;
let conectadoDesde = 0;

function despachar(tipo, dados) {
  coletarSensiveis(dados); // Modo Live: avisos também podem trazer nome/telefone de lead
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
    conectadoDesde = Date.now();
  };
  fonte.onerror = () => { caiu = true; conectadoDesde = 0; };
}

export function encerrarTempoReal() {
  fonte?.close();
  fonte = null;
  conectadoDesde = 0;
  anexados.clear();
}

// Avisos seguidos do mesmo tipo chegam juntos: o último no formato de sempre e todos em "lote".
// itensDoAviso devolve cada aviso do grupo; avisoTem(d, 'conversa', 12) confere se algum deles é sobre a conversa 12.
export const itensDoAviso = (d) => (Array.isArray(d?.lote) ? d.lote : [d || {}]);
export const avisoTem = (d, campo, valor) => itensDoAviso(d).some((x) => (valor === undefined ? Boolean(x?.[campo]) : x?.[campo] === valor));

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

// O tempo real está de pé? (conexão aberta e sem queda desde então)
export const tempoRealConectado = () => Boolean(fonte && fonte.readyState === 1 && !caiu && conectadoDesde);

// Atualização de segurança (polling) que respeita o tempo real e a aba escondida:
//  - aba escondida: não busca nada (ao voltar para a aba, busca na hora se já passou do prazo);
//  - tempo real conectado: os avisos já trazem as mudanças, então só confere a cada `comTempoReal` ms (padrão 3 min);
//  - tempo real caído: volta a conferir a cada `semTempoReal` ms.
// Antes cada tela tinha o seu setInterval de 10–30 s rodando o dia todo, mesmo com o tempo real funcionando.
export function useAtualizacaoPeriodica(fn, { semTempoReal = 30000, comTempoReal = 180000, ligado = true } = {}) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ligado) return undefined;
    let ultima = Date.now();
    const conferir = () => {
      if (document.hidden) return;
      const prazo = tempoRealConectado() ? comTempoReal : semTempoReal;
      if (Date.now() - ultima < prazo) return;
      ultima = Date.now();
      ref.current();
    };
    const id = setInterval(conferir, Math.min(semTempoReal, 30000));
    const aoVoltar = () => { if (!document.hidden) conferir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [semTempoReal, comTempoReal, ligado]);
}
