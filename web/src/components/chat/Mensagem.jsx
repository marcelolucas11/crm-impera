import { memo, useEffect, useRef, useState } from 'react';
import { Reply, Copy, Forward, Star, StarOff, Pencil, Info, Trash2, EyeOff, Download, CheckSquare, Plus, Phone, Video as IconeVideo, PhoneMissed, PhoneOff, Timer, Eye, Heart, ChevronDown, MapPin, UserRound, Smile, TriangleAlert, ExternalLink, Check, Ban } from 'lucide-react';
import { TextoFormatado } from './formatacao.jsx';
import PlayerAudio from './PlayerAudio.jsx';
import SeletorEmoji from './SeletorEmoji.jsx';
import { REACOES } from './emojis.js';
import { formatarTelefone } from '../../utils.js';
import { rota } from '../../base.js';

const TIPOS_MIDIA = new Set(['imagem', 'video', 'audio', 'documento', 'figurinha']);
const EDITAR_ATE_MS = 15 * 60000;

export const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function tamanhoArquivo(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const duracao = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, '0')}`;

// Cor estável para o nome de cada participante de grupo
const CORES_AUTOR = ['#e5a04b', '#53bdeb', '#06cf9c', '#d17cf2', '#ff8a65', '#9ccc65', '#f06292', '#4fc3f7', '#ffd54f', '#a1887f'];
export function corDoAutor(id) {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES_AUTOR[h % CORES_AUTOR.length];
}

// ✓ enviada · ✓✓ entregue · ✓✓ azul lida · relógio enviando · ⚠ erro
export function Tique({ status }) {
  if (status === 0) return <span className="tique erro" title="Não enviada"><TriangleAlert size={13} /></span>;
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
  const largura = figurinha ? 140 : Math.min(330, Math.max(160, proporcao >= 1 ? 330 : 330 * proporcao));
  const src = rota(`/api/whatsapp/midia/${m.id}${tentativa ? `?t=${tentativa}` : ''}`);
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
          {figurinha ? 'Figurinha indisponível' : 'Imagem indisponível'} · tentar de novo
        </button>
      )}
    </div>
  );
}

function Video({ m, onAbrir }) {
  const proporcao = m.media_w && m.media_h ? m.media_w / m.media_h : 16 / 9;
  const largura = Math.min(330, Math.max(160, proporcao >= 1 ? 330 : 330 * proporcao));
  const gif = m.extra?.gif;
  return (
    <button type="button" className="midia-imagem midia-video" style={{ width: largura, aspectRatio: String(Math.max(0.5, Math.min(2.2, proporcao))) }} onClick={onAbrir}>
      {m.thumb && <img className="midia-thumb nitida" src={`data:image/jpeg;base64,${m.thumb}`} alt="" />}
      {!m.thumb && m.media_pronta && <video className="midia-real" src={rota(`/api/whatsapp/midia/${m.id}#t=0.5`)} preload="metadata" muted playsInline />}
      <span className="midia-play">
        {gif ? <b className="rotulo-gif">GIF</b> : <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>}
      </span>
      {!gif && <span className="midia-rotulo"><IconeVideo size={12} /> {m.media_seconds ? duracao(m.media_seconds) : ''}{!m.media_pronta && m.media_size ? ` · ${tamanhoArquivo(m.media_size)}` : ''}</span>}
    </button>
  );
}

