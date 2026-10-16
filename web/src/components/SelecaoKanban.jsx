import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, UserRound, UserX, Columns3, X, CheckCheck, Megaphone, Send } from 'lucide-react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import MenuFlutuante, { OpcaoMenu, TituloMenu } from './MenuFlutuante.jsx';
import { FotoUsuario } from './FotoUsuario.jsx';

function BotaoMenu({ icone, rotulo, children, largura = 250 }) {
  const ref = useRef(null);
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button ref={ref} type="button" className={`btn btn-barra ${aberto ? 'ativo' : ''}`} onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto}>
        {icone} {rotulo}
      </button>
      {aberto && (
        <MenuFlutuante ancora={ref.current} aoFechar={() => setAberto(false)} largura={largura}>
          {children(() => setAberto(false))}
        </MenuFlutuante>
      )}
    </>
  );
}

// Barra flutuante no rodapé quando há cartões selecionados no kanban
export function BarraSelecao({ selecionados, totalVisiveis, onSelecionarTodos, onLimpar, onSair, onCriarPublico, onEmMassa, users, stages, ocupado }) {
  const n = selecionados.size;
  return createPortal(
    <div className="barra-selecao" role="toolbar" aria-label="Ações nos leads selecionados">
      <span className="barra-selecao-contagem"><b>{n}</b> {n === 1 ? 'lead selecionado' : 'leads selecionados'}</span>
      {n < totalVisiveis && (
        <button type="button" className="link link-sem-margem" onClick={onSelecionarTodos}><CheckCheck size={14} /> Selecionar todos os {totalVisiveis} visíveis</button>
      )}
      {n > 0 && <button type="button" className="link link-sem-margem" onClick={onLimpar}>Desmarcar</button>}
      <span className="espaco" />
      <button type="button" className="btn btn-ouro btn-barra" disabled={!n || ocupado} onClick={onCriarPublico}>
        <Megaphone size={15} /> Criar público
      </button>
      {n > 0 && !ocupado && (
        <>
          <BotaoMenu icone={<UserRound size={15} />} rotulo="Responsável">
            {(fechar) => (
              <>
                <TituloMenu>Responsável dos {n} selecionados</TituloMenu>
                {users.filter((u) => u.active).map((u) => (
                  <OpcaoMenu key={u.id} onClick={() => { fechar(); onEmMassa({ owner_id: u.id }, `Responsável: ${u.name}`); }} icone={<FotoUsuario usuario={u} tamanho={22} />}>{u.name}</OpcaoMenu>
                ))}
                <OpcaoMenu onClick={() => { fechar(); onEmMassa({ owner_id: null }, 'Responsável removido'); }} icone={<UserX size={16} />}>Sem responsável</OpcaoMenu>
              </>
            )}
          </BotaoMenu>
          <BotaoMenu icone={<Columns3 size={15} />} rotulo="Mover para">
            {(fechar) => (
              <>
                <TituloMenu>Mover os {n} selecionados para</TituloMenu>
                {stages.map((s) => (
                  <OpcaoMenu key={s.id} onClick={() => { fechar(); onEmMassa({ stage_id: s.id }, `Movidos para ${s.name}`); }}
                    icone={<span className="ponto" style={{ background: s.color }} />}>{s.name}</OpcaoMenu>
                ))}
              </>
            )}
          </BotaoMenu>
        </>
      )}
      <button type="button" className="botao-icone barra-selecao-sair" onClick={onSair} title="Sair da seleção (Esc)" aria-label="Sair da seleção"><X size={18} /></button>
    </div>,
    document.body
  );
}

