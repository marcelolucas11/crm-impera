// Chat com a assistente: conversas salvas (lista lateral), respostas em Markdown com fontes clicáveis,
// cartões de ação para aprovar, anexos (print, PDF, áudio, planilha), ditado por voz e seletor de modelo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Archive, ArchiveRestore, Paperclip, Mic, Square, Send, X, FileText, Image as Imagem, Music, MessageCircle, Clock, Smartphone, Pencil, Check, Loader2 } from 'lucide-react';
import { api } from '../../../api.js';
import { rota } from '../../../base.js';
import { useEvento } from '../../../tempoReal.js';
import { useT } from '../../../i18n/index.jsx';
import { tempoDesde } from '../../../utils.js';
import { useAviso } from '../../disparos/comum.jsx';
import Markdown from './Markdown.jsx';
import CartaoAcao from './CartaoAcao.jsx';
import { dinheiro, rotuloModelo, enviarAnexo } from './comum.js';

const ICONE_ORIGEM = { agendado: Clock, whatsapp: Smartphone, chat: MessageCircle };
const SUGESTOES = ['grupo', 'followup', 'promessas', 'proposta', 'hoje'];
// Prévia da última mensagem na lista, sem a marcação do Markdown
const semMarcacao = (t) => String(t || '').replace(/\b[gl]:[\w.:@-]+/g, '').replace(/[#*_`>|]+/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

function iconeDoArquivo(mime = '') {
  if (mime.startsWith('image/')) return Imagem;
  if (mime.startsWith('audio/')) return Music;
  return FileText;
}

export default function Chat({ user, dados, aoAbrirConversa, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  const [conversas, setConversas] = useState(null);
  const [arquivadas, setArquivadas] = useState(false);
  const [atual, setAtual] = useState(() => { try { return Number(localStorage.getItem('crm.agente.conversa')) || null; } catch { return null; } });
  const [detalhe, setDetalhe] = useState(null);
  const [etapa, setEtapa] = useState(null);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState([]);
  const [subindo, setSubindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [modelo, setModelo] = useState(dados.config.modelo_chat);
  const [gravando, setGravando] = useState(null);
  const [editandoTitulo, setEditandoTitulo] = useState(null);
  const fimRef = useRef(null);
  const arquivoRef = useRef(null);
  const campoRef = useRef(null);

  const escolher = (id) => { setAtual(id); try { localStorage.setItem('crm.agente.conversa', String(id || '')); } catch { /* sem armazenamento */ } };

  const carregarLista = useCallback(() => api(`/agente/conversas${arquivadas ? '?arquivadas=1' : ''}`).then((d) => setConversas(d.conversas)).catch((e) => aviso(e.message, 'erro')), [arquivadas, aviso]);
  const carregarDetalhe = useCallback(async (id = atual) => {
    if (!id) { setDetalhe(null); return; }
    try {
      const d = await api(`/agente/conversas/${id}`);
      setDetalhe(d);
      setEtapa(d.conversa.status === 'pensando' ? d.conversa.etapa : null);
    } catch (e) {
      if (/não encontrada/i.test(e.message)) escolher(null); else aviso(e.message, 'erro');
    }
  }, [atual, aviso]);

  useEffect(() => { carregarLista(); }, [carregarLista]);
  useEffect(() => { carregarDetalhe(); }, [carregarDetalhe]);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [detalhe?.mensagens?.length, detalhe?.acoes?.length, etapa]);

  // O tempo real junta avisos seguidos do mesmo tipo: na dúvida, recarrega (e confere sozinho enquanto ela pensa)
  const recarregarLista = useRef(null);
  useEvento('agente', (d) => {
    if (d?.usuario && d.usuario !== user.id) return;
    if (d?.conversa && d.conversa === atual && d.status === 'pensando') setEtapa(d.etapa || t('ia.agente.chat.pensando'));
    else if (atual && (!d?.conversa || d.conversa === atual)) carregarDetalhe(atual);
    clearTimeout(recarregarLista.current);
    recarregarLista.current = setTimeout(carregarLista, 400);
  });
  const pensandoAgora = Boolean(etapa) || detalhe?.conversa?.status === 'pensando';
  useEffect(() => {
    if (!pensandoAgora || !atual) return undefined;
    const id = setInterval(() => carregarDetalhe(atual), 4000);
    return () => clearInterval(id);
  }, [pensandoAgora, atual, carregarDetalhe]);

  const novaConversa = async () => {
    try {
      const { id } = await api('/agente/conversas', { method: 'POST', body: {} });
      setArquivadas(false);
      await carregarLista();
      escolher(id);
      setTimeout(() => campoRef.current?.focus(), 50);
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const enviar = async (textoForcado = null) => {
    const conteudo = (textoForcado ?? texto).trim();
    if ((!conteudo && !anexos.length) || enviando) return;
    setEnviando(true);
    try {
      let id = atual;
      if (!id) {
        id = (await api('/agente/conversas', { method: 'POST', body: {} })).id;
        escolher(id);
      }
      setEtapa(t('ia.agente.chat.pensando'));
      await api(`/agente/conversas/${id}/mensagens`, { method: 'POST', body: { texto: conteudo, anexos: anexos.map((a) => a.id), modelo } });
      setTexto('');
      setAnexos([]);
      await carregarDetalhe(id);
      setEtapa((e) => e || t('ia.agente.chat.pensando'));
      carregarLista();
      aoMudar?.();
    } catch (e) {
      setEtapa(null);
      aviso(e.message, 'erro');
    } finally { setEnviando(false); }
  };

  const subirArquivos = async (lista) => {
    const arquivos = [...(lista || [])];
    if (!arquivos.length) return;
    setSubindo(true);
    try {
      for (const f of arquivos.slice(0, 10)) {
        if (f.size > 25 * 1024 * 1024) { aviso(t('ia.agente.chat.anexoGrande', { nome: f.name }), 'erro'); continue; }
        const a = await enviarAnexo(f);
        setAnexos((l) => [...l, a]);
      }
    } catch (e) { aviso(e.message, 'erro'); } finally { setSubindo(false); }
  };

  // Ditado por voz: grava no navegador, envia e transcreve na VPS
  const alternarGravacao = async () => {
    if (gravando) { gravando.stop(); return; }
    if (!dados.transcricao.pronta) { aviso(t('ia.agente.chat.semTranscricao'), 'erro'); return; }
    try {
      const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(fluxo);
      const pedacos = [];
      rec.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
      rec.onstop = async () => {
        fluxo.getTracks().forEach((tr) => tr.stop());
        setGravando(null);
        const blob = new Blob(pedacos, { type: rec.mimeType || 'audio/webm' });
        if (!blob.size) return;
        setSubindo(true);
        try {
          const a = await enviarAnexo(blob, `ditado.${(rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'}`, blob.type);
          const { texto: falado } = await api(`/agente/anexos/${a.id}/transcrever`, { method: 'POST' });
          setTexto((x) => (x ? `${x} ${falado}` : falado));
          campoRef.current?.focus();
        } catch (e) { aviso(e.message, 'erro'); } finally { setSubindo(false); }
      };
      rec.start();
      setGravando(rec);
    } catch { aviso(t('ia.agente.chat.semMicrofone'), 'erro'); }
  };

  const mudarConversa = async (id, mudanca) => {
    try { await api(`/agente/conversas/${id}`, { method: 'PUT', body: mudanca }); carregarLista(); carregarDetalhe(id); } catch (e) { aviso(e.message, 'erro'); }
  };

  // Mensagens e cartões de ação na ordem em que aconteceram
  const linhaDoTempo = useMemo(() => {
    if (!detalhe) return [];
    const itens = detalhe.mensagens.map((m) => ({ tipo: 'msg', em: m.created_at, id: `m${m.id}`, m }));
    // O cartão aparece logo depois da resposta em que a assistente propôs a ação
    const respostas = detalhe.mensagens.filter((m) => m.papel === 'alice');
    for (const a of detalhe.acoes) {
      const resposta = respostas.find((m) => m.created_at >= a.created_at);
      itens.push({ tipo: 'acao', em: resposta ? `${resposta.created_at}~${a.id}` : a.created_at, id: `a${a.id}`, a });
    }
    return itens.sort((x, y) => (x.em < y.em ? -1 : x.em > y.em ? 1 : x.tipo === 'msg' ? -1 : 1));
  }, [detalhe]);

  const pensando = pensandoAgora;
  const nome = dados.config.nome;

  return (
    <div className="ag-chat">
      <aside className="ag-lista cartao-secao">
        <div className="ag-lista-topo">
          <button type="button" className="btn btn-ouro btn-pequeno" onClick={novaConversa}><Plus size={14} /> {t('ia.agente.chat.nova')}</button>
          <button type="button" className="btn btn-pequeno" onClick={() => setArquivadas((v) => !v)} title={arquivadas ? t('ia.agente.chat.verAtivas') : t('ia.agente.chat.verArquivadas')}>
            {arquivadas ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
        </div>
        {arquivadas && <p className="suave pequeno">{t('ia.agente.chat.arquivadas')}</p>}
        {!conversas ? <div className="carregando" /> : !conversas.length ? <p className="suave pequeno">{t('ia.agente.chat.semConversas')}</p> : (
          <ul>
            {conversas.map((c) => {
              const I = ICONE_ORIGEM[c.origem] || MessageCircle;
              return (
                <li key={c.id}>
                  <button type="button" className={`ag-conversa ${c.id === atual ? 'ativa' : ''}`} onClick={() => escolher(c.id)}>
                    <span className="ag-conversa-titulo"><I size={13} /> {c.titulo || t('ia.agente.chat.semTitulo')}</span>
                    <span className="ag-conversa-ultima">{c.status === 'pensando' ? <i>{c.etapa || t('ia.agente.chat.pensando')}</i> : semMarcacao(c.ultima)}</span>
                    <span className="ag-conversa-rodape">
                      <span>{tempoDesde(c.updated_at)}</span>
                      {c.pendentes > 0 && <span className="aba-contador" title={t('ia.agente.chat.pendentesNaConversa')}>{c.pendentes}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="ag-principal cartao-secao">
        {detalhe && (
          <div className="ag-topo">
            {editandoTitulo !== null ? (
              <form className="ag-titulo-edicao" onSubmit={(e) => { e.preventDefault(); mudarConversa(atual, { titulo: editandoTitulo }); setEditandoTitulo(null); }}>
                <input autoFocus value={editandoTitulo} maxLength={120} onChange={(e) => setEditandoTitulo(e.target.value)} onBlur={() => setEditandoTitulo(null)} />
                <button type="submit" className="btn btn-pequeno" onMouseDown={(e) => e.preventDefault()}><Check size={13} /></button>
              </form>
            ) : (
              <h3 className="ag-titulo" title={t('ia.agente.chat.renomear')} onClick={() => setEditandoTitulo(detalhe.conversa.titulo || '')}>
                {detalhe.conversa.titulo || t('ia.agente.chat.semTitulo')} <Pencil size={12} />
              </h3>
            )}
            <button type="button" className="btn btn-pequeno" onClick={() => mudarConversa(atual, { arquivada: !detalhe.conversa.arquivada })}>
              {detalhe.conversa.arquivada ? <><ArchiveRestore size={13} /> {t('ia.agente.chat.desarquivar')}</> : <><Archive size={13} /> {t('ia.agente.chat.arquivar')}</>}
            </button>
          </div>
        )}

        <div className="ag-mensagens">
          {!detalhe || !linhaDoTempo.length ? (
            <div className="ag-vazio">
              <h3>{t('ia.agente.chat.olaTitulo', { nome })}</h3>
              <p className="suave">{t('ia.agente.chat.olaTexto')}</p>
              <div className="ag-sugestoes">
                {SUGESTOES.map((s) => (
                  <button key={s} type="button" className="ag-sugestao" onClick={() => { setTexto(t(`ia.agente.sugestao.${s}`)); campoRef.current?.focus(); }}>
                    {t(`ia.agente.sugestao.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : linhaDoTempo.map((it) => (it.tipo === 'acao'
            ? <CartaoAcao key={it.id} acao={it.a} aoMudar={() => { carregarDetalhe(atual); aoMudar?.(); }} />
            : <Mensagem key={it.id} m={it.m} nome={nome} aoAbrirConversa={aoAbrirConversa} />))}
          {pensando && (
            <div className="ag-msg ag-msg-alice ag-pensando">
              <span className="ag-autor">{nome}</span>
              <span><Loader2 size={14} className="dp-gira" /> {etapa || t('ia.agente.chat.pensando')}…</span>
            </div>
          )}
          <div ref={fimRef} />
        </div>

        {anexos.length > 0 && (
          <div className="ag-anexos-pendentes">
            {anexos.map((a) => {
              const I = iconeDoArquivo(a.mime);
              return (
                <span key={a.id} className="ag-anexo">
                  <I size={13} /> {a.nome}
                  <button type="button" onClick={() => setAnexos((l) => l.filter((x) => x.id !== a.id))} aria-label={t('ia.agente.chat.tirarAnexo')}><X size={12} /></button>
                </span>
              );
            })}
          </div>
        )}

        <div className="ag-compositor"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); subirArquivos(e.dataTransfer.files); }}>
          <textarea ref={campoRef} rows={2} value={texto} placeholder={t('ia.agente.chat.placeholder', { nome })}
            onChange={(e) => setTexto(e.target.value)}
            onPaste={(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); subirArquivos(f); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }} />
          <div className="ag-compositor-barra">
            <select value={modelo} onChange={(e) => setModelo(e.target.value)} title={t('ia.agente.chat.modelo')} className="ag-modelo">
              {dados.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
            </select>
            <span className="ag-compositor-acoes">
              <input ref={arquivoRef} type="file" multiple hidden onChange={(e) => { subirArquivos(e.target.files); e.target.value = ''; }}
                accept="image/*,application/pdf,audio/*,.docx,.xlsx,.pptx,.txt,.csv,.md,.json" />
              <button type="button" className="btn btn-pequeno" disabled={subindo} onClick={() => arquivoRef.current?.click()} title={t('ia.agente.chat.anexar')}>
                {subindo ? <Loader2 size={14} className="dp-gira" /> : <Paperclip size={14} />}
              </button>
              <button type="button" className={`btn btn-pequeno ${gravando ? 'btn-perigo-leve' : ''}`} disabled={subindo && !gravando} onClick={alternarGravacao} title={gravando ? t('ia.agente.chat.pararGravacao') : t('ia.agente.chat.ditar')}>
                {gravando ? <Square size={14} /> : <Mic size={14} />}
              </button>
              <button type="button" className="btn btn-ouro btn-pequeno" disabled={enviando || pensando || (!texto.trim() && !anexos.length)} onClick={() => enviar()}>
                <Send size={14} /> {t('ia.agente.chat.enviar')}
              </button>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Mensagem({ m, nome, aoAbrirConversa }) {
  const t = useT();
  if (m.papel === 'evento') return <div className="ag-evento">{m.texto}</div>;
  const alice = m.papel === 'alice';
  return (
    <div className={`ag-msg ${alice ? 'ag-msg-alice' : 'ag-msg-usuario'}`}>
      <span className="ag-autor">{alice ? nome : t('ia.agente.chat.voce')}</span>
      {m.anexos?.length > 0 && (
        <div className="ag-anexos">
          {m.anexos.map((a) => {
            const I = iconeDoArquivo(a.mime);
            return <a key={a.id} className="ag-anexo" href={rota(`/api/agente/anexos/${a.id}`)} target="_blank" rel="noreferrer"><I size={13} /> {a.nome}</a>;
          })}
        </div>
      )}
      {alice ? <Markdown texto={m.texto} aoAbrirConversa={aoAbrirConversa} /> : m.texto && <div className="ag-texto-usuario">{m.texto}</div>}
      {alice && m.fontes?.length > 0 && (
        <div className="ag-fontes">
          <span className="suave pequeno">{t('ia.agente.chat.fontes')}</span>
          {m.fontes.map((f) => (
            <button key={f.chave} type="button" className="ag-fonte" onClick={() => aoAbrirConversa?.(f.chave)} title={f.chave}>{f.nome}</button>
          ))}
        </div>
      )}
      {alice && <span className="ag-meta">{m.modelo_nome}{m.custo_usd ? ` · ${dinheiro(m.custo_usd)}` : ''} · {new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
  );
}
