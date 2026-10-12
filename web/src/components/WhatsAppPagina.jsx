import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatarTelefone, horaMensagem, iniciais } from '../utils.js';
import Conversa from './Conversa.jsx';
import LeadFicha from './LeadFicha.jsx';

const FILTROS = [
  ['todas', 'Todas'],
  ['nao_lidas', 'Não lidas'],
  ['leads', 'Leads'],
  ['contatos', 'Não são leads'],
  ['aguardando', '⏳ Aguardando'],
];

// Tela de WhatsApp dentro do CRM: conversas à esquerda, chat no meio, ficha do lead à direita
export default function WhatsAppPagina({ user, stages, users, horas, aoMudarAlgo, setErro }) {
  const [conversas, setConversas] = useState([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [aberta, setAberta] = useState(null);
  const [numeros, setNumeros] = useState(null);
  const [transformando, setTransformando] = useState(false);
  const [carregou, setCarregou] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const p = new URLSearchParams({ filtro });
      if (busca.trim()) p.set('q', busca.trim());
      const d = await api(`/whatsapp/conversas?${p}`);
      setConversas(d.conversas);
      setCarregou(true);
    } catch (e) {
      setErro(e.message);
    }
  }, [busca, filtro, setErro]);

  useEffect(() => {
    const t = setTimeout(carregar, 200);
    const id = setInterval(() => { if (!document.hidden) carregar(); }, 4000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [carregar]);

  useEffect(() => {
    api('/whatsapp/numeros').then((d) => setNumeros(d.numeros)).catch(() => setNumeros([]));
  }, []);

  // Mantém a conversa aberta mesmo se o filtro da lista deixar de mostrá-la
  const [ultimaAberta, setUltimaAberta] = useState(null);
  const conversa = conversas.find((c) => c.chave === aberta) || (ultimaAberta?.chave === aberta ? ultimaAberta : null);
  const conectados = (numeros || []).filter((n) => n.status === 'conectado');

  const abrir = (c) => {
    setAberta(c.chave);
    setUltimaAberta(c);
    // A lista atualiza a contagem de não lidas no próximo ciclo; zera já na tela
    setConversas((cs) => cs.map((x) => (x.chave === c.chave ? { ...x, nao_lidas: 0 } : x)));
    setTimeout(aoMudarAlgo, 800);
  };

  const transformar = async () => {
    setTransformando(true);
    try {
      const d = await api(`/whatsapp/conversas/${encodeURIComponent(aberta)}/lead`, { method: 'POST' });
      setUltimaAberta((c) => ({ ...c, chave: d.chave, lead_id: d.lead_id }));
      setAberta(d.chave);
      await carregar();
      aoMudarAlgo();
    } catch (e) {
      setErro(e.message);
    } finally {
      setTransformando(false);
    }
  };

  return (
    <div className="whatsapp-tela">
      <aside className="lista-conversas">
        <div className="lista-topo">
          <input type="search" placeholder="Buscar nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="filtros-conversas">
            {FILTROS.map(([id, rotulo]) => (
              <button key={id} className={`chip chip-pequeno ${filtro === id ? 'ativo' : ''}`} onClick={() => setFiltro(id)}>{rotulo}</button>
            ))}
          </div>
        </div>

        <div className="itens-conversas">
          {numeros && numeros.length === 0 && (
            <div className="vazio-conversas">
              Nenhum número de WhatsApp conectado ainda.
              {user.role === 'admin' ? <> Conecte em <b>Equipe e integrações</b> (menu do seu avatar).</> : ' Peça a um administrador para conectar.'}
            </div>
          )}
          {carregou && conversas.length === 0 && numeros?.length > 0 && (
            <div className="vazio-conversas">{busca || filtro !== 'todas' ? 'Nenhuma conversa com esse filtro.' : 'As conversas aparecem aqui assim que alguém mandar mensagem.'}</div>
          )}
          {conversas.map((c) => (
            <button key={c.chave} className={`item-conversa ${aberta === c.chave ? 'aberta' : ''}`} onClick={() => abrir(c)}>
              <span className={`avatar-conversa ${c.lead_id ? 'lead' : ''}`}>{iniciais(c.nome || '') || '#'}</span>
              <span className="item-meio">
                <span className="item-linha">
                  <b className="item-nome">{c.nome || formatarTelefone(c.telefone) || 'Contato'}</b>
                  <small className="suave">{horaMensagem(c.ultima_em)}</small>
                </span>
                <span className="item-linha">
                  <span className={`item-previa ${c.nao_lidas ? 'forte' : ''}`}>{c.ultima_minha ? 'Você: ' : ''}{c.ultima_mensagem}</span>
                  {c.nao_lidas > 0 && <span className="contador-nao-lidas">{c.nao_lidas}</span>}
                </span>
                <span className="item-tags">
                  {c.lead_id ? (
                    <span className="tag tag-etapa"><span className="ponto" style={{ background: c.etapa?.cor }} />{c.etapa?.nome}</span>
                  ) : (
                    <span className="tag">Não é lead</span>
                  )}
                  {c.aguardando && <span className="tag tag-aguardando">⏳ aguardando</span>}
                  {c.atrasado && <span className="tag tag-atrasado">⚠ follow-up</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat">
        {!conversa ? (
          <div className="chat-vazio">
            <div className="marca marca-grande">IMPERA <span>CRM</span></div>
            <p className="suave">Escolha uma conversa à esquerda.</p>
            {conectados.length > 0 && <p className="suave pequeno">Conectados: {conectados.map((n) => n.name).join(', ')}</p>}
          </div>
        ) : (
          <>
            <div className="chat-topo">
              <button className="btn btn-pequeno voltar-lista" onClick={() => setAberta(null)} aria-label="Voltar para as conversas">←</button>
              <span className={`avatar-conversa ${conversa.lead_id ? 'lead' : ''}`}>{iniciais(conversa.nome || '') || '#'}</span>
              <div>
                <b>{conversa.nome || formatarTelefone(conversa.telefone) || 'Contato'}</b>
                <small className="suave">{conversa.telefone ? formatarTelefone(conversa.telefone) : 'telefone oculto pelo WhatsApp'}{conversa.lead_id ? ` · lead em ${conversa.etapa?.nome}` : ' · ainda não é lead'}</small>
              </div>
            </div>
            <Conversa chave={conversa.chave} cheia onEnviado={() => { carregar(); aoMudarAlgo(); }} />
          </>
        )}
      </section>

      {conversa && (
        <aside className="ficha-lateral">
          {conversa.lead_id ? (
            <LeadFicha
              key={conversa.lead_id}
              leadId={conversa.lead_id}
              stages={stages}
              users={users}
              user={user}
              horas={horas}
              onAtualizado={() => { carregar(); aoMudarAlgo(); }}
            />
          ) : (
            <div className="nao-lead">
              <h3>{conversa.nome || 'Contato do WhatsApp'}</h3>
              <p className="suave">{conversa.telefone ? formatarTelefone(conversa.telefone) : 'O WhatsApp não mostrou o telefone deste contato.'}</p>
              <p>Este contato ainda não é lead. Transforme em lead para colocá-lo no kanban, acompanhar o follow-up e fazer anotações.</p>
              <button className="btn btn-ouro" onClick={transformar} disabled={transformando}>{transformando ? 'Criando…' : '+ Transformar em lead'}</button>
              <p className="suave pequeno">Se já existir um lead com este telefone (do Yay! Forms, por exemplo), a conversa é ligada a ele em vez de criar outro.</p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
