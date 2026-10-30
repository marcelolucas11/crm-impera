// Faixa da IA dentro da conversa de WhatsApp: mostra se a IA está atendendo, o resumo quando ela passa o lead
// para a equipe e, no modo copiloto, a resposta sugerida para aprovar, editar ou descartar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Pause, Play, UserRound, Sparkles } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde } from '../../utils.js';
import './ia.css';

export default function IaConversa({ chave }) {
  const [estado, setEstado] = useState(null);
  const [textos, setTextos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;

  const carregar = useCallback(async () => {
    const pedida = chave;
    try {
      const d = await api(`/ia/conversa?chave=${encodeURIComponent(chave)}`);
      if (chaveAtual.current !== pedida) return;
      setEstado(d);
      setTextos(d.sugestao?.mensagens || []);
    } catch { if (chaveAtual.current === pedida) setEstado(null); }
  }, [chave]);

  useEffect(() => { setEstado(null); setErro(''); carregar(); }, [carregar]);
  useEvento('ia', () => carregar());

  const c = estado?.conversa;
  const s = estado?.sugestao;
  if (!c) return null;

  const agir = async (fn) => {
    setOcupado(true);
    setErro('');
    try { await fn(); await carregar(); } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  };
  const mudarEstado = (status) => agir(() => api('/ia/conversa/estado', { method: 'POST', body: { chave, status } }));
  const aprovar = () => agir(() => api(`/ia/sugestoes/${s.id}/aprovar`, { method: 'POST', body: { mensagens: textos } }));
  const descartar = () => agir(() => api(`/ia/sugestoes/${s.id}/descartar`, { method: 'POST' }));

  return (
    <div className={`ia-faixa ia-faixa-${c.status}`}>
      <div className="ia-faixa-topo">
        <span className="ia-faixa-icone"><Bot size={16} /></span>
        <div className="ia-faixa-texto">
          {c.status === 'ativa' && <><b>IA fazendo o primeiro contato</b> <span className="suave">· {c.mensagens_ia} mensagem(ns) · se você escrever, ela para sozinha</span></>}
          {c.status === 'aguardando_humano' && <><b>A IA passou este lead para você</b> <span className="suave">· {c.motivo} · {tempoDesde(c.atualizada_em)}</span></>}
          {c.status === 'humano' && <span className="suave">IA desligada nesta conversa: a equipe assumiu.</span>}
          {c.status === 'pausada' && <span className="suave">IA pausada nesta conversa.</span>}
          {c.status === 'erro' && <span className="alerta">A IA teve um problema nesta conversa.</span>}
        </div>
        <div className="ia-faixa-acoes">
          {c.status === 'ativa' && <>
            <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => mudarEstado('aguardando_humano')} title="Tirar a IA e marcar como aguardando você"><UserRound size={13} /> Assumir</button>
            <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => mudarEstado('pausada')}><Pause size={13} /> Pausar</button>
          </>}
          {(c.status === 'pausada' || c.status === 'aguardando_humano') && (
            <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => mudarEstado('ativa')} title="A IA volta a responder as próximas mensagens do lead"><Play size={13} /> Devolver para a IA</button>
          )}
        </div>
      </div>

      {c.resumo && c.status !== 'humano' && <p className="ia-resumo"><Sparkles size={12} /> {c.resumo}</p>}

      {s && (
        <div className="ia-sugestao">
          <div className="ia-sugestao-titulo">
            <b>Resposta sugerida pela IA</b>
            {s.acao === 'passar_humano' && <span className="ia-etiqueta">depois dela, o lead fica com você</span>}
          </div>
          {textos.map((t, i) => (
            <textarea key={i} rows={Math.min(5, Math.max(2, Math.ceil(t.length / 70)))} value={t}
              onChange={(e) => setTextos((l) => l.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Mensagem sugerida ${i + 1}`} />
          ))}
          <div className="ia-sugestao-acoes">
            <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={descartar}><X size={13} /> Descartar</button>
            <button type="button" className="btn btn-ouro btn-pequeno" disabled={ocupado || !textos.some((t) => t.trim())} onClick={aprovar}><Send size={13} /> Enviar</button>
          </div>
        </div>
      )}
      {erro && <p className="alerta pequeno" onClick={() => setErro('')}>{erro}</p>}
    </div>
  );
}
