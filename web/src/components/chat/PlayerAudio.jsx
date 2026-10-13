import { useEffect, useRef, useState } from 'react';
import { rota } from '../../base.js';
import { Mic } from 'lucide-react';

// O Safari antigo não toca OGG/Opus (formato das mensagens de voz): pede uma versão convertida
const tocaOgg = typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs="opus"') !== '';
let tocandoAgora = null;

const tempo = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// Player de áudio no estilo do WhatsApp: play, barra, tempo e velocidade 1x / 1,5x / 2x
export default function PlayerAudio({ id, segundos, ptt, avatar }) {
  const ref = useRef(null);
  const [ativo, setAtivo] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(segundos || 0);
  const [velocidade, setVelocidade] = useState(1);
  const [erro, setErro] = useState('');
  const querTocar = useRef(false);

  const src = rota(`/api/whatsapp/midia/${id}${tocaOgg ? '' : '?compat=1'}`);

  useEffect(() => {
    if (ativo && querTocar.current && ref.current) {
      querTocar.current = false;
      ref.current.play().catch(() => {});
    }
  }, [ativo]);

  useEffect(() => () => { if (tocandoAgora === ref.current) tocandoAgora = null; }, []);

  const alternar = () => {
    setErro('');
    if (!ativo) {
      querTocar.current = true;
      setCarregando(true);
      setAtivo(true);
      return;
    }
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const mudarVelocidade = () => {
    const nova = velocidade === 1 ? 1.5 : velocidade === 1.5 ? 2 : 1;
    setVelocidade(nova);
    if (ref.current) ref.current.playbackRate = nova;
  };

  const progresso = duracao ? Math.min(100, (atual / duracao) * 100) : 0;

  return (
    <div className={`player-audio ${ptt ? 'voz' : ''}`}>
      {ptt && avatar && <span className="player-avatar">{avatar}<span className="player-mic"><Mic size={13} /></span></span>}
      <button type="button" className="player-botao" onClick={alternar} aria-label={tocando ? 'Pausar' : 'Tocar'}>
        {carregando ? <span className="girando" /> : tocando ? (
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div className="player-meio">
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progresso}
          style={{ '--progresso': `${progresso}%` }}
          onChange={(e) => {
            const a = ref.current;
            if (a && duracao) { a.currentTime = (Number(e.target.value) / 100) * duracao; setAtual(a.currentTime); }
          }}
          disabled={!ativo}
          aria-label="Posição do áudio"
        />
        <div className="player-tempos">
          <span>{erro || tempo(tocando || atual ? atual : duracao)}</span>
          {(tocando || velocidade !== 1) && <button type="button" className="player-velocidade" onClick={mudarVelocidade}>{String(velocidade).replace('.', ',')}x</button>}
        </div>
      </div>
      {ativo && (
        <audio
          ref={ref}
          src={src}
          preload="auto"
          onPlay={(e) => {
            if (tocandoAgora && tocandoAgora !== e.currentTarget) tocandoAgora.pause();
            tocandoAgora = e.currentTarget;
            e.currentTarget.playbackRate = velocidade;
            setTocando(true);
            setCarregando(false);
          }}
          onPause={() => setTocando(false)}
          onEnded={() => { setTocando(false); setAtual(0); }}
          onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuracao(e.currentTarget.duration); }}
          onError={() => { setCarregando(false); setTocando(false); setErro('Áudio indisponível'); setAtivo(false); }}
        />
      )}
    </div>
  );
}
