import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEvento } from '../tempoReal.js';
import Avatar from './Avatar.jsx';
import Mensagem, { tamanhoArquivo } from './chat/Mensagem.jsx';
import Compositor from './chat/Compositor.jsx';
import Visualizador from './chat/Visualizador.jsx';

const RESERVA_MS = 15000; // atualização de segurança caso o tempo real caia

function rotuloDia(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  if (hoje - d < 6 * 86400000) return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Junta a lista nova com a anterior mantendo os mesmos objetos quando nada mudou (evita redesenhar tudo)
function mesclar(anteriores, novas) {
  const porId = new Map(anteriores.map((m) => [m.id, m]));
  return novas.map((m) => {
    const antiga = porId.get(m.id);
    return antiga && JSON.stringify(antiga) === JSON.stringify(m) ? antiga : m;
  });
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
  return (
    <div className="previa-arquivos">
      <div className="previa-topo">
        <button type="button" className="botao-icone" onClick={onCancelar} aria-label="Cancelar">✕</button>
        <span>{selecao.arquivos.length === 1 ? principal.name : `${selecao.arquivos.length} arquivos`}</span>
        {selecao.modo === 'documento' && <small className="suave">· enviado como documento</small>}
      </div>
      <div className="previa-centro">
        {urlPrincipal && principal.type.startsWith('image/') && <img src={urlPrincipal} alt="" />}
        {urlPrincipal && principal.type.startsWith('video/') && <video src={urlPrincipal} controls />}
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
        <input autoFocus value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Adicione uma legenda…" maxLength={1000} />
        <button className="botao-enviar" aria-label="Enviar">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" /></svg>
        </button>
      </form>
    </div>
  );
}

// Conversa de WhatsApp (de um lead ou de um contato), no estilo do WhatsApp.
// chave: "l:<id do lead>", "t:<telefone>" ou "j:<identificador do WhatsApp>"
export default function Conversa({ chave, nome = '', onEnviado, cheia = false }) {
  const [recentes, setRecentes] = useState([]);
  const [antigas, setAntigas] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [pedidoCelular, setPedidoCelular] = useState('');
  const [numeros, setNumeros] = useState([]);
  const [numeroId, setNumeroId] = useState('');
  const [respondendo, setRespondendo] = useState(null);
  const [selecao, setSelecao] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [visualizar, setVisualizar] = useState(null);
  const [destaque, setDestaque] = useState(null);
  const [novasAbaixo, setNovasAbaixo] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState('');
  const [foco, setFoco] = useState(0);

  const lista = useRef(null);
  const conteudo = useRef(null);
  const noFim = useRef(true);
  const ultimoId = useRef(null);
  const ajusteRolagem = useRef(null);
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;
  const antigasRef = useRef(antigas);
  antigasRef.current = antigas;
  const url = `/whatsapp/conversas/${encodeURIComponent(chave)}`;

  const carregar = useCallback(async () => {
    const pedida = chave;
    try {
      const d = await api(`${url}/mensagens`);
      if (chaveAtual.current !== pedida) return;
      setRecentes((r) => mesclar(r, d.mensagens));
      if (!antigasRef.current.length) setTemMais(d.tem_mais);
      setNumeroId((atual) => atual || (d.ultimo_numero ? String(d.ultimo_numero) : ''));
      setCarregou(true);
    } catch { /* tenta de novo no próximo aviso */ }
  }, [url, chave]);

  const carregarNumeros = useCallback(async () => {
    try { setNumeros((await api('/whatsapp/numeros')).numeros); } catch { /* idem */ }
  }, []);

  // Troca de conversa: zera tudo
  useEffect(() => {
    setRecentes([]);
    setAntigas([]);
    setTemMais(false);
    setCarregou(false);
    setNumeroId('');
    setRespondendo(null);
    setSelecao(null);
    setErro('');
    setPedidoCelular('');
    setNovasAbaixo(0);
    noFim.current = true;
    ultimoId.current = null;
    carregar();
    carregarNumeros();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, RESERVA_MS);
    return () => clearInterval(t);
  }, [carregar, carregarNumeros]);

  useEvento('whatsapp', (d) => {
    carregar();
    if (d?.numeros || d?.reconectou) carregarNumeros();
    if (d?.historico && pedidoCelular) recarregarTudo();
  });

  const conectados = numeros.filter((n) => n.status === 'conectado');
  useEffect(() => {
    if (conectados.length && !conectados.some((n) => String(n.id) === numeroId)) setNumeroId(String(conectados[0].id));
  }, [conectados, numeroId]);

  const mensagens = useMemo(() => {
    const ids = new Set(recentes.map((m) => m.id));
    return [...antigas.filter((m) => !ids.has(m.id)), ...recentes];
  }, [antigas, recentes]);

  // Rolagem: começa no fim; desce sozinho com mensagens novas se já estava no fim
  useLayoutEffect(() => {
    const el = lista.current;
    if (!el) return;
    if (ajusteRolagem.current !== null) {
      el.scrollTop = el.scrollHeight - ajusteRolagem.current;
      ajusteRolagem.current = null;
      return;
    }
    const ultima = mensagens.at(-1);
    if (!ultima || ultima.id === ultimoId.current) return;
    const primeiraVez = ultimoId.current === null;
    ultimoId.current = ultima.id;
    if (primeiraVez || noFim.current || ultima.from_me) {
      el.scrollTop = el.scrollHeight;
      setNovasAbaixo(0);
    } else {
      setNovasAbaixo((n) => n + 1);
    }
  }, [mensagens]);

  // Fotos e áudios terminam de carregar depois: se estava no fim, continua no fim
  useEffect(() => {
    const el = conteudo.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver(() => {
      if (noFim.current && lista.current && ajusteRolagem.current === null) lista.current.scrollTop = lista.current.scrollHeight;
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const carregarAntigas = useCallback(async () => {
    if (carregandoAntigas || !temMais || !mensagens.length) return;
    setCarregandoAntigas(true);
    try {
      const d = await api(`${url}/mensagens?antes=${mensagens[0].id}`);
      if (lista.current) ajusteRolagem.current = lista.current.scrollHeight - lista.current.scrollTop;
      setAntigas((a) => [...d.mensagens, ...a]);
      setTemMais(d.tem_mais);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregandoAntigas(false);
    }
  }, [carregandoAntigas, temMais, mensagens, url]);

  // Depois de buscar no celular: recarrega a conversa inteira (até 10 páginas)
  const recarregarTudo = async () => {
    try {
      let todas = [];
      let d = await api(`${url}/mensagens`);
      todas = d.mensagens;
      for (let i = 0; i < 10 && d.tem_mais; i++) {
        d = await api(`${url}/mensagens?antes=${todas[0].id}`);
        todas = [...d.mensagens, ...todas];
      }
      if (lista.current) ajusteRolagem.current = lista.current.scrollHeight - lista.current.scrollTop;
      setAntigas(todas);
      setRecentes((r) => mesclar(r, todas.slice(-80)));
      setTemMais(d.tem_mais);
    } catch { /* fica como está */ }
  };

  const aoRolar = () => {
    const el = lista.current;
    if (!el) return;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (noFim.current && novasAbaixo) setNovasAbaixo(0);
    if (el.scrollTop < 200) carregarAntigas();
  };

  const irParaFim = () => {
    const el = lista.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNovasAbaixo(0);
  };

  const pedirAoCelular = async () => {
    setPedidoCelular('pedindo');
    try {
      await api(`${url}/mais-antigas`, { method: 'POST' });
      setPedidoCelular('pedido');
    } catch (e) {
      setPedidoCelular('');
      setErro(e.message);
    }
  };

  const enviarTexto = async (texto) => {
    if (!numeroId) return;
    setErro('');
    const resposta = respondendo;
    setRespondendo(null);
    noFim.current = true;
    try {
      await api(`${url}/mensagens`, { method: 'POST', body: { texto, numero_id: Number(numeroId), responder_id: resposta?.id } });
      onEnviado?.();
    } catch (e) {
      setErro(e.message);
    } finally {
      carregar();
    }
  };

  const enviarArquivos = async (arquivos, modo, legenda) => {
    if (!numeroId) return;
    const resposta = respondendo;
    setRespondendo(null);
    setSelecao(null);
    noFim.current = true;
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
      try {
        await enviarArquivo(`/api${url}/arquivo?${p}`, arquivo, (progresso) =>
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

  const reagir = useCallback(async (m, emoji) => {
    try {
      await api(`/whatsapp/mensagens/${m.id}/reacao`, { method: 'POST', body: { emoji } });
      carregar();
    } catch (e) { setErro(e.message); }
  }, [carregar]);

  const apagar = useCallback(async (m) => {
    if (!confirm('Apagar esta mensagem para todos? O contato vai ver "Mensagem apagada".')) return;
    try {
      await api(`/whatsapp/mensagens/${m.id}`, { method: 'DELETE' });
      carregar();
    } catch (e) { setErro(e.message); }
  }, [carregar]);

  const responder = useCallback((m) => { setRespondendo(m); setFoco((f) => f + 1); }, []);
  const reenviar = useCallback((m) => enviarTexto(m.body), [numeroId, url]); // eslint-disable-line react-hooks/exhaustive-deps
  const copiar = useCallback((t) => { navigator.clipboard?.writeText(t).catch(() => {}); }, []);
  const irPara = useCallback((id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setDestaque(id);
    setTimeout(() => setDestaque((d) => (d === id ? null : d)), 1600);
  }, []);

  const aoSoltar = (e) => {
    e.preventDefault();
    setArrastando(false);
    const arquivos = [...(e.dataTransfer?.files || [])];
    if (arquivos.length && conectados.length) setSelecao({ arquivos, modo: 'auto', legenda: '' });
  };

  const avatarContato = useMemo(() => <Avatar chave={chave} nome={nome} tamanho={40} />, [chave, nome]);
  const mostrarNumero = numeros.length > 1;

  return (
    <div
      className={`conversa ${cheia ? 'conversa-cheia' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setArrastando(false); }}
      onDrop={aoSoltar}
    >
      <div className="conversa-lista" ref={lista} onScroll={aoRolar}>
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
        {carregandoAntigas && <div className="carregando-antigas"><span className="girando" /></div>}
        {!carregou && <div className="conversa-vazia"><span className="girando" /></div>}
        {carregou && mensagens.length === 0 && <div className="conversa-vazia">Nenhuma mensagem de WhatsApp ainda.</div>}

        <div className="conversa-conteudo" ref={conteudo}>
        {mensagens.map((m, i) => {
          const anterior = mensagens[i - 1];
          const novoDia = !anterior || new Date(anterior.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
          const primeiraDoGrupo = novoDia || anterior.from_me !== m.from_me || new Date(m.timestamp) - new Date(anterior.timestamp) > 10 * 60000;
          return (
            <div key={m.id} className="bloco-mensagem">
              {novoDia && <div className="separador-dia"><span>{rotuloDia(m.timestamp)}</span></div>}
              <Mensagem
                m={m}
                primeiraDoGrupo={primeiraDoGrupo}
                nomeContato={nome || 'Contato'}
                avatarVoz={m.from_me ? null : avatarContato}
                mostrarNumero={mostrarNumero}
                destaque={destaque === m.id}
                onResponder={responder}
                onReagir={reagir}
                onApagar={apagar}
                onAbrirMidia={setVisualizar}
                onIrPara={irPara}
                onReenviar={reenviar}
                onCopiar={copiar}
              />
            </div>
          );
        })}
        </div>
      </div>

      {novasAbaixo > 0 && (
        <button type="button" className="botao-descer" onClick={irParaFim} aria-label="Ir para as mensagens novas">
          <span className="contador-nao-lidas">{novasAbaixo}</span>
          <svg viewBox="0 0 18 18" width="18" height="18"><path fill="currentColor" d="M3.3 6.3 9 12l5.7-5.7-1.1-1L9 9.8 4.4 5.3z" /></svg>
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
          conectados={conectados}
          numeroId={numeroId}
          setNumeroId={setNumeroId}
          respondendo={respondendo}
          nomeContato={nome || 'Contato'}
          onCancelarResposta={() => setRespondendo(null)}
          onEnviarTexto={enviarTexto}
          onSelecionarArquivos={(arquivos, modo, legenda) => setSelecao({ arquivos, modo, legenda })}
          onEnviarVoz={enviarVoz}
          foco={foco}
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
          onEnviar={(legenda) => enviarArquivos(selecao.arquivos, selecao.modo, legenda)}
        />
      )}
      {visualizar && <Visualizador midia={visualizar} onFechar={() => setVisualizar(null)} />}
    </div>
  );
}
