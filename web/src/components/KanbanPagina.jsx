import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEvento } from '../tempoReal.js';
import { SlidersHorizontal, Eye, Plus, Columns3 } from 'lucide-react';
import Kanban from './Kanban.jsx';
import FundoLogo3D from './FundoLogo3D.jsx';
import CamposVisiveis from './CamposVisiveis.jsx';
import LeadPanel from './LeadPanel.jsx';
import NovoLead from './NovoLead.jsx';
import EditorEtapas from './EditorEtapas.jsx';
import PainelFiltros, { FILTROS_VAZIOS, aplicarFiltros, contarFiltros } from './Filtros.jsx';

const ATUALIZAR_A_CADA_MS = 30000;
const CHAVE_FILTROS = 'crm.filtros.kanban';

function lerFiltrosSalvos() {
  try {
    return { ...FILTROS_VAZIOS, ...JSON.parse(localStorage.getItem(CHAVE_FILTROS) || '{}') };
  } catch {
    return FILTROS_VAZIOS;
  }
}

export default function KanbanPagina({ user, stages, users, carregarEtapas, aoMudarAlgo, setErro }) {
  const [leads, setLeads] = useState([]);
  const [horas, setHoras] = useState(24);
  const [busca, setBusca] = useState('');
  const [filtros, setFiltrosEstado] = useState(lerFiltrosSalvos);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [mostrarCampos, setMostrarCampos] = useState(false);
  const [ocultos, setOcultosEstado] = useState(() => { try { return JSON.parse(localStorage.getItem('crm.camposOcultos') || '[]'); } catch { return []; } });
  const setOcultos = (o) => { setOcultosEstado(o); try { localStorage.setItem('crm.camposOcultos', JSON.stringify(o)); } catch { /* sem armazenamento */ } };
  const [aberto, setAberto] = useState(null);
  const [criando, setCriando] = useState(false);
  const [editandoEtapas, setEditandoEtapas] = useState(false);
  const buscaRef = useRef(busca);
  buscaRef.current = busca;

  const setFiltros = (f) => {
    setFiltrosEstado(f);
    try { localStorage.setItem(CHAVE_FILTROS, JSON.stringify(f)); } catch { /* sem armazenamento */ }
  };

  const carregarLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (buscaRef.current.trim()) params.set('q', buscaRef.current.trim());
    try {
      const d = await api(`/leads?${params}`);
      setLeads(d.leads);
      setHoras(d.followup_horas);
    } catch (e) {
      setErro(e.message);
    }
  }, [setErro]);

  useEffect(() => {
    const t = setTimeout(carregarLeads, 250);
    return () => clearTimeout(t);
  }, [busca, carregarLeads]);

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) carregarLeads(); }, ATUALIZAR_A_CADA_MS);
    return () => clearInterval(id);
  }, [carregarLeads]);

  // Mensagem nova no WhatsApp: atualiza os cartões (contador de mensagens), no máximo a cada 3 s
  const ultimaAtualizacao = useRef(0);
  const agendada = useRef(null);
  useEvento('whatsapp', (d) => {
    if (!d?.chat && !d?.historico && !d?.reconectou) return;
    if (agendada.current) return;
    const espera = Math.max(0, 3000 - (Date.now() - ultimaAtualizacao.current));
    agendada.current = setTimeout(() => {
      agendada.current = null;
      ultimaAtualizacao.current = Date.now();
      carregarLeads();
    }, espera);
  });
  useEffect(() => () => clearTimeout(agendada.current), []);

  const visiveis = useMemo(() => aplicarFiltros(leads, filtros, user), [leads, filtros, user]);
  const atrasados = useMemo(() => leads.filter((l) => l.followup_overdue).length, [leads]);
  const aguardando = useMemo(() => leads.filter((l) => l.waiting_since).length, [leads]);
  const nuncaContatados = useMemo(() => leads.filter((l) => !l.first_contact_at).length, [leads]);
  const fechando = useMemo(() => leads.filter((l) => l.closing_since).length, [leads]);
  const qtdFiltros = contarFiltros(filtros);

  const mover = async (leadId, stageId) => {
    const anterior = leads;
    const etapa = stages.find((s) => s.id === stageId);
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, stage_id: stageId, stage_name: etapa?.name, stage_kind: etapa?.kind } : l)));
    try {
      const d = await api(`/leads/${leadId}`, { method: 'PATCH', body: { stage_id: stageId } });
      setLeads((ls) => ls.map((l) => (l.id === leadId ? d.lead : l)));
      carregarEtapas();
    } catch (e) {
      setLeads(anterior);
      setErro(e.message);
    }
  };

  const aoAtualizar = (lead) => {
    if (!lead) return carregarLeads();
    setLeads((ls) => (ls.some((l) => l.id === lead.id) ? ls.map((l) => (l.id === lead.id ? lead : l)) : [lead, ...ls]));
    aoMudarAlgo();
  };

  const alternar = (campo) => setFiltros({ ...filtros, [campo]: !filtros[campo] });

  return (
    <>
      <FundoLogo3D modo="kanban" />
      <div className="barra-ferramentas">
        <input
          className="busca"
          type="search"
          placeholder="Buscar nome, telefone, e-mail ou formulário…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button className={`chip ${mostrarFiltros || qtdFiltros ? 'ativo' : ''}`} onClick={() => setMostrarFiltros(!mostrarFiltros)}>
          <SlidersHorizontal size={14} /> Filtros{qtdFiltros ? ` (${qtdFiltros})` : ''}
        </button>
        <button className={`chip chip-led chip-ambar ${filtros.aguardando ? 'ativo' : ''}`} onClick={() => alternar('aguardando')} title="Leads esperando a sua resposta">
          <i className="led led-ambar" /> {aguardando} aguardando resposta
        </button>
        <button className={`chip chip-led chip-verde ${filtros.fechando ? 'ativo' : ''}`} onClick={() => alternar('fechando')} title="Leads que vão fechar — esperando a decisão deles">
          <i className="led led-verde" /> {fechando} aguardando fechar
        </button>
        <button className={`chip chip-led chip-azul ${filtros.nuncaContatado ? 'ativo' : ''}`} onClick={() => alternar('nuncaContatado')} title="Leads com quem ninguém falou ainda">
          <i className="led led-azul" /> {nuncaContatados} nunca contatado{nuncaContatados === 1 ? '' : 's'}
        </button>
        <button
          className={`chip chip-led ${atrasados ? 'chip-vermelho' : 'chip-ok'} ${filtros.atrasados ? 'ativo' : ''}`}
          onClick={() => alternar('atrasados')}
          title={`Leads sem contato há mais de ${horas} h`}
        >
          <i className={`led ${atrasados ? 'led-vermelho' : 'led-apagado'}`} /> {atrasados ? `${atrasados} sem contato` : 'Follow-up em dia'}
        </button>
        <div className="espaco" />
        <button className={`chip ${mostrarCampos ? 'ativo' : ''}`} onClick={() => setMostrarCampos(!mostrarCampos)} title="Escolher o que aparece nos cartões">
          <Eye size={14} /> Campos{ocultos.length ? ` (${ocultos.length} ocultos)` : ''}
        </button>
        {user.role === 'admin' && <button className="btn" onClick={() => setEditandoEtapas(true)}><Columns3 size={15} /> Editar etapas</button>}
        <button className="btn btn-ouro" onClick={() => setCriando(true)}><Plus size={16} strokeWidth={2.2} /> Novo lead</button>
      </div>

      {mostrarFiltros && (
        <PainelFiltros filtros={filtros} setFiltros={setFiltros} leads={leads} users={users} total={leads.length} visiveis={visiveis.length} />
      )}
      {!mostrarFiltros && qtdFiltros > 0 && (
        <div className="faixa-filtros">
          Filtros ativos — mostrando {visiveis.length} de {leads.length} leads.
          <button className="link" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar</button>
        </div>
      )}

      {mostrarCampos && <CamposVisiveis leads={leads} ocultos={ocultos} setOcultos={setOcultos} onFechar={() => setMostrarCampos(false)} />}

      <Kanban stages={stages} leads={visiveis} ocultos={ocultos} onMover={mover} onAbrir={(l) => setAberto(l.id)} />

      {aberto && (
        <LeadPanel
          leadId={aberto}
          stages={stages}
          users={users}
          user={user}
          horas={horas}
          onFechar={() => { setAberto(null); carregarLeads(); aoMudarAlgo(); }}
          onAtualizado={aoAtualizar}
          onExcluido={() => { setAberto(null); carregarLeads(); carregarEtapas(); }}
        />
      )}
      {criando && (
        <NovoLead
          stages={stages}
          users={users}
          user={user}
          onFechar={() => setCriando(false)}
          onCriado={(lead) => { setCriando(false); aoAtualizar(lead); setAberto(lead.id); carregarEtapas(); }}
        />
      )}
      {editandoEtapas && (
        <EditorEtapas
          stages={stages}
          aoMudar={() => { carregarEtapas(); }}
          onFechar={() => { setEditandoEtapas(false); carregarEtapas(); carregarLeads(); }}
        />
      )}
    </>
  );
}