function Documento({ m }) {
  const { ext, cor } = iconeDocumento(m.media_name, m.media_mime);
  const url = rota(`/api/whatsapp/midia/${m.id}`);
  const pdf = /pdf/i.test(m.media_mime || '') || ext === 'PDF';
  return (
    <div className="midia-documento">
      <span className="doc-icone" style={{ background: cor }}>{ext}</span>
      <span className="doc-info">
        <b title={m.media_name || ''}>{m.media_name || 'Documento'}</b>
        <small>{[ext, tamanhoArquivo(m.media_size)].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="doc-acoes">
        {pdf && <a href={url} target="_blank" rel="noreferrer" title="Abrir"><Eye size={16} /></a>}
        <a href={`${url}?download=1`} title="Baixar"><Download size={16} /></a>
      </span>
    </div>
  );
}

function Localizacao({ extra }) {
  const url = `https://www.google.com/maps?q=${extra.lat},${extra.lng}`;
  return (
    <a className="midia-local" href={url} target="_blank" rel="noreferrer">
      {extra.thumb ? <img src={`data:image/jpeg;base64,${extra.thumb}`} alt="" /> : <span className="local-mapa"><MapPin size={34} /></span>}
      <span>
        <b>{extra.nome || 'Localização'}</b>
        {extra.endereco && <small>{extra.endereco}</small>}
        <small className="link">Abrir no mapa <ExternalLink size={11} /></small>
      </span>
    </a>
  );
}

function Contatos({ extra }) {
  return (
    <div className="midia-contatos">
      {(extra.contatos || []).map((c, i) => (
        <div key={i} className="cartao-contato">
          <span className="foto-perfil" style={{ width: 38, height: 38, flexBasis: 38 }}><UserRound size={20} /></span>
          <span>
            <b>{c.nome}</b>
            {c.telefones?.map((t) => <small key={t}>{formatarTelefone(t)}</small>)}
          </span>
          {c.telefones?.[0] && <a className="cartao-contato-link" href={`https://wa.me/${c.telefones[0]}`} target="_blank" rel="noreferrer">Conversar</a>}
        </div>
      ))}
    </div>
  );
}

// Enquete: resultado ao vivo e voto (como no WhatsApp)
function Enquete({ m, podeVotar, onVotar, nomeDe }) {
  const extra = m.extra || {};
  const votos = extra.votos || {};
  const opcoes = extra.opcoes || [];
  const contagem = Object.fromEntries(opcoes.map((o) => [o, 0]));
  for (const lista of Object.values(votos)) for (const o of lista) if (o in contagem) contagem[o]++;
  const total = Object.values(votos).filter((l) => l.length).length;
  const meus = votos.eu || [];
  const [vendoVotos, setVendoVotos] = useState(false);
  const alternar = (o) => {
    if (!podeVotar) return;
    const novo = extra.multipla ? (meus.includes(o) ? meus.filter((x) => x !== o) : [...meus, o]) : meus.includes(o) ? [] : [o];
    onVotar(novo);
  };
  const maior = Math.max(1, ...Object.values(contagem));
  return (
    <div className="midia-enquete">
      <b className="enquete-pergunta">{extra.pergunta}</b>
      <small className="enquete-dica">{extra.multipla ? 'Selecione uma ou mais opções' : 'Selecione uma opção'}</small>
      {opcoes.map((o) => (
        <button key={o} type="button" className={`opcao-enquete ${meus.includes(o) ? 'marcada' : ''}`} onClick={() => alternar(o)} disabled={!podeVotar}>
          <span className="opcao-linha">
            <span className={`opcao-marca ${extra.multipla ? 'quadrada' : ''}`}>{meus.includes(o) ? <Check size={12} /> : ''}</span>
            <span className="opcao-nome">{o}</span>
            <b>{contagem[o] || 0}</b>
          </span>
          <span className="opcao-barra"><i style={{ width: `${((contagem[o] || 0) / maior) * 100}%` }} /></span>
        </button>
      ))}
      <button type="button" className="enquete-ver" onClick={() => setVendoVotos((v) => !v)}>{vendoVotos ? 'Ocultar votos' : `Ver votos (${total})`}</button>
      {vendoVotos && (
        <div className="enquete-votos">
          {opcoes.map((o) => {
            const quem = Object.entries(votos).filter(([, l]) => l.includes(o)).map(([q]) => (q === 'eu' ? 'Vocês' : extra.nomes?.[q] || nomeDe(q)));
            return <div key={o}><b>{o}</b>: {quem.length ? quem.join(', ') : <span className="suave">ninguém</span>}</div>;
          })}
        </div>
      )}
    </div>
  );
}

function Chamada({ m }) {
  const e = m.extra || {};
  const perdida = e.resultado === 'perdida' || e.resultado === 'recusada';
  const Icone = perdida ? (e.resultado === 'recusada' ? PhoneOff : PhoneMissed) : e.video ? IconeVideo : Phone;
  return (
    <div className={`midia-chamada ${perdida ? 'perdida' : ''}`}>
      <span className="chamada-icone"><Icone size={18} /></span>
      <span><b>{m.body?.replace(/^📞\s*/, '')}</b></span>
    </div>
  );
}

function PreviaLink({ previa }) {
  if (!previa?.titulo) return null;
  const url = previa.url && /^https?:/i.test(previa.url) ? previa.url : null;
  const Corpo = url ? 'a' : 'div';
  return (
    <Corpo className="previa-link" {...(url ? { href: url, target: '_blank', rel: 'noreferrer noopener' } : {})}>
      {previa.thumb && <img src={`data:image/jpeg;base64,${previa.thumb}`} alt="" />}
      <span>
        <b>{previa.titulo}</b>
        {previa.descricao && <small>{previa.descricao}</small>}
        {url && <small className="previa-dominio">{(() => { try { return new URL(url).hostname; } catch { return ''; } })()}</small>}
      </span>
    </Corpo>
  );
}

function Menu({ m, paraCima, onFechar, acoes, podeEditar, onReagirMais }) {
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
  const fazer = (fn) => () => { onFechar(); fn(); };
  const apagada = Boolean(m.deleted_at);
  return (
    <div className={`menu-mensagem ${m.from_me ? 'esquerda' : 'direita'} ${paraCima ? 'para-cima' : ''}`} ref={ref}>
      {!apagada && m.type !== 'chamada' && (
        <div className="menu-reacoes">
          {REACOES.map((r) => (
            <button key={r} type="button" className={minha === r ? 'ativa' : ''} onClick={fazer(() => acoes.reagir(m, minha === r ? '' : r))}>{r}</button>
          ))}
          <button type="button" className="reacao-mais" title="Mais emojis" onClick={() => { onFechar(); onReagirMais(); }}><Plus size={18} /></button>
        </div>
      )}
      {!apagada && m.type !== 'chamada' && <button type="button" onClick={fazer(() => acoes.responder(m))}><Reply size={16} /> Responder</button>}
      {texto && <button type="button" onClick={fazer(() => acoes.copiar(texto))}><Copy size={16} /> Copiar</button>}
      {!apagada && m.type !== 'chamada' && <button type="button" onClick={fazer(() => acoes.encaminhar([m]))}><Forward size={16} /> Encaminhar</button>}
      <button type="button" onClick={fazer(() => acoes.estrela(m, !m.starred_at))}>{m.starred_at ? <><StarOff size={16} /> Desfavoritar</> : <><Star size={16} /> Favoritar</>}</button>
      {podeEditar && <button type="button" onClick={fazer(() => acoes.editar(m))}><Pencil size={16} /> Editar</button>}
      {m.from_me && <button type="button" onClick={fazer(() => acoes.info(m))}><Info size={16} /> Dados da mensagem</button>}
      {TIPOS_MIDIA.has(m.type) && m.media_mime && !m.extra?.unica && <a href={rota(`/api/whatsapp/midia/${m.id}?download=1`)} onClick={onFechar}><Download size={16} /> Baixar</a>}
      {m.type === 'figurinha' && !m.from_me && <button type="button" onClick={fazer(() => acoes.favoritarFigurinha(m))}><Heart size={16} /> Favoritar figurinha</button>}
      <button type="button" onClick={fazer(() => acoes.selecionar(m))}><CheckSquare size={16} /> Selecionar</button>
      <button type="button" onClick={fazer(() => acoes.apagarParaMim(m))}><EyeOff size={16} /> Apagar para mim</button>
      {m.from_me && !apagada && m.status !== 0 && m.type !== 'chamada' && <button type="button" className="perigo" onClick={fazer(() => acoes.apagarParaTodos(m))}><Trash2 size={16} /> Apagar para todos</button>}
    </div>
  );
}

function Mensagem({
  m, primeiraDoGrupo, grupo = false, nomeContato, avatarVoz, mostrarNumero, destaque, selecionando = false, selecionada = false, acoes, nomeDe,
}) {
  const [menu, setMenu] = useState(false);
  const [emojis, setEmojis] = useState(false);
  const bolha = useRef(null);
  // Mensagens na metade de baixo da tela abrem o menu para cima (senão ele seria cortado)
  const paraCima = useRef(false);
  const calcularLado = () => {
    if (bolha.current) {
      const caixa = bolha.current.closest('.conversa-lista')?.getBoundingClientRect();
      const r = bolha.current.getBoundingClientRect();
      paraCima.current = caixa ? r.top - caixa.top > caixa.height / 2 : r.top > window.innerHeight / 2;
    }
  };
  const abrirMenu = () => {
    if (!menu) calcularLado();
    setMenu((v) => !v);
  };
  const midiaAntiga = TIPOS_MIDIA.has(m.type) && !m.media_mime; // de antes da versão 0.5
  const unica = Boolean(m.extra?.unica) && TIPOS_MIDIA.has(m.type);
  const semBolha = m.type === 'figurinha' && !midiaAntiga;
  const legenda = m.type === 'texto' ? null : m.legenda;
  const reacoes = m.reactions ? Object.values(m.reactions) : [];
  const abrir = () => acoes.abrirMidia({ id: m.id, tipo: m.type, legenda: m.legenda, titulo: `${m.from_me ? 'Você' : m.participant_name || nomeContato} · ${new Date(m.timestamp).toLocaleString('pt-BR')}` });
  const podeEditar = m.from_me && m.type === 'texto' && !m.deleted_at && m.status !== 0 && Date.now() - new Date(m.timestamp).getTime() < EDITAR_ATE_MS;
  const mencoes = m.extra?.mencoes || null;

  let corpo;
  if (unica) {
    corpo = <div className="bolha-unica"><span className="unica-icone">1</span> {m.type === 'video' ? 'Vídeo' : m.type === 'audio' ? 'Áudio' : 'Foto'} de visualização única <small>· abra no celular</small></div>;
  } else if (midiaAntiga || m.type === 'outro') corpo = <div className="bolha-texto suave"><i>{m.body}</i></div>;
  else if (m.type === 'texto') corpo = <div className="bolha-texto"><TextoFormatado texto={m.body} mencoes={mencoes} /></div>;
  else if (m.type === 'imagem') corpo = <Imagem m={m} onAbrir={abrir} />;
  else if (m.type === 'figurinha') corpo = <Imagem m={m} figurinha />;
  else if (m.type === 'video') corpo = <Video m={m} onAbrir={abrir} />;
  else if (m.type === 'audio') corpo = <PlayerAudio id={m.id} segundos={m.media_seconds} ptt={m.ptt} avatar={avatarVoz} />;
  else if (m.type === 'documento') corpo = <Documento m={m} />;
  else if (m.type === 'localizacao' && m.extra) corpo = <Localizacao extra={m.extra} />;
  else if (m.type === 'contato' && m.extra) corpo = <Contatos extra={m.extra} />;
  else if (m.type === 'enquete' && m.extra) corpo = <Enquete m={m} podeVotar={m.tem_original && !m.deleted_at} onVotar={(o) => acoes.votar(m, o)} nomeDe={nomeDe} />;
  else if (m.type === 'chamada') corpo = <Chamada m={m} />;
  else corpo = <div className="bolha-texto"><TextoFormatado texto={m.body} mencoes={mencoes} /></div>;

  // Quem mandou: a IA de primeiro contato (aprovada por alguém, no modo copiloto), a automação de disparos, a equipe ou o celular
  const origem = m.extra?.origem;
  const autor = !m.from_me ? null
    : origem === 'ia' ? (m.enviado_por ? `IA · aprovada por ${m.enviado_por}` : 'IA')
      : origem === 'disparo' ? 'Automação'
        : m.enviado_por || 'Celular';
  const nomeParticipante = grupo && !m.from_me ? m.participant_name || nomeDe(m.participant_jid) : null;
  const clique = selecionando ? () => acoes.alternarSelecao(m) : undefined;

  return (
    <div
      id={`msg-${m.id}`}
      className={`linha-mensagem ${m.from_me ? 'minha' : 'dele'} ${primeiraDoGrupo ? 'inicio-grupo' : ''} ${reacoes.length ? 'com-reacao' : ''} ${selecionando ? 'selecionando' : ''} ${selecionada ? 'selecionada' : ''}`}
      onClick={clique}
    >
      {selecionando && <span className="caixa-selecao">{selecionada && <Check size={13} />}</span>}
      <div ref={bolha} className={`bolha tipo-${m.type} ${semBolha ? 'sem-bolha' : ''} ${primeiraDoGrupo ? 'com-cauda' : ''} ${m.deleted_at ? 'apagada' : ''} ${destaque ? 'destaque' : ''} ${menu ? 'menu-aberto' : ''}`}>
        {!selecionando && (
          <button type="button" className="bolha-seta" onClick={abrirMenu} aria-label="Opções da mensagem">
            <ChevronDown size={18} />
          </button>
        )}
        {!selecionando && !m.deleted_at && m.type !== 'chamada' && (
          <button type="button" className={`bolha-reagir ${m.from_me ? 'lado-esquerdo' : ''}`} onClick={() => { calcularLado(); setEmojis(true); }} aria-label="Reagir">
            <Smile size={16} />
          </button>
        )}
        {menu && (
          <Menu m={m} paraCima={paraCima.current} onFechar={() => setMenu(false)} acoes={acoes} podeEditar={podeEditar} onReagirMais={() => setEmojis(true)} />
        )}
        {emojis && (
          <div className={`reacao-seletor ${m.from_me ? 'esquerda' : 'direita'} ${paraCima.current ? 'para-cima' : ''}`}>
            <div className="menu-reacoes solto">
              {REACOES.map((r) => (
                <button key={r} type="button" className={m.reactions?.eu === r ? 'ativa' : ''} onClick={() => { setEmojis(false); acoes.reagir(m, m.reactions?.eu === r ? '' : r); }}>{r}</button>
              ))}
            </div>
            <SeletorEmoji onEscolher={(e) => { setEmojis(false); acoes.reagir(m, e); }} onFechar={() => setEmojis(false)} />
          </div>
        )}

        {nomeParticipante && primeiraDoGrupo && <div className="autor-grupo" style={{ color: corDoAutor(m.participant_jid) }}>{nomeParticipante}</div>}
        {m.extra?.encaminhada && <div className="encaminhada"><Forward size={13} /> {m.extra.encaminhada >= 4 ? 'Encaminhada com frequência' : 'Encaminhada'}</div>}

        {m.quoted_wa_id && (
          <button type="button" className={`citacao ${m.quoted_from_me ? 'de-mim' : ''}`} onClick={(e) => { e.stopPropagation(); if (m.quoted_id) acoes.irPara(m.quoted_id); }}>
            <b>{m.quoted_from_me ? 'Você' : nomeContato}</b>
            <span>{m.quoted_body || 'Mensagem'}</span>
          </button>
        )}

        {m.type === 'texto' && m.extra?.previa && <PreviaLink previa={m.extra.previa} />}
        {corpo}
        {legenda && <div className="bolha-texto legenda-midia"><TextoFormatado texto={legenda} mencoes={mencoes} /></div>}

        <div className="bolha-info">
          {m.extra?.temporaria && <span title="Mensagem temporária"><Timer size={12} /></span>}
          {m.starred_at && <span title="Favorita"><Star size={11} fill="currentColor" /></span>}
          {m.deleted_at && <span className="marca-apagada" title={`Apagada para todos às ${hora(m.deleted_at)}`}><Ban size={12} /> {m.from_me ? 'Você apagou' : 'Apagada pelo contato'}</span>}
          {m.edited_at && <span title={`Editada às ${hora(m.edited_at)}`}>Editada</span>}
          {autor && <span className="autor">{autor}{mostrarNumero && m.numero_nome ? ` · ${m.numero_nome}` : ''}</span>}
          {!autor && mostrarNumero && m.numero_nome && <span>{m.numero_nome}</span>}
          <span>{hora(m.timestamp)}</span>
          {m.from_me && m.type !== 'chamada' && <Tique status={m.status} />}
        </div>
        {m.status === 0 && m.type === 'texto' && (
          <button type="button" className="reenviar" onClick={() => acoes.reenviar(m)}>Não enviada · tentar de novo</button>
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
