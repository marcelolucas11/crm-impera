// Service worker do CRM-IMPERA (app instalado / PWA).
// - Notificações: recebe o aviso do servidor e mostra no padrão do aparelho (iPhone, Android, computador).
// - Toque na notificação: abre o CRM (ou traz para a frente) já na lista de reuniões com a ficha do lead.
// - Sem internet: mostra uma página simples em vez da tela de erro do navegador.
// Não guarda dados do CRM no aparelho: a API sempre vai direto ao servidor.
const VERSAO = 'crm-impera-v1';
const OFFLINE = 'offline.html';
const ICONE = 'icones/icone-192.png';
const SELO = 'icones/selo-96.png';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll([OFFLINE, ICONE, SELO])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Só a abertura de telas passa por aqui (nunca a API): tenta a rede e, sem conexão, mostra a página offline
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
});

// ---------- Notificações ----------
const doisDigitos = (n) => String(n).padStart(2, '0');
const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Data e hora da reunião no fuso deste aparelho: "hoje, 16/11 às 14:00", "amanhã, 17/11 às 09:30", "qua., 19/11 às 15:00"
function quandoReuniao(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86400000);
  const data = `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}`;
  let hora;
  try { hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { hora = `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`; }
  let dia;
  if (mesmoDia(d, hoje)) dia = `hoje, ${data}`;
  else if (mesmoDia(d, amanha)) dia = `amanhã, ${data}`;
  else {
    let semana = '';
    try { semana = d.toLocaleDateString('pt-BR', { weekday: 'short' }); } catch { /* sem Intl */ }
    dia = semana ? `${semana} ${data}` : data;
  }
  return `${dia} às ${hora}`;
}

function textoAviso(d) {
  if (d.tipo === 'reuniao' && d.inicio) {
    const linhas = [`${d.nome || 'Lead'} — ${quandoReuniao(d.inicio)}`];
    if (d.nicho) linhas.push(`Nicho: ${d.nicho}`);
    return linhas.join('\n');
  }
  return d.corpo || '';
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'CRM-IMPERA';
  const opcoes = {
    body: textoAviso(d),
    icon: ICONE,
    badge: SELO,
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    timestamp: Date.parse(d.enviado_em || '') || Date.now(),
    vibrate: [120, 60, 120],
    data: { url: d.url || './#kanban', lead_id: d.lead_id || null, tipo: d.tipo || null },
  };
  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const dados = e.notification.data || {};
  const destino = new URL(dados.url || './#kanban', self.registration.scope).href;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const doCrm = janelas.find((c) => c.url.startsWith(self.registration.scope));
    if (doCrm) {
      // CRM já aberto: avisa a tela para abrir a reunião e traz a janela para a frente
      doCrm.postMessage({ tipo: 'crm-abrir', url: destino, lead_id: dados.lead_id, aviso: dados.tipo });
      try { await doCrm.focus(); return; } catch { /* alguns aparelhos não deixam focar: abre de novo */ }
    }
    await self.clients.openWindow(destino);
  })());
});

// O navegador trocou a inscrição sozinho (expirou): inscreve de novo com a mesma chave e avisa o servidor
self.addEventListener('pushsubscriptionchange', (e) => {
  const chave = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey;
  if (!chave) return;
  e.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })
      .then((nova) => fetch(new URL('api/notificacoes/inscrever', self.registration.scope).href, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao: nova.toJSON(), aparelho: 'Aparelho (renovado)' }),
      }))
      .catch(() => {})
  );
});
