// Construtor do fluxo de mensagens: blocos em sequência (texto, áudio, vídeo, imagem/GIF, arquivo),
// cada um com a espera e o "digitando…/gravando áudio…" antes dele. Arrastar, subir/descer, duplicar e remover.
import { useRef, useState } from 'react';
import {
  Type, Mic, Video, Image as ImageIcon, FileText, GripVertical, ChevronUp, ChevronDown, Copy, Trash2, Upload, Link2,
  Square, Timer, Bold, Italic, Strikethrough, Code, Plus, Braces, Loader2,
} from 'lucide-react';
import { api } from '../../api.js';
import { useAviso, enviarArquivo, urlMidia } from './comum.jsx';
import { VARIAVEIS, TIPOS_BLOCO, ACEITA, novoBloco, novoId, tamanhoArquivo, variaveisDesconhecidas } from './texto.js';

export const ICONES = { texto: Type, audio: Mic, video: Video, imagem: ImageIcon, arquivo: FileText };
const TIPOS_GRAVACAO = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
const MAX_BLOCOS = 15;

function EditorTexto({ valor, aoMudar, placeholder, variaveis, extras, linhas = 4 }) {
  const ref = useRef(null);
  const inserir = (antes, depois = '') => {
    const el = ref.current;
    const ini = el?.selectionStart ?? valor.length;
    const fim = el?.selectionEnd ?? valor.length;
    const selecionado = valor.slice(ini, fim);
    const novo = valor.slice(0, ini) + antes + selecionado + depois + valor.slice(fim);
    aoMudar(novo);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = selecionado ? ini + antes.length + selecionado.length + depois.length : ini + antes.length;
      el.setSelectionRange(pos, pos);
    });
  };
  const desconhecidas = variaveisDesconhecidas(valor, variaveis);
  return (
    <div className="dp-editor">
      <div className="dp-editor-barra">
        <button type="button" title="Negrito (*texto*)" onClick={() => inserir('*', '*')}><Bold size={14} /></button>
        <button type="button" title="Itálico (_texto_)" onClick={() => inserir('_', '_')}><Italic size={14} /></button>
        <button type="button" title="Riscado (~texto~)" onClick={() => inserir('~', '~')}><Strikethrough size={14} /></button>
        <button type="button" title="Monoespaçado" onClick={() => inserir('```', '```')}><Code size={14} /></button>
        <button type="button" title="Spintax: uma opção é sorteada a cada envio" onClick={() => inserir('{Oi|Olá|E aí}')}><Braces size={14} /> Spintax</button>
        <span className="dp-editor-sep" />
        {VARIAVEIS.map((v) => (
          <button type="button" key={v.nome} className="dp-chip-var" title={v.rotulo} onClick={() => inserir(`{{${v.nome}}}`)}>{`{{${v.nome}}}`}</button>
        ))}
        {extras?.map((v) => (
          <button type="button" key={v.variavel} className="dp-chip-var dp-chip-var-form" title={`${v.rotulo}${v.valor ? ` — ex.: ${v.valor}` : ''}`} onClick={() => inserir(`{{${v.variavel}}}`)}>{`{{${v.variavel}}}`}</button>
        ))}
      </div>
      <textarea ref={ref} rows={linhas} value={valor} placeholder={placeholder} onChange={(e) => aoMudar(e.target.value)} />
      {desconhecidas.length > 0 && (
        <div className="dp-alerta-var">
          Variável sem valor de exemplo: {desconhecidas.map((d) => <code key={d}>{`{{${d}}}`}</code>)} — se não existir no contato, sai vazia.
          Use <code>{'{{nome|padrão}}'}</code> para um valor reserva.
        </div>
      )}
    </div>
  );
}

