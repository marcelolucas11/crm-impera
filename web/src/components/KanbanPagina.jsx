import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEvento } from '../tempoReal.js';
import { SlidersHorizontal, Eye, Plus, Columns3, BellRing, ArrowDownWideNarrow, SquareCheckBig } from 'lucide-react';
import Kanban, { ORDENS } from './Kanban.jsx';
import FundoLogo3D from './FundoLogo3D.jsx';
import CamposVisiveis from './CamposVisiveis.jsx';
import LeadPanel from './LeadPanel.jsx';
import NovoLead from './NovoLead.jsx';
import EditorEtapas from './EditorEtapas.jsx';
import PainelFiltros, { FILTROS_VAZIOS, aplicarFiltros, contarFiltros } from './Filtros.jsx';
import { ChipResponsavel, ChipWhatsApp } from './SeletoresRapidos.jsx';
import { BarraSelecao, CriarPublico } from './SelecaoKanban.jsx';

const ATUALIZAR_A_CADA_MS = 30000;
const CHAVE_FILTROS = 'crm.filtros.kanban';
const CHAVE_ORDEM = 'crm.ordem.kanban';
// WhatsApp escolhido na barra do kanban: é o número que manda mensagem pela conversa dentro do cartão
const CHAVE_WHATSAPP = 'crm.whatsapp.kanban';

function lerFiltrosSalvos() {
  try {
    return { ...FILTROS_VAZIOS, ...JSON.parse(localStorage.getItem(CHAVE_FILTROS) || '{}') };
  } catch {
    return FILTROS_VAZIOS;
  }
}

