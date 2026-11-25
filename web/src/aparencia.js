// Aparência × desempenho: efeitos visuais que pesam no computador e ficam desligados por padrão.
// Fica salvo só neste navegador (como o Modo Live) e vale para todas as abas abertas.
//  - fundoAnimado: o logo 3D do kanban se mexe e segue o mouse. Desligado, ele é desenhado uma vez e fica parado
//    (mesma imagem, sem gastar processador/placa de vídeo a cada quadro).
//  - vidroAvancado: refração da luz nas bordas do vidro (só Chrome/Edge) e desfoque em todos os painéis de todas as
//    telas. Desligado, o desfoque fica onde há algo atrás para desfocar (logo 3D, janelas e menus por cima).
import { useSyncExternalStore } from 'react';

const CHAVE = 'crm-aparencia';
const PADRAO = { fundoAnimado: false, vidroAvancado: false };

function ler() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (salvo && typeof salvo === 'object') return { ...PADRAO, ...salvo };
  } catch { /* navegador sem armazenamento */ }
  return { ...PADRAO };
}

let config = ler();
const ouvintes = new Set();

function aplicar() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('lg-vidro-avancado', Boolean(config.vidroAvancado));
}

export function configAparencia() { return config; }

export function definirAparencia(parcial) {
  config = { ...config, ...parcial };
  try { localStorage.setItem(CHAVE, JSON.stringify(config)); } catch { /* sem armazenamento */ }
  aplicar();
  for (const fn of ouvintes) { try { fn(); } catch { /* ignora */ } }
}

export function useAparencia() {
  return useSyncExternalStore(
    (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    () => config,
  );
}

// Outras abas do mesmo navegador mudaram a escolha
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CHAVE) return;
    config = ler();
    aplicar();
    for (const fn of ouvintes) { try { fn(); } catch { /* ignora */ } }
  });
}

aplicar();
