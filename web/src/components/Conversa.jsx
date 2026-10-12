import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { horaMensagem } from '../utils.js';

const ATUALIZAR_MS = 4000;

// Conversa de WhatsApp do lead: histórico + envio pelo número escolhido
export default function Conversa({ leadId, onEnviado }) {
  const [mensagens, setMensagens] = useState([]);
  const [numeros, setNumeros] = useState([]);
  const [numeroId, setNumeroId] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const lista = useRef(null);
  const quantidade = useRef(0);

  const carregar = useCallback(async () => {
    try {
      const d = await api(`/leads/${leadId}/mensagens`);
      setMensagens(d.mensagens);
      setNumeroId((atual) => atual || (d.ultimo_numero ? String(d.ultimo_numero) : ''));
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [leadId]);

  const carregarNumeros = useCallback(async () => {
    try {
      const d = await api('/whatsapp/numeros');
      setNumeros(d.numeros);
    } catch { /* idem */ }
  }, []);

  useEffect(() => {
    carregar();
    carregarNumeros();
    const a = setInterval(() => { if (!document.hidden) carregar(); }, ATUALIZAR_MS);
    const b = setInterval(carregarNumeros, 15000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [carregar, carregarNumeros]);

  // Escolhe um número conectado se nenhum válido estiver selecionado
  const conectados = numeros.filter((n) => n.status === 'conectado');
  useEffect(() => {
    if (!conectados.length) return;
    if (!conectados.some((n) => String(n.id) === numeroId)) setNumeroId(String(conectados[0].id));
  }, [conectados, numeroId]);

  // Rola para a última mensagem quando chega algo novo
  useEffect(() => {
    if (mensagens.length !== quantidade.current && lista.current) {
      lista.current.scrollTop = lista.current.scrollHeight;
    }
    quantidade.current = mensagens.length;
  }, [mensagens]);

  const enviar = async (e) => {
    e?.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo || !numeroId || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await api(`/leads/${leadId}/mensagens`, { method: 'POST', body: { texto: conteudo, numero_id: Number(numeroId) } });
      setTexto('');
      await carregar();
      onEnviado?.();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="conversa">
      <div className="conversa-lista" ref={lista}>
        {mensagens.length === 0 && <div className="conversa-vazia">Nenhuma mensagem de WhatsApp com este lead ainda.</div>}
        {mensagens.map((m) => (
          <div key={m.id} className={`bolha ${m.from_me ? 'minha' : 'dele'} ${m.type !== 'texto' ? 'midia' : ''}`}>
            <div className="bolha-texto">{m.body}</div>
            <div className="bolha-info">
              {horaMensagem(m.timestamp)}
              {m.from_me && (m.enviado_por ? ` · ${m.enviado_por}` : ' · pelo celular')}
              {numeros.length > 1 && m.numero_nome ? ` · ${m.numero_nome}` : ''}
            </div>
          </div>
        ))}
      </div>

      {conectados.length === 0 ? (
        <p className="suave pequeno">Nenhum WhatsApp conectado. Um administrador conecta em <b>Equipe e integrações</b>.</p>
      ) : (
        <form className="conversa-envio" onSubmit={enviar}>
          {conectados.length > 1 && (
            <select value={numeroId} onChange={(e) => setNumeroId(e.target.value)} title="Número que vai enviar">
              {conectados.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          )}
          <textarea
            rows={2}
            placeholder={`Mensagem pelo ${conectados.find((n) => String(n.id) === numeroId)?.name || 'WhatsApp'}… (Enter envia)`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) enviar(e); }}
          />
          <button className="btn btn-whats" disabled={!texto.trim() || enviando}>{enviando ? '…' : 'Enviar'}</button>
        </form>
      )}
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}
