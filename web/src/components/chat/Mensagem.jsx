import { memo, useEffect, useRef, useState } from 'react';
import { TextoFormatado } from './formatacao.jsx';
import PlayerAudio from './PlayerAudio.jsx';
import { REACOES } from './emojis.js';
import { formatarTelefone } from '../../utils.js';

const TIPOS_MIDIA = new Set(['imagem', 'video', 'audio', 'documento', 'figurinha']);

export const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function tamanhoArquivo(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const duracao = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, '0')}`;

// ✓ enviada · ✓✓ entregue · ✓✓ azul lida · relógio enviando · ⚠ erro
export function Tique({ status }) {
  if (status === 0) return <span className="tique erro" title="Não enviada">⚠</span>;
  if (status === 1 || status === null || status === undefined) {
    return (
      <svg className="tique" viewBox="0 0 16 16" width="14" height="14" aria-label="Enviando">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.5V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  const lida = status >= 4;
  return (
    <svg className={`tique ${lida ? 'lida' : ''}`} viewBox="0 0 18 12" width="17" height="12" aria-label={lida ? 'Lida' : status >= 3 ? 'Entregue' : 'Enviada'}>
      {status >= 3 ? (
        <>
          <path d="M1 6.5l3.2 3.2L11 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.5 9.7L7.2 10.3 14.8 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <path d="M3 6.5l3.2 3.2L13 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function iconeDocumento(nome, mime) {
  const ext = (String(nome || '').match(/\.([a-z0-9]+)$/i)?.[1] || String(mime || '').split('/')[1] || 'arq').toLowerCase().slice(0, 4);
  const cor = /pdf/.test(ext) ? '#e5534b' : /xls|csv|ods/.test(ext) ? '#3fa66b' : /doc|odt|rtf|txt/.test(ext) ? '#4a8fe7' : /ppt|key/.test(ext) ? '#e08a3c' : /zip|rar|7z/.test(ext) ? '#a37ce0' : '#8a8f98';
  return { ext: ext.toUpperCase(), cor };
}

function Imagem({ m, onAbrir, figurinha = false }) {
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const proporcao = m.media_w && m.media_h ? m.media_w / m.media_h : figurinha ? 1 : 4 / 3;
  const largura = figurinha ? 130 : Math.min(300, Math.max(160, proporcao >= 1 ? 300 : 300 * proporcao));
  const src = `/api/whatsapp/midia/${m.id}${tentativa ? `?t=${tentativa}` : ''}`;
  return (
    <div
      className={`midia-imagem ${figurinha ? 'figurinha' : ''} ${carregou ? 'pronta' : ''}`}
      style={{ width: largura, aspectRatio: String(Math.max(0.5, Math.min(2.2, proporcao))) }}
      onClick={() => !figurinha && carregou && onAbrir()}
    >
      {m.thumb && !carregou && <img className="midia-thumb" src={`data:image/jpeg;base64,${m.thumb}`} alt="" />}
      {!erro && <img className="midia-real" src={src} alt={m.legenda || ''} loading="lazy" onLoad={() => setCarregou(true)} onError={() => setErro(true)} />}
      {!carregou && !erro && <span className="midia-carregando"><span className="girando" /></span>}
      {erro && (
        <button type="button" className="midia-erro" onClick={(e) => { e.stopPropagation(); setErro(false); setTentativa((t) => t + 1); }}>
          Imagem indisponível · tentar de novo
        </button>
      )}
    </div>
  );
}

function Video({ m, onAbrir }) {
  const proporcao = m.media_w && m.media_h ? m.media_w / m.media_h : 16 / 9;
  const largura = Math.min(300, Math.max(160, proporcao >= 1 ? 300 : 300 * proporcao));
  return (
    <button type="button" className="midia-imagem midia-video" style={{ width: largura, aspectRatio: String(Math.max(0.5, Math.min(2.2, proporcao))) }} onClick={onAbrir}>
      {m.thumb && <img className="midia-thumb nitida" src={`data:image/jpeg;base64,${m.thumb}`} alt="" />}
      {!m.thumb && m.media_pronta && <video className="midia-real" src={`/api/whatsapp/midia/${m.id}#t=0.5`} preload="metadata" muted playsInline />}
      <span className="midia-play">
        <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
      </span>
      <span className="midia-rotulo">🎥 {m.media_seconds ? duracao(m.media_seconds) : ''}{!m.media_pronta && m.media_size ? ` · ${tamanhoArquivo(m.media_size)}` : ''}</span>
    </button>
  );
}

