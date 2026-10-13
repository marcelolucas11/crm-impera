// Seletor unificado de contatos: leads do kanban (com etapa, etiquetas e origem) e contatos do WhatsApp
// (só nome, número e foto), sem números repetidos. Busca, filtros e seleção em massa.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Search, Columns3, MessageCircle, Users, CheckSquare, XSquare, Plus, RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import Avatar from '../Avatar.jsx';
import { useAviso } from './comum.jsx';
import { formatarTelefone } from './texto.js';

let cache = null; // { contatos, etapas, etiquetas, em }

export function useContatos() {
  const [dados, setDados] = useState(cache);
  const [carregando, setCarregando] = useState(!cache);
  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await api('/disparos/contatos');
      cache = { ...d, em: Date.now() };
      setDados(cache);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    if (!cache || Date.now() - cache.em > 60000) recarregar().catch(() => {});
  }, [recarregar]);
  return { dados, carregando, recarregar };
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function LinhaContato({ c, marcado, aoMarcar, compacto = false }) {
  return (
    <label className={`dp-contato ${marcado ? 'marcado' : ''} ${c.tipo === 'kanban' ? 'kanban' : 'whatsapp'}`}>
      {aoMarcar && <input type="checkbox" checked={marcado} onChange={() => aoMarcar(c)} />}
      <Avatar chave={c.chave} nome={c.nome} tamanho={compacto ? 32 : 38} lead={c.tipo === 'kanban'} />
      <div className="dp-contato-meio">
        <div className="dp-contato-nome">
          <b>{c.nome || formatarTelefone(c.telefone)}</b>
          {c.tipo === 'kanban' && c.etapa && (
            <span className="dp-etapa" style={{ '--cor': c.etapa.cor }}><i />{c.etapa.nome}</span>
          )}
          {c.tipo === 'whatsapp' && <span className="dp-wa-padrao" title="Contato do WhatsApp (não está no kanban)"><MessageCircle size={11} /> WhatsApp</span>}
        </div>
        <div className="dp-contato-linha">
          <span>{formatarTelefone(c.telefone)}</span>
          {c.tipo === 'kanban' && !compacto && (
            <>
              {c.origem && <span className="tag tag-yayforms">{c.origem}</span>}
              {c.formulario && <span className="tag" title="Formulário">{c.formulario}</span>}
              {c.parcial && <span className="tag tag-parcial">Form. incompleto</span>}
              {c.etiquetas?.map((e) => <span key={e.id} className="tag dp-etiqueta" style={{ '--cor': e.cor }}>{e.nome}</span>)}
              {c.extras?.map((x) => <span key={x} className="tag">{x}</span>)}
            </>
          )}
          {c.tipo === 'whatsapp' && !compacto && c.etiquetas?.map((e) => <span key={e.id} className="tag dp-etiqueta" style={{ '--cor': e.cor }}>{e.nome}</span>)}
        </div>
      </div>
    </label>
  );
}

/**
 * selecionados: Map(telefone → contato) · aoMudar(novoMap)
 */
