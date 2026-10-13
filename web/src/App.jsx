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

const PAGINAS = new Set(['kanban', 'whatsapp', 'disparos', 'estatisticas', 'equipe']);
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
  return <Sistema user={user} aoSair={() => { encerrarTempoReal(); setUser(null); }} />;
}

// Estrutura comum: barra do topo com as abas + a tela escolhida (tudo dentro do CRM, sem abrir abas no navegador)
function Sistema({ user, aoSair }) {
  const [pagina, setPaginaEstado] = useState(paginaInicial);
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');

  const setPagina = (p) => {
    setPaginaEstado(p);
    window.history.replaceState(null, '', `#${p}`);
  };

  const carregarEtapas = useCallback(() => api('/stages').then((d) => setStages(d.stages)).catch((e) => setErro(e.message)), []);
  const carregarResumo = useCallback(() => api('/followup/resumo').then(setResumo).catch(() => {}), []);

  useEffect(() => {
    carregarEtapas();
    api('/users').then((d) => setUsers(d.users)).catch(() => {});
    carregarResumo();
    const id = setInterval(() => { if (!document.hidden) carregarResumo(); }, 15000);
    return () => clearInterval(id);
  }, [carregarEtapas, carregarResumo]);

  // Mensagem nova: atualiza o contador da aba WhatsApp
  useEvento('whatsapp', (d) => { if (d?.chat || d?.reconectou) carregarResumo(); });

  const sair = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    aoSair();
  };

  const comum = { user, stages, users, horas: resumo?.horas || 24, carregarEtapas, aoMudarAlgo: carregarResumo, setErro };

  return (
    <div className="app">
      <Topo user={user} pagina={pagina} setPagina={setPagina} resumo={resumo} sair={sair} />
      {erro && <div className="faixa-erro" onClick={() => setErro('')}>{erro} <span>×</span></div>}
      {pagina === 'kanban' && <KanbanPagina {...comum} />}
      {pagina === 'whatsapp' && <WhatsAppPagina {...comum} />}
      {pagina === 'disparos' && <DisparosPagina />}
      {pagina === 'estatisticas' && <Estatisticas {...comum} />}
      {pagina === 'equipe' && <Equipe user={user} />}
      <ChamadaRecebida aoAbrirConversa={(chave) => {
        window.__waAbrir = chave;
        setPagina('whatsapp');
        setTimeout(() => window.dispatchEvent(new CustomEvent('wa-abrir', { detail: chave })), 50);
      }} />
    </div>
  );
}
