import { memo, useEffect, useRef, useState } from 'react';
import { Search, Archive, ArchiveRestore, Pin, PinOff, BellOff, Bell, MailOpen, Mail, Heart, HeartOff, Tag, EyeOff, ExternalLink, ChevronDown, ArrowLeft, Users, Image as IconeImagem, Video, Mic, FileText, Sticker, MapPin, UserRound, BarChart3, Phone, Calendar, X, Ban } from 'lucide-react';
import Avatar from '../Avatar.jsx';
import { Tique } from './Mensagem.jsx';
import { realcar } from './formatacao.jsx';
import { formatarTelefone } from '../../utils.js';
import { temRascunho } from './Compositor.jsx';

const ICONES_TIPO = {
  imagem: IconeImagem, video: Video, audio: Mic, documento: FileText, figurinha: Sticker, localizacao: MapPin, contato: UserRound,
  enquete: BarChart3, chamada: Phone, evento: Calendar,
};

const FILTROS = [
  ['todas', 'Tudo'],
  ['nao_lidas', 'Não lidas'],
  ['favoritas', 'Favoritas'],
  ['grupos', 'Grupos'],
  ['leads', 'Leads'],
  ['contatos', 'Não são leads'],
  ['aguardando', 'Aguardando'],
];

// Data da última mensagem no formato do WhatsApp Web: hora (hoje), "Ontem", dia da semana ou data
export function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  if (hoje - d < 6 * 86400000) return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const SILENCIAR = [
  ['8 horas', 8 * 3600000],
  ['1 semana', 7 * 86400000],
  ['Sempre', null],
];

function MenuConversa({ c, etiquetas, onFechar, onEstado, onAbrirWeb }) {
  const ref = useRef(null);
  const [sub, setSub] = useState(null);
  useEffect(() => {
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) onFechar(); };
    const tecla = (e) => e.key === 'Escape' && onFechar();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [onFechar]);
  const fazer = (mudanca) => () => { onFechar(); onEstado(c, mudanca); };
  const silenciada = Boolean(c.silenciada_ate);
  const naoLida = c.nao_lidas > 0 || c.marcada_nao_lida;
  return (
    <div className="menu-conversa" ref={ref} onClick={(e) => e.stopPropagation()}>
      {sub === 'silenciar' ? (
        <>
          <span className="menu-titulo">Silenciar por…</span>
          {SILENCIAR.map(([rotulo, ms]) => (
            <button key={rotulo} type="button" onClick={fazer({ silenciada_ate: ms ? new Date(Date.now() + ms).toISOString() : '9999-12-31T00:00:00.000Z' })}>{rotulo}</button>
          ))}
        </>
      ) : sub === 'etiquetas' ? (
        <>
          <span className="menu-titulo">Etiquetas</span>
          {!etiquetas.length && <span className="menu-vazio">Crie etiquetas no menu ⋮ da lista.</span>}
          {etiquetas.map((t) => {
            const tem = c.etiquetas.includes(t.id);
            return (
              <button key={t.id} type="button" onClick={() => onEstado(c, { etiquetas: tem ? c.etiquetas.filter((x) => x !== t.id) : [...c.etiquetas, t.id] })}>
                <span className="ponto" style={{ background: t.color }} /> {t.name} {tem && '✓'}
              </button>
            );
          })}
        </>
      ) : (
        <>
          <button type="button" onClick={fazer({ arquivada: !c.arquivada })}>{c.arquivada ? <><ArchiveRestore size={16} /> Desarquivar</> : <><Archive size={16} /> Arquivar conversa</>}</button>
          {silenciada
            ? <button type="button" onClick={fazer({ silenciada_ate: null })}><Bell size={16} /> Reativar notificações</button>
            : <button type="button" onClick={() => setSub('silenciar')}><BellOff size={16} /> Silenciar notificações</button>}
          <button type="button" onClick={fazer({ fixada: !c.fixada })}>{c.fixada ? <><PinOff size={16} /> Desafixar conversa</> : <><Pin size={16} /> Fixar conversa</>}</button>
          <button type="button" onClick={fazer({ nao_lida: !naoLida })}>{naoLida ? <><MailOpen size={16} /> Marcar como lida</> : <><Mail size={16} /> Marcar como não lida</>}</button>
          <button type="button" onClick={fazer({ favorita: !c.favorita })}>{c.favorita ? <><HeartOff size={16} /> Tirar das favoritas</> : <><Heart size={16} /> Adicionar às favoritas</>}</button>
          <button type="button" onClick={() => setSub('etiquetas')}><Tag size={16} /> Etiquetar conversa</button>
          {c.telefone && !c.grupo && <button type="button" onClick={() => { onFechar(); onAbrirWeb(c); }}><ExternalLink size={16} /> Abrir no WhatsApp Web</button>}
          <button type="button" className="perigo" onClick={fazer({ oculta: true })} title="Some da lista até chegar mensagem nova. Nada é apagado."><EyeOff size={16} /> Ocultar conversa</button>
        </>
      )}
    </div>
  );
}