export default function SeletorContatos({ selecionados, aoMudar, altura = 460 }) {
  const aviso = useAviso();
  const { dados, carregando, recarregar } = useContatos();
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState('todos');
  const [etapa, setEtapa] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [manual, setManual] = useState('');

  const contatos = dados?.contatos || [];
  const contagem = useMemo(() => ({
    todos: contatos.length,
    kanban: contatos.filter((c) => c.tipo === 'kanban').length,
    whatsapp: contatos.filter((c) => c.tipo === 'whatsapp').length,
  }), [contatos]);

  const filtrados = useMemo(() => {
    const termo = semAcento(busca.trim());
    const digitos = busca.replace(/\D/g, '');
    return contatos.filter((c) => {
      if (origem !== 'todos' && c.tipo !== origem) return false;
      if (etapa && String(c.etapa?.id) !== etapa) return false;
      if (etiqueta && !c.etiquetas?.some((e) => String(e.id) === etiqueta)) return false;
      if (termo) {
        const casa = semAcento(c.nome).includes(termo) || (digitos.length >= 3 && c.telefone.includes(digitos))
          || semAcento(c.formulario).includes(termo) || semAcento(c.etapa?.nome).includes(termo);
        if (!casa) return false;
      }
      return true;
    });
  }, [contatos, busca, origem, etapa, etiqueta]);

  const marcar = (c) => {
    const novo = new Map(selecionados);
    if (novo.has(c.telefone)) novo.delete(c.telefone); else novo.set(c.telefone, c);
    aoMudar(novo);
  };
  const todosFiltradosMarcados = filtrados.length > 0 && filtrados.every((c) => selecionados.has(c.telefone));
  const marcarFiltrados = () => {
    const novo = new Map(selecionados);
    if (todosFiltradosMarcados) filtrados.forEach((c) => novo.delete(c.telefone));
    else filtrados.forEach((c) => novo.set(c.telefone, c));
    aoMudar(novo);
  };

  const adicionarManual = async () => {
    const lista = manual.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
    if (!lista.length) return;
    const novo = new Map(selecionados);
    let ok = 0;
    for (const t of lista.slice(0, 200)) {
      try {
        const d = await api(`/disparos/telefone/${encodeURIComponent(t)}`);
        const existente = contatos.find((c) => c.telefone === d.telefone);
        novo.set(d.telefone, existente || { chave: d.lead_id ? `l:${d.lead_id}` : `t:${d.telefone}`, tipo: d.lead_id ? 'kanban' : 'whatsapp', telefone: d.telefone, nome: d.nome, lead_id: d.lead_id, etiquetas: [] });
        ok++;
      } catch { /* inválido */ }
    }
    aoMudar(novo);
    setManual('');
    aviso(ok === lista.length ? `${ok} número(s) adicionado(s)` : `${ok} de ${lista.length} números adicionados (os outros são inválidos)`, ok ? 'ok' : 'erro');
  };

  const nomeEtapa = dados?.etapas?.find((e) => String(e.id) === etapa)?.nome;

  return (
    <div className="dp-seletor">
      <div className="dp-seletor-filtros">
        <div className="dp-busca">
          <Search size={15} />
          <input placeholder="Buscar por nome, telefone, etapa ou formulário…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="dp-segmentos" role="tablist">
          <button type="button" className={origem === 'todos' ? 'ativo' : ''} onClick={() => setOrigem('todos')}><Users size={13} /> Todos <small>{contagem.todos}</small></button>
          <button type="button" className={origem === 'kanban' ? 'ativo' : ''} onClick={() => setOrigem('kanban')}><Columns3 size={13} /> Apenas do Kanban <small>{contagem.kanban}</small></button>
          <button type="button" className={origem === 'whatsapp' ? 'ativo' : ''} onClick={() => { setOrigem('whatsapp'); setEtapa(''); }}><MessageCircle size={13} /> Apenas do WhatsApp <small>{contagem.whatsapp}</small></button>
        </div>
        <div className="dp-seletor-linha">
          {origem !== 'whatsapp' && (
            <select value={etapa} onChange={(e) => setEtapa(e.target.value)} aria-label="Etapa do kanban">
              <option value="">Todas as etapas</option>
              {dados?.etapas?.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          )}
          <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} aria-label="Etiqueta">
            <option value="">Todas as etiquetas</option>
            {dados?.etiquetas?.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <button type="button" className="btn btn-pequeno" onClick={marcarFiltrados} disabled={!filtrados.length}>
            {todosFiltradosMarcados ? <XSquare size={13} /> : <CheckSquare size={13} />}
            {todosFiltradosMarcados ? 'Desmarcar ' : 'Selecionar '}{etapa ? `todos da coluna “${nomeEtapa}”` : `os ${filtrados.length} filtrados`}
          </button>
          <button type="button" className="dp-botao-icone" title="Atualizar contatos" onClick={() => recarregar().catch((e) => aviso(e.message, 'erro'))}><RefreshCw size={14} className={carregando ? "dp-gira" : ""} /></button>
        </div>
      </div>

      <div className="dp-seletor-lista" style={{ height: altura }}>
        {carregando && !contatos.length ? <div className="dp-centro"><div className="carregando" /></div>
          : !filtrados.length ? <div className="dp-centro suave">Nenhum contato com esses filtros.</div>
            : (
              <Virtuoso
                data={filtrados}
                computeItemKey={(_, c) => c.telefone}
                itemContent={(_, c) => <LinhaContato c={c} marcado={selecionados.has(c.telefone)} aoMarcar={marcar} />}
              />
            )}
      </div>

      <div className="dp-seletor-rodape">
        <div className="dp-manual">
          <input placeholder="Adicionar números à mão (separe por vírgula ou linha)" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), adicionarManual())} />
          <button type="button" className="btn btn-pequeno" onClick={adicionarManual}><Plus size={13} /> Adicionar</button>
        </div>
        <span className="dp-selecionados"><b>{selecionados.size}</b> selecionado(s)</span>
        {selecionados.size > 0 && <button type="button" className="btn btn-pequeno" onClick={() => aoMudar(new Map())}>Limpar</button>}
      </div>
    </div>
  );
}
