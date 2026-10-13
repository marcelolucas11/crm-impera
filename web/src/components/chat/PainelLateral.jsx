// Painel à direita da conversa (recolhível): ficha do lead, dados do contato/grupo, busca na conversa e favoritas
import { useEffect, useState } from 'react';
import { X, Search, Star, Timer, ExternalLink, Users, Play } from 'lucide-react';
import { api } from '../../api.js';
import { rota } from '../../base.js';
import { formatarTelefone, dataHora } from '../../utils.js';
import { useEvento } from '../../tempoReal.js';
import LeadFicha from '../LeadFicha.jsx';
import Avatar from '../Avatar.jsx';
import { realcar } from './formatacao.jsx';
import { quando } from './ListaConversas.jsx';

const TEMPORARIAS = [[0, 'Desligado'], [86400, '24 horas'], [604800, '7 dias'], [7776000, '90 dias']];

function DadosContato({ conversa, numeroId, onTransformar, transformando, onAbrirMidia }) {
  const [dados, setDados] = useState(null);
  const [temporarias, setTemporarias] = useState(conversa.temporarias || 0);
  const [erro, setErro] = useState('');
  const url = `/whatsapp/conversas/${encodeURIComponent(conversa.chave)}`;
  useEffect(() => { api(`${url}/contato`).then(setDados).catch((e) => setErro(e.message)); }, [url]);
  useEffect(() => setTemporarias(conversa.temporarias || 0), [conversa.temporarias]);

  const mudarTemporarias = async (s) => {
    if (!confirm(s ? `Ligar mensagens temporárias (${TEMPORARIAS.find((t) => t[0] === s)[1]}) nesta conversa? O contato será avisado.` : 'Desligar as mensagens temporárias?')) return;
    try {
      await api(`${url}/temporarias`, { method: 'POST', body: { segundos: s, numero_id: Number(numeroId) } });
      setTemporarias(s);
    } catch (e) { setErro(e.message); }
  };

  return (
    <div className="dados-contato">
      <div className="dados-topo">
        <Avatar chave={conversa.chave} nome={conversa.nome} tamanho={160} lead={Boolean(conversa.lead_id)} grupo={conversa.grupo} />
        <h3>{conversa.nome || formatarTelefone(conversa.telefone) || 'Contato'}</h3>
        {conversa.grupo ? (
          <p className="suave">Grupo · {dados?.participantes?.length || 0} participantes vistos</p>
        ) : (
          <p className="suave">{conversa.telefone ? formatarTelefone(conversa.telefone) : 'O WhatsApp não mostrou o telefone deste contato.'}</p>
        )}
        {dados?.apelido && !conversa.grupo && <p className="suave pequeno">~{dados.apelido}{dados.nome_agenda ? ` · na agenda: ${dados.nome_agenda}` : ''}</p>}
      </div>

      {!conversa.grupo && !conversa.lead_id && (
        <div className="dados-bloco">
          <p className="pequeno">Este contato ainda não é lead. Transforme em lead para colocá-lo no kanban, acompanhar o follow-up e fazer anotações.</p>
          <button className="btn btn-ouro" onClick={onTransformar} disabled={transformando}>{transformando ? 'Criando…' : '+ Transformar em lead'}</button>
          <p className="suave pequeno">Se já existir um lead com este telefone (do Yay! Forms, por exemplo), a conversa é ligada a ele.</p>
        </div>
      )}
      {conversa.grupo && <p className="dados-bloco suave pequeno"><Users size={14} /> Grupos ficam só na tela de WhatsApp: nunca viram lead.</p>}

      {dados?.midias?.length > 0 && (
        <div className="dados-bloco">
          <b className="dados-titulo">Mídia ({dados.contagem?.midias || 0}) · Docs ({dados.contagem?.documentos || 0})</b>
          <div className="grade-midias">
            {dados.midias.map((m) => (
              <button key={m.id} type="button" onClick={() => onAbrirMidia({ id: m.id, tipo: m.type, titulo: dataHora(m.timestamp) })}>
                <img src={m.thumb ? `data:image/jpeg;base64,${m.thumb}` : rota(`/api/whatsapp/midia/${m.id}`)} alt="" loading="lazy" />
                {m.type === 'video' && <span className="grade-video"><Play size={18} fill="currentColor" /></span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dados-bloco">
        <b className="dados-titulo"><Timer size={15} /> Mensagens temporárias</b>
        <select value={temporarias} onChange={(e) => mudarTemporarias(Number(e.target.value))} disabled={!numeroId}>
          {TEMPORARIAS.map(([s, r]) => <option key={s} value={s}>{r}</option>)}
        </select>
      </div>

      {dados?.participantes?.length > 0 && (
        <div className="dados-bloco">
          <b className="dados-titulo">Participantes que já escreveram</b>
          {dados.participantes.map((p) => (
            <div key={p.jid} className="participante">
              <span>{p.nome || formatarTelefone(p.telefone) || p.jid.split('@')[0]}</span>
              <small className="suave">{p.telefone ? formatarTelefone(p.telefone) : ''} · {p.mensagens} msg</small>
            </div>
          ))}
        </div>
      )}
      {dados?.contagem && (
        <p className="dados-bloco suave pequeno">
          {dados.contagem.total} mensagens no CRM{dados.contagem.primeira ? ` desde ${dataHora(dados.contagem.primeira)}` : ''} · {dados.contagem.favoritas || 0} favoritas
        </p>
      )}
      {conversa.telefone && !conversa.grupo && (
        <a className="dados-link" href={`https://web.whatsapp.com/send?phone=${conversa.telefone}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir no WhatsApp Web</a>
      )}
      {erro && <div className="erro pequeno">{erro}</div>}
    </div>
  );
}

function BuscaNaConversa({ chave, onIr }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  useEffect(() => {
    if (q.trim().length < 2) { setResultados(null); return undefined; }
    const t = setTimeout(() => {
      api(`/whatsapp/conversas/${encodeURIComponent(chave)}/buscar?q=${encodeURIComponent(q.trim())}`).then((d) => setResultados(d.resultados)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, chave]);
  return (
    <div className="busca-conversa">
      <label className="campo-busca"><Search size={17} /><input autoFocus type="text" placeholder="Pesquisar mensagens…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {resultados && !resultados.length && <p className="suave pequeno">Nenhuma mensagem encontrada.</p>}
      {!resultados && <p className="suave pequeno">Procure por palavras das mensagens desta conversa (inclusive as do histórico importado).</p>}
      {resultados?.map((r) => (
        <button key={r.id} type="button" className="item-resultado" onClick={() => onIr(r.id)}>
          <small className="suave">{quando(r.timestamp)}</small>
          <span>{r.from_me && 'Você: '}{realcar(r.texto, q.trim())}</span>
        </button>
      ))}
    </div>
  );
}

function Favoritas({ chave, onIr }) {
  const [lista, setLista] = useState(null);
  const carregar = () => api(chave ? `/whatsapp/conversas/${encodeURIComponent(chave)}/favoritas` : '/whatsapp/favoritas').then((d) => setLista(d.mensagens)).catch(() => {});
  useEffect(() => { carregar(); }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  useEvento('whatsapp', () => carregar());
  return (
    <div className="busca-conversa">
      {!lista && <span className="girando" />}
      {lista && !lista.length && <p className="suave pequeno">Nenhuma mensagem favorita. Use Favoritar no menu de uma mensagem.</p>}
      {lista?.map((m) => (
        <button key={m.id} type="button" className="item-resultado" onClick={() => onIr(m.id, m.chave)}>
          <small className="suave"><Star size={11} fill="currentColor" /> {quando(m.timestamp)} · {m.from_me ? 'Você' : m.participant_name || 'Contato'}</small>
          <span>{m.legenda || m.body}</span>
        </button>
      ))}
    </div>
  );
}

export default function PainelLateral({
  modo, conversa, onFechar, stages, users, user, horas, onAtualizado, onTransformar, transformando, numeroId, onIrPara, onAbrirMidia,
}) {
  const titulos = { ficha: conversa?.lead_id ? 'Ficha do lead' : conversa?.grupo ? 'Dados do grupo' : 'Dados do contato', busca: 'Pesquisar mensagens', favoritas: 'Mensagens favoritas', contato: conversa?.grupo ? 'Dados do grupo' : 'Dados do contato' };
  return (
    <aside className="ficha-lateral">
      <div className="painel-lateral-topo">
        <button type="button" className="botao-icone" onClick={onFechar} aria-label="Fechar painel"><X size={20} /></button>
        <b>{titulos[modo]}</b>
      </div>
      <div className="painel-lateral-corpo">
        {modo === 'ficha' && conversa?.lead_id && (
          <LeadFicha key={conversa.lead_id} leadId={conversa.lead_id} stages={stages} users={users} user={user} horas={horas} onAtualizado={onAtualizado} />
        )}
        {modo === 'ficha' && conversa && !conversa.lead_id && (
          <DadosContato conversa={conversa} numeroId={numeroId} onTransformar={onTransformar} transformando={transformando} onAbrirMidia={onAbrirMidia} />
        )}
        {modo === 'contato' && conversa && (
          <DadosContato conversa={conversa} numeroId={numeroId} onTransformar={onTransformar} transformando={transformando} onAbrirMidia={onAbrirMidia} />
        )}
        {modo === 'busca' && conversa && <BuscaNaConversa chave={conversa.chave} onIr={onIrPara} />}
        {modo === 'favoritas' && <Favoritas chave={conversa?.chave || null} onIr={onIrPara} />}
      </div>
    </aside>
  );
}

export { DadosContato };