const ItemConversa = memo(function ItemConversa({ c, aberta, etiquetas, busca, onAbrir, onEstado, onAbrirWeb }) {
  const [menu, setMenu] = useState(false);
  const Icone = ICONES_TIPO[c.ultimo_tipo];
  const naoLida = c.nao_lidas > 0 || c.marcada_nao_lida;
  const rascunho = !aberta && temRascunho(c.chave);
  const etiquetasDaConversa = etiquetas.filter((t) => c.etiquetas?.includes(t.id));
  const nome = c.nome || formatarTelefone(c.telefone) || 'Contato';
  let previa;
  if (c.digitando) previa = <span className="digitando">{c.digitando === 'recording' ? 'gravando áudio…' : 'digitando…'}</span>;
  else if (rascunho) previa = <span><b className="rascunho">Rascunho:</b> {(() => { try { return localStorage.getItem(`wa-rascunho:${c.chave}`); } catch { return ''; } })()}</span>;
  else if (c.ultima_apagada) previa = <i className="com-icone"><Ban size={13} /> Mensagem apagada</i>;
  else {
    const texto = String(c.ultima_mensagem || '').replace(/^(📷|🎥|🎤|🎵|📄|🙂|📍|👤|📊|📞|📅|🎞)\s*/u, '');
    previa = (
      <>
        {c.ultima_minha && <Tique status={c.ultimo_status} />}
        {c.ultima_autor && <span className="autor-previa">{c.ultima_autor}: </span>}
        {Icone && <Icone size={15} className="icone-previa" />}
        <span className="texto-previa">{texto}</span>
      </>
    );
  }
  return (
    <div className={`item-conversa ${aberta ? 'aberta' : ''} ${naoLida ? 'nao-lida' : ''}`} role="button" tabIndex={0}
      onClick={() => onAbrir(c)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(c)}
      onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <Avatar chave={c.chave} nome={c.nome} tamanho={49} lead={Boolean(c.lead_id)} grupo={c.grupo} />
      <span className="item-meio">
        <span className="item-linha">
          <b className="item-nome">{realcar(nome, busca)}</b>
          <small className={`item-hora ${naoLida && !c.silenciada_ate ? 'destaque' : ''}`}>{quando(c.ultima_em)}</small>
        </span>
        <span className="item-linha">
          <span className={`item-previa ${naoLida ? 'forte' : ''}`}>{previa}</span>
          <span className="item-icones">
            {c.silenciada_ate && <BellOff size={15} />}
            {c.fixada && <Pin size={15} />}
            {c.nao_lidas > 0 ? <span className={`contador-nao-lidas ${c.silenciada_ate ? 'silenciado' : ''}`}>{c.nao_lidas}</span>
              : c.marcada_nao_lida ? <span className="contador-nao-lidas ponto-nao-lida" /> : null}
            <button type="button" className="item-seta" aria-label="Opções da conversa" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
              <ChevronDown size={18} />
            </button>
          </span>
        </span>
        <span className="item-tags">
          {c.grupo ? <span className="tag"><Users size={11} /> Grupo</span>
            : c.lead_id ? <span className="tag tag-etapa"><span className="ponto" style={{ background: c.etapa?.cor }} />{c.etapa?.nome}</span>
              : <span className="tag">Não é lead</span>}
          {etiquetasDaConversa.map((t) => <span key={t.id} className="tag" style={{ borderColor: t.color, color: t.color }}>{t.name}</span>)}
          {c.aguardando && <span className="tag tag-aguardando"><i className="led led-ambar" /> aguardando</span>}
          {c.atrasado && <span className="tag tag-atrasado"><i className="led led-vermelho" /> follow-up</span>}
        </span>
      </span>
      {menu && <MenuConversa c={c} etiquetas={etiquetas} onFechar={() => setMenu(false)} onEstado={onEstado} onAbrirWeb={onAbrirWeb} />}
    </div>
  );
});

