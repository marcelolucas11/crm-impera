// Direct do Instagram no estilo da tela de WhatsApp: conversas à esquerda, chat no meio, ficha à direita.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, ArrowLeft, PanelRightOpen, PanelRightClose, MoreVertical, Archive, ArchiveRestore, Pin, PinOff, MailOpen, Mail, Hourglass, Bot, Megaphone, Camera as IconeInstagram, Sun, Moon, ExternalLink } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { quando } from '../chat/ListaConversas.jsx';
import ChatIg from './ChatIg.jsx';
import PainelIg from './PainelIg.jsx';
import { FotoContato, nomeDaConversa } from './comum.jsx';
import logo from '../../assets/logo-impera.png';

const FILTROS = ['todas', 'nao_lidas', 'responder', 'aguardando', 'alice', 'leads', 'nao_leads', 'anuncios'];
const ler = (k, p) => { try { return localStorage.getItem(k) ?? p; } catch { return p; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };


function Janela({ janela, t }) {
  if (!janela?.aberta) return <span className="ig-janela fechada" title={t('instagram.direct.janelaFechadaDica')}>{t('instagram.direct.janelaFechada')}</span>;
  const h = janela.horas_restantes;
  const texto = h < 1 ? t('instagram.direct.janelaMinutos', { n: Math.max(1, Math.round(h * 60)) })
    : h >= 48 ? t('instagram.direct.janelaDias', { n: Math.floor(h / 24) })
      : t('instagram.direct.janelaHoras', { n: Math.floor(h) });
  return <span className={`ig-janela ${h < 3 ? 'acabando' : ''}`} title={t('instagram.direct.janelaDica')}>{texto}</span>;
}

function MenuConversa({ c, onFechar, onEstado, t }) {
  const ref = useRef(null);
  useEffect(() => {
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) onFechar(); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [onFechar]);
  const fazer = (m) => () => { onFechar(); onEstado(c, m); };
  const naoLida = c.nao_lidas > 0 || c.marcada_nao_lida;
  return (
    <div className="menu-conversa" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={fazer({ arquivada: !c.arquivada })}>{c.arquivada ? <><ArchiveRestore size={16} /> {t('instagram.direct.desarquivar')}</> : <><Archive size={16} /> {t('instagram.direct.arquivar')}</>}</button>
      <button type="button" onClick={fazer({ fixada: !c.fixada })}>{c.fixada ? <><PinOff size={16} /> {t('instagram.direct.desafixar')}</> : <><Pin size={16} /> {t('instagram.direct.fixar')}</>}</button>
      <button type="button" onClick={fazer({ nao_lida: !naoLida })}>{naoLida ? <><MailOpen size={16} /> {t('instagram.direct.marcarLida')}</> : <><Mail size={16} /> {t('instagram.direct.marcarNaoLida')}</>}</button>
      <button type="button" onClick={fazer({ aguardando: !c.aguardando })}><Hourglass size={16} /> {c.aguardando ? t('instagram.direct.resolvido') : t('instagram.direct.aguardandoMinha')}</button>
      {c.username && <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" onClick={onFechar}><ExternalLink size={16} /> {t('instagram.direct.abrirPerfil')}</a>}
    </div>
  );
}

function Item({ c, aberta, onAbrir, onEstado, varios, t }) {
  const [menu, setMenu] = useState(false);
  const naoLida = c.nao_lidas > 0 || c.marcada_nao_lida;
  return (
    <div className={`item-conversa ${aberta ? 'aberta' : ''} ${naoLida ? 'nao-lida' : ''}`} role="button" tabIndex={0}
      onClick={() => onAbrir(c)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(c)} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <FotoContato conversa={c} />
      <span className="item-meio">
        <span className="item-linha">
          <b className="item-nome">{nomeDaConversa(c)}</b>
          <small className={`item-hora ${naoLida ? 'destaque' : ''}`}>{quando(c.ultima_em)}</small>
        </span>
        <span className="item-linha">
          <span className={`item-previa ${naoLida ? 'forte' : ''}`}>
            <span className="texto-previa">{c.ultima_minha ? `${t('instagram.direct.voce')}: ` : ''}{c.ultima_previa}</span>
          </span>
          <span className="item-icones">
            {c.fixada && <Pin size={15} />}
            {c.nao_lidas > 0 ? <span className="contador-nao-lidas">{c.nao_lidas}</span> : c.marcada_nao_lida ? <span className="contador-nao-lidas ponto-nao-lida" /> : null}
            <button type="button" className="item-seta" aria-label={t('instagram.direct.opcoes')} onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>⌄</button>
          </span>
        </span>
        <span className="item-tags">
          {varios && <span className="tag"><IconeInstagram size={10} /> @{c.perfil_username}</span>}
          {c.lead_id ? <span className="tag tag-etapa"><span className="ponto" style={{ background: c.etapa?.cor }} />{c.etapa?.nome}</span> : <span className="tag">{t('instagram.direct.naoLead')}</span>}
          {c.ia_status === 'ativa' && <span className="tag tag-ia"><Bot size={10} /> {t('instagram.direct.aliceAtendendo')}</span>}
          {c.sugestoes > 0 && <span className="tag tag-ia"><Bot size={10} /> {t('instagram.direct.sugestao')}</span>}
          {c.aguardando && <span className="tag tag-aguardando"><i className="led led-ambar" /> {t('instagram.direct.aguardando')}</span>}
          {c.anuncio_id && <span className="tag" title={c.anuncio_titulo || ''}><Megaphone size={10} /> {t('instagram.direct.anuncio')}</span>}
          {!c.ultima_minha && c.janela?.aberta && <Janela janela={c.janela} t={t} />}
        </span>
      </span>
      {menu && <MenuConversa c={c} onFechar={() => setMenu(false)} onEstado={onEstado} t={t} />}
    </div>
  );
}

export default function Direct({ user, stages, users, horas, perfis, aoMudarAlgo }) {
  const t = useT();
  const [conversas, setConversas] = useState([]);
  const [arquivadas, setArquivadas] = useState(0);
  const [carregou, setCarregou] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [perfil, setPerfil] = useState(() => ler('ig-perfil-filtro', ''));
  const [aberta, setAberta] = useState(() => window.__igAbrir || null);
  const [ultima, setUltima] = useState(null);
  const [tema, setTema] = useState(() => ler('wa-tema', 'escuro'));
  const estreita = () => typeof window !== 'undefined' && window.innerWidth < 1180;
  const [painel, setPainel] = useState(() => !estreita() && ler('ig-painel', 'aberto') !== 'fechado');
  const [menuTopo, setMenuTopo] = useState(false);
  const recarga = useRef(null);

  useEffect(() => gravar('ig-perfil-filtro', perfil), [perfil]);
  useEffect(() => gravar('wa-tema', tema), [tema]);

  const carregar = useCallback(async () => {
    try {
      const p = new URLSearchParams({ filtro });
      if (busca.trim()) p.set('q', busca.trim());
      if (perfil) p.set('perfil', perfil);
      const d = await api(`/instagram/conversas?${p}`);
      setConversas(d.conversas);
      setArquivadas(d.arquivadas || 0);
      setCarregou(true);
    } catch { setCarregou(true); }
  }, [busca, filtro, perfil]);

  useEffect(() => {
    const tm = setTimeout(carregar, busca ? 250 : 0);
    const id = setInterval(() => { if (!document.hidden) carregar(); }, 30000);
    return () => { clearTimeout(tm); clearInterval(id); };
  }, [carregar, busca]);

  useEvento('instagram', (d) => {
    if (!d?.conversa && !d?.conversas && !d?.contato && !d?.reconectou && !d?.ia) return;
    clearTimeout(recarga.current);
    recarga.current = setTimeout(carregar, 200);
  });

  // "Abrir conversa" vindo de outra tela
  useEffect(() => {
    const ir = (e) => { const id = Number(e?.detail || window.__igAbrir); if (id) { setAberta(id); window.__igAbrir = null; } };
    if (window.__igAbrir) ir();
    window.addEventListener('ig-abrir', ir);
    return () => window.removeEventListener('ig-abrir', ir);
  }, []);

  const conversa = conversas.find((c) => c.id === aberta) || (ultima?.id === aberta ? ultima : null);
  useEffect(() => { if (conversa) setUltima(conversa); }, [conversa]);
  // Conversa aberta que não está na lista (filtro ou vinda de outra tela): busca direto
  useEffect(() => {
    if (!aberta || conversa) return;
    api(`/instagram/conversas/${aberta}`).then((d) => setUltima(d.conversa)).catch(() => setAberta(null));
  }, [aberta, conversa]);

  const abrir = (c) => {
    setAberta(c.id);
    setUltima(c);
    if (estreita()) setPainel(false);
    setConversas((cs) => cs.map((x) => (x.id === c.id ? { ...x, nao_lidas: 0, marcada_nao_lida: false } : x)));
  };

  const mudarEstado = async (c, mudanca) => {
    try {
      await api(`/instagram/conversas/${c.id}`, { method: 'PATCH', body: mudanca });
      carregar();
      aoMudarAlgo?.();
    } catch { /* o aviso aparece no próximo carregamento */ }
  };

  const alternarPainel = () => setPainel((p) => { gravar('ig-painel', p ? 'fechado' : 'aberto'); return !p; });
  const varios = perfis.length > 1;

  return (
    <div className={`whatsapp-tela wa-tela ig-direct ${conversa ? 'com-conversa' : ''} ${painel && conversa ? 'com-painel' : ''}`} data-tema={tema}>
      <aside className="lista-conversas">
        <div className="lista-cabecalho">
          <b className="lista-titulo">{t('instagram.direct.titulo')}</b>
          <span className="espaco" />
          {varios && (
            <select className="seletor-numero-lista" value={perfil} onChange={(e) => setPerfil(e.target.value)} title={t('instagram.direct.qualPerfil')}>
              <option value="">{t('instagram.direct.todosPerfis')}</option>
              {perfis.map((p) => <option key={p.id} value={p.id}>@{p.username}</option>)}
            </select>
          )}
          <button type="button" className="botao-icone" title={tema === 'escuro' ? t('instagram.direct.temaClaro') : t('instagram.direct.temaEscuro')} onClick={() => setTema((x) => (x === 'escuro' ? 'claro' : 'escuro'))}>
            {tema === 'escuro' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
        <div className="lista-topo">
          {filtro === 'arquivadas' ? (
            <div className="titulo-arquivadas">
              <button type="button" className="botao-icone" onClick={() => setFiltro('todas')} aria-label={t('instagram.direct.voltar')}><ArrowLeft size={20} /></button>
              <b>{t('instagram.direct.arquivadas')}</b>
            </div>
          ) : (
            <>
              <label className="campo-busca">
                <Search size={17} />
                <input type="text" placeholder={t('instagram.direct.buscar')} value={busca} onChange={(e) => setBusca(e.target.value)} />
                {busca && <button type="button" onClick={() => setBusca('')} aria-label={t('instagram.direct.limpar')}><X size={16} /></button>}
              </label>
              <div className="filtros-conversas">
                {FILTROS.map((f) => (
                  <button key={f} type="button" className={`chip chip-pequeno ${filtro === f ? 'ativo' : ''}`} onClick={() => setFiltro(f)}>{t(`instagram.direct.filtro.${f}`)}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="itens-conversas">
          {filtro !== 'arquivadas' && arquivadas > 0 && !busca && (
            <button type="button" className="linha-arquivadas" onClick={() => setFiltro('arquivadas')}>
              <Archive size={18} /> <span>{t('instagram.direct.arquivadas')}</span> <small>{arquivadas}</small>
            </button>
          )}
          {carregou && conversas.length === 0 && (
            <div className="vazio-conversas">{busca ? t('instagram.direct.nadaBusca') : filtro !== 'todas' ? t('instagram.direct.nadaFiltro') : t('instagram.direct.nadaAinda')}</div>
          )}
          {conversas.map((c) => <Item key={c.id} c={c} aberta={aberta === c.id} onAbrir={abrir} onEstado={mudarEstado} varios={varios} t={t} />)}
        </div>
      </aside>

      <section className="chat">
        {!conversa ? (
          <div className="chat-vazio">
            <img className="chat-vazio-logo" src={logo} alt="" />
            <div className="marca marca-grande">IMPERA <span>CRM</span></div>
            <p className="suave">{t('instagram.direct.escolha')}</p>
            <p className="suave pequeno">{t('instagram.direct.regra24h')}</p>
          </div>
        ) : (
          <>
            <div className="chat-topo">
              <button className="botao-icone voltar-lista" onClick={() => setAberta(null)} aria-label={t('instagram.direct.voltar')}><ArrowLeft size={20} /></button>
              <button type="button" className="chat-topo-contato" onClick={alternarPainel}>
                <FotoContato conversa={conversa} tamanho={40} />
                <span className="chat-topo-textos">
                  <b>{nomeDaConversa(conversa)}</b>
                  <small className="suave">
                    {conversa.username ? `@${conversa.username}` : ''}{conversa.username ? ' · ' : ''}
                    {t('instagram.direct.noPerfil', { perfil: conversa.perfil_username })}
                    {conversa.lead_id ? ` · ${t('instagram.direct.leadEm', { etapa: conversa.etapa?.nome || '' })}` : ''}
                  </small>
                </span>
              </button>
              <span className="espaco" />
              <Janela janela={conversa.janela} t={t} />
              <button type="button" className={`botao-icone ${painel ? 'ativo' : ''}`} title={painel ? t('instagram.direct.recolherFicha') : t('instagram.direct.mostrarFicha')} onClick={alternarPainel}>
                {painel ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
              </button>
              <div className="posicao-relativa">
                <button type="button" className={`botao-icone ${menuTopo ? 'ativo' : ''}`} onClick={() => setMenuTopo((v) => !v)} aria-label={t('instagram.direct.opcoes')}><MoreVertical size={20} /></button>
                {menuTopo && <div className="menu-topo direita"><MenuConversa c={conversa} onFechar={() => setMenuTopo(false)} onEstado={mudarEstado} t={t} /></div>}
              </div>
            </div>
            <ChatIg key={conversa.id} conversa={conversa} perfil={perfis.find((p) => p.id === conversa.perfil_id)} user={user} onEnviado={() => { carregar(); aoMudarAlgo?.(); }} />
          </>
        )}
      </section>

      {painel && conversa && (
        <PainelIg key={conversa.id} conversa={conversa} user={user} stages={stages} users={users} horas={horas} onFechar={alternarPainel}
          onAtualizado={() => { carregar(); aoMudarAlgo?.(); }} />
      )}
    </div>
  );
}