// Janela "Criar público": guarda os leads selecionados como uma lista de contatos para usar nos disparos
export function CriarPublico({ leads, onFechar, onCriado, usarPublico }) {
  const [modo, setModo] = useState('novo');
  const [nome, setNome] = useState('');
  const [listas, setListas] = useState([]);
  const [listaId, setListaId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState(null);
  const campo = useRef(null);

  useEffect(() => {
    api('/disparos/listas').then((d) => setListas(d.listas)).catch(() => {});
    setTimeout(() => campo.current?.focus(), 30);
  }, []);

  const comTelefone = useMemo(() => leads.filter((l) => l.phone), [leads]);
  const semTelefone = leads.length - comTelefone.length;
  const contatos = comTelefone.map((l) => ({ telefone: l.phone, lead_id: l.id, nome: l.name || null }));

  const salvar = async (e) => {
    e.preventDefault();
    setErro('');
    if (!contatos.length) { setErro('Nenhum dos leads selecionados tem WhatsApp/telefone.'); return; }
    if (modo === 'novo' && !nome.trim()) { setErro('Dê um nome ao público.'); campo.current?.focus(); return; }
    if (modo === 'existente' && !listaId) { setErro('Escolha o público.'); return; }
    setEnviando(true);
    try {
      let id = Number(listaId);
      let resultado;
      let nomeFinal = listas.find((l) => l.id === id)?.nome;
      if (modo === 'novo') {
        nomeFinal = nome.trim();
        resultado = await api('/disparos/listas', {
          method: 'POST',
          body: { nome: nomeFinal, descricao: `Criado no kanban em ${new Date().toLocaleDateString('pt-BR')}`, contatos },
        });
        id = resultado.id;
      } else {
        resultado = await api(`/disparos/listas/${id}/membros`, { method: 'POST', body: { contatos } });
      }
      setFeito({ id, nome: nomeFinal, adicionados: resultado?.adicionados ?? contatos.length, total: resultado?.total ?? contatos.length, invalidos: resultado?.invalidos || 0 });
      onCriado?.();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  if (feito) {
    const repetidos = contatos.length - feito.adicionados - feito.invalidos;
    return (
      <Modal titulo="Público salvo" onFechar={onFechar}>
        <div className="publico-feito">
          <div className="publico-feito-icone"><Users size={26} /></div>
          <p><b>{feito.nome}</b> {modo === 'novo' ? 'foi criado' : 'foi atualizado'} com <b>{feito.total}</b> contato{feito.total === 1 ? '' : 's'}.</p>
          <ul className="suave pequeno publico-feito-detalhes">
            {modo === 'existente' && <li>{feito.adicionados} novo{feito.adicionados === 1 ? '' : 's'} nesta vez.</li>}
            {repetidos > 0 && <li>{repetidos} número{repetidos === 1 ? '' : 's'} repetido{repetidos === 1 ? '' : 's'} entr{repetidos === 1 ? 'ou' : 'aram'} uma vez só.</li>}
            {feito.invalidos > 0 && <li>{feito.invalidos} telefone{feito.invalidos === 1 ? '' : 's'} inválido{feito.invalidos === 1 ? '' : 's'} ficou de fora.</li>}
            {semTelefone > 0 && <li>{semTelefone} lead{semTelefone === 1 ? '' : 's'} sem telefone ficou de fora.</li>}
          </ul>
          <p className="suave pequeno">Ele aparece em <b>Disparos → Disparo personalizado</b> e em <b>Públicos e listas</b>.</p>
          <div className="acoes-modal">
            <button type="button" className="btn" onClick={onFechar}>Fechar</button>
            <button type="button" className="btn btn-ouro" onClick={() => { onFechar(); usarPublico?.({ id: feito.id, nome: feito.nome }); }}>
              <Send size={14} /> Usar num disparo
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Criar público" onFechar={onFechar}>
      <form className="form-publico" onSubmit={salvar}>
        <p className="suave pequeno">
          {leads.length} lead{leads.length === 1 ? '' : 's'} selecionado{leads.length === 1 ? '' : 's'} · <b className="texto-ouro">{comTelefone.length} com WhatsApp</b>
          {semTelefone > 0 && <> · {semTelefone} sem telefone (fica{semTelefone === 1 ? '' : 'm'} de fora)</>}
        </p>
        <div className="seletor-ordem seletor-modo-publico" role="radiogroup" aria-label="Novo ou existente">
          <button type="button" role="radio" aria-checked={modo === 'novo'} className={modo === 'novo' ? 'ativo' : ''} onClick={() => setModo('novo')}>Novo público</button>
          <button type="button" role="radio" aria-checked={modo === 'existente'} className={modo === 'existente' ? 'ativo' : ''} disabled={!listas.length}
            onClick={() => setModo('existente')} title={listas.length ? '' : 'Ainda não há públicos salvos'}>Adicionar a um existente</button>
        </div>
        {modo === 'novo' ? (
          <label>Nome do público
            <input ref={campo} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Leads quentes — outubro" />
          </label>
        ) : (
          <label>Público
            <select value={listaId} onChange={(e) => setListaId(e.target.value)}>
              <option value="">Escolha…</option>
              {listas.map((l) => <option key={l.id} value={l.id}>{l.nome} ({l.total})</option>)}
            </select>
          </label>
        )}
        <p className="suave pequeno">O público pode ser usado nos disparos. Números repetidos (com e sem o 9º dígito) entram uma vez só.</p>
        {erro && <div className="erro pequeno">{erro}</div>}
        <div className="acoes-modal">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-ouro" disabled={enviando || !contatos.length}>
            <Megaphone size={14} /> {enviando ? 'Salvando…' : modo === 'novo' ? 'Criar público' : 'Adicionar ao público'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
