// Comentários das publicações: ver, responder em público, ocultar e "chamar no Direct" (uma mensagem privada que a
// Meta deixa mandar em até 7 dias; se a pessoa responder, a conversa segue no Direct com a Alice e a equipe).
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Send, EyeOff, Eye, RefreshCw, Search, X, Heart, Megaphone, CheckCheck, ExternalLink, CornerDownRight, MessagesSquare } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { pode } from '../../permissoes.js';
import { tempoDesde, dataHora } from '../../utils.js';
import { useAviso, Vazio } from '../disparos/comum.jsx';
import { Miniatura } from './comum.jsx';

const FILTROS = ['todos', 'nao_lidos', 'sem_resposta', 'anuncios', 'ocultos'];

function abrirNoDirect(conversaId) {
  window.__igAbrir = conversaId;
  window.dispatchEvent(new CustomEvent('ig-abrir', { detail: conversaId }));
}

function Cartao({ c, podeDirect, varios, t, aoMudar }) {
  const aviso = useAviso();
  const [modo, setModo] = useState(null); // 'responder' | 'direct'
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [conversa, setConversa] = useState(null);

  const abrir = (m) => {
    setModo(m);
    setTexto(m === 'direct' ? t('instagram.comentarios.mensagemPadrao', { usuario: c.usuario || '' }) : c.usuario ? `@${c.usuario} ` : '');
  };
  const executar = async (fn, ok) => {
    setOcupado(true);
    try {
      const r = await fn();
      aviso(ok);
      setModo(null);
      setTexto('');
      aoMudar();
      return r;
    } catch (e) { aviso(e.message, 'erro'); return null; } finally { setOcupado(false); }
  };
  const enviar = async (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    if (modo === 'responder') {
      await executar(() => api(`/instagram/comentarios/${encodeURIComponent(c.id)}/responder`, { method: 'POST', body: { texto } }), t('instagram.comentarios.respondido'));
    } else {
      const r = await executar(() => api(`/instagram/comentarios/${encodeURIComponent(c.id)}/direct`, { method: 'POST', body: { texto } }), t('instagram.comentarios.chamado'));
      if (r?.conversa_id) setConversa(r.conversa_id);
    }
  };
  const ocultar = () => executar(
    () => api(`/instagram/comentarios/${encodeURIComponent(c.id)}/ocultar`, { method: 'POST', body: { oculto: !c.oculto } }),
    c.oculto ? t('instagram.comentarios.mostrado') : t('instagram.comentarios.ocultado')
  );
  const marcarLido = () => api('/instagram/comentarios/lidos', { method: 'POST', body: { ids: [c.id] } }).then(aoMudar).catch(() => {});

  return (
    <article className={`ig-comentario cartao-secao ${c.lido ? '' : 'nao-lido'} ${c.oculto ? 'oculto' : ''}`}>
      <a className="ig-comentario-post" href={c.post?.permalink || undefined} target="_blank" rel="noreferrer" title={c.post?.legenda || ''}>
        <Miniatura post={{ id: c.post_id }} tamanho={52} />
      </a>
      <div className="ig-comentario-corpo">
        <div className="ig-comentario-topo">
          <a href={c.usuario ? `https://instagram.com/${c.usuario}` : undefined} target="_blank" rel="noreferrer"><b>@{c.usuario || '?'}</b></a>
          <small className="suave" title={dataHora(c.publicado_em)}>{tempoDesde(c.publicado_em)}</small>
          {varios && <span className="tag">@{c.perfil_username}</span>}
          {c.anuncio && <span className="tag"><Megaphone size={10} /> {t('instagram.comentarios.noAnuncio')}</span>}
          {c.oculto && <span className="tag"><EyeOff size={10} /> {t('instagram.comentarios.oculto')}</span>}
          {c.curtidas > 0 && <small className="suave"><Heart size={11} /> {c.curtidas}</small>}
          <span className="espaco" />
          {!c.lido && <button type="button" className="link-botao pequeno" onClick={marcarLido}>{t('instagram.comentarios.marcarLido')}</button>}
        </div>
        <p className="ig-comentario-texto">{c.texto}</p>
        {c.post?.legenda && <small className="suave ig-comentario-legenda">{t('instagram.comentarios.naPublicacao', { legenda: c.post.legenda })}</small>}

        {c.respostas.length > 0 && (
          <ul className="ig-respostas">
            {c.respostas.map((r) => (
              <li key={r.id} className={r.de_mim ? 'minha' : ''}>
                <CornerDownRight size={12} /> <b>@{r.usuario || '?'}</b> {r.texto} <small className="suave">· {tempoDesde(r.publicado_em)}</small>
              </li>
            ))}
          </ul>
        )}

        <div className="ig-comentario-status">
          {c.respondido_em && <small className="suave"><CheckCheck size={12} /> {t('instagram.comentarios.respondidoPor', { nome: c.respondido_por || t('instagram.comentarios.equipe'), quando: tempoDesde(c.respondido_em) })}</small>}
          {c.direct_em && <small className="suave"><MessageCircle size={12} /> {t('instagram.comentarios.chamadoPor', { nome: c.direct_por || t('instagram.comentarios.equipe'), quando: tempoDesde(c.direct_em) })}</small>}
          {conversa && <button type="button" className="link-botao pequeno" onClick={() => abrirNoDirect(conversa)}><ExternalLink size={12} /> {t('instagram.comentarios.abrirConversa')}</button>}
        </div>

        {modo ? (
          <form className="ig-comentario-form" onSubmit={enviar}>
            <small className="suave">{modo === 'direct' ? t('instagram.comentarios.directExplica') : t('instagram.comentarios.respostaExplica')}</small>
            <textarea autoFocus rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={modo === 'direct' ? 1000 : 2200} />
            <div className="acoes-linha">
              <button type="button" className="btn btn-pequeno" onClick={() => setModo(null)} disabled={ocupado}><X size={13} /> {t('instagram.comentarios.cancelar')}</button>
              <button className="btn btn-ouro btn-pequeno" disabled={ocupado || !texto.trim()}><Send size={13} /> {modo === 'direct' ? t('instagram.comentarios.enviarDirect') : t('instagram.comentarios.publicarResposta')}</button>
            </div>
          </form>
        ) : (
          <div className="acoes-linha">
            <button type="button" className="btn btn-pequeno" onClick={() => abrir('responder')}><MessagesSquare size={13} /> {t('instagram.comentarios.responder')}</button>
            {podeDirect && c.pode_direct && <button type="button" className="btn btn-pequeno" onClick={() => abrir('direct')}><MessageCircle size={13} /> {t('instagram.comentarios.chamarDirect')}</button>}
            {!c.pode_direct && !c.direct_em && <small className="suave">{t('instagram.comentarios.prazoDirect')}</small>}
            <button type="button" className="btn btn-pequeno" onClick={ocultar} disabled={ocupado}>
              {c.oculto ? <><Eye size={13} /> {t('instagram.comentarios.mostrar')}</> : <><EyeOff size={13} /> {t('instagram.comentarios.ocultar')}</>}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Comentarios({ user, perfis }) {
  const t = useT();
  const aviso = useAviso();
  const [filtro, setFiltro] = useState('nao_lidos');
  const [perfil, setPerfil] = useState('');
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState(null);
  const [atualizando, setAtualizando] = useState(false);
  const varios = perfis.length > 1;

  const carregar = useCallback(async () => {
    const p = new URLSearchParams({ filtro });
    if (perfil) p.set('perfil', perfil);
    if (busca.trim()) p.set('q', busca.trim());
    try { setDados(await api(`/instagram/comentarios?${p}`)); } catch (e) { aviso(e.message, 'erro'); }
  }, [filtro, perfil, busca, aviso]);
  useEffect(() => { const id = setTimeout(carregar, busca ? 250 : 0); return () => clearTimeout(id); }, [carregar, busca]);
  useEvento('instagram', (d) => { if (d?.comentarios) carregar(); });

  const atualizar = async () => {
    setAtualizando(true);
    try { await api('/instagram/comentarios/sincronizar', { method: 'POST' }); aviso(t('instagram.comentarios.buscando'), 'info'); } catch (e) { aviso(e.message, 'erro'); }
    setTimeout(() => setAtualizando(false), 4000);
  };
  const lerTodos = async () => {
    const ids = (dados?.comentarios || []).filter((c) => !c.lido).map((c) => c.id);
    if (!ids.length) return;
    try { await api('/instagram/comentarios/lidos', { method: 'POST', body: { ids } }); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };

  const lista = dados?.comentarios || [];
  return (
    <div className="pagina ig-aba">
      <div className="ig-barra">
        <div className="dp-segmentos">
          {FILTROS.map((f) => <button key={f} type="button" className={filtro === f ? 'ativo' : ''} onClick={() => setFiltro(f)}>{t(`instagram.comentarios.filtro.${f}`)}</button>)}
        </div>
        {varios && (
          <select value={perfil} onChange={(e) => setPerfil(e.target.value)} className="ig-seletor">
            <option value="">{t('instagram.direct.todosPerfis')}</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>@{p.username}</option>)}
          </select>
        )}
        <label className="ig-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t('instagram.comentarios.buscar')} /></label>
        <span className="espaco" />
        <button type="button" className="btn btn-pequeno" onClick={lerTodos} disabled={!lista.some((c) => !c.lido)}><CheckCheck size={14} /> {t('instagram.comentarios.lerTodos')}</button>
        <button type="button" className="btn btn-pequeno" onClick={atualizar} disabled={atualizando}><RefreshCw size={14} className={atualizando ? 'dp-gira' : ''} /> {t('instagram.comentarios.atualizar')}</button>
      </div>

      {dados && !dados.ativo && <p className="dp-dica-admin">{t('instagram.comentarios.desligado')}</p>}
      {!dados && <div className="dp-centro"><span className="girando" /></div>}
      {dados && !lista.length && (
        <Vazio icone={MessagesSquare} titulo={t('instagram.comentarios.vazioTitulo')}>{filtro === 'nao_lidos' ? t('instagram.comentarios.vazioNaoLidos') : t('instagram.comentarios.vazio')}</Vazio>
      )}
      <div className="ig-comentarios">
        {lista.map((c) => <Cartao key={c.id} c={c} podeDirect={pode(user, 'instagram_responder')} varios={varios} t={t} aoMudar={carregar} />)}
      </div>
      <p className="suave pequeno">{t('instagram.comentarios.rodape')}</p>
    </div>
  );
}
