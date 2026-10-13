// Listas de contatos salvas (kanban + WhatsApp, sem números repetidos)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListPlus, Pencil, Trash2, UserPlus, Users, Columns3, Search, Send, X } from 'lucide-react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';
import Avatar from '../Avatar.jsx';
import SeletorContatos, { useContatos } from './SeletorContatos.jsx';
import { useAviso, Vazio } from './comum.jsx';
import { formatarTelefone } from './texto.js';
import { tempoDesde } from '../../utils.js';

function NovaLista({ aoFechar, aoCriar }) {
  const aviso = useAviso();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [selecionados, setSelecionados] = useState(new Map());
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    if (!nome.trim()) { aviso('Dê um nome à lista', 'erro'); return; }
    setSalvando(true);
    try {
      const r = await api('/disparos/listas', {
        method: 'POST',
        body: { nome, descricao, contatos: [...selecionados.values()].map((c) => ({ telefone: c.telefone, lead_id: c.lead_id, nome: c.nome })) },
      });
      aviso(`Lista “${nome}” criada${r.total ? ` com ${r.total} contato(s)` : ''}`);
      aoCriar(r.id);
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };
  return (
    <Modal titulo="Nova lista de contatos" onFechar={aoFechar} largo>
      <div className="painel-corpo">
        <div className="grade-2">
          <label>Nome<input autoFocus placeholder="Ex.: Leads quentes de outubro" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label>Descrição (opcional)<input placeholder="Para que serve esta lista" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
        </div>
        <SeletorContatos selecionados={selecionados} aoMudar={setSelecionados} altura={380} />
        <div className="acoes">
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          <span className="espaco" />
          <button className="btn btn-ouro" disabled={salvando} onClick={criar}><ListPlus size={14} /> Criar lista {selecionados.size ? `com ${selecionados.size}` : 'vazia'}</button>
        </div>
      </div>
    </Modal>
  );
}

