// Prévia ao vivo no estilo do WhatsApp: como o contato vai ver cada bloco, com as esperas entre eles.
// "Simular" toca o fluxo no tempo real (com o "digitando…" no topo); "Sortear" troca as opções do Spintax.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Shuffle, Mic, FileText, Video, Timer, CheckCheck, Image as ImageIcon } from 'lucide-react';
import { TextoFormatado } from '../chat/formatacao.jsx';
import { urlMidia } from './comum.jsx';
import { renderizar, duracaoCurta } from './texto.js';

const PRESENCA = { composing: 'digitando…', recording: 'gravando áudio…' };

function Bolha({ bloco, texto, hora }) {
  const m = bloco.midia;
  const mime = m?.mime || '';
  return (
    <div className="dp-pv-bolha">
      {bloco.tipo === 'imagem' && (m ? <img src={urlMidia(m.id)} alt="" className="dp-pv-img" /> : <div className="dp-pv-sem"><ImageIcon size={22} /> Imagem</div>)}
      {bloco.tipo === 'video' && (m ? <video src={urlMidia(m.id)} className="dp-pv-img" muted preload="metadata" /> : <div className="dp-pv-sem"><Video size={22} /> Vídeo</div>)}
      {bloco.tipo === 'audio' && (
        <div className="dp-pv-audio">
          <span className={`dp-pv-audio-icone ${bloco.ptt ? 'ptt' : ''}`}><Mic size={15} /></span>
          <span className="dp-pv-onda">{Array.from({ length: 26 }, (_, i) => <i key={i} style={{ height: `${25 + ((i * 37) % 70)}%` }} />)}</span>
          <span className="dp-pv-audio-tempo">{bloco.ptt ? 'voz' : mime.split('/')[1] || 'áudio'}</span>
        </div>
      )}
      {bloco.tipo === 'arquivo' && (
        <div className="dp-pv-doc"><FileText size={22} /><span>{bloco.nome_arquivo || m?.nome || 'documento'}</span></div>
      )}
      {texto && <div className="dp-pv-texto"><TextoFormatado texto={texto} /></div>}
      {!texto && bloco.tipo === 'texto' && <div className="dp-pv-texto suave"><i>(mensagem vazia — este bloco é pulado)</i></div>}
      <span className="dp-pv-hora">{hora} <CheckCheck size={13} /></span>
    </div>
  );
}

export default function PreviaWhatsApp({ blocos, variaveis = {}, nome = 'Contato', atrasoInicial = null }) {
  const [semente, setSemente] = useState(0);
  const [simulando, setSimulando] = useState(null); // { mostrados, presenca }
  const timers = useRef([]);
  const fundo = useRef(null);

  // Sorteio estável por semente (0 = sempre a 1ª opção)
  const textos = useMemo(() => {
    let s = semente;
    const sorteio = semente ? () => { s = (s * 9301 + 49297) % 233280; return s / 233280; } : () => 0;
    return blocos.map((b) => (b.tipo === 'audio' ? '' : renderizar(b.texto, variaveis, sorteio)));
  }, [blocos, variaveis, semente]);

  const parar = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSimulando(null);
  };
  useEffect(() => parar, []);
  useEffect(() => { if (simulando) parar(); /* fluxo mudou: para a simulação */ }, [blocos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fundo.current?.scrollTo({ top: fundo.current.scrollHeight, behavior: 'smooth' }); }, [simulando?.mostrados, textos]);

  const simular = () => {
    parar();
    let t = 0;
    setSimulando({ mostrados: 0, presenca: null });
    blocos.forEach((b, i) => {
      const espera = Math.min(b.espera?.segundos || 0, 30) * 1000;
      const pres = b.espera?.presenca !== 'nenhuma' ? b.espera?.presenca : null;
      timers.current.push(setTimeout(() => setSimulando({ mostrados: i, presenca: pres }), t));
      t += Math.max(espera, 400);
      timers.current.push(setTimeout(() => setSimulando({ mostrados: i + 1, presenca: null }), t));
    });
    timers.current.push(setTimeout(() => setSimulando((s) => (s ? { ...s, fim: true } : s)), t + 1500));
  };

  const agora = new Date();
  const hora = (i) => {
    const seg = blocos.slice(0, i + 1).reduce((a, b) => a + (b.espera?.segundos || 0), 0) + (atrasoInicial || 0);
    return new Date(agora.getTime() + seg * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const visiveis = simulando ? simulando.mostrados : blocos.length;
  const total = blocos.reduce((a, b) => a + (b.espera?.segundos || 0), 0) + (atrasoInicial || 0);

  return (
    <div className="dp-previa">
      <div className="dp-previa-acoes">
        <span className="suave pequeno"><Timer size={13} /> {duracaoCurta(total)} por contato</span>
        <span className="espaco" />
        <button type="button" className="btn btn-pequeno" onClick={() => setSemente((x) => x + 1)} title="Sortear outras opções do Spintax"><Shuffle size={13} /> Sortear</button>
        {simulando ? (
          <button type="button" className="btn btn-pequeno" onClick={parar}><Square size={12} /> Parar</button>
        ) : (
          <button type="button" className="btn btn-pequeno btn-verde-leve" onClick={simular} disabled={!blocos.length}><Play size={13} /> Simular</button>
        )}
      </div>
      <div className="dp-celular">
        <div className="dp-cel-topo">
          <span className="dp-cel-avatar">{(nome || '?').charAt(0).toUpperCase()}</span>
          <div>
            <b>{nome}</b>
            <small>{simulando?.presenca ? <span className="dp-cel-digitando">{PRESENCA[simulando.presenca]}</span> : 'online'}</small>
          </div>
        </div>
        <div className="dp-cel-fundo" ref={fundo}>
          {atrasoInicial ? <div className="dp-pv-espera">Formulário enviado · {duracaoCurta(atrasoInicial)} depois…</div> : null}
          {blocos.slice(0, visiveis).map((b, i) => (
            <div key={b.id} className="dp-pv-item">
              {!simulando && (b.espera?.segundos > 0) && (
                <div className="dp-pv-espera"><Timer size={11} /> {duracaoCurta(b.espera.segundos)}{b.espera.presenca !== 'nenhuma' ? ` · ${PRESENCA[b.espera.presenca]}` : ''}</div>
              )}
              <Bolha bloco={b} texto={textos[i]} hora={hora(i)} />
            </div>
          ))}
          {simulando?.presenca && (
            <div className="dp-pv-digitando"><span /><span /><span /></div>
          )}
          {!blocos.length && <div className="dp-pv-espera">A prévia aparece aqui</div>}
        </div>
      </div>
    </div>
  );
}