function SeletorMidia({ bloco, aoMudar }) {
  const aviso = useAviso();
  const arquivo = useRef(null);
  const [enviando, setEnviando] = useState(false);
  const [link, setLink] = useState(null);
  const [gravando, setGravando] = useState(null);
  const [segundos, setSegundos] = useState(0);

  const usar = (midia) => aoMudar({ midia, midia_id: midia.id, nome_arquivo: bloco.tipo === 'arquivo' && !bloco.nome_arquivo ? midia.nome : bloco.nome_arquivo });

  const subir = async (f, nome) => {
    if (!f) return;
    setEnviando(true);
    try { usar(await enviarArquivo(f, nome)); } catch (e) { aviso(e.message, 'erro'); } finally { setEnviando(false); }
  };

  const importar = async () => {
    if (!link?.trim()) return;
    setEnviando(true);
    try {
      const d = await api('/disparos/midias/url', { method: 'POST', body: { url: link.trim() } });
      usar(d.midia);
      setLink(null);
    } catch (e) { aviso(e.message, 'erro'); } finally { setEnviando(false); }
  };

  const gravar = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      aviso('Para gravar áudio, abra o CRM por https ou http://localhost.', 'erro');
      return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch {
      aviso('O navegador não liberou o microfone. Clique no cadeado da barra de endereço e permita.', 'erro');
      return;
    }
    const mime = TIPOS_GRAVACAO.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const partes = [];
    const inicio = Date.now();
    rec.ondataavailable = (e) => { if (e.data?.size) partes.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(g.timer);
      setGravando(null);
      if ((Date.now() - inicio) / 1000 < 1 || !partes.length) return;
      const tipo = rec.mimeType || mime || 'audio/webm';
      const ext = tipo.includes('ogg') ? 'ogg' : tipo.includes('mp4') ? 'm4a' : 'webm';
      subir(new Blob(partes, { type: tipo }), `gravacao.${ext}`);
    };
    const g = { rec, timer: setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 500) };
    rec.start(250);
    setSegundos(0);
    setGravando(g);
  };

  const m = bloco.midia;
  return (
    <div className="dp-midia">
      {m ? (
        <div className="dp-midia-atual">
          {bloco.tipo === 'imagem' && <img src={urlMidia(m.id)} alt="" />}
          {bloco.tipo === 'video' && <video src={urlMidia(m.id)} controls preload="metadata" />}
          {bloco.tipo === 'audio' && <audio src={urlMidia(m.id)} controls preload="metadata" />}
          {bloco.tipo === 'arquivo' && <FileText size={28} />}
          <div className="dp-midia-info">
            <b title={m.nome}>{m.nome}</b>
            <span>{tamanhoArquivo(m.tamanho)} · {m.mime.split(';')[0]}</span>
            <button type="button" className="btn btn-pequeno" onClick={() => aoMudar({ midia: null, midia_id: null })}>Trocar</button>
          </div>
        </div>
      ) : bloco.midia_id ? (
        <div className="dp-midia-atual"><FileText size={22} /><div className="dp-midia-info"><b>Arquivo #{bloco.midia_id}</b><button type="button" className="btn btn-pequeno" onClick={() => aoMudar({ midia: null, midia_id: null })}>Trocar</button></div></div>
      ) : gravando ? (
        <div className="dp-gravando">
          <span className="ponto-gravando" /> Gravando… {segundos}s
          <button type="button" className="btn btn-pequeno btn-perigo-leve" onClick={() => gravando.rec.stop()}><Square size={12} /> Parar e usar</button>
        </div>
      ) : (
        <div
          className={`dp-soltar ${enviando ? 'enviando' : ''}`}
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
          onDrop={(e) => { if (e.dataTransfer?.files?.[0]) { e.preventDefault(); e.stopPropagation(); subir(e.dataTransfer.files[0]); } }}
        >
          {enviando ? <><Loader2 size={18} className="dp-gira" /> Enviando arquivo…</> : (
            <>
              <span className="suave">Arraste o arquivo aqui ou</span>
              <div className="acoes">
                <button type="button" className="btn btn-pequeno" onClick={() => arquivo.current?.click()}><Upload size={13} /> Escolher arquivo</button>
                {bloco.tipo === 'audio' && <button type="button" className="btn btn-pequeno" onClick={gravar}><Mic size={13} /> Gravar agora</button>}
                {(bloco.tipo === 'video' || bloco.tipo === 'imagem' || bloco.tipo === 'arquivo') && (
                  <button type="button" className="btn btn-pequeno" onClick={() => setLink(link === null ? '' : null)}><Link2 size={13} /> Usar link</button>
                )}
              </div>
              {link !== null && (
                <div className="dp-link">
                  <input autoFocus placeholder="https://…/video.mp4" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), importar())} />
                  <button type="button" className="btn btn-pequeno btn-ouro" onClick={importar}>Baixar</button>
                </div>
              )}
            </>
          )}
          <input ref={arquivo} type="file" hidden accept={ACEITA[bloco.tipo]} onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}

