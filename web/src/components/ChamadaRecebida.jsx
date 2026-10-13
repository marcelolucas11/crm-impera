import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video, MessageSquare } from 'lucide-react';
import { api } from '../api.js';
import { useEvento } from '../tempoReal.js';
import Avatar from './Avatar.jsx';
import { formatarTelefone } from '../utils.js';

const RESPOSTAS = [
  'Não posso atender agora. Te ligo em seguida.',
  'Estou em reunião. Pode me mandar uma mensagem?',
  'Te ligo daqui a pouco.',
];

// Aviso de chamada recebida (em qualquer tela do CRM). O CRM não atende: dá para recusar ou recusar com mensagem;
// para atender, use o celular.
export default function ChamadaRecebida({ aoAbrirConversa }) {
  const [chamadas, setChamadas] = useState([]);
  const [comMensagem, setComMensagem] = useState(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const som = useRef(null);

  useEffect(() => {
    api('/whatsapp/chamadas').then((d) => setChamadas(d.chamadas || [])).catch(() => {});
  }, []);

  useEvento('chamada', (c) => {
    if (!c?.id) return;
    setChamadas((l) => {
      const sem = l.filter((x) => x.id !== c.id);
      return c.status === 'encerrada' ? sem : [...sem, c];
    });
    if (c.status === 'encerrada' && comMensagem === c.id) setComMensagem(null);
  });

  // Toque discreto enquanto tocar (gerado no navegador, sem arquivo de som)
  const tocando = chamadas.some((c) => c.status === 'tocando');
  useEffect(() => {
    if (!tocando) return undefined;
    let ctx;
    const tocar = () => {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 520;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.65);
      } catch { /* navegador sem áudio */ }
    };
    tocar();
    som.current = setInterval(tocar, 2200);
    return () => { clearInterval(som.current); ctx?.close?.(); };
  }, [tocando]);

  const recusar = async (c, mensagem = null) => {
    setErro('');
    try {
      await api(`/whatsapp/chamadas/${encodeURIComponent(c.id)}/recusar`, { method: 'POST', body: mensagem ? { mensagem } : {} });
      setChamadas((l) => l.filter((x) => x.id !== c.id));
      setComMensagem(null);
      setTexto('');
    } catch (e) {
      setErro(e.message);
    }
  };

  if (!chamadas.length) return null;
  return (
    <div className="chamadas-recebidas">
      {chamadas.map((c) => (
        <div key={c.id} className="chamada-recebida" role="alertdialog" aria-label="Chamada recebida">
          <div className="chamada-cabeca">
            <Avatar chave={c.chave} nome={c.nome} tamanho={52} />
            <div className="chamada-textos">
              <b>{c.nome || formatarTelefone(c.telefone) || 'Contato'}</b>
              <small>{c.video ? <><Video size={14} /> Chamada de vídeo</> : <><Phone size={14} /> Chamada de voz</>} · {c.status === 'em_andamento' ? 'atendida no celular' : 'tocando…'}</small>
            </div>
          </div>
          {comMensagem === c.id ? (
            <div className="chamada-mensagem">
              {RESPOSTAS.map((r) => <button key={r} type="button" className="btn btn-pequeno" onClick={() => recusar(c, r)}>{r}</button>)}
              <form onSubmit={(e) => { e.preventDefault(); if (texto.trim()) recusar(c, texto.trim()); }}>
                <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva uma mensagem…" />
                <button className="btn btn-pequeno btn-ouro" disabled={!texto.trim()}>Recusar e enviar</button>
              </form>
            </div>
          ) : c.status === 'tocando' ? (
            <div className="chamada-botoes">
              <button type="button" className="btn btn-pequeno btn-recusar" onClick={() => recusar(c)}><PhoneOff size={15} /> Recusar</button>
              <button type="button" className="btn btn-pequeno" onClick={() => setComMensagem(c.id)}><MessageSquare size={15} /> Recusar com mensagem</button>
            </div>
          ) : null}
          <div className="chamada-rodape">
            <button type="button" className="link-botao" onClick={() => aoAbrirConversa?.(c.chave)}>Abrir conversa</button>
            <small className="suave">Para atender, use o celular.</small>
          </div>
          {erro && <div className="erro pequeno">{erro}</div>}
        </div>
      ))}
    </div>
  );
}
