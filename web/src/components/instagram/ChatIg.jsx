// Conversa do Direct: mensagens (texto, fotos, vídeos, áudios, stories, publicações compartilhadas), faixa da Alice
// e a caixa de resposta (só dentro da janela de 24 h do Instagram e para quem tem a permissão de responder).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, X, Pause, Play, Sparkles, Smile, Paperclip, SendHorizontal, ChevronDown, Download, ExternalLink, Megaphone, RefreshCw, Lock, FileText, Reply, Ban, Clock } from 'lucide-react';
import { api } from '../../api.js';
import { rota } from '../../base.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento, avisoTem } from '../../tempoReal.js';
import { pode } from '../../permissoes.js';
import { tempoDesde, dataHora } from '../../utils.js';
import { TextoFormatado } from '../chat/formatacao.jsx';
import { Tique, hora, tamanhoArquivo } from '../chat/Mensagem.jsx';
import SeletorEmoji from '../chat/SeletorEmoji.jsx';
import { rotuloDia } from '../Conversa.jsx';
import '../ia/ia.css';

const RESERVA_MS = 15000;
const MAX_ARQUIVO = 25 * 1024 * 1024;
const MAX_BYTES = 1000;
const bytes = (s) => new TextEncoder().encode(s || '').length;
const urlMidia = (msg, indice) => rota(`/api/instagram/midia/${msg}/${indice}`);

function mesclar(anteriores, novas) {
  const porId = new Map(anteriores.map((m) => [m.id, m]));
  for (const m of novas) {
    const velha = porId.get(m.id);
    porId.set(m.id, velha && JSON.stringify(velha) === JSON.stringify(m) ? velha : m);
  }
  return [...porId.values()].sort((a, b) => (a.timestamp === b.timestamp ? a.id - b.id : a.timestamp < b.timestamp ? -1 : 1));
}

