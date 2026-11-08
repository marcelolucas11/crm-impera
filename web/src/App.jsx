import { useCallback, useEffect, useState } from 'react';
import { api, definirAoDeslogar } from './api.js';
import { useEvento, encerrarTempoReal } from './tempoReal.js';
import Login from './components/Login.jsx';
import Topo from './components/Topo.jsx';
import KanbanPagina from './components/KanbanPagina.jsx';
import WhatsAppPagina from './components/WhatsAppPagina.jsx';
import Estatisticas from './components/Estatisticas.jsx';
import DisparosPagina from './components/disparos/DisparosPagina.jsx';
import Equipe from './components/Equipe.jsx';
import ChamadaRecebida from './components/ChamadaRecebida.jsx';
import IaPagina from './components/ia/IaPagina.jsx';
import AvisoPassagem from './components/ia/AvisoPassagem.jsx';
import InstagramPagina from './components/instagram/InstagramPagina.jsx';
import AvisoInstagram from './components/instagram/AvisoInstagram.jsx';
import { pode, podeVer, primeiraPagina } from './permissoes.js';

const PAGINAS = new Set(['kanban', 'whatsapp', 'instagram', 'disparos', 'ia', 'estatisticas', 'equipe']);
const paginaInicial = (user) => {
  const p = window.location.hash.replace('#', '').split('/')[0];
  return PAGINAS.has(p) && podeVer(user, p) ? p : primeiraPagina(user);
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = carregando, null = deslogado

  useEffect(() => {
    definirAoDeslogar(() => { encerrarTempoReal(); setUser(null); });
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="tela-cheia"><div className="carregando" /></div>;
  if (!user) return <Login aoEntrar={setUser} />;
  return <Sistema user={user} aoMudarUser={setUser} aoSair={() => { encerrarTempoReal(); setUser(null); }} />;
}

// Estrutura comum: barra do topo com as abas + a tela escolhida (tudo dentro do CRM, sem abrir abas no navegador)
function Sistema({ user, aoMudarUser, aoSair }) {
  const [pagina, setPaginaEstado] = useState(() => paginaInicial(user));
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [pedidoDisparo, setPedidoDisparo] = useState(null);

  const setPagina = (p) => {
    // Tela sem permissão (link antigo, permissão retirada): vai para a primeira liberada
    const destino = podeVer(user, p) ? p : primeiraPagina(user);
    setPaginaEstado(destino);
    window.history.replaceState(null, '', `${window.location.pathname}#${destino}`);
  };

  const carregarEtapas = useCallback(() => api('/stages').then((d) => setStages(d.stages)).catch((e) => setErro(e.message)), []);
  const carregarResumo = useCallback(() => api('/followup/resumo').then(setResumo).catch(() => {}), []);
  const carregarUsuarios = useCallback(() => api('/users').then((d) => setUsers(d.users)).catch(() => {}), []);

  useEffect(() => {
    carregarEtapas();
    carregarUsuarios();
    carregarResumo();
    const id = setInterval(() => { if (!document.hidden) carregarResumo(); }, 15000);
    return () => clearInterval(id);
  }, [carregarEtapas, carregarResumo, carregarUsuarios]);

  // Mensagem nova: atualiza o contador da aba WhatsApp
  useEvento('whatsapp', (d) => { if (d?.chat || d?.reconectou) carregarResumo(); });

  // Abre uma conversa: WhatsApp (chamada recebida, aviso da IA, lista da tela IA) ou Instagram (chave ig:<id>)
  const abrirConversa = useCallback((chave) => {
    if (String(chave || '').startsWith('ig:')) {
      window.__igAbrir = Number(String(chave).slice(3));
      setPagina('instagram');
      setTimeout(() => window.dispatchEvent(new CustomEvent('ig-abrir', { detail: window.__igAbrir })), 50);
      return;
    }
    window.__waAbrir = chave;
    setPagina('whatsapp');
    setTimeout(() => window.dispatchEvent(new CustomEvent('wa-abrir', { detail: chave })), 50);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Outras telas (ficha do lead no kanban) pedem para abrir uma conversa
  useEffect(() => {
    const ouvir = (e) => abrirConversa(e.detail);
    window.addEventListener('crm-abrir-conversa', ouvir);
    return () => window.removeEventListener('crm-abrir-conversa', ouvir);
  }, [abrirConversa]);

  const sair = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    aoSair();
  };

  const comum = { user, stages, users, horas: resumo?.horas || 24, carregarEtapas, aoMudarAlgo: carregarResumo, setErro };
  // Público criado no kanban → abre Disparos com ele já escolhido
  const usarPublico = (lista) => { setPedidoDisparo(lista); setPagina('disparos'); };
  // Minha foto mudou (seção Minha conta): atualiza o topo e a lista da equipe (fotos nos cartões)
  const aoMudarMinhaFoto = (u) => { aoMudarUser({ ...user, foto: u.foto }); carregarUsuarios(); };

  return (
    <div className="app">
      <Topo user={user} pagina={pagina} setPagina={setPagina} resumo={resumo} sair={sair} />
      {erro && <div className="faixa-erro" onClick={() => setErro('')}>{erro} <span>×</span></div>}
      {pagina === 'kanban' && <KanbanPagina {...comum} usarPublico={usarPublico} />}
      {pagina === 'whatsapp' && <WhatsAppPagina {...comum} />}
      {pagina === 'instagram' && <InstagramPagina {...comum} aoAbrirConversa={abrirConversa} />}
      {pagina === 'disparos' && <DisparosPagina pedidoLista={pedidoDisparo} aoConsumirPedido={() => setPedidoDisparo(null)} />}
      {pagina === 'ia' && <IaPagina user={user} aoAbrirConversa={abrirConversa} />}
      {pagina === 'estatisticas' && <Estatisticas {...comum} />}
      {pagina === 'equipe' && <Equipe user={user} aoMudarMinhaFoto={aoMudarMinhaFoto} aoMudarUsuarios={(lista) => {
        setUsers(lista);
        const eu = lista.find((u) => u.id === user.id);
        if (eu && eu.foto !== user.foto) aoMudarUser({ ...user, foto: eu.foto });
      }} />}
      {podeVer(user, 'whatsapp') && <ChamadaRecebida aoAbrirConversa={abrirConversa} />}
      <AvisoPassagem aoAbrir={abrirConversa} />
      {pode(user, 'instagram') && <AvisoInstagram aoAbrir={abrirConversa} />}
    </div>
  );
}