function CartaoBloco({ bloco, indice, total, aoMudar, aoMover, aoDuplicar, aoRemover, variaveis, extras, rotuloEspera, arrastando }) {
  const Icone = ICONES[bloco.tipo];
  const mudar = (p) => aoMudar({ ...bloco, ...p });
  const trocarTipo = (tipo) => {
    if (tipo === bloco.tipo) return;
    mudar({ tipo, midia: null, midia_id: null, espera: { ...bloco.espera, presenca: tipo === 'audio' ? 'recording' : bloco.espera.presenca === 'recording' ? 'composing' : bloco.espera.presenca } });
  };
  return (
    <div className={`dp-bloco ${arrastando.alvo === indice ? 'dp-bloco-alvo' : ''}`}
      onDragOver={(e) => { if (arrastando.de !== null) { e.preventDefault(); arrastando.setAlvo(indice); } }}
      onDrop={(e) => { if (arrastando.de !== null) { e.preventDefault(); aoMover(arrastando.de, indice); arrastando.fim(); } }}
    >
      <div className="dp-espera">
        <Timer size={14} />
        <span>{rotuloEspera(indice)}</span>
        <input type="number" min={0} max={600} value={bloco.espera.segundos}
          onChange={(e) => mudar({ espera: { ...bloco.espera, segundos: Math.max(0, Math.min(600, Number(e.target.value) || 0)) } })} />
        <span>s mostrando</span>
        <select value={bloco.espera.presenca} onChange={(e) => mudar({ espera: { ...bloco.espera, presenca: e.target.value } })}>
          <option value="composing">“digitando…”</option>
          <option value="recording">“gravando áudio…”</option>
          <option value="nenhuma">nada</option>
        </select>
      </div>
      <div className="dp-bloco-cartao">
        <div className="dp-bloco-topo">
          <span className="dp-alca" draggable title="Arraste para reordenar"
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(indice)); arrastando.inicio(indice); }}
            onDragEnd={arrastando.fim}
          ><GripVertical size={16} /></span>
          <span className="dp-bloco-num"><Icone size={14} /> Bloco {indice + 1}</span>
          <div className="dp-tipos" role="radiogroup" aria-label="Tipo do bloco">
            {TIPOS_BLOCO.map((t) => {
              const I = ICONES[t.id];
              return (
                <button key={t.id} type="button" role="radio" aria-checked={bloco.tipo === t.id} className={bloco.tipo === t.id ? 'ativo' : ''} onClick={() => trocarTipo(t.id)} title={t.rotulo}>
                  <I size={13} /> <span>{t.rotulo}</span>
                </button>
              );
            })}
          </div>
          <span className="espaco" />
          <div className="dp-bloco-acoes">
            <button type="button" disabled={indice === 0} onClick={() => aoMover(indice, indice - 1)} title="Subir"><ChevronUp size={15} /></button>
            <button type="button" disabled={indice === total - 1} onClick={() => aoMover(indice, indice + 1)} title="Descer"><ChevronDown size={15} /></button>
            <button type="button" disabled={total >= MAX_BLOCOS} onClick={aoDuplicar} title="Duplicar"><Copy size={14} /></button>
            <button type="button" className="perigo" onClick={aoRemover} title="Remover"><Trash2 size={14} /></button>
          </div>
        </div>
        {bloco.tipo === 'texto' ? (
          <EditorTexto valor={bloco.texto} aoMudar={(texto) => mudar({ texto })} variaveis={variaveis} extras={extras}
            placeholder="Ex.: {{saudacao}}, {{primeiro_nome}}! {Tudo bem?|Como vai?}" />
        ) : (
          <>
            <SeletorMidia bloco={bloco} aoMudar={mudar} />
            {bloco.tipo === 'audio' && (
              <label className="dp-check">
                <input type="checkbox" checked={bloco.ptt} onChange={(e) => mudar({ ptt: e.target.checked })} />
                <span>Enviar como áudio gravado na hora (mensagem de voz / PTT)</span>
              </label>
            )}
            {bloco.tipo === 'arquivo' && (
              <label>Nome do arquivo para o contato
                <input value={bloco.nome_arquivo || ''} placeholder="Ex.: Proposta Impera.pdf" onChange={(e) => mudar({ nome_arquivo: e.target.value })} />
              </label>
            )}
            {bloco.tipo !== 'audio' && (
              <EditorTexto valor={bloco.texto} aoMudar={(texto) => mudar({ texto })} variaveis={variaveis} extras={extras} linhas={2}
                placeholder="Legenda (opcional) — aceita variáveis e Spintax" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * blocos/setBlocos: estado do fluxo · variaveis: valores de exemplo (para avisar variáveis desconhecidas)
 * extras: variáveis do formulário [{ variavel, rotulo, valor }] · rotuloPrimeiro: texto da espera do 1º bloco
 */
export default function ConstrutorFluxo({ blocos, setBlocos, variaveis = {}, extras = [], rotuloPrimeiro = 'Antes da 1ª mensagem: aguardar' }) {
  const [de, setDe] = useState(null);
  const [alvo, setAlvo] = useState(null);
  const arrastando = { de, alvo, setAlvo, inicio: (i) => setDe(i), fim: () => { setDe(null); setAlvo(null); } };

  const mover = (origem, destino) => {
    if (destino < 0 || destino >= blocos.length || origem === destino) return;
    const lista = [...blocos];
    const [b] = lista.splice(origem, 1);
    lista.splice(destino, 0, b);
    setBlocos(lista);
  };
  const adicionar = (tipo) => {
    if (blocos.length >= MAX_BLOCOS) return;
    setBlocos([...blocos, novoBloco(tipo, blocos.length === 0)]);
  };
  const rotuloEspera = (i) => (i === 0 ? rotuloPrimeiro : 'Depois do bloco anterior: aguardar');

  return (
    <div className="dp-fluxo">
      {blocos.length === 0 && <div className="dp-fluxo-vazio">Nenhum bloco ainda. Comece adicionando uma mensagem abaixo.</div>}
      {blocos.map((b, i) => (
        <CartaoBloco
          key={b.id}
          bloco={b}
          indice={i}
          total={blocos.length}
          aoMudar={(novo) => setBlocos(blocos.map((x, j) => (j === i ? novo : x)))}
          aoMover={mover}
          aoDuplicar={() => { const lista = [...blocos]; lista.splice(i + 1, 0, { ...b, id: novoId() }); setBlocos(lista); }}
          aoRemover={() => setBlocos(blocos.filter((_, j) => j !== i))}
          variaveis={variaveis}
          extras={extras}
          rotuloEspera={rotuloEspera}
          arrastando={arrastando}
        />
      ))}
      <div className="dp-adicionar">
        <span className="suave pequeno">{blocos.length >= MAX_BLOCOS ? `Máximo de ${MAX_BLOCOS} blocos` : 'Adicionar bloco:'}</span>
        {TIPOS_BLOCO.map((t) => {
          const I = ICONES[t.id];
          return <button key={t.id} type="button" className="btn btn-pequeno" disabled={blocos.length >= MAX_BLOCOS} onClick={() => adicionar(t.id)}><Plus size={12} /><I size={13} /> {t.rotulo}</button>;
        })}
      </div>
    </div>
  );
}
