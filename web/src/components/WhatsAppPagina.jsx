import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, Video, Search, MoreVertical, PanelRightOpen, PanelRightClose, ArrowLeft, Sun, Moon, Star, Tag, Keyboard, ExternalLink,
  Archive, Pin, BellOff, Bell, CheckSquare, Info,
} from 'lucide-react';
import { api } from '../api.js';
import { formatarTelefone } from '../utils.js';
import { useEvento } from '../tempoReal.js';
import Conversa from './Conversa.jsx';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import ListaConversas from './chat/ListaConversas.jsx';
import PainelLateral from './chat/PainelLateral.jsx';
import Visualizador from './chat/Visualizador.jsx';
import { Ligar, Atalhos } from './chat/Modais.jsx';
import logo from '../assets/logo-impera.png';

const ler = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

function textoPresenca(p, grupo) {
  if (!p?.estado) return null;
  if (p.estado === 'composing') return grupo ? 'alguém está digitando…' : 'digitando…';
  if (p.estado === 'recording') return grupo ? 'alguém está gravando áudio…' : 'gravando áudio…';
  if (grupo) return null;
  if (p.estado === 'available') return 'online';
  if (p.visto) {
    const d = new Date(p.visto);
    const hoje = new Date();
    const horaTxt = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoje.toDateString()) return `visto por último hoje às ${horaTxt}`;
    if (d.toDateString() === new Date(hoje - 86400000).toDateString()) return `visto por último ontem às ${horaTxt}`;
    return `visto por último em ${d.toLocaleDateString('pt-BR')} às ${horaTxt}`;
  }
  return null;
}

function GerenciarEtiquetas({ etiquetas, onFechar, onMudou }) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState('#d7b870');
  const [erro, setErro] = useState('');
  const criar = async (e) => {
    e.preventDefault();
    try { await api('/whatsapp/etiquetas', { method: 'POST', body: { nome, cor } }); setNome(''); onMudou(); } catch (err) { setErro(err.message); }
  };
  const editar = async (t, dados) => {
    try { await api(`/whatsapp/etiquetas/${t.id}`, { method: 'PATCH', body: dados }); onMudou(); } catch (err) { setErro(err.message); }
  };
  return (
    <Modal titulo="Etiquetas" onFechar={onFechar}>
      <div className="modal-wa">
        <p className="suave pequeno">Etiquetas organizam as conversas (ex.: Orçamento, Pós-venda). Elas ficam no CRM; use o menu ⌄ de cada conversa para etiquetar.</p>
        {etiquetas.map((t) => (
          <div key={t.id} className="linha-etiqueta">
            <input type="color" value={t.color} onChange={(e) => editar(t, { cor: e.target.value })} aria-label="Cor" />
            <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && editar(t, { nome: e.target.value })} />
          </div>
        ))}
        <form className="linha-etiqueta" onSubmit={criar}>
          <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} aria-label="Cor" />
          <input placeholder="Nova etiqueta" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} />
          <button className="btn btn-ouro btn-pequeno" disabled={!nome.trim()}>Criar</button>
        </form>
        {erro && <div className="erro pequeno">{erro}</div>}
      </div>
    </Modal>
  );
}

