import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, definirAoDeslogar } from './api.js';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import Kanban from './components/Kanban.jsx';
import LeadPanel from './components/LeadPanel.jsx';
import NovoLead from './components/NovoLead.jsx';
import Equipe from './components/Equipe.jsx';

const ATUALIZAR_A_CADA_MS = 30000;

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = carregando, null = deslogado
  const [pagina, setPagina] = useState('kanban');

  useEffect(() => {
    definirAoDeslogar(() => setUser(null));
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  const sair = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  if (user === undefined) return <div className="tela-cheia"><div className="carregando" /></div>;
  if (!user) return <Login aoEntrar={setUser} />;

  return pagina === 'equipe'
    ? <Equipe user={user} voltar={() => setPagina('kanban')} sair={sair} />
    : <Painel user={user} irParaEquipe={() => setPagina('equipe')} sair={sair} />;
}

function Painel({ user, irParaEquipe, sair }) {
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [horas, setHoras] = useState(24);
  const [busca, setBusca] = useState('');
  const [soAtrasados, setSoAtrasados] = useState(false);
  const [soMeus, setSoMeus] = useState(false);
  const [aberto, setAberto] = useState(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');
  const buscaRef = useRef(busca);
  buscaRef.current = busca;

  const carregarLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (buscaRef.current.trim()) params.set('q', buscaRef.current.trim());
    if (soMeus) params.set('responsavel', 'eu');
    try {
      const d = await api(`/leads?${params}`);
      setLeads(d.leads);
      setHoras(d.followup_horas);
      setErro('');
    } catch (e) {
      setErro(e.message);
    }
  }, [soMeus]);

  useEffect(() => {
    api('/stages').then((d) => setStages(d.stages)).catch((e) => setErro(e.message));
    api('/users').then((d) => setUsers(d.users)).catch(() => {});
  }, []);

  // Recarrega ao mudar filtros (com pequena espera na busca)
  useEffect(() => {
    const t = setTimeout(carregarLeads, 250);
    return () => clearTimeout(t);
  }, [busca, carregarLeads]);

  // Atualização automática para novos leads aparecerem sozinhos
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) carregarLeads(); }, ATUALIZAR_A_CADA_MS);
    return () => clearInterval(id);
  }, [carregarLeads]);

  const atrasados = useMemo(() => leads.filter((l) => l.followup_overdue).length, [leads]);
  const visiveis = useMemo(() => (soAtrasados ? leads.filter((l) => l.followup_overdue) : leads), [leads, soAtrasados]);

  const mover = async (leadId, stageId) => {
    const anterior = leads;
    const etapa = stages.find((s) => s.id === stageId);
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, stage_id: stageId, stage_name: etapa?.name, stage_kind: etapa?.kind } : l)));
    try {
      const d = await api(`/leads/${leadId}`, { method: 'PATCH', body: { stage_id: stageId } });
      setLeads((ls) => ls.map((l) => (l.id === leadId ? d.lead : l)));
    } catch (e) {
      setLeads(anterior);
      setErro(e.message);
    }
  };

  const aoAtualizar = (lead) => {
    if (!lead) return carregarLeads();
    setLeads((ls) => (ls.some((l) => l.id === lead.id) ? ls.map((l) => (l.id === lead.id ? lead : l)) : [lead, ...ls]));
  };

  return (
    <div className="app">
      <Header
        user={user}
        busca={busca}
        setBusca={setBusca}
        atrasados={atrasados}
        horas={horas}
        soAtrasados={soAtrasados}
        setSoAtrasados={setSoAtrasados}
        soMeus={soMeus}
        setSoMeus={setSoMeus}
        onNovo={() => setCriando(true)}
        irParaEquipe={irParaEquipe}
        sair={sair}
      />
      {erro && <div className="faixa-erro" onClick={() => setErro('')}>{erro} <span>×</span></div>}
      <Kanban stages={stages} leads={visiveis} onMover={mover} onAbrir={(l) => setAberto(l.id)} />
      {aberto && (
        <LeadPanel
          leadId={aberto}
          stages={stages}
          users={users}
          user={user}
          horas={horas}
          onFechar={() => { setAberto(null); carregarLeads(); }}
          onAtualizado={aoAtualizar}
          onExcluido={() => { setAberto(null); carregarLeads(); }}
        />
      )}
      {criando && (
        <NovoLead
          stages={stages}
          users={users}
          user={user}
          onFechar={() => setCriando(false)}
          onCriado={(lead) => { setCriando(false); aoAtualizar(lead); setAberto(lead.id); }}
        />
      )}
    </div>
  );
}