function enviarComProgresso(url, arquivo, aoProgredir) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && aoProgredir(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let dados = null;
      try { dados = JSON.parse(xhr.responseText); } catch { /* sem corpo */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(dados);
      else reject(new Error(dados?.erro || `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Falha de conexão com o CRM'));
    xhr.send(arquivo);
  });
}

// Foto ou vídeo (o tipo do story não vem da Meta: tenta imagem e, se não abrir, vídeo)
function MidiaVisual({ src, tipo = 'auto', onAbrir, rotuloErro }) {
  const [modo, setModo] = useState(tipo === 'video' ? 'video' : 'imagem');
  const [erro, setErro] = useState(false);
  if (erro) return <div className="ig-midia-erro">{rotuloErro}</div>;
  if (modo === 'video') {
    return <video className="ig-midia" src={src} controls preload="metadata" playsInline onError={() => setErro(true)} />;
  }
  return (
    <img className="ig-midia clicavel" src={src} alt="" loading="lazy"
      onClick={() => onAbrir?.({ src, tipo: 'imagem' })}
      onError={() => (tipo === 'auto' ? setModo('video') : setErro(true))} />
  );
}

function Anexo({ m, a, onAbrir, onBaixar, t }) {
  const src = urlMidia(m.id, a.indice);
  if (a.erro && !a.pronto) return <div className="ig-midia-erro">{t('instagram.chat.midiaExpirou')}</div>;
  if (!a.pronto) {
    return (
      <div className="ig-midia-erro">
        <span className="girando" /> {t('instagram.chat.baixandoMidia')}
        <button type="button" className="link-botao" onClick={() => onBaixar(m.id)}><RefreshCw size={12} /> {t('instagram.chat.tentarDeNovo')}</button>
      </div>
    );
  }
  if (a.tipo === 'imagem') return <MidiaVisual src={src} tipo="imagem" onAbrir={onAbrir} rotuloErro={t('instagram.chat.midiaIndisponivel')} />;
  if (a.tipo === 'video') return <MidiaVisual src={src} tipo="video" rotuloErro={t('instagram.chat.midiaIndisponivel')} />;
  if (a.tipo === 'audio') return <audio className="ig-audio" src={src} controls preload="metadata" />;
  if (a.tipo === 'post' || a.tipo === 'reel' || a.tipo === 'compartilhamento') {
    return <MidiaVisual src={src} tipo="auto" onAbrir={onAbrir} rotuloErro={t('instagram.chat.midiaIndisponivel')} />;
  }
  return (
    <div className="midia-documento">
      <span className="doc-icone" style={{ background: '#8a8f98' }}><FileText size={16} /></span>
      <span className="doc-info">
        <b title={a.nome || ''}>{a.nome || t('instagram.chat.arquivo')}</b>
        <small>{[a.mime, tamanhoArquivo(a.tamanho)].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="doc-acoes"><a href={`${src}?download=1`} title={t('instagram.chat.baixar')}><Download size={16} /></a></span>
    </div>
  );
}

const ROTULO_TIPO = { post: 'instagram.chat.post', reel: 'instagram.chat.reel', compartilhamento: 'instagram.chat.compartilhou' };

function MensagemIg({ m, primeira, citada, onAbrir, onBaixar, t }) {
  const autor = !m.de_mim ? null
    : m.origem === 'ia' ? (m.enviado_por ? t('instagram.chat.autorAliceAprovada', { nome: m.enviado_por }) : t('instagram.chat.autorAlice'))
      : m.origem === 'assistente' ? t('instagram.chat.autorAssistente', { nome: m.enviado_por || '' })
        : m.origem === 'crm' ? m.enviado_por || t('instagram.chat.autorEquipe')
          : t('instagram.chat.autorApp');
  const reacoes = m.reacoes ? Object.entries(m.reacoes) : [];
  const anuncio = m.referral?.ad_id ? (m.referral.ads_context_data?.ad_title || t('instagram.chat.anuncioSemTitulo')) : null;
  const rotuloStory = m.tipo === 'story_resposta' ? t('instagram.chat.storyResposta') : m.tipo === 'story_mencao' ? t('instagram.chat.storyMencao') : null;
  return (
    <div className={`linha-mensagem ${m.de_mim ? 'minha' : 'dele'} ${primeira ? 'inicio-grupo' : ''} ${reacoes.length ? 'com-reacao' : ''}`}>
      <div className={`bolha ig-bolha ${primeira ? 'com-cauda' : ''} ${m.apagada ? 'apagada' : ''} ${m.origem === 'ia' ? 'ig-bolha-alice' : ''}`}>
        {anuncio && <div className="ig-referral"><Megaphone size={12} /> {t('instagram.chat.veioDoAnuncio', { titulo: anuncio })}</div>}
        {!anuncio && m.referral && <div className="ig-referral"><ExternalLink size={12} /> {t('instagram.chat.veioDeLink', { origem: String(m.referral.source || m.referral.type || 'link').toLowerCase() })}</div>}
        {m.resposta_mid && (
          <div className={`citacao ${citada?.de_mim ? 'de-mim' : ''}`}>
            <b><Reply size={12} /> {citada ? (citada.de_mim ? t('instagram.chat.voce') : t('instagram.chat.contato')) : t('instagram.chat.respondeu')}</b>
            <span>{citada?.texto || (citada ? t(`instagram.tipo.${citada.tipo}`) : '')}</span>
          </div>
        )}
        {rotuloStory && (
          <div className="ig-story">
            <small className="suave">{rotuloStory}</small>
            {m.story?.pronto
              ? <MidiaVisual src={urlMidia(m.id, 'story')} tipo="auto" onAbrir={onAbrir} rotuloErro={t('instagram.chat.storyExpirou')} />
              : <div className="ig-midia-erro">{t('instagram.chat.storyExpirou')}</div>}
          </div>
        )}
        {m.anexos.map((a) => (
          <div key={a.indice} className="ig-anexo">
            {ROTULO_TIPO[a.tipo] && <small className="suave">{t(ROTULO_TIPO[a.tipo])}</small>}
            <Anexo m={m} a={a} onAbrir={onAbrir} onBaixar={onBaixar} t={t} />
            {a.link && <a className="ig-link-compartilhado" href={a.link} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> {t('instagram.chat.abrirLink')}</a>}
          </div>
        ))}
        {m.tipo === 'nao_suportada' && <div className="bolha-texto suave"><i>{t('instagram.chat.naoSuportada')}</i></div>}
        {m.apagada && <div className="bolha-texto suave"><i><Ban size={12} /> {t('instagram.chat.apagada')}</i></div>}
        {m.texto && !m.apagada && <div className={`bolha-texto ${m.anexos.length || rotuloStory ? 'legenda-midia' : ''}`}><TextoFormatado texto={m.texto} /></div>}
        {m.transcricao && <div className="bolha-texto ig-transcricao"><small className="suave">{t('instagram.chat.transcricao')}</small> {m.transcricao}</div>}
        <div className="bolha-info">
          {m.editada && <span>{t('instagram.chat.editada')}</span>}
          {autor && <span className="autor">{autor}</span>}
          <span>{hora(m.timestamp)}</span>
          {m.de_mim && <Tique status={m.status} />}
        </div>
        {m.status === 0 && m.erro && <div className="reenviar">{m.erro}</div>}
        {reacoes.length > 0 && (
          <span className="reacoes" title={reacoes.map(([q, e]) => `${q === 'eu' ? t('instagram.chat.voce') : t('instagram.chat.contato')}: ${e}`).join('\n')}>
            {reacoes.map(([, e]) => e).join('')}
          </span>
        )}
      </div>
    </div>
  );
}

// Faixa da Alice (SDR) nesta conversa
function FaixaAlice({ conversa, perfil, podeResponder, t }) {
  const [estado, setEstado] = useState(null);
  const [textos, setTextos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const atual = useRef(conversa.id);
  atual.current = conversa.id;

  const carregar = useCallback(async () => {
    const pedida = conversa.id;
    try {
      const d = await api(`/instagram/conversas/${pedida}/ia`);
      if (atual.current !== pedida) return;
      setEstado(d);
      setTextos(d.sugestao?.mensagens || []);
    } catch { /* tenta no próximo aviso */ }
  }, [conversa.id]);
  useEffect(() => { setEstado(null); setErro(''); carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (avisoTem(d, 'conversa', conversa.id) && (d.ia || d.nova)) carregar(); });

  if (!estado) return null;
  const status = estado.status;
  const s = estado.sugestao;
  const aliceNoPerfil = Boolean(perfil?.alice_ativa);
  // Sem histórico da Alice e ela desligada no perfil: nada a mostrar
  if (!status && !aliceNoPerfil) return null;

  const agir = async (fn) => {
    setOcupado(true);
    setErro('');
    try { await fn(); await carregar(); } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  };
  const mudar = (novo) => agir(() => api(`/instagram/conversas/${conversa.id}/ia`, { method: 'POST', body: { status: novo } }));
  const aprovar = () => agir(() => api(`/instagram/sugestoes/${s.id}/aprovar`, { method: 'POST', body: { mensagens: textos } }));
  const descartar = () => agir(() => api(`/instagram/sugestoes/${s.id}/descartar`, { method: 'POST' }));
  const janela = conversa.janela?.aberta;
  const classe = { ira_atender: 'ativa', janela_fechada: 'pausada', ignorada: 'humano', concluida: 'humano' }[status] || status || 'humano';

  return (
    <div className={`ia-faixa ia-faixa-${classe}`}>
      <div className="ia-faixa-topo">
        <span className="ia-faixa-icone"><Bot size={16} /></span>
        <div className="ia-faixa-texto">
          {!status && <span className="suave">{t('instagram.alice.semEstado')}</span>}
          {status === 'ira_atender' && <><b>{t('instagram.alice.iraAtender')}</b> <span className="suave">· {t('instagram.alice.iraAtenderDica')}</span></>}
          {status === 'ativa' && <><b>{t('instagram.alice.atendendo')}</b> <span className="suave">· {t('instagram.alice.atendendoDica', { n: estado.mensagens_ia || 0 })}</span></>}
          {status === 'aguardando_humano' && <><b>{t('instagram.alice.passouParaVoce')}</b> <span className="suave">· {estado.motivo} · {tempoDesde(estado.atualizada_em)}</span></>}
          {status === 'concluida' && <b>{t('instagram.alice.concluida')}</b>}
          {status === 'humano' && <span className="suave">{t('instagram.alice.humano')}</span>}
          {status === 'pausada' && <span className="suave">{t('instagram.alice.pausada')}</span>}
          {status === 'ignorada' && <span className="suave">{t('instagram.alice.ignorada', { motivo: estado.motivo || '' })}</span>}
          {status === 'janela_fechada' && <span className="suave">{t('instagram.alice.janelaFechada')}</span>}
          {status === 'erro' && <span className="alerta">{t('instagram.alice.erro')}{estado.motivo ? ` · ${estado.motivo}` : ''}</span>}
          {!aliceNoPerfil && status && <span className="suave"> · {t('instagram.alice.desligadaNoPerfil')}</span>}
        </div>
        {podeResponder && (
          <div className="ia-faixa-acoes">
            {(status === 'ativa' || status === 'ira_atender') && (
              <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => mudar('pausada')}><Pause size={13} /> {t('instagram.alice.pausar')}</button>
            )}
            {janela && aliceNoPerfil && ['pausada', 'aguardando_humano', 'humano', 'ignorada', 'erro', null].includes(status) && (
              <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => mudar('ativa')} title={t('instagram.alice.ligarDica')}>
                <Play size={13} /> {status ? t('instagram.alice.devolver') : t('instagram.alice.ligarAqui')}
              </button>
            )}
          </div>
        )}
      </div>

      {estado.resumo && <p className="ia-resumo"><Sparkles size={12} /> {estado.resumo}</p>}

      {s && (
        <div className="ia-sugestao">
          <div className="ia-sugestao-titulo">
            <b>{t('instagram.alice.sugestao')}</b>
            {s.acao === 'passar_humano' && <span className="ia-etiqueta">{t('instagram.alice.sugestaoHumano')}</span>}
            {s.acao === 'lead' && <span className="ia-etiqueta">{t('instagram.alice.sugestaoLead')}</span>}
          </div>
          {textos.map((x, i) => (
            <textarea key={i} rows={Math.min(6, Math.max(2, Math.ceil(x.length / 48)))} value={x} disabled={!podeResponder}
              onChange={(e) => setTextos((l) => l.map((y, j) => (j === i ? e.target.value : y)))} aria-label={t('instagram.alice.sugestaoN', { n: i + 1 })} />
          ))}
          {podeResponder && (
            <div className="ia-sugestao-acoes">
              <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={descartar}><X size={13} /> {t('instagram.alice.descartar')}</button>
              <button type="button" className="btn btn-ouro btn-pequeno" disabled={ocupado || !janela || !textos.some((x) => x.trim())} onClick={aprovar}><Send size={13} /> {t('instagram.alice.enviar')}</button>
            </div>
          )}
        </div>
      )}
      {erro && <p className="alerta pequeno" onClick={() => setErro('')}>{erro}</p>}
    </div>
  );
}

// Caixa de resposta: emoji, anexo (foto, vídeo, áudio, PDF) e texto (Enter envia)
function CompositorIg({ conversaId, onEnviarTexto, onArquivos, devolver, t }) {
  const chave = `ig-rascunho:${conversaId}`;
  const [texto, setTexto] = useState(() => { try { return localStorage.getItem(chave) || ''; } catch { return ''; } });
  const [emoji, setEmoji] = useState(false);
  const campo = useRef(null);
  const arquivoInput = useRef(null);

  useEffect(() => { try { if (texto) localStorage.setItem(chave, texto); else localStorage.removeItem(chave); } catch { /* sem armazenamento */ } }, [chave, texto]);
  useEffect(() => { if (devolver?.texto) setTexto((atual) => atual || devolver.texto); }, [devolver]);
  useLayoutEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight, 140)}px`;
  }, [texto]);
  useEffect(() => { campo.current?.focus(); }, []);

  const tamanho = bytes(texto);
  const partes = tamanho > MAX_BYTES ? Math.ceil(tamanho / MAX_BYTES) : 1;
  const enviar = () => {
    const conteudo = texto.trim();
    if (!conteudo) return;
    setTexto('');
    setEmoji(false);
    onEnviarTexto(conteudo);
  };
  const inserir = (e) => {
    const c = campo.current;
    if (!c) { setTexto((x) => x + e); return; }
    const ini = c.selectionStart ?? texto.length;
    const fim = c.selectionEnd ?? texto.length;
    setTexto(texto.slice(0, ini) + e + texto.slice(fim));
    requestAnimationFrame(() => { c.focus(); c.setSelectionRange(ini + e.length, ini + e.length); });
  };

  return (
    <div className="compositor">
      {emoji && (
        <div className="painel-expressoes">
          <SeletorEmoji className="no-painel" onEscolher={inserir} onFechar={() => setEmoji(false)} ignorar=".compositor" />
        </div>
      )}
      {partes > 1 && <div className="ig-aviso-partes suave pequeno">{t('instagram.compositor.partes', { n: partes })}</div>}
      <div className="barra-digitacao">
        <button type="button" className={`botao-icone botao-emoji ${emoji ? 'ativo' : ''}`} onClick={() => setEmoji((v) => !v)} aria-label={t('instagram.compositor.emoji')} title={t('instagram.compositor.emoji')}>
          <Smile size={24} />
        </button>
        <button type="button" className="botao-icone" onClick={() => arquivoInput.current?.click()} aria-label={t('instagram.compositor.anexar')} title={t('instagram.compositor.anexarDica')}>
          <Paperclip size={22} />
        </button>
        <input ref={arquivoInput} type="file" accept="image/*,video/*,audio/*,application/pdf" multiple hidden
          onChange={(e) => { onArquivos([...(e.target.files || [])]); e.target.value = ''; }} />
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          placeholder={t('instagram.compositor.placeholder')}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
            if (e.key === 'Escape' && emoji) setEmoji(false);
          }}
          onPaste={(e) => {
            const arquivos = [...(e.clipboardData?.files || [])];
            if (arquivos.length) { e.preventDefault(); onArquivos(arquivos); }
          }}
        />
        <button type="button" className="botao-enviar" onClick={enviar} disabled={!texto.trim()} aria-label={t('instagram.compositor.enviar')} title={t('instagram.compositor.enviar')}>
          <SendHorizontal size={22} />
        </button>
      </div>
    </div>
  );
}