// Tela de WhatsApp no estilo do WhatsApp Web: conversas à esquerda, chat no meio e painel recolhível à direita
export default function WhatsAppPagina({ user, stages, users, horas, aoMudarAlgo, setErro }) {
  const [conversas, setConversas] = useState([]);
  const [arquivadas, setArquivadas] = useState(0);
  const [mensagensBusca, setMensagensBusca] = useState([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [numeroFiltro, setNumeroFiltro] = useState(() => ler('wa-numero-filtro', ''));
  const [aberta, setAberta] = useState(null);
  const [numeros, setNumeros] = useState(null);
  const [etiquetas, setEtiquetas] = useState([]);
  const [transformando, setTransformando] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [tema, setTema] = useState(() => ler('wa-tema', 'escuro'));
  const estreita = () => typeof window !== 'undefined' && window.innerWidth < 1180;
  const [painel, setPainel] = useState(() => (estreita() || ler('wa-painel', 'ficha') === 'fechado' ? null : 'ficha'));
  const [pularPara, setPularPara] = useState(null);
  const [painelPedido, setPainelPedido] = useState(null);
  const [presenca, setPresenca] = useState(null);
  const [jidsAbertos, setJidsAbertos] = useState([]);
  const [menuTopo, setMenuTopo] = useState(false);
  const [menuLista, setMenuLista] = useState(false);
  const [janela, setJanela] = useState(null);
  const [numeroAtivo, setNumeroAtivo] = useState('');
  const [visualizar, setVisualizar] = useState(null);
  const [pedidoSelecao, setPedidoSelecao] = useState(null);
  const campoBusca = useRef(null);
  const menuTopoRef = useRef(null);
  const menuListaRef = useRef(null);

  useEffect(() => gravar('wa-tema', tema), [tema]);
  useEffect(() => gravar('wa-numero-filtro', numeroFiltro), [numeroFiltro]);

  const carregar = useCallback(async () => {
    try {
      const p = new URLSearchParams({ filtro });
      if (busca.trim()) p.set('q', busca.trim());
      if (numeroFiltro) p.set('numero', numeroFiltro);
      const d = await api(`/whatsapp/conversas?${p}`);
      setConversas(d.conversas);
      setArquivadas(d.arquivadas || 0);
      setMensagensBusca(d.mensagens || []);
      setCarregou(true);
    } catch (e) {
      setErro(e.message);
    }
  }, [busca, filtro, numeroFiltro, setErro]);

  useEffect(() => {
    const t = setTimeout(carregar, busca ? 250 : 0);
    const id = setInterval(() => { if (!document.hidden) carregar(); }, 20000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [carregar, busca]);

  const carregarNumeros = useCallback(() => {
    api('/whatsapp/numeros').then((d) => setNumeros(d.numeros)).catch(() => setNumeros([]));
  }, []);
  const carregarEtiquetas = useCallback(() => {
    api('/whatsapp/etiquetas').then((d) => setEtiquetas(d.etiquetas)).catch(() => {});
  }, []);
  useEffect(() => { carregarNumeros(); carregarEtiquetas(); }, [carregarNumeros, carregarEtiquetas]);

  // Atualizações em tempo real (agrupadas para não recarregar a lista a cada mensagem do histórico)
  const recarga = useRef(null);
  useEvento('whatsapp', (d) => {
    clearTimeout(recarga.current);
    recarga.current = setTimeout(carregar, d?.historico ? 1500 : 150);
    if (d?.numeros) carregarNumeros();
    if (d?.chat || d?.historico) aoMudarAlgo();
  });
  useEvento('presenca', (p) => {
    if (jidsAbertos.includes(p.jid)) setPresenca(p);
    if (p.estado === 'composing' || p.estado === 'recording' || p.estado === 'paused' || p.estado === 'available') {
      clearTimeout(recarga.current);
      recarga.current = setTimeout(carregar, 300);
    }
  });

  // Mantém a conversa aberta mesmo se o filtro da lista deixar de mostrá-la
  const [ultimaAberta, setUltimaAberta] = useState(null);
  const conversa = conversas.find((c) => c.chave === aberta) || (ultimaAberta?.chave === aberta ? ultimaAberta : null);
  useEffect(() => { if (conversa) setUltimaAberta(conversa); }, [conversa]);
  const conectados = (numeros || []).filter((n) => n.status === 'conectado');

  // Presença do contato aberto (online, visto por último, digitando…)
  useEffect(() => {
    setPresenca(null);
    setJidsAbertos([]);
    if (!aberta) return undefined;
    let vivo = true;
    const buscar = () => api(`/whatsapp/conversas/${encodeURIComponent(aberta)}/presenca`).then((d) => {
      if (!vivo) return;
      setJidsAbertos(d.jids || []);
      setPresenca(d);
    }).catch(() => {});
    buscar();
    const t = setInterval(buscar, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, [aberta]);

  const abrir = useCallback((c, mensagemId = null) => {
    setAberta(c.chave);
    setUltimaAberta(c);
    if (estreita()) setPainel(null);
    setPularPara(mensagemId ? { id: mensagemId, t: Date.now() } : null);
    // A lista atualiza a contagem de não lidas no próximo ciclo; zera já na tela
    setConversas((cs) => cs.map((x) => (x.chave === c.chave ? { ...x, nao_lidas: 0, marcada_nao_lida: false } : x)));
    setTimeout(aoMudarAlgo, 800);
  }, [aoMudarAlgo]);

  // "Abrir conversa" no aviso de chamada (vem de outra tela)
  useEffect(() => {
    const ir = (chave) => { if (chave) { abrir({ chave }); window.__waAbrir = null; } };
    ir(window.__waAbrir);
    const ouvir = (e) => ir(e.detail);
    window.addEventListener('wa-abrir', ouvir);
    return () => window.removeEventListener('wa-abrir', ouvir);
  }, [abrir]);

  const abrirMensagem = (m) => {
    const c = conversas.find((x) => x.chave === m.chave) || { chave: m.chave };
    abrir(c, m.id);
  };

  const mudarEstado = useCallback(async (c, mudanca) => {
    try {
      await api(`/whatsapp/conversas/${encodeURIComponent(c.chave)}`, { method: 'PATCH', body: mudanca });
      if (mudanca.oculta && aberta === c.chave) setAberta(null);
      carregar();
      if ('nao_lida' in mudanca) aoMudarAlgo();
    } catch (e) {
      setErro(e.message);
    }
  }, [aberta, carregar, aoMudarAlgo, setErro]);

  const abrirWeb = (c) => window.open(`https://web.whatsapp.com/send?phone=${c.telefone}`, '_blank', 'noopener');

  const transformar = async () => {
    setTransformando(true);
    try {
      const d = await api(`/whatsapp/conversas/${encodeURIComponent(aberta)}/lead`, { method: 'POST' });
      setUltimaAberta((c) => ({ ...c, chave: d.chave, lead_id: d.lead_id }));
      setAberta(d.chave);
      setPainel('ficha');
      await carregar();
      aoMudarAlgo();
    } catch (e) {
      setErro(e.message);
    } finally {
      setTransformando(false);
    }
  };

  const alternarPainel = (modo) => {
    setPainel((p) => {
      const novo = p === modo ? null : modo;
      gravar('wa-painel', novo ? 'ficha' : 'fechado');
      return novo;
    });
  };

  // Fecha os menus do topo ao clicar fora
  useEffect(() => {
    if (!menuTopo && !menuLista) return undefined;
    const fora = (e) => {
      if (menuTopo && menuTopoRef.current && !menuTopoRef.current.contains(e.target)) setMenuTopo(false);
      if (menuLista && menuListaRef.current && !menuListaRef.current.contains(e.target)) setMenuLista(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menuTopo, menuLista]);

  // Atalhos de teclado do WhatsApp Web (Ctrl/Cmd + Alt + …)
  const estadoAtalhos = useRef({});
  estadoAtalhos.current = { conversas, aberta, conversa, abrir, mudarEstado };
  useEffect(() => {
    const tecla = (e) => {
      const { conversas: lista, aberta: chave, conversa: c, abrir: abrirC, mudarEstado: mudar } = estadoAtalhos.current;
      if (e.key === 'Escape' && !document.querySelector('.fundo-modal, .menu-mensagem, .menu-conversa, .painel-expressoes, .visualizador, .previa-arquivos, .seletor-emoji-mart')) {
        if (chave) { setAberta(null); return; }
      }
      if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
      const codigo = e.code;
      let feito = true;
      if (codigo === 'Slash' && !e.shiftKey) campoBusca.current?.focus();
      else if (codigo === 'KeyK') setJanela({ tipo: 'atalhos' });
      else if (codigo === 'Tab' && lista.length) {
        const i = lista.findIndex((x) => x.chave === chave);
        const prox = lista[(i + (e.shiftKey ? -1 : 1) + lista.length) % lista.length];
        if (prox) abrirC(prox);
      } else if (c && e.shiftKey && codigo === 'KeyU') mudar(c, { nao_lida: !(c.nao_lidas > 0 || c.marcada_nao_lida) });
      else if (c && e.shiftKey && codigo === 'KeyE') mudar(c, { arquivada: !c.arquivada });
      else if (c && e.shiftKey && codigo === 'KeyP') mudar(c, { fixada: !c.fixada });
      else if (c && e.shiftKey && codigo === 'KeyM') mudar(c, { silenciada_ate: c.silenciada_ate ? null : '9999-12-31T00:00:00.000Z' });
      else if (c && e.shiftKey && codigo === 'KeyF') setPainel('busca');
      else if (c && !e.shiftKey && codigo === 'KeyE') setPainelPedido({ qual: 'emoji', t: Date.now() });
      else if (c && !e.shiftKey && codigo === 'KeyS') setPainelPedido({ qual: 'figurinhas', t: Date.now() });
      else if (c && !e.shiftKey && codigo === 'KeyP') setPainel((p) => (p === 'ficha' ? null : 'ficha'));
      else feito = false;
      if (feito) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, []);

  const subtitulo = useMemo(() => {
    if (!conversa) return '';
    const p = textoPresenca(presenca, conversa.grupo);
    if (p) return p;
    if (conversa.grupo) return 'Grupo · clique para ver os dados';
    const tel = conversa.telefone ? formatarTelefone(conversa.telefone) : 'telefone oculto pelo WhatsApp';
    return `${tel}${conversa.lead_id ? ` · lead em ${conversa.etapa?.nome}` : ' · ainda não é lead'}`;
  }, [conversa, presenca]);

  const topoLista = (
    <div className="lista-cabecalho">
      <b className="lista-titulo">Conversas</b>
      <span className="espaco" />
      {(numeros?.length || 0) > 1 && (
        <select className="seletor-numero-lista" value={numeroFiltro} onChange={(e) => setNumeroFiltro(e.target.value)} title="Mostrar conversas de qual número">
          <option value="">Todos os números</option>
          {numeros.map((n) => <option key={n.id} value={n.id}>{n.name}{n.status !== 'conectado' ? ' (desconectado)' : ''}</option>)}
        </select>
      )}
      <button type="button" className="botao-icone" title={tema === 'escuro' ? 'Tema claro' : 'Tema escuro'} onClick={() => setTema((t) => (t === 'escuro' ? 'claro' : 'escuro'))}>
        {tema === 'escuro' ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <div className="posicao-relativa" ref={menuListaRef}>
        <button type="button" className={`botao-icone ${menuLista ? 'ativo' : ''}`} onClick={() => setMenuLista((v) => !v)} aria-label="Menu"><MoreVertical size={20} /></button>
        {menuLista && (
          <div className="menu-conversa menu-topo">
            <button type="button" onClick={() => { setMenuLista(false); setAberta(aberta); setPainel('favoritas'); }}><Star size={16} /> Mensagens favoritas</button>
            <button type="button" onClick={() => { setMenuLista(false); setFiltro('arquivadas'); }}><Archive size={16} /> Arquivadas ({arquivadas})</button>
            <button type="button" onClick={() => { setMenuLista(false); setJanela({ tipo: 'etiquetas' }); }}><Tag size={16} /> Etiquetas</button>
            <button type="button" onClick={() => { setMenuLista(false); setJanela({ tipo: 'atalhos' }); }}><Keyboard size={16} /> Atalhos do teclado</button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`whatsapp-tela wa-tela ${conversa ? 'com-conversa' : ''} ${painel && (conversa || painel === 'favoritas') ? 'com-painel' : ''}`} data-tema={tema}>
      <ListaConversas
        conversas={conversas}
        arquivadas={arquivadas}
        mensagensBusca={mensagensBusca}
        carregou={carregou}
        aberta={aberta}
        busca={busca}
        setBusca={setBusca}
        filtro={filtro}
        setFiltro={setFiltro}
        etiquetas={etiquetas}
        numeros={numeros}
        user={user}
        onAbrir={abrir}
        onAbrirMensagem={abrirMensagem}
        onEstado={mudarEstado}
        onAbrirWeb={abrirWeb}
        campoBusca={campoBusca}
        topo={topoLista}
      />

      <section className="chat">
        {!conversa ? (
          <div className="chat-vazio">
            <img className="chat-vazio-logo" src={logo} alt="" />
            <div className="marca marca-grande">IMPERA <span>CRM</span></div>
            <p className="suave">Escolha uma conversa à esquerda.</p>
            {conectados.length > 0 && <p className="suave pequeno">Conectados: {conectados.map((n) => n.name).join(', ')}</p>}
            <p className="suave pequeno">Dica: Ctrl + Alt + K mostra os atalhos do teclado.</p>
          </div>
        ) : (
          <>
            <div className="chat-topo">
              <button className="botao-icone voltar-lista" onClick={() => setAberta(null)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button>
              <button type="button" className="chat-topo-contato" onClick={() => alternarPainel(conversa.lead_id ? 'ficha' : 'contato')} title="Dados do contato">
                <Avatar chave={conversa.chave} nome={conversa.nome} tamanho={40} lead={Boolean(conversa.lead_id)} grupo={conversa.grupo} />
                <span className="chat-topo-textos">
                  <b>{conversa.nome || formatarTelefone(conversa.telefone) || 'Contato'}</b>
                  <small className={presenca?.estado === 'composing' || presenca?.estado === 'recording' ? 'digitando' : 'suave'}>{subtitulo}</small>
                </span>
              </button>
              <span className="espaco" />
              {!conversa.grupo && (
                <>
                  <button type="button" className="botao-icone" title="Chamada de vídeo" onClick={() => setJanela({ tipo: 'ligar', video: true })}><Video size={20} /></button>
                  <button type="button" className="botao-icone" title="Chamada de voz" onClick={() => setJanela({ tipo: 'ligar', video: false })}><Phone size={20} /></button>
                </>
              )}
              <button type="button" className={`botao-icone ${painel === 'busca' ? 'ativo' : ''}`} title="Pesquisar na conversa (Ctrl+Alt+Shift+F)" onClick={() => alternarPainel('busca')}><Search size={20} /></button>
              <button type="button" className={`botao-icone ${painel === 'ficha' ? 'ativo' : ''}`} title={painel === 'ficha' ? 'Recolher a ficha' : 'Mostrar a ficha do lead'} onClick={() => alternarPainel('ficha')}>
                {painel === 'ficha' ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
              </button>
              <div className="posicao-relativa" ref={menuTopoRef}>
                <button type="button" className={`botao-icone ${menuTopo ? 'ativo' : ''}`} onClick={() => setMenuTopo((v) => !v)} aria-label="Mais opções"><MoreVertical size={20} /></button>
                {menuTopo && (
                  <div className="menu-conversa menu-topo direita">
                    <button type="button" onClick={() => { setMenuTopo(false); setPainel('contato'); }}><Info size={16} /> {conversa.grupo ? 'Dados do grupo' : 'Dados do contato'}</button>
                    <button type="button" onClick={() => { setMenuTopo(false); setPainel('favoritas'); }}><Star size={16} /> Mensagens favoritas</button>
                    <button type="button" onClick={() => { setMenuTopo(false); setPedidoSelecao({ t: Date.now() }); }}><CheckSquare size={16} /> Selecionar mensagens</button>
                    <button type="button" onClick={() => { setMenuTopo(false); mudarEstado(conversa, { silenciada_ate: conversa.silenciada_ate ? null : '9999-12-31T00:00:00.000Z' }); }}>
                      {conversa.silenciada_ate ? <><Bell size={16} /> Reativar notificações</> : <><BellOff size={16} /> Silenciar notificações</>}
                    </button>
                    <button type="button" onClick={() => { setMenuTopo(false); mudarEstado(conversa, { fixada: !conversa.fixada }); }}><Pin size={16} /> {conversa.fixada ? 'Desafixar' : 'Fixar'} conversa</button>
                    <button type="button" onClick={() => { setMenuTopo(false); mudarEstado(conversa, { arquivada: !conversa.arquivada }); }}><Archive size={16} /> {conversa.arquivada ? 'Desarquivar' : 'Arquivar'} conversa</button>
                    {conversa.telefone && !conversa.grupo && <button type="button" onClick={() => { setMenuTopo(false); abrirWeb(conversa); }}><ExternalLink size={16} /> Abrir no WhatsApp Web</button>}
                    <button type="button" onClick={() => { setMenuTopo(false); setAberta(null); }}>Fechar conversa</button>
                  </div>
                )}
              </div>
            </div>
            <Conversa
              chave={conversa.chave}
              nome={conversa.nome || formatarTelefone(conversa.telefone)}
              cheia
              pularPara={pularPara}
              painelPedido={painelPedido}
              pedidoSelecao={pedidoSelecao}
              onNumeroAtivo={setNumeroAtivo}
              onEnviado={() => { carregar(); aoMudarAlgo(); }}
            />
          </>
        )}
      </section>

      {painel && (conversa || painel === 'favoritas') && (
        <PainelLateral
          modo={painel}
          conversa={conversa}
          onFechar={() => { setPainel(null); gravar('wa-painel', 'fechado'); }}
          stages={stages}
          users={users}
          user={user}
          horas={horas}
          numeroId={numeroAtivo}
          transformando={transformando}
          onTransformar={transformar}
          onAtualizado={() => { carregar(); aoMudarAlgo(); }}
          onAbrirMidia={setVisualizar}
          onIrPara={(id, chave) => {
            if (chave && chave !== aberta) abrir(conversas.find((c) => c.chave === chave) || { chave }, id);
            else setPularPara({ id, t: Date.now() });
          }}
        />
      )}

      {janela?.tipo === 'ligar' && conversa && (
        <Ligar video={janela.video} chave={conversa.chave} telefone={conversa.telefone} numeros={conectados} numeroPadrao={numeroAtivo}
          onFechar={() => setJanela(null)} onEnviado={() => carregar()} />
      )}
      {janela?.tipo === 'atalhos' && <Atalhos onFechar={() => setJanela(null)} />}
      {janela?.tipo === 'etiquetas' && <GerenciarEtiquetas etiquetas={etiquetas} onFechar={() => setJanela(null)} onMudou={() => { carregarEtiquetas(); carregar(); }} />}
      {visualizar && <Visualizador midia={visualizar} onFechar={() => setVisualizar(null)} />}
    </div>
  );
}
