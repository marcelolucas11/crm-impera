// App instalado (PWA): service worker, botão "Instalar app" e notificações no aparelho.
// iPhone/iPad: as notificações só funcionam com o CRM adicionado à Tela de Início (Safari → Compartilhar →
// Adicionar à Tela de Início) e aberto por lá, no iOS 16.4 ou mais novo. Android e computador: funcionam também no navegador.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { BASE, rota } from './base.js';

const temSW = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
const seguro = typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost');

let registro = null;
let pedidoInstalacao = null; // evento "beforeinstallprompt" guardado (Android e computador)
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((fn) => fn());

export function registrarServiceWorker() {
  if (!temSW || !seguro) return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalacao = e; avisar(); });
  window.addEventListener('appinstalled', () => { pedidoInstalacao = null; avisar(); });
  // Toque numa notificação com o CRM já aberto: o service worker pede para abrir a reunião
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo !== 'crm-abrir') return;
    window.dispatchEvent(new CustomEvent('crm-notificacao', { detail: e.data }));
  });
  const iniciar = () => {
    navigator.serviceWorker.register(rota('/sw.js'), { scope: `${BASE}/` })
      .then((r) => { registro = r; avisar(); r.update?.().catch(() => {}); })
      .catch((err) => console.warn('[pwa] service worker não registrou:', err?.message));
  };
  if (document.readyState === 'complete') iniciar(); else window.addEventListener('load', iniciar, { once: true });
}

// ---------- Ambiente ----------
export const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const ehAndroid = () => /android/i.test(navigator.userAgent);
export const instaladoComoApp = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const suportaNotificacoes = () => temSW && seguro && 'PushManager' in window && 'Notification' in window;

/** Nome amigável do aparelho para a lista de aparelhos ("iPhone (app)", "Android · Chrome", "Mac · Safari") */
export function nomeAparelho() {
  const ua = navigator.userAgent;
  let base = 'Computador';
  if (/iphone/i.test(ua)) base = 'iPhone';
  else if (/ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) base = 'iPad';
  else if (/android/i.test(ua)) base = /mobile/i.test(ua) ? 'Android' : 'Tablet Android';
  else if (/mac os x|macintosh/i.test(ua)) base = 'Mac';
  else if (/windows/i.test(ua)) base = 'Windows';
  else if (/linux/i.test(ua)) base = 'Linux';
  let nav = '';
  if (/edg\//i.test(ua)) nav = 'Edge';
  else if (/samsungbrowser/i.test(ua)) nav = 'Samsung Internet';
  else if (/firefox|fxios/i.test(ua)) nav = 'Firefox';
  else if (/chrome|crios/i.test(ua)) nav = 'Chrome';
  else if (/safari/i.test(ua)) nav = 'Safari';
  return instaladoComoApp() ? `${base} (app)` : `${base}${nav ? ` · ${nav}` : ''}`;
}

// ---------- Instalação ----------
function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
const fotoInstalacao = () => `${Boolean(pedidoInstalacao)}|${instaladoComoApp()}`;

/** { podeInstalar, instalado, ios, instalar() } — podeInstalar = o navegador oferece o botão (Android/computador) */
export function useInstalacao() {
  useSyncExternalStore(assinar, fotoInstalacao);
  return {
    podeInstalar: Boolean(pedidoInstalacao),
    instalado: instaladoComoApp(),
    ios: ehIOS(),
    android: ehAndroid(),
    instalar: async () => {
      if (!pedidoInstalacao) return false;
      pedidoInstalacao.prompt();
      const r = await pedidoInstalacao.userChoice.catch(() => null);
      pedidoInstalacao = null;
      avisar();
      return r?.outcome === 'accepted';
    },
  };
}

// ---------- Notificações ----------
async function registroPronto() {
  if (registro) return registro;
  if (!temSW) throw new Error('Este navegador não tem suporte a notificações de app.');
  registro = await navigator.serviceWorker.ready;
  return registro;
}

function chaveParaBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const bruto = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

/** Estado das notificações neste aparelho: 'sem-suporte' | 'precisa-instalar' | 'bloqueado' | 'desligado' | 'ligado' */
export async function estadoNotificacoes() {
  if (!suportaNotificacoes()) return ehIOS() && !instaladoComoApp() ? 'precisa-instalar' : 'sem-suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  try {
    const r = await registroPronto();
    const insc = await r.pushManager.getSubscription();
    return insc && Notification.permission === 'granted' ? 'ligado' : 'desligado';
  } catch {
    return 'desligado';
  }
}

/** Pede a permissão (precisa vir de um toque do usuário), inscreve o aparelho e avisa o servidor */
export async function ligarNotificacoes() {
  if (!suportaNotificacoes()) {
    throw new Error(ehIOS() && !instaladoComoApp()
      ? 'No iPhone/iPad, instale o CRM na Tela de Início (Safari → Compartilhar → Adicionar à Tela de Início) e abra por lá para ligar as notificações.'
      : 'Este navegador não tem suporte a notificações. Use o Chrome (Android/computador) ou o app instalado no iPhone.');
  }
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    throw new Error(permissao === 'denied'
      ? 'As notificações foram bloqueadas para o CRM neste aparelho. Libere nos Ajustes do aparelho (Notificações → CRM-IMPERA) ou nas permissões do site e tente de novo.'
      : 'Permissão não concedida. Toque de novo e escolha "Permitir".');
  }
  const r = await registroPronto();
  const { chave_publica: chave } = await api('/notificacoes/chave');
  let insc = await r.pushManager.getSubscription();
  // Inscrição feita com outra chave (servidor novo ou banco restaurado): troca por uma nova
  if (insc) {
    const atual = insc.options?.applicationServerKey;
    const mesma = atual && btoa(String.fromCharCode(...new Uint8Array(atual))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === chave.replace(/=+$/, '');
    if (atual && !mesma) { await insc.unsubscribe().catch(() => {}); insc = null; }
  }
  if (!insc) insc = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) });
  return api('/notificacoes/inscrever', { method: 'POST', body: { inscricao: insc.toJSON(), aparelho: nomeAparelho() } });
}

export async function desligarNotificacoes() {
  const r = await registroPronto();
  const insc = await r.pushManager.getSubscription();
  if (!insc) return;
  await api('/notificacoes/cancelar', { method: 'POST', body: { endpoint: insc.endpoint } }).catch(() => {});
  await insc.unsubscribe().catch(() => {});
}

/** Renova a inscrição no servidor quando o app abre (ex.: o servidor apagou depois de uma falha). Silencioso. */
export async function renovarInscricao() {
  try {
    if (!suportaNotificacoes() || Notification.permission !== 'granted') return;
    const r = await registroPronto();
    const insc = await r.pushManager.getSubscription();
    if (insc) await api('/notificacoes/inscrever', { method: 'POST', body: { inscricao: insc.toJSON(), aparelho: nomeAparelho() } });
  } catch { /* tenta na próxima abertura */ }
}

/** Hook com o estado das notificações deste aparelho (e uma função para conferir de novo) */
export function useNotificacoesAparelho() {
  const [estado, setEstado] = useState('carregando');
  const conferir = () => estadoNotificacoes().then(setEstado).catch(() => setEstado('sem-suporte'));
  useEffect(() => { conferir(); }, []);
  return [estado, conferir];
}