export default function KanbanPagina({ user, stages, users, carregarEtapas, aoMudarAlgo, setErro, usarPublico }) {
  const [leads, setLeads] = useState([]);
  const [horas, setHoras] = useState(24);
  const [busca, setBusca] = useState('');
  const [filtros, setFiltrosEstado] = useState(lerFiltrosSalvos);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [mostrarCampos, setMostrarCampos] = useState(false);
  const [ocultos, setOcultosEstado] = useState(() => { try { return JSON.parse(localStorage.getItem('crm.camposOcultos') || '[]'); } catch { return []; } });
  const setOcultos = (o) => { setOcultosEstado(o); try { localStorage.setItem('crm.camposOcultos', JSON.stringify(o)); } catch { /* sem armazenamento */ } };
  const [ordem, setOrdemEstado] = useState(() => {
    try { const o = localStorage.getItem(CHAVE_ORDEM); return ORDENS.some(([k]) => k === o) ? o : 'formulario'; } catch { return 'formulario'; }
  });
  const setOrdem = (o) => { setOrdemEstado(o); try { localStorage.setItem(CHAVE_ORDEM, o); } catch { /* sem armazenamento */ } };
  const [aberto, setAberto] = useState(null);
  const [criando, setCriando] = useState(false);
  const [editandoEtapas, setEditandoEtapas] = useState(false);
  const buscaRef = useRef(busca);
  buscaRef.current = busca;

  // WhatsApp que manda mensagem pelo cartão ('' = automático: o último número usado com o lead)
  const [numeros, setNumeros] = useState([]);
  const [numeroWa, setNumeroWaEstado] = useState(() => { try { return localStorage.getItem(CHAVE_WHATSAPP) || ''; } catch { return ''; } });
  const setNumeroWa = (v) => { setNumeroWaEstado(v); try { localStorage.setItem(CHAVE_WHATSAPP, v); } catch { /* sem armazenamento */ } };
  const carregarNumeros = useCallback(() => api('/whatsapp/numeros').then((d) => setNumeros(d.numeros)).catch(() => {}), []);
  useEffect(() => { carregarNumeros(); }, [carregarNumeros]);
  useEvento('whatsapp', (d) => { if (d?.numeros || d?.reconectou) carregarNumeros(); });

  // Seleção em massa: null = desligada; Set de ids = ligada (clicar no cartão marca/desmarca)
  const [selecionados, setSelecionados] = useState(null);
  const [criandoPublico, setCriandoPublico] = useState(false);
  const [emMassa, setEmMassa] = useState(false);
  const [avisoMassa, setAvisoMassa] = useState('');

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
  const semResposta = useMemo(() => leads.filter((l) => l.sem_resposta).length, [leads]);
  const qtdFiltros = contarFiltros(filtros);

  // Quantos leads de cada responsável (para a lista do chip "Responsável")
  const porResponsavel = useMemo(() => {
    const c = { todos: leads.length, ninguem: 0 };
    for (const l of leads) {
      if (!l.owner_id) c.ninguem++;
      else c[String(l.owner_id)] = (c[String(l.owner_id)] || 0) + 1;
    }
    return c;
  }, [leads]);

  // A seleção fica só com o que está visível (mudar filtro/busca tira da seleção quem sumiu da tela)
  useEffect(() => {
    if (!selecionados?.size) return;
    const ids = new Set(visiveis.map((l) => l.id));
    if ([...selecionados].some((id) => !ids.has(id))) setSelecionados(new Set([...selecionados].filter((id) => ids.has(id))));
  }, [visiveis]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternarSelecao = (id) => setSelecionados((atual) => {
    const s = new Set(atual || []);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });
  const marcarVarios = (ids, marcar) => setSelecionados((atual) => {
    const s = new Set(atual || []);
    ids.forEach((id) => (marcar ? s.add(id) : s.delete(id)));
    return s;
  });
  const sairDaSelecao = useCallback(() => { setSelecionados(null); setAvisoMassa(''); }, []);
  const leadsSelecionados = useMemo(() => (selecionados ? leads.filter((l) => selecionados.has(l.id)) : []), [leads, selecionados]);

  // Esc sai da seleção (quando não há ficha ou janela aberta por cima)
  useEffect(() => {
    if (!selecionados || aberto || criandoPublico) return undefined;
    const tecla = (e) => { if (e.key === 'Escape') sairDaSelecao(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [selecionados, aberto, criandoPublico, sairDaSelecao]);

  const aplicarEmMassa = async (dados, descricao) => {
    if (!selecionados?.size) return;
    setEmMassa(true);
    try {
      const d = await api('/leads/em-massa', { method: 'POST', body: { ids: [...selecionados], ...dados } });
      setAvisoMassa(`${descricao} — ${d.alterados} lead${d.alterados === 1 ? '' : 's'} alterado${d.alterados === 1 ? '' : 's'}.`);
      await carregarLeads();
      if (dados.stage_id) carregarEtapas();
      aoMudarAlgo();
    } catch (e) {
      setErro(e.message);
    } finally {
      setEmMassa(false);
    }
  };

  // Foto do responsável no cartão: troca na hora
  const mudarResponsavel = async (leadId, ownerId) => {
    const anterior = leads;
    const dono = users.find((u) => u.id === ownerId);
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, owner_id: ownerId, owner_name: dono?.name || null, owner_foto: dono?.foto || null } : l)));
    try {
      const d = await api(`/leads/${leadId}`, { method: 'PATCH', body: { owner_id: ownerId } });
      setLeads((ls) => ls.map((l) => (l.id === leadId ? d.lead : l)));
    } catch (e) {
      setLeads(anterior);
      setErro(e.message);
    }
  };

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

  // Botão do cartão: apaga a notificação de mensagem sem resposta (volta se o lead mandar outra mensagem)
  const limparNotificacao = async (leadId) => {
    const anterior = leads;
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, sem_resposta: false } : l)));
    try {
      const d = await api(`/leads/${leadId}/notificacao/limpar`, { method: 'POST' });
      setLeads((ls) => ls.map((l) => (l.id === leadId ? d.lead : l)));
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
        <ChipResponsavel valor={filtros.responsavel} aoMudar={(v) => setFiltros({ ...filtros, responsavel: v })} users={users} user={user} contagem={porResponsavel} />
        <ChipWhatsApp numeros={numeros} valor={numeroWa} aoMudar={setNumeroWa} textoVazio="Automático"
          detalheVazio="Usa o último número que falou com o lead" titulo="WhatsApp que manda mensagem pelo cartão do lead" />
        <button className={`chip chip-led chip-notif ${filtros.semResposta ? 'ativo' : ''}`} onClick={() => alternar('semResposta')} title="Leads que mandaram mensagem e ainda não foram respondidos">
          <BellRing size={13} strokeWidth={2.2} /> {semResposta} sem resposta
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
        <div className="seletor-ordem" role="radiogroup" aria-label="Ordem dos cartões" title="Ordem dos cartões em todas as etapas (mais recente em cima)">
          <ArrowDownWideNarrow size={14} className="seletor-ordem-icone" />
          {ORDENS.map(([k, rotulo]) => (
            <button key={k} type="button" role="radio" aria-checked={ordem === k} className={ordem === k ? 'ativo' : ''} onClick={() => setOrdem(k)}>
              {rotulo}
            </button>
          ))}
        </div>
        <button className={`chip ${mostrarCampos ? 'ativo' : ''}`} onClick={() => setMostrarCampos(!mostrarCampos)} title="Escolher o que aparece nos cartões">
          <Eye size={14} /> Campos{ocultos.length ? ` (${ocultos.length} ocultos)` : ''}
        </button>
        <button className={`chip ${selecionados ? 'ativo' : ''}`} onClick={() => (selecionados ? sairDaSelecao() : setSelecionados(new Set()))}
          title="Selecionar vários cartões (também: Ctrl/⌘ + clique no cartão)">
          <SquareCheckBig size={14} /> {selecionados ? 'Selecionando' : 'Selecionar'}
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

      {avisoMassa && selecionados && <div className="faixa-filtros faixa-sucesso">{avisoMassa} <button className="link" onClick={() => setAvisoMassa('')}>OK</button></div>}

      <Kanban
        stages={stages} leads={visiveis} ocultos={ocultos} ordem={ordem} onMover={mover} onAbrir={(l) => setAberto(l.id)} onLimparNotificacao={limparNotificacao}
        users={users} onMudarResponsavel={mudarResponsavel}
        selecionados={selecionados} onAlternarSelecao={alternarSelecao} onMarcarVarios={marcarVarios}
      />

      {selecionados && (
        <BarraSelecao
          selecionados={selecionados}
          totalVisiveis={visiveis.length}
          onSelecionarTodos={() => setSelecionados(new Set(visiveis.map((l) => l.id)))}
          onLimpar={() => setSelecionados(new Set())}
          onSair={sairDaSelecao}
          onCriarPublico={() => setCriandoPublico(true)}
          onEmMassa={aplicarEmMassa}
          users={users}
          stages={stages}
          ocupado={emMassa}
        />
      )}
      {criandoPublico && (
        <CriarPublico leads={leadsSelecionados} onFechar={() => setCriandoPublico(false)} usarPublico={usarPublico} />
      )}

      {aberto && (
        <LeadPanel
          leadId={aberto}
          numeroPreferido={numeroWa}
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