function AdicionarMembros({ lista, aoFechar, aoAdicionar }) {
  const aviso = useAviso();
  const [selecionados, setSelecionados] = useState(new Map());
  const adicionar = async () => {
    try {
      const r = await api(`/disparos/listas/${lista.id}/membros`, { method: 'POST', body: { contatos: [...selecionados.values()].map((c) => ({ telefone: c.telefone, lead_id: c.lead_id, nome: c.nome })) } });
      aviso(r.adicionados ? `${r.adicionados} contato(s) adicionado(s)` : 'Esses contatos já estavam na lista', r.adicionados ? 'ok' : 'info');
      aoAdicionar();
    } catch (e) { aviso(e.message, 'erro'); }
  };
  return (
    <Modal titulo={`Adicionar contatos a “${lista.nome}”`} onFechar={aoFechar} largo>
      <div className="painel-corpo">
        <SeletorContatos selecionados={selecionados} aoMudar={setSelecionados} altura={420} />
        <div className="acoes">
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          <span className="espaco" />
          <button className="btn btn-ouro" disabled={!selecionados.size} onClick={adicionar}><UserPlus size={14} /> Adicionar {selecionados.size || ''}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function AbaListas({ aoUsarLista }) {
  const aviso = useAviso();
  const [listas, setListas] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [membros, setMembros] = useState([]);
  const [criando, setCriando] = useState(false);
  const [adicionando, setAdicionando] = useState(false);
  const [busca, setBusca] = useState('');
  const { dados } = useContatos();

  const carregar = useCallback(async () => {
    try {
      const d = await api('/disparos/listas');
      setListas(d.listas);
      setAberta((a) => (a && d.listas.some((l) => l.id === a) ? a : d.listas[0]?.id ?? null));
    } catch (e) { aviso(e.message, 'erro'); }
  }, [aviso]);
  const carregarMembros = useCallback(async () => {
    if (!aberta) { setMembros([]); return; }
    try { setMembros((await api(`/disparos/listas/${aberta}/membros`)).membros); } catch (e) { aviso(e.message, 'erro'); }
  }, [aberta, aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarMembros(); }, [carregarMembros]);

  // Dados do kanban/WhatsApp atuais de cada membro (etapa, etiquetas)
  const porTelefone = useMemo(() => new Map((dados?.contatos || []).map((c) => [c.telefone, c])), [dados]);
  const lista = listas?.find((l) => l.id === aberta);
  const filtrados = membros.filter((m) => !busca || (m.nome || '').toLowerCase().includes(busca.toLowerCase()) || m.telefone.includes(busca.replace(/\D/g, '') || '¬'));

  const renomear = async () => {
    const nome = window.prompt('Novo nome da lista:', lista.nome);
    if (!nome?.trim()) return;
    try { await api(`/disparos/listas/${lista.id}`, { method: 'PATCH', body: { nome } }); aviso('Lista renomeada'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };
  const apagar = async () => {
    if (!window.confirm(`Apagar a lista “${lista.nome}”? Os contatos e leads continuam no CRM.`)) return;
    try { await api(`/disparos/listas/${lista.id}`, { method: 'DELETE' }); aviso('Lista apagada'); setAberta(null); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };
  const remover = async (telefone) => {
    try { await api(`/disparos/listas/${lista.id}/membros/remover`, { method: 'POST', body: { telefones: [telefone] } }); carregarMembros(); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };

  if (!listas) return <div className="dp-centro"><div className="carregando" /></div>;

  return (
    <div className="dp-aba">
      <div className="dp-listas">
        <aside className="dp-listas-lado">
          <button className="btn btn-ouro" onClick={() => setCriando(true)}><ListPlus size={14} /> Nova lista</button>
          {!listas.length && <p className="suave pequeno">Crie listas como “Leads quentes”, “Clientes antigos” ou “Repescagem Yay! Forms” para disparar com 1 clique.</p>}
          {listas.map((l) => (
            <button key={l.id} type="button" className={`dp-camp ${aberta === l.id ? 'ativa' : ''}`} onClick={() => setAberta(l.id)}>
              <span className="dp-camp-icone"><Users size={15} /></span>
              <span className="dp-camp-meio">
                <b>{l.nome}</b>
                <small>{l.total} contato(s){l.do_kanban ? ` · ${l.do_kanban} do kanban` : ''} · {tempoDesde(l.updated_at)}</small>
              </span>
            </button>
          ))}
        </aside>

        <section className="cartao-secao dp-listas-membros">
          {!lista ? <Vazio icone={Users} titulo="Nenhuma lista">Crie a primeira lista para organizar seus disparos.</Vazio> : (
            <>
              <div className="dp-secao-topo">
                <div>
                  <h2>{lista.nome}</h2>
                  {lista.descricao && <span className="suave pequeno">{lista.descricao}</span>}
                </div>
                <div className="acoes">
                  <button className="btn btn-pequeno btn-ouro" onClick={() => aoUsarLista(lista)} disabled={!lista.total}><Send size={13} /> Disparar para esta lista</button>
                  <button className="btn btn-pequeno" onClick={() => setAdicionando(true)}><UserPlus size={13} /> Adicionar contatos</button>
                  <button className="btn btn-pequeno" onClick={renomear}><Pencil size={13} /> Renomear</button>
                  <button className="btn btn-pequeno btn-perigo-leve" onClick={apagar}><Trash2 size={13} /> Excluir</button>
                </div>
              </div>
              {membros.length > 8 && (
                <div className="dp-busca"><Search size={15} /><input placeholder="Buscar na lista…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
              )}
              {!membros.length ? <p className="suave">Lista vazia. Clique em “Adicionar contatos”.</p> : (
                <div className="dp-membros">
                  {filtrados.map((m) => {
                    const c = porTelefone.get(m.telefone);
                    return (
                      <div key={m.telefone} className={`dp-contato ${m.lead_id ? 'kanban' : 'whatsapp'}`}>
                        <Avatar chave={m.lead_id ? `l:${m.lead_id}` : c?.chave || `t:${m.telefone}`} nome={m.nome} tamanho={34} lead={Boolean(m.lead_id)} />
                        <div className="dp-contato-meio">
                          <div className="dp-contato-nome">
                            <b>{m.nome || formatarTelefone(m.telefone)}</b>
                            {m.lead_id && m.etapa_nome && <span className="dp-etapa" style={{ '--cor': m.etapa_cor }}><i />{m.etapa_nome}</span>}
                            {!m.lead_id && <span className="dp-wa-padrao"><Columns3 size={11} /> não está no kanban</span>}
                          </div>
                          <div className="dp-contato-linha">
                            <span>{formatarTelefone(m.telefone)}</span>
                            {c?.etiquetas?.map((e) => <span key={e.id} className="tag dp-etiqueta" style={{ '--cor': e.cor }}>{e.nome}</span>)}
                          </div>
                        </div>
                        <button className="dp-botao-icone" title="Tirar da lista" onClick={() => remover(m.telefone)}><X size={15} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {criando && <NovaLista aoFechar={() => setCriando(false)} aoCriar={(id) => { setCriando(false); setAberta(id); carregar(); }} />}
      {adicionando && lista && <AdicionarMembros lista={lista} aoFechar={() => setAdicionando(false)} aoAdicionar={() => { setAdicionando(false); carregarMembros(); carregar(); }} />}
    </div>
  );
}
