import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Smile, Paperclip, Mic, SendHorizontal, Trash2, X, Image as IconeImagem, FileText, Music, Sticker, UserRound, MapPin,
  BarChart3, Eye, Pencil, Film,
} from 'lucide-react';
import SeletorEmoji from './SeletorEmoji.jsx';
import PainelFigurinhas from './PainelFigurinhas.jsx';

const TIPOS_GRAVACAO = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
const relogio = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const lerRascunho = (chave) => { try { return localStorage.getItem(`wa-rascunho:${chave}`) || ''; } catch { return ''; } };
const gravarRascunho = (chave, texto) => {
  try {
    if (texto) localStorage.setItem(`wa-rascunho:${chave}`, texto);
    else localStorage.removeItem(`wa-rascunho:${chave}`);
  } catch { /* navegador sem armazenamento: segue sem rascunho */ }
};
export const temRascunho = (chave) => Boolean(lerRascunho(chave));

// Barra de digitação: emoji/figurinhas, anexos, texto (com rascunho por conversa), gravação de áudio e edição
export default function Compositor({
  chave, conectados, numeroId, setNumeroId, respondendo, nomeContato, onCancelarResposta,
  onEnviarTexto, onSelecionarArquivos, onEnviarVoz, onEnviarFigurinha, onAbrirJanela, onDigitando, onErro,
  foco, painelPedido, editando, onSalvarEdicao, onCancelarEdicao, onEditarUltima, participantes = null,
}) {
  const [texto, setTexto] = useState(() => lerRascunho(chave));
  const [painel, setPainel] = useState(null); // 'emoji' | 'figurinhas' | 'gif'
  const [anexo, setAnexo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState('');
  const [mencao, setMencao] = useState(null); // { inicio, termo }
  const mencoes = useRef(new Map());
  const campo = useRef(null);
  const midiaInput = useRef(null);
  const unicaInput = useRef(null);
  const docInput = useRef(null);
  const audioInput = useRef(null);
  const figurinhaInput = useRef(null);
  const gifInput = useRef(null);
  const gravacao = useRef(null);
  const menuAnexo = useRef(null);
  const chaveRef = useRef(chave);

  // Troca de conversa: guarda o rascunho da anterior e carrega o da nova
  useEffect(() => {
    if (chaveRef.current !== chave) {
      chaveRef.current = chave;
      setTexto(lerRascunho(chave));
      setPainel(null);
      mencoes.current = new Map();
    }
  }, [chave]);
  useEffect(() => { if (!editando) gravarRascunho(chave, texto); }, [chave, texto, editando]);

  // Edição: o campo recebe o texto da mensagem
  const textoAntesDaEdicao = useRef(null);
  useEffect(() => {
    if (editando) {
      textoAntesDaEdicao.current = texto;
      setTexto(editando.body || '');
      requestAnimationFrame(() => campo.current?.focus());
    } else if (textoAntesDaEdicao.current !== null) {
      // Fim da edição: volta o que estava escrito antes (o rascunho), nunca o texto editado
      setTexto(textoAntesDaEdicao.current || '');
      textoAntesDaEdicao.current = null;
    }
  }, [editando]); // eslint-disable-line react-hooks/exhaustive-deps

  // Campo cresce até 6 linhas
  useLayoutEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight, 140)}px`;
  }, [texto]);

  useEffect(() => { if (respondendo || foco) campo.current?.focus(); }, [respondendo, foco]);
  useEffect(() => { if (painelPedido?.qual) setPainel(painelPedido.qual); }, [painelPedido]);

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
    if (editando) {
      onSalvarEdicao(editando, conteudo);
      return;
    }
    const jids = [...mencoes.current.entries()].filter(([d]) => conteudo.includes(`@${d}`)).map(([, jid]) => jid);
    setTexto('');
    gravarRascunho(chave, '');
    mencoes.current = new Map();
    setPainel(null);
    onDigitando?.('paused');
    onEnviarTexto(conteudo, jids);
  };

  const inserir = (e) => {
    const c = campo.current;
    if (!c) { setTexto((t) => t + e); return; }
    const ini = c.selectionStart ?? texto.length;
    const fim = c.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + e + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => { c.focus(); c.setSelectionRange(ini + e.length, ini + e.length); });
  };

  const escolherArquivos = (lista, modo, extra = {}) => {
    const arquivos = [...(lista || [])];
    if (arquivos.length) onSelecionarArquivos(arquivos, modo, texto.trim(), extra);
    if (arquivos.length && texto.trim() && modo !== 'figurinha') setTexto('');
  };

  const aoDigitar = (valor, cursor) => {
    setTexto(valor);
    if (valor.trim()) onDigitando?.('composing');
    // @menção em grupos
    if (participantes?.length) {
      const antes = valor.slice(0, cursor);
      const m = antes.match(/(^|\s)@([^\s@]{0,30})$/);
      setMencao(m ? { inicio: cursor - m[2].length - 1, termo: m[2].toLowerCase() } : null);
    }
  };

  const escolherMencao = (p) => {
    const digitos = (p.telefone || p.jid.split('@')[0]).replace(/\D/g, '');
    const fim = mencao.inicio + 1 + mencao.termo.length;
    const novo = `${texto.slice(0, mencao.inicio)}@${digitos} ${texto.slice(fim)}`;
    mencoes.current.set(digitos, p.jid);
    setTexto(novo);
    setMencao(null);
    requestAnimationFrame(() => campo.current?.focus());
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
      onDigitando?.('paused');
    };
    rec.start(250);
    g.timer = setInterval(() => {
      setSegundos(Math.floor((Date.now() - g.inicio) / 1000));
      onDigitando?.('recording');
    }, 1000);
    gravacao.current = g;
    setSegundos(0);
    setGravando(true);
    onDigitando?.('recording');
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
  const sugestoes = mencao && participantes
    ? participantes.filter((p) => (p.nome || '').toLowerCase().includes(mencao.termo) || (p.telefone || '').includes(mencao.termo)).slice(0, 8)
    : [];

  const itemAnexo = (Icone, cor, rotulo, acao) => (
    <button type="button" onClick={() => { setAnexo(false); acao(); }}><span className="icone-anexo" style={{ background: cor }}><Icone size={18} /></span> {rotulo}</button>
  );

  return (
    <div className="compositor">
      {editando && (
        <div className="respondendo editando">
          <div className="citacao de-mim"><b><Pencil size={13} /> Editar mensagem</b><span>{editando.body}</span></div>
          <button type="button" className="botao-icone" onClick={onCancelarEdicao} aria-label="Cancelar edição"><X size={20} /></button>
        </div>
      )}
      {respondendo && !editando && (
        <div className="respondendo">
          <div className={`citacao ${respondendo.from_me ? 'de-mim' : ''}`}>
            <b>{respondendo.from_me ? 'Você' : respondendo.participant_name || nomeContato}</b>
            <span>{respondendo.type === 'texto' ? respondendo.body : respondendo.legenda || respondendo.body}</span>
          </div>
          <button type="button" className="botao-icone" onClick={onCancelarResposta} aria-label="Cancelar resposta"><X size={20} /></button>
        </div>
      )}
      {erro && <div className="compositor-erro" onClick={() => setErro('')}>{erro} <span>✕</span></div>}
      {sugestoes.length > 0 && (
        <div className="sugestoes-mencao">
          {sugestoes.map((p) => (
            <button key={p.jid} type="button" onMouseDown={(e) => { e.preventDefault(); escolherMencao(p); }}>
              <b>{p.nome || p.telefone}</b> <small className="suave">{p.telefone ? `+${p.telefone}` : ''}</small>
            </button>
          ))}
        </div>
      )}

      {painel && (
        <div className="painel-expressoes">
          <div className="painel-expressoes-abas">
            <button type="button" className={painel === 'emoji' ? 'ativa' : ''} onClick={() => setPainel('emoji')} title="Emojis (Ctrl+Alt+E)"><Smile size={20} /></button>
            <button type="button" className={painel === 'gif' ? 'ativa' : ''} onClick={() => setPainel('gif')} title="GIF"><Film size={20} /></button>
            <button type="button" className={painel === 'figurinhas' ? 'ativa' : ''} onClick={() => setPainel('figurinhas')} title="Figurinhas (Ctrl+Alt+S)"><Sticker size={20} /></button>
            <span className="espaco" />
            <button type="button" onClick={() => setPainel(null)} aria-label="Fechar"><X size={18} /></button>
          </div>
          {painel === 'emoji' && <SeletorEmoji className="no-painel" onEscolher={inserir} onFechar={() => setPainel(null)} ignorar=".compositor" />}
          {painel === 'figurinhas' && <PainelFigurinhas onEnviar={(id) => onEnviarFigurinha(id)} onErro={onErro} />}
          {painel === 'gif' && (
            <div className="painel-gif">
              <p className="suave">Escolha um vídeo curto (até 15 s) ou um GIF do computador. Ele vai como GIF do WhatsApp, em repetição e sem som.</p>
              <div className="acoes-linha">
                <button type="button" className="btn btn-ouro" onClick={() => gifInput.current?.click()}>Escolher vídeo ou GIF</button>
                <button type="button" className="btn" onClick={() => figurinhaInput.current?.click()}>Transformar em figurinha</button>
              </div>
              <p className="suave pequeno">A busca de GIFs na internet do WhatsApp não está disponível pela conexão por QR code.</p>
            </div>
          )}
        </div>
      )}

      {gravando ? (
        <div className="barra-gravacao">
          <button type="button" className="botao-icone" onClick={() => pararGravacao(false)} aria-label="Descartar áudio" title="Descartar"><Trash2 size={22} /></button>
          <span className="ponto-gravando" />
          <span className="tempo-gravacao">{relogio(segundos)}</span>
          <span className="onda-gravacao" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 7) * 0.12}s` }} />)}</span>
          <button type="button" className="botao-enviar" onClick={() => pararGravacao(true)} aria-label="Enviar áudio" title="Enviar áudio"><SendHorizontal size={22} /></button>
        </div>
      ) : (
        <div className="barra-digitacao">
          {conectados.length > 1 && !editando && (
            <select className="seletor-numero" value={numeroId} onChange={(e) => setNumeroId(e.target.value)} title="Número que vai enviar">
              {conectados.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          )}
          {!editando && (
            <>
              <button type="button" className={`botao-icone botao-emoji ${painel ? 'ativo' : ''}`} onClick={() => setPainel((p) => (p ? null : 'emoji'))} aria-label="Emojis, GIFs e figurinhas" title="Emojis, GIFs e figurinhas">
                <Smile size={24} />
              </button>
              <div className="posicao-relativa" ref={menuAnexo}>
                <button type="button" className={`botao-icone ${anexo ? 'ativo' : ''}`} onClick={() => setAnexo((v) => !v)} aria-label="Anexar" title="Anexar">
                  <Paperclip size={22} />
                </button>
                {anexo && (
                  <div className="menu-anexo">
                    {itemAnexo(IconeImagem, '#bf59cf', 'Fotos e vídeos', () => midiaInput.current?.click())}
                    {itemAnexo(FileText, '#5157ae', 'Documento', () => docInput.current?.click())}
                    {itemAnexo(Music, '#f96533', 'Áudio', () => audioInput.current?.click())}
                    {itemAnexo(Eye, '#0795dc', 'Visualização única', () => unicaInput.current?.click())}
                    {itemAnexo(Sticker, '#02a698', 'Nova figurinha', () => figurinhaInput.current?.click())}
                    {itemAnexo(UserRound, '#009de2', 'Contato', () => onAbrirJanela('contato'))}
                    {itemAnexo(MapPin, '#1fa855', 'Localização', () => onAbrirJanela('localizacao'))}
                    {itemAnexo(BarChart3, '#ffbc38', 'Enquete', () => onAbrirJanela('enquete'))}
                  </div>
                )}
              </div>
            </>
          )}
          <input ref={midiaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { escolherArquivos(e.target.files, 'auto'); e.target.value = ''; }} />
          <input ref={unicaInput} type="file" accept="image/*,video/*" hidden onChange={(e) => { escolherArquivos(e.target.files, 'auto', { unica: true }); e.target.value = ''; }} />
          <input ref={docInput} type="file" multiple hidden onChange={(e) => { escolherArquivos(e.target.files, 'documento'); e.target.value = ''; }} />
          <input ref={audioInput} type="file" accept="audio/*" multiple hidden onChange={(e) => { escolherArquivos(e.target.files, 'auto'); e.target.value = ''; }} />
          <input ref={figurinhaInput} type="file" accept="image/*,video/*" hidden onChange={(e) => { escolherArquivos(e.target.files, 'figurinha'); e.target.value = ''; }} />
          <input ref={gifInput} type="file" accept="video/*,image/gif" hidden onChange={(e) => { escolherArquivos(e.target.files, 'gif'); e.target.value = ''; }} />

          <textarea
            ref={campo}
            rows={1}
            value={texto}
            placeholder={editando ? 'Editar mensagem' : `Digite uma mensagem${numeroAtual && conectados.length > 1 ? ` (pelo ${numeroAtual.name})` : ''}`}
            onChange={(e) => aoDigitar(e.target.value, e.target.selectionStart)}
            onBlur={() => onDigitando?.('paused')}
            onKeyDown={(e) => {
              if (sugestoes.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); escolherMencao(sugestoes[0]); return; }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
              if (e.key === 'Escape') {
                if (mencao) setMencao(null);
                else if (editando) onCancelarEdicao();
                else if (painel) setPainel(null);
                else if (respondendo) onCancelarResposta();
              }
              if (e.key === 'ArrowUp' && !texto && !editando) { e.preventDefault(); onEditarUltima?.(); }
            }}
            onPaste={(e) => {
              const arquivos = [...(e.clipboardData?.files || [])];
              if (arquivos.length) { e.preventDefault(); escolherArquivos(arquivos, 'auto'); }
            }}
          />
          {texto.trim() || editando ? (
            <button type="button" className="botao-enviar" onClick={enviar} aria-label={editando ? 'Salvar edição' : 'Enviar'} title={editando ? 'Salvar (Enter)' : 'Enviar (Enter)'}>
              {editando ? '✓' : <SendHorizontal size={22} />}
            </button>
          ) : (
            <button type="button" className="botao-enviar" onClick={iniciarGravacao} aria-label="Gravar áudio" title="Gravar áudio">
              <Mic size={22} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
