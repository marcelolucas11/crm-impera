import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GRUPOS } from './emojis.js';

const TIPOS_GRAVACAO = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
const relogio = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function SeletorEmoji({ onEscolher, onFechar }) {
  const [grupo, setGrupo] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.botao-emoji')) onFechar(); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [onFechar]);
  return (
    <div className="seletor-emoji" ref={ref}>
      <div className="seletor-abas">
        {GRUPOS.map(([nome, lista], i) => (
          <button key={nome} type="button" className={grupo === i ? 'ativa' : ''} onClick={() => setGrupo(i)} title={nome}>{lista[0]}</button>
        ))}
      </div>
      <div className="seletor-grade">
        {GRUPOS[grupo][1].map((e) => <button key={e} type="button" onClick={() => onEscolher(e)}>{e}</button>)}
      </div>
    </div>
  );
}

// Barra de digitação: emoji, anexo, texto e gravação de áudio (como no WhatsApp)
export default function Compositor({
  conectados, numeroId, setNumeroId, respondendo, nomeContato, onCancelarResposta,
  onEnviarTexto, onSelecionarArquivos, onEnviarVoz, foco,
}) {
  const [texto, setTexto] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [anexo, setAnexo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState('');
  const campo = useRef(null);
  const midiaInput = useRef(null);
  const docInput = useRef(null);
  const audioInput = useRef(null);
  const gravacao = useRef(null);
  const menuAnexo = useRef(null);

  // Campo cresce até 6 linhas
  useLayoutEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight, 140)}px`;
  }, [texto]);

  useEffect(() => { if (respondendo || foco) campo.current?.focus(); }, [respondendo, foco]);

  useEffect(() => {
    if (!anexo) return undefined;
    const fora = (e) => { if (menuAnexo.current && !menuAnexo.current.contains(e.target)) setAnexo(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [anexo]);

  // Ao sair da tela no meio de uma gravação, descarta
  useEffect(() => () => {
    const g = gravacao.current;
    if (g) {
      clearInterval(g.timer);
      g.descartar = true;
      try { g.rec.stop(); } catch { /* já parado */ }
      g.stream.getTracks().forEach((t) => t.stop());
    }
  }, []);

  const enviar = () => {
    const conteudo = texto.trim();
    if (!conteudo) return;
    setTexto('');
    onEnviarTexto(conteudo);
  };

  const inserirEmoji = (e) => {
    const c = campo.current;
    if (!c) { setTexto((t) => t + e); return; }
    const ini = c.selectionStart ?? texto.length;
    const fim = c.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + e + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => { c.focus(); c.setSelectionRange(ini + e.length, ini + e.length); });
  };

  const escolherArquivos = (lista, modo) => {
    const arquivos = [...(lista || [])];
    if (arquivos.length) onSelecionarArquivos(arquivos, modo, texto.trim());
    if (arquivos.length && texto.trim()) setTexto('');
  };

  const iniciarGravacao = async () => {
    setErro('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErro('Para gravar áudio, abra o CRM pelo endereço http://localhost ou por https.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setErro('O navegador não liberou o microfone. Clique no cadeado da barra de endereço e permita o microfone.');
      return;
    }
    const mime = TIPOS_GRAVACAO.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const partes = [];
    const g = { rec, stream, partes, inicio: Date.now(), descartar: false, timer: null };
    rec.ondataavailable = (e) => { if (e.data?.size) partes.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const duracao = (Date.now() - g.inicio) / 1000;
      if (!g.descartar && duracao >= 1 && partes.length) {
        const tipo = rec.mimeType || mime || 'audio/webm';
        onEnviarVoz(new Blob(partes, { type: tipo }), tipo);
      }
    };
    rec.start(250);
    g.timer = setInterval(() => setSegundos(Math.floor((Date.now() - g.inicio) / 1000)), 250);
    gravacao.current = g;
    setSegundos(0);
    setGravando(true);
  };

  const pararGravacao = (enviarAudio) => {
    const g = gravacao.current;
    if (!g) return;
    clearInterval(g.timer);
    g.descartar = !enviarAudio;
    try { g.rec.stop(); } catch { /* já parado */ }
    gravacao.current = null;
    setGravando(false);
  };

  const numeroAtual = conectados.find((n) => String(n.id) === numeroId);

  return (
    <div className="compositor">
      {respondendo && (
        <div className="respondendo">
          <div className={`citacao ${respondendo.from_me ? 'de-mim' : ''}`}>
            <b>{respondendo.from_me ? 'Você' : nomeContato}</b>
            <span>{respondendo.type === 'texto' ? respondendo.body : respondendo.legenda || respondendo.body}</span>
          </div>
          <button type="button" className="botao-icone" onClick={onCancelarResposta} aria-label="Cancelar resposta">✕</button>
        </div>
      )}
      {erro && <div className="compositor-erro" onClick={() => setErro('')}>{erro} <span>✕</span></div>}

      {gravando ? (
        <div className="barra-gravacao">
          <button type="button" className="botao-icone" onClick={() => pararGravacao(false)} aria-label="Descartar áudio" title="Descartar">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z" /></svg>
          </button>
          <span className="ponto-gravando" />
          <span className="tempo-gravacao">{relogio(segundos)}</span>
          <span className="onda-gravacao" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 7) * 0.12}s` }} />)}</span>
          <button type="button" className="botao-enviar" onClick={() => pararGravacao(true)} aria-label="Enviar áudio" title="Enviar áudio">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" /></svg>
          </button>
        </div>
      ) : (
        <div className="barra-digitacao">
          {conectados.length > 1 && (
            <select className="seletor-numero" value={numeroId} onChange={(e) => setNumeroId(e.target.value)} title="Número que vai enviar">
              {conectados.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          )}
          <div className="posicao-relativa">
            <button type="button" className="botao-icone botao-emoji" onClick={() => setEmoji((v) => !v)} aria-label="Emojis" title="Emojis">
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m-3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M12 17.5c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5" /></svg>
            </button>
            {emoji && <SeletorEmoji onEscolher={inserirEmoji} onFechar={() => setEmoji(false)} />}
          </div>
          <div className="posicao-relativa" ref={menuAnexo}>
            <button type="button" className={`botao-icone ${anexo ? 'ativo' : ''}`} onClick={() => setAnexo((v) => !v)} aria-label="Anexar" title="Anexar">
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z" /></svg>
            </button>
            {anexo && (
              <div className="menu-anexo">
                <button type="button" onClick={() => { setAnexo(false); midiaInput.current?.click(); }}><span className="icone-anexo roxo">🖼</span> Fotos e vídeos</button>
                <button type="button" onClick={() => { setAnexo(false); docInput.current?.click(); }}><span className="icone-anexo azul">📄</span> Documento</button>
                <button type="button" onClick={() => { setAnexo(false); audioInput.current?.click(); }}><span className="icone-anexo laranja">🎵</span> Áudio</button>
              </div>
            )}
          </div>
          <input ref={midiaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { escolherArquivos(e.target.files, 'auto'); e.target.value = ''; }} />
          <input ref={docInput} type="file" multiple hidden onChange={(e) => { escolherArquivos(e.target.files, 'documento'); e.target.value = ''; }} />
          <input ref={audioInput} type="file" accept="audio/*" multiple hidden onChange={(e) => { escolherArquivos(e.target.files, 'auto'); e.target.value = ''; }} />

          <textarea
            ref={campo}
            rows={1}
            value={texto}
            placeholder={`Mensagem${numeroAtual && conectados.length > 1 ? ` pelo ${numeroAtual.name}` : ''}`}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
              if (e.key === 'Escape' && respondendo) onCancelarResposta();
            }}
            onPaste={(e) => {
              const arquivos = [...(e.clipboardData?.files || [])];
              if (arquivos.length) { e.preventDefault(); escolherArquivos(arquivos, 'auto'); }
            }}
          />
          {texto.trim() ? (
            <button type="button" className="botao-enviar" onClick={enviar} aria-label="Enviar" title="Enviar (Enter)">
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" /></svg>
            </button>
          ) : (
            <button type="button" className="botao-enviar" onClick={iniciarGravacao} aria-label="Gravar áudio" title="Gravar áudio">
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15m6-3.5h-1.7c0 2.6-2.1 4.6-4.3 4.6s-4.3-2-4.3-4.6H6c0 3 2.4 5.5 5.2 5.9V21h1.6v-3.6c2.8-.4 5.2-2.9 5.2-5.9" /></svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