function Visualizador({ midia, onFechar, t }) {
  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);
  return (
    <div className="visualizador" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="visualizador-topo">
        <span className="espaco" />
        <a className="btn btn-pequeno" href={`${midia.src}?download=1`}><Download size={14} /> {t('instagram.chat.baixar')}</a>
        <button className="btn btn-pequeno" onClick={onFechar} aria-label={t('instagram.chat.fechar')}><X size={14} /></button>
      </div>
      <div className="visualizador-corpo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
        <img src={midia.src} alt="" />
      </div>
    </div>
  );
}

export default function ChatIg({ conversa, perfil, user, onEnviado }) {
  const t = useT();
  const [mensagens, setMensagens] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [erro, setErro] = useState('');
  const [envios, setEnvios] = useState([]);
  const [visualizar, setVisualizar] = useState(null);
  const [devolver, setDevolver] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [noFim, setNoFim] = useState(true);
  const [novas, setNovas] = useState(0);
  const lista = useRef(null);
  const ultimo = useRef(null);
  const alturaAntes = useRef(null);
  const podeResponder = pode(user, 'instagram_responder');
  const janela = conversa.janela;
  const url = `/instagram/conversas/${conversa.id}`;

  const carregar = useCallback(async () => {
    try {
      const d = await api(`${url}/mensagens`);
      setMensagens((atual) => {
        if (!atual.length) setTemMais(d.tem_mais);
        return mesclar(atual, d.mensagens);
      });
      setCarregou(true);
    } catch (e) { setErro(e.message); setCarregou(true); }
  }, [url]);

  useEffect(() => {
    carregar();
    const id = setInterval(() => { if (!document.hidden) carregar(); }, RESERVA_MS);
    return () => clearInterval(id);
  }, [carregar]);
  useEvento('instagram', (d) => { if (avisoTem(d, 'conversa', conversa.id) || d?.conversas) carregar(); });

  // Rolagem: começa no fim, acompanha mensagens novas quando já está no fim e mantém a posição ao carregar as antigas
  useLayoutEffect(() => {
    const el = lista.current;
    if (!el || !mensagens.length) return;
    if (alturaAntes.current !== null) {
      el.scrollTop = el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
      return;
    }
    const ultima = mensagens.at(-1);
    if (ultima.id === ultimo.current) return;
    const primeiraVez = ultimo.current === null;
    ultimo.current = ultima.id;
    if (primeiraVez || noFim || ultima.de_mim) el.scrollTop = el.scrollHeight;
    else setNovas((n) => n + 1);
  }, [mensagens, noFim]);

  // Fotos e vídeos crescem depois de carregar: se a conversa estava no fim, continua no fim
  const noFimRef = useRef(true);
  noFimRef.current = noFim;
  useEffect(() => {
    const el = lista.current;
    if (!el) return undefined;
    const aoCarregar = () => { if (noFimRef.current) el.scrollTop = el.scrollHeight; };
    el.addEventListener('load', aoCarregar, true);
    el.addEventListener('loadedmetadata', aoCarregar, true);
    return () => { el.removeEventListener('load', aoCarregar, true); el.removeEventListener('loadedmetadata', aoCarregar, true); };
  }, [carregou, mensagens.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const aoRolar = () => {
    const el = lista.current;
    if (!el) return;
    const fim = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setNoFim(fim);
    if (fim) setNovas(0);
    if (el.scrollTop < 80 && temMais && !carregandoAntigas) carregarAntigas();
  };

  const carregarAntigas = async () => {
    if (!mensagens.length) return;
    setCarregandoAntigas(true);
    try {
      const d = await api(`${url}/mensagens?antes=${encodeURIComponent(mensagens[0].timestamp)}`);
      alturaAntes.current = lista.current ? lista.current.scrollHeight - lista.current.scrollTop : null;
      setMensagens((l) => mesclar(l, d.mensagens));
      setTemMais(d.tem_mais);
    } catch (e) { setErro(e.message); } finally { setCarregandoAntigas(false); }
  };

  const irParaFim = () => {
    const el = lista.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNovas(0);
  };

  const enviarTexto = async (texto) => {
    setErro('');
    try {
      await api(`${url}/mensagens`, { method: 'POST', body: { texto } });
      onEnviado?.();
    } catch (e) {
      setErro(e.message);
      setDevolver({ texto, em: Date.now() });
    } finally { carregar(); }
  };

  const enviarArquivos = async (arquivos) => {
    for (const [i, arquivo] of arquivos.entries()) {
      const id = `${Date.now()}-${i}`;
      if (arquivo.size > MAX_ARQUIVO) { setErro(t('instagram.compositor.grande', { nome: arquivo.name })); continue; }
      setEnvios((e) => [...e, { id, nome: arquivo.name || 'arquivo', progresso: 0 }]);
      const p = new URLSearchParams({ nome: arquivo.name || 'arquivo', mime: arquivo.type || 'application/octet-stream' });
      try {
        await enviarComProgresso(rota(`/api${url}/arquivo?${p}`), arquivo, (progresso) => setEnvios((e) => e.map((x) => (x.id === id ? { ...x, progresso } : x))));
        setEnvios((e) => e.filter((x) => x.id !== id));
        onEnviado?.();
      } catch (err) {
        setEnvios((e) => e.map((x) => (x.id === id ? { ...x, erro: err.message } : x)));
      }
      carregar();
    }
  };

  const baixarDeNovo = async (msgId) => {
    try { await api(`/instagram/midia/${msgId}/baixar`, { method: 'POST' }); carregar(); } catch (e) { setErro(e.message); }
  };

  const porMid = useMemo(() => new Map(mensagens.filter((m) => m.mid).map((m) => [m.mid, m])), [mensagens]);
  const podeEscrever = podeResponder && janela?.aberta;

  return (
    <div className="conversa conversa-cheia ig-conversa"
      onDragOver={(e) => { if (podeEscrever && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); if (podeEscrever) enviarArquivos([...(e.dataTransfer?.files || [])]); }}>
      <div className="conversa-lista">
        {!carregou && <div className="conversa-vazia"><span className="girando" /></div>}
        {carregou && !mensagens.length && <div className="conversa-vazia">{t('instagram.chat.vazia')}</div>}
        {carregou && mensagens.length > 0 && (
          <div className="ig-rolagem" ref={lista} onScroll={aoRolar}>
            <div className="topo-lista-mensagens">
              {carregandoAntigas && <div className="carregando-antigas"><span className="girando" /></div>}
              {temMais && !carregandoAntigas && <button type="button" className="btn btn-pequeno" onClick={carregarAntigas}>{t('instagram.chat.carregarAntigas')}</button>}
              {!temMais && <div className="aviso-criptografia"><Lock size={12} /> {t('instagram.chat.avisoHistorico')}</div>}
            </div>
            {mensagens.map((m, i) => {
              const anterior = mensagens[i - 1];
              const novoDia = !anterior || new Date(anterior.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
              const primeira = novoDia || anterior.de_mim !== m.de_mim || new Date(m.timestamp) - new Date(anterior.timestamp) > 10 * 60000;
              return (
                <div key={m.id} className="bloco-mensagem">
                  {novoDia && <div className="separador-dia"><span>{rotuloDia(m.timestamp)}</span></div>}
                  <MensagemIg m={m} primeira={primeira} citada={m.resposta_mid ? porMid.get(m.resposta_mid) : null} onAbrir={setVisualizar} onBaixar={baixarDeNovo} t={t} />
                </div>
              );
            })}
            <div style={{ height: 8 }} />
          </div>
        )}
      </div>

      {(novas > 0 || !noFim) && carregou && mensagens.length > 0 && (
        <button type="button" className="botao-descer" onClick={irParaFim} aria-label={t('instagram.chat.irParaFim')}>
          {novas > 0 && <span className="contador-nao-lidas">{novas}</span>}
          <ChevronDown size={22} />
        </button>
      )}

      {envios.length > 0 && (
        <div className="envios">
          {envios.map((e) => (
            <div key={e.id} className={`envio ${e.erro ? 'com-erro' : ''}`}>
              <span className="envio-nome">{e.erro ? `${e.nome}: ${e.erro}` : e.progresso < 100 ? t('instagram.compositor.enviando', { nome: e.nome }) : t('instagram.compositor.processando', { nome: e.nome })}</span>
              {!e.erro && <span className="envio-barra"><i style={{ width: `${e.progresso}%` }} /></span>}
              {e.erro && <button type="button" className="botao-icone" onClick={() => setEnvios((l) => l.filter((x) => x.id !== e.id))}><X size={16} /></button>}
            </div>
          ))}
        </div>
      )}

      <FaixaAlice conversa={conversa} perfil={perfil} podeResponder={podeResponder} t={t} />

      {erro && <div className="erro conversa-erro" onClick={() => setErro('')}>{erro} <span><X size={14} /></span></div>}

      {!podeResponder ? (
        <p className="suave pequeno aviso-sem-numero"><Lock size={13} /> {t('instagram.compositor.semPermissao')}</p>
      ) : !janela?.aberta ? (
        <p className="suave pequeno aviso-sem-numero ig-janela-fechada">
          <Clock size={13} /> {conversa.ultima_dele_em ? t('instagram.compositor.janelaFechada', { quando: dataHora(conversa.ultima_dele_em) }) : t('instagram.compositor.semMensagemDele')}
        </p>
      ) : (
        <CompositorIg key={conversa.id} conversaId={conversa.id} onEnviarTexto={enviarTexto} onArquivos={enviarArquivos} devolver={devolver} t={t} />
      )}

      {arrastando && <div className="soltar-aqui">{t('instagram.compositor.soltar')}</div>}
      {visualizar && <Visualizador midia={visualizar} onFechar={() => setVisualizar(null)} t={t} />}
    </div>
  );
}