export default function ListaConversas({
  conversas, arquivadas, mensagensBusca, carregou, aberta, busca, setBusca, filtro, setFiltro, etiquetas, numeros, user,
  onAbrir, onAbrirMensagem, onEstado, onAbrirWeb, campoBusca, topo,
}) {
  const vendoArquivadas = filtro === 'arquivadas';
  return (
    <aside className="lista-conversas">
      {topo}
      <div className="lista-topo">
        {vendoArquivadas ? (
          <div className="titulo-arquivadas">
            <button type="button" className="botao-icone" onClick={() => setFiltro('todas')} aria-label="Voltar"><ArrowLeft size={20} /></button>
            <b>Arquivadas</b>
          </div>
        ) : (
          <>
            <label className="campo-busca">
              <Search size={17} />
              <input ref={campoBusca} type="text" placeholder="Pesquisar nome, número ou mensagem" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar"><X size={16} /></button>}
            </label>
            <div className="filtros-conversas">
              {FILTROS.map(([id, rotulo]) => (
                <button key={id} type="button" className={`chip chip-pequeno ${filtro === id ? 'ativo' : ''}`} onClick={() => setFiltro(id)}>{rotulo}</button>
              ))}
              {etiquetas.map((t) => (
                <button key={t.id} type="button" className={`chip chip-pequeno ${filtro === `etiqueta:${t.id}` ? 'ativo' : ''}`} onClick={() => setFiltro(`etiqueta:${t.id}`)}>
                  <span className="ponto" style={{ background: t.color }} /> {t.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="itens-conversas">
        {!vendoArquivadas && arquivadas > 0 && !busca && (
          <button type="button" className="linha-arquivadas" onClick={() => setFiltro('arquivadas')}>
            <Archive size={18} /> <span>Arquivadas</span> <small>{arquivadas}</small>
          </button>
        )}
        {numeros && numeros.length === 0 && (
          <div className="vazio-conversas">
            Nenhum número de WhatsApp conectado ainda.
            {user.role === 'admin' ? <> Conecte em <b>Equipe e integrações</b> (menu do seu avatar).</> : ' Peça a um administrador para conectar.'}
          </div>
        )}
        {busca && conversas.length > 0 && <div className="secao-busca">Conversas</div>}
        {carregou && conversas.length === 0 && numeros?.length > 0 && (
          <div className="vazio-conversas">{busca ? 'Nenhuma conversa encontrada.' : filtro !== 'todas' ? 'Nenhuma conversa com esse filtro.' : 'As conversas aparecem aqui assim que alguém mandar mensagem.'}</div>
        )}
        {conversas.map((c) => (
          <ItemConversa key={c.chave} c={c} aberta={aberta === c.chave} etiquetas={etiquetas} busca={busca} onAbrir={onAbrir} onEstado={onEstado} onAbrirWeb={onAbrirWeb} />
        ))}
        {busca && mensagensBusca?.length > 0 && (
          <>
            <div className="secao-busca">Mensagens</div>
            {mensagensBusca.map((m) => {
              const c = conversas.find((x) => x.chave === m.chave);
              return (
                <button key={m.id} type="button" className="item-resultado" onClick={() => onAbrirMensagem(m)}>
                  <span className="item-linha">
                    <b>{c?.nome || formatarTelefone(c?.telefone) || 'Conversa'}</b>
                    <small className="suave">{quando(m.timestamp)}</small>
                  </span>
                  <span className="item-previa">{m.from_me && 'Você: '}{realcar(m.texto, busca)}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
