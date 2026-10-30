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

const PAGINAS = new Set(['kanban', 'whatsapp', 'disparos', 'ia', 'estatisticas', 'equipe']);
const paginaInicial = () => {
  const p = window.location.hash.replace('#', '');
  return PAGINAS.has(p) ? p : 'kanban';
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
  const [pagina, setPaginaEstado] = useState(paginaInicial);
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [pedidoDisparo, setPedidoDisparo] = useState(null);

  const setPagina = (p) => {
    setPaginaEstado(p);
    window.history.replaceState(null, '', `#${p}`);
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

  // Abre uma conversa na tela de WhatsApp (chamada recebida, aviso da IA, lista da tela IA)
  const abrirConversa = (chave) => {
    window.__waAbrir = chave;
    setPagina('whatsapp');
    setTimeout(() => window.dispatchEvent(new CustomEvent('wa-abrir', { detail: chave })), 50);
  };

  const sair = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    aoSair();
  };

  const comum = { user, stages, users, horas: resumo?.horas || 24, carregarEtapas, aoMudarAlgo: carregarResumo, setErro };
  // Público criado no kanban → abre Disparos com ele já escolhido
  const usarPublico = (lista) => { setPedidoDisparo(lista); setPagina('disparos'); };
  // Minha foto mudou (menu do avatar): atualiza o topo e a lista da equipe (fotos nos cartões)
  const aoMudarMinhaFoto = (u) => { aoMudarUser({ ...user, foto: u.foto }); carregarUsuarios(); };

  return (
    <div className="app">
      <Topo user={user} pagina={pagina} setPagina={setPagina} resumo={resumo} sair={sair} aoMudarFoto={aoMudarMinhaFoto} setErro={setErro} />
      {erro && <div className="faixa-erro" onClick={() => setErro('')}>{erro} <span>×</span></div>}
      {pagina === 'kanban' && <KanbanPagina {...comum} usarPublico={usarPublico} />}
      {pagina === 'whatsapp' && <WhatsAppPagina {...comum} />}
      {pagina === 'disparos' && <DisparosPagina pedidoLista={pedidoDisparo} aoConsumirPedido={() => setPedidoDisparo(null)} />}
      {pagina === 'ia' && <IaPagina user={user} aoAbrirConversa={abrirConversa} />}
      {pagina === 'estatisticas' && <Estatisticas {...comum} />}
      {pagina === 'equipe' && <Equipe user={user} aoMudarUsuarios={(lista) => {
        setUsers(lista);
        const eu = lista.find((u) => u.id === user.id);
        if (eu && eu.foto !== user.foto) aoMudarUser({ ...user, foto: eu.foto });
      }} />}
      <ChamadaRecebida aoAbrirConversa={abrirConversa} />
      <AvisoPassagem aoAbrir={abrirConversa} />
    </div>
  );
}