function Documento({ m }) {
  const { ext, cor } = iconeDocumento(m.media_name, m.media_mime);
  const url = `/api/whatsapp/midia/${m.id}`;
  const pdf = /pdf/i.test(m.media_mime || '') || ext === 'PDF';
  return (
    <div className="midia-documento">
      <span className="doc-icone" style={{ background: cor }}>{ext}</span>
      <span className="doc-info">
        <b title={m.media_name || ''}>{m.media_name || 'Documento'}</b>
        <small>{[ext, tamanhoArquivo(m.media_size)].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="doc-acoes">
        {pdf && <a href={url} target="_blank" rel="noreferrer" title="Abrir">👁</a>}
        <a href={`${url}?download=1`} title="Baixar">⬇</a>
      </span>
    </div>
  );
}

function Localizacao({ extra }) {
  const url = `https://www.google.com/maps?q=${extra.lat},${extra.lng}`;
  return (
    <a className="midia-local" href={url} target="_blank" rel="noreferrer">
      {extra.thumb ? <img src={`data:image/jpeg;base64,${extra.thumb}`} alt="" /> : <span className="local-mapa">📍</span>}
      <span>
        <b>{extra.nome || 'Localização'}</b>
        {extra.endereco && <small>{extra.endereco}</small>}
        <small className="link">Abrir no mapa</small>
      </span>
    </a>
  );
}

function Contatos({ extra }) {
  return (
    <div className="midia-contatos">
      {(extra.contatos || []).map((c, i) => (
        <div key={i} className="cartao-contato">
          <span className="foto-perfil" style={{ width: 36, height: 36, flexBasis: 36 }}>👤</span>
          <span>
            <b>{c.nome}</b>
            {c.telefones?.map((t) => <small key={t}>{formatarTelefone(t)}</small>)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Enquete({ extra }) {
  return (
    <div className="midia-enquete">
      <b>📊 {extra.pergunta}</b>
      {(extra.opcoes || []).map((o) => <span key={o} className="opcao-enquete">○ {o}</span>)}
    </div>
  );
}

function Menu({ m, paraCima, onFechar, onResponder, onReagir, onApagar, onCopiar }) {
  const ref = useRef(null);
  useEffect(() => {
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) onFechar(); };
    const tecla = (e) => e.key === 'Escape' && onFechar();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [onFechar]);
  const texto = m.type === 'texto' ? m.body : m.legenda;
  const minha = m.reactions?.eu;
  return (
    <div className={`menu-mensagem ${m.from_me ? 'esquerda' : 'direita'} ${paraCima ? 'para-cima' : ''}`} ref={ref}>
      <div className="menu-reacoes">
        {REACOES.map((r) => (
          <button key={r} type="button" className={minha === r ? 'ativa' : ''} onClick={() => { onReagir(minha === r ? '' : r); onFechar(); }}>{r}</button>
        ))}
      </div>
      <button type="button" onClick={() => { onResponder(); onFechar(); }}>↩ Responder</button>
      {texto && <button type="button" onClick={() => { onCopiar(texto); onFechar(); }}>⧉ Copiar texto</button>}
      {TIPOS_MIDIA.has(m.type) && m.media_mime && <a href={`/api/whatsapp/midia/${m.id}?download=1`} onClick={onFechar}>⬇ Baixar</a>}
      {m.from_me && !m.deleted_at && m.status !== 0 && <button type="button" className="perigo" onClick={() => { onFechar(); onApagar(); }}>🗑 Apagar para todos</button>}
    </div>
  );
}

function Mensagem({
  m, primeiraDoGrupo, nomeContato, avatarVoz, mostrarNumero, destaque,
  onResponder, onReagir, onApagar, onAbrirMidia, onIrPara, onReenviar, onCopiar,
}) {
  const [menu, setMenu] = useState(false);
  const bolha = useRef(null);
  // Mensagens na metade de baixo da tela abrem o menu para cima (senão ele seria cortado)
  const paraCima = useRef(false);
  const abrirMenu = () => {
    if (!menu && bolha.current) {
      const caixa = bolha.current.closest('.conversa-lista')?.getBoundingClientRect();
      const r = bolha.current.getBoundingClientRect();
      paraCima.current = caixa ? r.top - caixa.top > caixa.height / 2 : r.top > window.innerHeight / 2;
    }
    setMenu((v) => !v);
  };
  const midiaAntiga = TIPOS_MIDIA.has(m.type) && !m.media_mime; // de antes da versão 0.5
  const semBolha = m.type === 'figurinha' && !midiaAntiga;
  const legenda = m.type === 'texto' ? null : m.legenda;
  const reacoes = m.reactions ? Object.values(m.reactions) : [];
  const abrir = () => onAbrirMidia({ id: m.id, tipo: m.type, legenda: m.legenda, titulo: `${m.from_me ? 'Você' : nomeContato} · ${new Date(m.timestamp).toLocaleString('pt-BR')}` });

  let corpo;
  if (midiaAntiga || m.type === 'outro') corpo = <div className="bolha-texto suave"><i>{m.body}</i></div>;
  else if (m.type === 'texto') corpo = <div className="bolha-texto"><TextoFormatado texto={m.body} /></div>;
  else if (m.type === 'imagem') corpo = <Imagem m={m} onAbrir={abrir} />;
  else if (m.type === 'figurinha') corpo = <Imagem m={m} figurinha />;
  else if (m.type === 'video') corpo = <Video m={m} onAbrir={abrir} />;
  else if (m.type === 'audio') corpo = <PlayerAudio id={m.id} segundos={m.media_seconds} ptt={m.ptt} avatar={avatarVoz} />;
  else if (m.type === 'documento') corpo = <Documento m={m} />;
  else if (m.type === 'localizacao' && m.extra) corpo = <Localizacao extra={m.extra} />;
  else if (m.type === 'contato' && m.extra) corpo = <Contatos extra={m.extra} />;
  else if (m.type === 'enquete' && m.extra) corpo = <Enquete extra={m.extra} />;
  else corpo = <div className="bolha-texto"><TextoFormatado texto={m.body} /></div>;

  const autor = m.from_me ? m.enviado_por || 'Celular' : null;

  return (
    <div id={`msg-${m.id}`} className={`linha-mensagem ${m.from_me ? 'minha' : 'dele'} ${primeiraDoGrupo ? 'inicio-grupo' : ''} ${reacoes.length ? 'com-reacao' : ''}`}>
      <div ref={bolha} className={`bolha tipo-${m.type} ${semBolha ? 'sem-bolha' : ''} ${primeiraDoGrupo ? 'com-cauda' : ''} ${m.deleted_at ? 'apagada' : ''} ${destaque ? 'destaque' : ''} ${menu ? 'menu-aberto' : ''}`}>
        <button type="button" className="bolha-seta" onClick={abrirMenu} aria-label="Opções da mensagem">
          <svg viewBox="0 0 18 18" width="16" height="16"><path fill="currentColor" d="M3.3 6.3 9 12l5.7-5.7-1.1-1L9 9.8 4.4 5.3z" /></svg>
        </button>
        {menu && (
          <Menu
            m={m}
            paraCima={paraCima.current}
            onFechar={() => setMenu(false)}
            onResponder={() => onResponder(m)}
            onReagir={(e) => onReagir(m, e)}
            onApagar={() => onApagar(m)}
            onCopiar={onCopiar}
          />
        )}

        {m.quoted_wa_id && (
          <button type="button" className={`citacao ${m.quoted_from_me ? 'de-mim' : ''}`} onClick={() => m.quoted_id && onIrPara(m.quoted_id)}>
            <b>{m.quoted_from_me ? 'Você' : nomeContato}</b>
            <span>{m.quoted_body || 'Mensagem'}</span>
          </button>
        )}

        {corpo}
        {legenda && <div className="bolha-texto legenda-midia"><TextoFormatado texto={legenda} /></div>}

        <div className="bolha-info">
          {m.deleted_at && <span className="marca-apagada" title={`Apagada para todos às ${hora(m.deleted_at)}`}>🚫 {m.from_me ? 'Você apagou' : 'Apagada pelo contato'}</span>}
          {m.edited_at && <span title={`Editada às ${hora(m.edited_at)}`}>editada</span>}
          {autor && <span className="autor">{autor}{mostrarNumero && m.numero_nome ? ` · ${m.numero_nome}` : ''}</span>}
          {!autor && mostrarNumero && m.numero_nome && <span>{m.numero_nome}</span>}
          <span>{hora(m.timestamp)}</span>
          {m.from_me && <Tique status={m.status} />}
        </div>
        {m.status === 0 && m.type === 'texto' && (
          <button type="button" className="reenviar" onClick={() => onReenviar(m)}>Não enviada · tentar de novo</button>
        )}

        {reacoes.length > 0 && (
          <span className="reacoes" title={Object.entries(m.reactions).map(([q, e]) => `${q === 'eu' ? 'Vocês' : nomeContato}: ${e}`).join('\n')}>
            {[...new Set(reacoes)].join('')}{reacoes.length > 1 && <small>{reacoes.length}</small>}
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(Mensagem);
