import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { X, Forward, Star, EyeOff, Copy, ChevronDown } from 'lucide-react';
import { api } from '../api.js';
import { useEvento } from '../tempoReal.js';
import Avatar from './Avatar.jsx';
import Mensagem, { tamanhoArquivo } from './chat/Mensagem.jsx';
import Compositor from './chat/Compositor.jsx';
import Visualizador from './chat/Visualizador.jsx';
import { Encaminhar, InfoMensagem, NovaEnquete, EnviarContato, EnviarLocalizacao } from './chat/Modais.jsx';
import { rota } from '../base.js';
import { formatarTelefone } from '../utils.js';

const RESERVA_MS = 15000; // atualização de segurança caso o tempo real caia
const INICIO = 1_000_000; // índice da primeira mensagem na lista virtual (diminui ao carregar as antigas)

export function rotuloDia(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  if (hoje - d < 6 * 86400000) return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const ordem = (a, b) => (a.timestamp === b.timestamp ? a.id - b.id : a.timestamp < b.timestamp ? -1 : 1);

// Junta a página nova com o que já está na tela, mantendo os mesmos objetos quando nada mudou
function mesclar(anteriores, novas, { substituirFim = false } = {}) {
  const porId = new Map(anteriores.map((m) => [m.id, m]));
  const novasIds = new Set(novas.map((m) => m.id));
  let lista = anteriores;
  if (substituirFim && novas.length) {
    // Mensagens que sumiram do fim (apagadas para mim) saem da tela
    const corte = novas[0];
    lista = anteriores.filter((m) => ordem(m, corte) < 0 || novasIds.has(m.id));
  }
  const resultado = lista.map((m) => {
    if (!novasIds.has(m.id)) return m;
    const nova = novas.find((x) => x.id === m.id);
    return JSON.stringify(nova) === JSON.stringify(m) ? m : nova;
  });
  for (const m of novas) if (!porId.has(m.id)) resultado.push(m);
  return resultado.sort(ordem);
}

// Envia um arquivo com barra de progresso
function enviarArquivo(url, arquivo, aoProgredir) {
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

function PreviaArquivos({ selecao, onCancelar, onEnviar, onRemover }) {
  const [legenda, setLegenda] = useState(selecao.legenda || '');
  const urls = useMemo(() => selecao.arquivos.map((a) => (/^(image|video)\//.test(a.type) ? URL.createObjectURL(a) : null)), [selecao.arquivos]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && onCancelar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCancelar]);
  const principal = selecao.arquivos[0];
  const urlPrincipal = urls[0];
  const rotuloModo = { documento: 'enviado como documento', figurinha: 'vira figurinha 512×512', gif: 'vai como GIF (sem som, em repetição)' }[selecao.modo];
  return (
    <div className="previa-arquivos">
      <div className="previa-topo">
        <button type="button" className="botao-icone" onClick={onCancelar} aria-label="Cancelar"><X size={22} /></button>
        <span>{selecao.arquivos.length === 1 ? principal.name : `${selecao.arquivos.length} arquivos`}</span>
        {rotuloModo && <small className="suave">· {rotuloModo}</small>}
        {selecao.unica && <small className="suave">· visualização única</small>}
      </div>
      <div className="previa-centro">
        {urlPrincipal && principal.type.startsWith('image/') && <img src={urlPrincipal} alt="" className={selecao.modo === 'figurinha' ? 'previa-figurinha' : ''} />}
        {urlPrincipal && principal.type.startsWith('video/') && <video src={urlPrincipal} controls muted={selecao.modo === 'gif'} loop={selecao.modo === 'gif'} autoPlay={selecao.modo === 'gif'} />}
        {!urlPrincipal && (
          <div className="previa-doc">
            <span className="previa-doc-icone">{principal.type.startsWith('audio/') ? '🎵' : '📄'}</span>
            <b>{principal.name}</b>
            <small className="suave">{tamanhoArquivo(principal.size)}</small>
          </div>
        )}
      </div>
      {selecao.arquivos.length > 1 && (
        <div className="previa-lista">
          {selecao.arquivos.map((a, i) => (
            <span key={`${a.name}-${i}`} className="previa-item">
              {urls[i] && a.type.startsWith('image/') ? <img src={urls[i]} alt="" /> : <span>{a.type.startsWith('video/') ? '🎥' : '📄'}</span>}
              <button type="button" onClick={() => onRemover(i)} aria-label={`Remover ${a.name}`}>✕</button>
            </span>
          ))}
        </div>
      )}
      <form className="previa-rodape" onSubmit={(e) => { e.preventDefault(); onEnviar(legenda.trim()); }}>
        {selecao.modo !== 'figurinha' && <input autoFocus value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Adicione uma legenda…" maxLength={1000} />}
        {selecao.modo === 'figurinha' && <span className="espaco" />}
        <button className="botao-enviar" aria-label="Enviar">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" /></svg>
        </button>
      </form>
    </div>
  );
}

/**
 * Conversa de WhatsApp (de um lead, contato ou grupo), no estilo do WhatsApp Web.
 * chave: "l:<id do lead>", "t:<telefone>", "j:<identificador>" ou "g:<grupo>"
 * pularPara: { id } — leva até essa mensagem (busca, favoritas)
 * painelPedido: { qual: 'emoji' | 'figurinhas' } — atalhos de teclado
 */
export default function Conversa({ chave, nome = '', onEnviado, cheia = false, pularPara = null, painelPedido = null, pedidoSelecao = null, onNumeroAtivo }) {
  const [mensagens, setMensagens] = useState([]);
  const [primeiroIndice, setPrimeiroIndice] = useState(INICIO);
  const [temMais, setTemMais] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [pedidoCelular, setPedidoCelular] = useState('');
  const [numeros, setNumeros] = useState([]);
  const [numeroId, setNumeroId] = useState('');
  const [respondendo, setRespondendo] = useState(null);
  const [editando, setEditando] = useState(null);
  const [selecao, setSelecao] = useState(null);
  const [selecionadas, setSelecionadas] = useState(null); // Set de ids (modo seleção)
  const [envios, setEnvios] = useState([]);
  const [visualizar, setVisualizar] = useState(null);
  const [destaque, setDestaque] = useState(null);
  const [noFim, setNoFim] = useState(true);
  const [novasAbaixo, setNovasAbaixo] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState('');
  const [foco, setFoco] = useState(0);
  const [janela, setJanela] = useState(null); // { tipo, ... }
  const [participantes, setParticipantes] = useState(null);
  const [dataFlutuante, setDataFlutuante] = useState('');

  const virtuoso = useRef(null);
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;
  const mensagensRef = useRef(mensagens);
  mensagensRef.current = mensagens;
  const ultimoId = useRef(null);
  const url = `/whatsapp/conversas/${encodeURIComponent(chave)}`;
  const grupo = chave.startsWith('g:');

  const carregar = useCallback(async () => {
    const pedida = chave;
    try {
      const d = await api(`${url}/mensagens`);
      if (chaveAtual.current !== pedida) return;
      setMensagens((atual) => {
        if (!atual.length) setTemMais(d.tem_mais);
        return mesclar(atual, d.mensagens, { substituirFim: true });
      });
      setNumeroId((atual) => atual || (d.ultimo_numero ? String(d.ultimo_numero) : ''));
      setCarregou(true);
    } catch { /* tenta de novo no próximo aviso */ }
  }, [url, chave]);

  const carregarNumeros = useCallback(async () => {
    try { setNumeros((await api('/whatsapp/numeros')).numeros); } catch { /* idem */ }
  }, []);

  // Troca de conversa: zera tudo
  useEffect(() => {
    setMensagens([]);
    setPrimeiroIndice(INICIO);
    setTemMais(false);
    setCarregou(false);
    setNumeroId('');
    setRespondendo(null);
    setEditando(null);
    setSelecao(null);
    setSelecionadas(null);
    setErro('');
    setPedidoCelular('');
    setNovasAbaixo(0);
    setParticipantes(null);
    setAncora(null);
    ultimoId.current = null;
    carregar();
    carregarNumeros();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, RESERVA_MS);
    return () => clearInterval(t);
  }, [carregar, carregarNumeros]);

  // Participantes do grupo (para @menções)
  useEffect(() => {
    if (!grupo) return;
    api(`${url}/contato`).then((d) => setParticipantes(d.participantes || [])).catch(() => {});
  }, [grupo, url]);

  useEvento('whatsapp', (d) => {
    carregar();
    if (d?.numeros || d?.reconectou) carregarNumeros();
    if (d?.historico && pedidoCelular) carregarAntigas(true);
  });

  const conectados = numeros.filter((n) => n.status === 'conectado');
  useEffect(() => {
    if (conectados.length && !conectados.some((n) => String(n.id) === numeroId)) setNumeroId(String(conectados[0].id));
  }, [conectados, numeroId]);
  useEffect(() => { onNumeroAtivo?.(numeroId); }, [numeroId, onNumeroAtivo]);

  // Mensagem nova chegou: desce se estava no fim; senão mostra o contador
  useEffect(() => {
    const ultima = mensagens.at(-1);
    if (!ultima || ultima.id === ultimoId.current) return;
    const primeiraVez = ultimoId.current === null;
    ultimoId.current = ultima.id;
    if (!primeiraVez && !noFim && !ultima.from_me) setNovasAbaixo((n) => n + 1);
    if (!primeiraVez && ultima.from_me) {
      requestAnimationFrame(() => virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' }));
    }
  }, [mensagens, noFim]);

  const carregarAntigas = useCallback(async (forcar = false) => {
    if (carregandoAntigas) return;
    const atuais = mensagensRef.current;
    if (!atuais.length || (!temMais && !forcar)) return;
    setCarregandoAntigas(true);
    try {
      const d = await api(`${url}/mensagens?antes=${atuais[0].id}`);
      if (d.mensagens.length) {
        const ids = new Set(atuais.map((m) => m.id));
        const novas = d.mensagens.filter((m) => !ids.has(m.id));
        setPrimeiroIndice((i) => i - novas.length);
        setMensagens((l) => [...novas, ...l]);
      }
      setTemMais(d.tem_mais);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregandoAntigas(false);
    }
  }, [carregandoAntigas, temMais, url]);

  // Vai até uma mensagem (carrega o trecho se ela ainda não está na tela). A lista é remontada já
  // posicionada na mensagem, para o pulo ser exato mesmo em conversas longas.
  const [ancora, setAncora] = useState(null); // { indice, versao }
  const irPara = useCallback(async (id) => {
    let lista = mensagensRef.current;
    let indice = lista.findIndex((m) => m.id === id);
    if (indice < 0) {
      try {
        const d = await api(`${url}/mensagens?a_partir=${id}`);
        lista = mesclar([], d.mensagens);
        setMensagens(lista);
        setPrimeiroIndice(INICIO - lista.length);
        setTemMais(d.tem_mais);
        indice = lista.findIndex((m) => m.id === id);
      } catch (e) {
        setErro(e.message);
        return;
      }
    }
    if (indice < 0) return;
    setAncora((a) => ({ indice, versao: (a?.versao || 0) + 1 }));
    setDestaque(id);
    setTimeout(() => setDestaque((d) => (d === id ? null : d)), 2200);
  }, [url]);

  useEffect(() => { if (pularPara?.id) irPara(pularPara.id); }, [pularPara, irPara]);
  useEffect(() => { if (pedidoSelecao) setSelecionadas(new Set()); }, [pedidoSelecao]);

  const irParaFim = () => {
    if (ancora) { setAncora(null); setNovasAbaixo(0); return; }
    virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' });
    setNovasAbaixo(0);
  };

  const pedirAoCelular = async () => {
    setPedidoCelular('pedindo');
    try {
      await api(`${url}/mais-antigas`, { method: 'POST', body: { numero_id: Number(numeroId) || null } });
      setPedidoCelular('pedido');
    } catch (e) {
      setPedidoCelular('');
      setErro(e.message);
    }
  };

  const depoisDeEnviar = () => { onEnviado?.(); carregar(); };

  const enviarTexto = async (texto, mencoes = []) => {
    if (!numeroId) return;
    setErro('');
    const resposta = respondendo;
    setRespondendo(null);
    try {
      await api(`${url}/mensagens`, { method: 'POST', body: { texto, numero_id: Number(numeroId), responder_id: resposta?.id, mencoes } });
      onEnviado?.();
    } catch (e) {
      setErro(e.message);
    } finally {
      carregar();
    }
  };

  const enviarArquivos = async (arquivos, modo, legenda, extra = {}) => {
    if (!numeroId) return;
    const resposta = respondendo;
    setRespondendo(null);
    setSelecao(null);
    for (const [i, arquivo] of arquivos.entries()) {
      const id = `${Date.now()}-${i}`;
      setEnvios((e) => [...e, { id, nome: arquivo.name || 'Áudio', progresso: 0 }]);
      const p = new URLSearchParams({
        numero_id: numeroId,
        mime: arquivo.type || 'application/octet-stream',
        nome: arquivo.name || 'audio',
        modo,
      });
      if (i === 0 && legenda) p.set('legenda', legenda);
      if (i === 0 && resposta) p.set('responder_id', resposta.id);
      if (extra.unica) p.set('unica', '1');
      try {
        await enviarArquivo(rota(`/api${url}/arquivo?${p}`), arquivo, (progresso) =>
          setEnvios((e) => e.map((x) => (x.id === id ? { ...x, progresso } : x)))
        );
        setEnvios((e) => e.filter((x) => x.id !== id));
        onEnviado?.();
      } catch (err) {
        setEnvios((e) => e.map((x) => (x.id === id ? { ...x, erro: err.message } : x)));
      }
      carregar();
    }
  };

  const enviarVoz = (blob, tipo) => {
    const ext = tipo.includes('ogg') ? 'ogg' : tipo.includes('mp4') ? 'm4a' : 'webm';
    const arquivo = new File([blob], `audio.${ext}`, { type: tipo });
    enviarArquivos([arquivo], 'voz', '');
  };

  const enviarEspecial = async (caminho, corpo) => {
    if (!numeroId) return;
    setErro('');
    try {
      await api(`${url}/${caminho}`, { method: 'POST', body: { ...corpo, numero_id: Number(numeroId) } });
      setJanela(null);
      depoisDeEnviar();
    } catch (e) {
      setErro(e.message);
    }
  };

  const enviarFigurinha = (id) => {
    const resposta = respondendo;
    setRespondendo(null);
    enviarEspecial('figurinha', { figurinha_id: id, responder_id: resposta?.id });
  };

  const digitando = useCallback((estado) => {
    if (!numeroId) return;
    api(`${url}/digitando`, { method: 'POST', body: { numero_id: Number(numeroId), estado } }).catch(() => {});
  }, [numeroId, url]);

  const salvarEdicao = async (m, texto) => {
    try {
      await api(`/whatsapp/mensagens/${m.id}`, { method: 'PATCH', body: { texto } });
      setEditando(null);
      carregar();
    } catch (e) { setErro(e.message); }
  };

  const editarUltima = () => {
    const m = [...mensagensRef.current].reverse().find((x) => x.from_me && x.type === 'texto' && !x.deleted_at && x.status !== 0);
    if (m && Date.now() - new Date(m.timestamp).getTime() < 15 * 60000) setEditando(m);
  };

  // Ações das mensagens (objeto estável para não redesenhar a lista inteira)
  const acoesRef = useRef({});
  acoesRef.current = {
    responder: (m) => { setEditando(null); setRespondendo(m); setFoco((f) => f + 1); },
    reagir: async (m, emoji) => {
      try { await api(`/whatsapp/mensagens/${m.id}/reacao`, { method: 'POST', body: { emoji } }); carregar(); } catch (e) { setErro(e.message); }
    },
    apagarParaTodos: async (m) => {
      if (!confirm('Apagar esta mensagem para todos? O contato vai ver "Mensagem apagada".')) return;
      try { await api(`/whatsapp/mensagens/${m.id}`, { method: 'DELETE' }); carregar(); } catch (e) { setErro(e.message); }
    },
    apagarParaMim: async (m) => {
      try {
        await api(`/whatsapp/mensagens/${m.id}/ocultar`, { method: 'POST' });
        setMensagens((l) => l.filter((x) => x.id !== m.id));
      } catch (e) { setErro(e.message); }
    },
    abrirMidia: (midia) => setVisualizar(midia),
    irPara: (id) => irPara(id),
    reenviar: (m) => enviarTexto(m.body),
    copiar: (t) => { navigator.clipboard?.writeText(t).catch(() => {}); },
    encaminhar: (lista) => setJanela({ tipo: 'encaminhar', mensagens: lista }),
    estrela: async (m, marcar) => {
      try { await api(`/whatsapp/mensagens/${m.id}/estrela`, { method: 'POST', body: { estrela: marcar } }); carregar(); } catch (e) { setErro(e.message); }
    },
    editar: (m) => { setRespondendo(null); setEditando(m); },
    info: (m) => setJanela({ tipo: 'info', id: m.id }),
    votar: async (m, opcoes) => {
      try { await api(`/whatsapp/mensagens/${m.id}/voto`, { method: 'POST', body: { opcoes } }); carregar(); } catch (e) { setErro(e.message); }
    },
    favoritarFigurinha: async (m) => {
      try { await api(`/whatsapp/mensagens/${m.id}/figurinha-favorita`, { method: 'POST' }); } catch (e) { setErro(e.message); }
    },
    selecionar: (m) => setSelecionadas(new Set([m.id])),
    alternarSelecao: (m) => setSelecionadas((s) => {
      const novo = new Set(s || []);
      if (novo.has(m.id)) novo.delete(m.id); else novo.add(m.id);
      return novo;
    }),
  };
  const acoes = useMemo(() => {
    const o = {};
    for (const k of Object.keys(acoesRef.current)) o[k] = (...a) => acoesRef.current[k](...a);
    return o;
  }, []);

  // Seleção de várias mensagens
  const escolhidas = useMemo(() => (selecionadas ? mensagens.filter((m) => selecionadas.has(m.id)) : []), [selecionadas, mensagens]);
  const emLote = async (fn) => {
    for (const m of escolhidas) await fn(m);
    setSelecionadas(null);
    carregar();
  };

  const nomeDe = useCallback((jid) => {
    if (!jid) return 'Participante';
    const p = participantes?.find((x) => x.jid === jid);
    return p?.nome || (p?.telefone ? formatarTelefone(p.telefone) : formatarTelefone(String(jid).split('@')[0]));
  }, [participantes]);

  const aoSoltar = (e) => {
    e.preventDefault();
    setArrastando(false);
    const arquivos = [...(e.dataTransfer?.files || [])];
    if (arquivos.length && conectados.length) setSelecao({ arquivos, modo: 'auto', legenda: '' });
  };

  const avatarContato = useMemo(() => <Avatar chave={chave} nome={nome} tamanho={40} />, [chave, nome]);
  const mostrarNumero = numeros.length > 1;

  const itemContent = useCallback((indice, m) => {
    const i = indice - primeiroIndice;
    const anterior = mensagens[i - 1];
    const novoDia = !anterior || new Date(anterior.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
    const primeiraDoGrupo = novoDia || anterior.from_me !== m.from_me || anterior.participant_jid !== m.participant_jid
      || anterior.type === 'chamada' || new Date(m.timestamp) - new Date(anterior.timestamp) > 10 * 60000;
    return (
      <div className="bloco-mensagem">
        {novoDia && <div className="separador-dia"><span>{rotuloDia(m.timestamp)}</span></div>}
        <Mensagem
          m={m}
          grupo={grupo}
          primeiraDoGrupo={primeiraDoGrupo}
          nomeContato={nome || 'Contato'}
          avatarVoz={m.from_me ? null : avatarContato}
          mostrarNumero={mostrarNumero}
          destaque={destaque === m.id}
          selecionando={Boolean(selecionadas)}
          selecionada={Boolean(selecionadas?.has(m.id))}
          acoes={acoes}
          nomeDe={nomeDe}
        />
      </div>
    );
  }, [primeiroIndice, mensagens, grupo, nome, avatarContato, mostrarNumero, destaque, selecionadas, acoes, nomeDe]);

  const Cabecalho = useCallback(() => (
    <div className="topo-lista-mensagens">
      {carregandoAntigas && <div className="carregando-antigas"><span className="girando" /></div>}
      {carregou && !temMais && mensagens.length > 0 && conectados.length > 0 && (
        <div className="buscar-antigas">
          {pedidoCelular === 'pedido' ? (
            <span className="suave pequeno">Pedido enviado ao celular. As mensagens anteriores aparecem aqui em alguns segundos (o celular precisa estar com internet).</span>
          ) : (
            <button type="button" className="btn btn-pequeno" onClick={pedirAoCelular} disabled={pedidoCelular === 'pedindo'}>
              {pedidoCelular === 'pedindo' ? 'Pedindo…' : '⟳ Buscar mensagens anteriores no celular'}
            </button>
          )}
        </div>
      )}
      {carregou && !temMais && <div className="aviso-criptografia">🔒 As mensagens são guardadas no CRM da agência e não saem dele.</div>}
    </div>
  ), [carregandoAntigas, carregou, temMais, mensagens.length, conectados.length, pedidoCelular]); // eslint-disable-line react-hooks/exhaustive-deps

  const componentes = useMemo(() => ({ Header: Cabecalho, Footer: () => <div style={{ height: 8 }} /> }), [Cabecalho]);

  return (
    <div
      className={`conversa ${cheia ? 'conversa-cheia' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setArrastando(false); }}
      onDrop={aoSoltar}
    >
      {selecionadas && (
        <div className="barra-selecao">
          <button type="button" className="botao-icone" onClick={() => setSelecionadas(null)} aria-label="Cancelar seleção"><X size={20} /></button>
          <b>{selecionadas.size} selecionada{selecionadas.size === 1 ? '' : 's'}</b>
          <span className="espaco" />
          <button type="button" className="botao-icone" title="Copiar" disabled={!escolhidas.length}
            onClick={() => { navigator.clipboard?.writeText(escolhidas.map((m) => m.legenda || m.body || '').filter(Boolean).join('\n')).catch(() => {}); setSelecionadas(null); }}>
            <Copy size={20} />
          </button>
          <button type="button" className="botao-icone" title="Favoritar" disabled={!escolhidas.length}
            onClick={() => emLote((m) => api(`/whatsapp/mensagens/${m.id}/estrela`, { method: 'POST', body: { estrela: true } }).catch(() => {}))}>
            <Star size={20} />
          </button>
          <button type="button" className="botao-icone" title="Apagar para mim" disabled={!escolhidas.length}
            onClick={() => confirm(`Apagar ${escolhidas.length} mensagem(ns) só para vocês (some do CRM, continua guardada)?`) && emLote((m) => api(`/whatsapp/mensagens/${m.id}/ocultar`, { method: 'POST' }).catch(() => {})).then(() => setMensagens((l) => l.filter((x) => !escolhidas.some((e) => e.id === x.id))))}>
            <EyeOff size={20} />
          </button>
          <button type="button" className="botao-icone" title="Encaminhar" disabled={!escolhidas.length || escolhidas.some((m) => m.type === 'chamada')}
            onClick={() => setJanela({ tipo: 'encaminhar', mensagens: escolhidas })}>
            <Forward size={20} />
          </button>
        </div>
      )}

      <div className="conversa-lista">
        {dataFlutuante && !noFim && <div className="data-flutuante"><span>{dataFlutuante}</span></div>}
        {!carregou && <div className="conversa-vazia"><span className="girando" /></div>}
        {carregou && mensagens.length === 0 && <div className="conversa-vazia">Nenhuma mensagem de WhatsApp ainda.</div>}
        {carregou && mensagens.length > 0 && (
          <Virtuoso
            key={`${chave}-${ancora?.versao || 0}`}
            ref={virtuoso}
            className="lista-virtual"
            data={mensagens}
            firstItemIndex={primeiroIndice}
            initialTopMostItemIndex={ancora ? { index: Math.min(ancora.indice, mensagens.length - 1), align: 'center' } : { index: mensagens.length - 1, align: 'end' }}
            alignToBottom
            followOutput={(noFimAgora) => (noFimAgora ? 'auto' : false)}
            atBottomThreshold={120}
            atBottomStateChange={(v) => { setNoFim(v); if (v) setNovasAbaixo(0); }}
            startReached={() => carregarAntigas()}
            increaseViewportBy={{ top: 600, bottom: 300 }}
            computeItemKey={(_, m) => m.id}
            rangeChanged={({ startIndex }) => {
              const m = mensagens[startIndex - primeiroIndice];
              if (m) setDataFlutuante(rotuloDia(m.timestamp));
            }}
            itemContent={itemContent}
            components={componentes}
          />
        )}
      </div>

      {(novasAbaixo > 0 || (!noFim && carregou && mensagens.length > 0)) && (
        <button type="button" className="botao-descer" onClick={irParaFim} aria-label="Ir para as mensagens mais recentes">
          {novasAbaixo > 0 && <span className="contador-nao-lidas">{novasAbaixo}</span>}
          <ChevronDown size={22} />
        </button>
      )}

      {envios.length > 0 && (
        <div className="envios">
          {envios.map((e) => (
            <div key={e.id} className={`envio ${e.erro ? 'com-erro' : ''}`}>
              <span className="envio-nome">{e.erro ? `⚠ ${e.nome}: ${e.erro}` : e.progresso < 100 ? `Enviando ${e.nome}…` : `Processando ${e.nome}…`}</span>
              {!e.erro && <span className="envio-barra"><i style={{ width: `${e.progresso}%` }} /></span>}
              {e.erro && <button type="button" className="botao-icone" onClick={() => setEnvios((l) => l.filter((x) => x.id !== e.id))}>✕</button>}
            </div>
          ))}
        </div>
      )}

      {erro && <div className="erro conversa-erro" onClick={() => setErro('')}>{erro} <span>✕</span></div>}

      {conectados.length === 0 ? (
        <p className="suave pequeno aviso-sem-numero">Nenhum WhatsApp conectado. Um administrador conecta em <b>Equipe e integrações</b>.</p>
      ) : (
        <Compositor
          chave={chave}
          conectados={conectados}
          numeroId={numeroId}
          setNumeroId={setNumeroId}
          respondendo={respondendo}
          nomeContato={nome || 'Contato'}
          onCancelarResposta={() => setRespondendo(null)}
          onEnviarTexto={enviarTexto}
          onSelecionarArquivos={(arquivos, modo, legenda, extra) => setSelecao({ arquivos, modo, legenda, unica: extra?.unica })}
          onEnviarVoz={enviarVoz}
          onEnviarFigurinha={enviarFigurinha}
          onAbrirJanela={(tipo) => setJanela({ tipo })}
          onDigitando={digitando}
          onErro={setErro}
          foco={foco}
          painelPedido={painelPedido}
          editando={editando}
          onSalvarEdicao={salvarEdicao}
          onCancelarEdicao={() => setEditando(null)}
          onEditarUltima={editarUltima}
          participantes={participantes}
        />
      )}

      {arrastando && conectados.length > 0 && <div className="soltar-aqui">Solte para enviar</div>}
      {selecao && (
        <PreviaArquivos
          selecao={selecao}
          onCancelar={() => setSelecao(null)}
          onRemover={(i) => setSelecao((s) => {
            const arquivos = s.arquivos.filter((_, j) => j !== i);
            return arquivos.length ? { ...s, arquivos } : null;
          })}
          onEnviar={(legenda) => enviarArquivos(selecao.arquivos, selecao.modo, legenda, { unica: selecao.unica })}
        />
      )}
      {visualizar && <Visualizador midia={visualizar} onFechar={() => setVisualizar(null)} />}
      {janela?.tipo === 'encaminhar' && (
        <Encaminhar mensagens={janela.mensagens} numeros={conectados} numeroPadrao={numeroId} onFechar={() => setJanela(null)}
          onFeito={() => { setJanela(null); setSelecionadas(null); onEnviado?.(); }} />
      )}
      {janela?.tipo === 'info' && <InfoMensagem id={janela.id} onFechar={() => setJanela(null)} />}
      {janela?.tipo === 'enquete' && <NovaEnquete onFechar={() => setJanela(null)} onEnviar={(d) => enviarEspecial('enquete', d)} />}
      {janela?.tipo === 'contato' && <EnviarContato onFechar={() => setJanela(null)} onEnviar={(contatos) => enviarEspecial('contato', { contatos })} />}
      {janela?.tipo === 'localizacao' && <EnviarLocalizacao onFechar={() => setJanela(null)} onEnviar={(d) => enviarEspecial('localizacao', d)} />}
    </div>
  );
}
