// Agendados: tarefas que a assistente executa sozinha num horário. O pedido é escrito do seu jeito; "Melhorar prompt"
// transforma no prompt executável e pergunta o que faltar antes de publicar.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, Plus, Play, Pencil, Trash2, Wand2, History, Loader2, MessageCircle } from 'lucide-react';
import { api } from '../../../api.js';
import { useEvento } from '../../../tempoReal.js';
import { useT } from '../../../i18n/index.jsx';
import { useAviso, Interruptor } from '../../disparos/comum.jsx';
import Modal from '../../Modal.jsx';
import Markdown from './Markdown.jsx';
import { dinheiro, rotuloModelo, FUSOS, nomeFuso, dataHoraCurta } from './comum.js';

const TIPOS = ['diario', 'dias_uteis', 'semanal', 'mensal', 'a_cada_horas', 'uma_vez'];
const DESTINOS = ['aba', 'proprio', 'numero', 'grupo'];
const DIAS = [1, 2, 3, 4, 5, 6, 0];

export default function Agendados({ user, dados, aoAbrirConversa }) {
  const t = useT();
  const aviso = useAviso();
  const [lista, setLista] = useState(null);
  const [aberto, setAberto] = useState(null);
  const [historico, setHistorico] = useState(null);
  const carregar = useCallback(() => api('/agente/agendados').then((d) => setLista(d.agendados)).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('agente', (d) => { if ((!d?.usuario || d.usuario === user.id) && (d?.agendados || d?.acoes || d?.reconectou)) carregar(); });

  const alternar = async (a, ativo) => {
    try { await api(`/agente/agendados/${a.id}`, { method: 'PUT', body: { ativo } }); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };
  const rodar = async (a) => {
    try { await api(`/agente/agendados/${a.id}/rodar`, { method: 'POST' }); aviso(t('ia.agente.agendados.rodando'), 'info'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };
  const apagar = async (a) => {
    if (!confirm(t('ia.agente.agendados.confirmarApagar', { nome: a.nome }))) return;
    try { await api(`/agente/agendados/${a.id}`, { method: 'DELETE' }); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };

  return (
    <section className="cartao-secao">
      <div className="dp-secao-topo">
        <h2><CalendarClock size={16} /> {t('ia.agente.agendados.titulo')}</h2>
        <button type="button" className="btn btn-ouro btn-pequeno" onClick={() => setAberto({})}><Plus size={13} /> {t('ia.agente.agendados.novo')}</button>
      </div>
      <p className="suave pequeno">{t('ia.agente.agendados.explicacao', { nome: dados.config.nome })}</p>
      {!lista ? <div className="carregando" /> : !lista.length ? <div className="vazio">{t('ia.agente.agendados.vazio')}</div> : (
        <div className="ag-agendados">
          {lista.map((a) => (
            <div key={a.id} className={`ag-agendado ${a.ativo ? '' : 'inativo'}`}>
              <div className="ag-agendado-topo">
                <Interruptor ligado={a.ativo} aoMudar={(v) => alternar(a, v)} />
                <b>{a.nome}</b>
                {a.ultimo_status && <span className={`ag-acao-status ${a.ultimo_status.startsWith('tentativa') ? 'pendente' : a.ultimo_status}`}>{t(`ia.agente.agendados.status.${a.ultimo_status.startsWith('tentativa') ? 'tentativa' : a.ultimo_status}`)}</span>}
              </div>
              <span className="pequeno">{a.frequencia_texto} · {nomeFuso(a.fuso)} · {a.destino_texto}</span>
              <span className="pequeno suave">
                {a.ativo && a.proxima_em ? t('ia.agente.agendados.proxima', { quando: dataHoraCurta(a.proxima_em) }) : t('ia.agente.agendados.parado')}
                {a.ultima_em ? ` · ${t('ia.agente.agendados.ultima', { quando: dataHoraCurta(a.ultima_em) })}` : ''} · {a.modelo_nome} · {t('ia.agente.agendados.tetoCurto', { valor: dinheiro(a.teto_execucao_usd) })}
              </span>
              <div className="ag-linha-acoes">
                <button type="button" className="btn btn-pequeno" onClick={() => rodar(a)}><Play size={13} /> {t('ia.agente.agendados.rodarAgora')}</button>
                <button type="button" className="btn btn-pequeno" onClick={() => setHistorico(a)}><History size={13} /> {t('ia.agente.agendados.historico')}</button>
                <button type="button" className="btn btn-pequeno" onClick={() => setAberto(a)}><Pencil size={13} /> {t('ia.agente.editar')}</button>
                <button type="button" className="btn btn-pequeno" onClick={() => apagar(a)} aria-label={t('ia.agente.apagar')}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {aberto && createPortal(<Editor inicial={aberto} dados={dados} aoFechar={() => setAberto(null)} aoSalvar={() => { setAberto(null); carregar(); }} />, document.body)}
      {historico && createPortal(<Historico agendado={historico} aoFechar={() => setHistorico(null)} aoAbrirConversa={aoAbrirConversa} />, document.body)}
    </section>
  );
}

function Editor({ inicial, dados, aoFechar, aoSalvar }) {
  const t = useT();
  const aviso = useAviso();
  const cfg = dados.config;
  const [nome, setNome] = useState(inicial.nome || '');
  const [pedido, setPedido] = useState(inicial.pedido || '');
  const [prompt, setPrompt] = useState(inicial.prompt || '');
  const [freq, setFreq] = useState(inicial.frequencia || { tipo: 'diario', hora: '08:00', dias: [1], dia_mes: 1, horas: 4, data: new Date().toISOString().slice(0, 10) });
  const [fuso, setFuso] = useState(inicial.fuso || cfg.fuso);
  const [destino, setDestino] = useState(inicial.destino || { tipo: 'aba', numero_id: dados.numeros[0]?.id || null });
  const [modelo, setModelo] = useState(inicial.modelo || cfg.modelo_agendados);
  const [teto, setTeto] = useState(inicial.teto_execucao_usd ?? 0.5);
  const [perguntas, setPerguntas] = useState((inicial.perguntas || []).map((p) => (typeof p === 'string' ? { pergunta: p, resposta: '' } : p)));
  const [grupos, setGrupos] = useState([]);
  const [melhorando, setMelhorando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api('/agente/grupos').then((d) => setGrupos(d.grupos)).catch(() => {}); }, []);

  const melhorar = async () => {
    setMelhorando(true);
    try {
      const r = await api('/agente/agendados/melhorar-prompt', { method: 'POST', body: { pedido, nome, respostas: perguntas, atual: { frequencia: freq, fuso, destino } } });
      if (r.nome && !nome) setNome(r.nome);
      setPrompt(r.prompt);
      if (r.frequencia?.tipo) setFreq((f) => ({ ...f, ...Object.fromEntries(Object.entries(r.frequencia).filter(([, v]) => v !== null && v !== undefined)) }));
      if (r.fuso) setFuso(r.fuso);
      if (r.destino?.tipo) {
        const d = { ...destino, ...Object.fromEntries(Object.entries(r.destino).filter(([, v]) => v !== null && v !== undefined)) };
        if (d.conversa?.startsWith?.('g:')) d.jid = d.conversa.slice(2);
        setDestino(d);
      }
      const respondidas = perguntas.filter((p) => p.resposta?.trim());
      setPerguntas([...respondidas, ...r.perguntas.map((p) => ({ pergunta: p, resposta: '' }))]);
      aviso(r.perguntas.length ? t('ia.agente.agendados.temPerguntas', { n: r.perguntas.length }) : t('ia.agente.agendados.promptPronto'), r.perguntas.length ? 'info' : 'ok');
    } catch (e) { aviso(e.message, 'erro'); } finally { setMelhorando(false); }
  };

  const abertas = perguntas.filter((p) => !p.resposta?.trim());

  const salvar = async () => {
    if (abertas.length && !confirm(t('ia.agente.agendados.confirmarSemResponder', { n: abertas.length }))) return;
    setSalvando(true);
    const corpo = { nome, pedido, prompt, frequencia: freq, fuso, destino, modelo, teto_execucao_usd: teto, perguntas };
    try {
      if (inicial.id) await api(`/agente/agendados/${inicial.id}`, { method: 'PUT', body: corpo });
      else await api('/agente/agendados', { method: 'POST', body: corpo });
      aviso(t('ia.agente.agendados.salvo'));
      aoSalvar();
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  const mudarFreq = (p) => setFreq((f) => ({ ...f, ...p }));
  const mudarDestino = (p) => setDestino((d) => ({ ...d, ...p }));

  return (
    <Modal titulo={inicial.id ? t('ia.agente.agendados.editarTitulo') : t('ia.agente.agendados.novoTitulo')} onFechar={aoFechar} largo>
      <div className="ag-editor ia-pagina">
        <label>{t('ia.agente.agendados.nome')}<input value={nome} maxLength={100} onChange={(e) => setNome(e.target.value)} placeholder={t('ia.agente.agendados.nomeExemplo')} /></label>
        <label>{t('ia.agente.agendados.pedido')}
          <textarea rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder={t('ia.agente.agendados.pedidoExemplo')} />
        </label>
        <div><button type="button" className="btn" disabled={melhorando || !pedido.trim() || !cfg.chave_configurada} onClick={melhorar}>
          {melhorando ? <Loader2 size={14} className="dp-gira" /> : <Wand2 size={14} />} {t('ia.agente.agendados.melhorar')}
        </button></div>

        {perguntas.length > 0 && (
          <div className="ag-perguntas">
            <b>{t('ia.agente.agendados.perguntasTitulo')}</b>
            {perguntas.map((p, i) => (
              <label key={i}>{p.pergunta}
                <input value={p.resposta || ''} onChange={(e) => setPerguntas((l) => l.map((x, j) => (j === i ? { ...x, resposta: e.target.value } : x)))} />
              </label>
            ))}
            <span className="suave pequeno">{t('ia.agente.agendados.perguntasDica')}</span>
          </div>
        )}

        <label>{t('ia.agente.agendados.prompt')}
          <textarea rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('ia.agente.agendados.promptVazio')} />
        </label>

        <div className="ia-campos-3">
          <label>{t('ia.agente.agendados.frequencia')}
            <select value={freq.tipo} onChange={(e) => mudarFreq({ tipo: e.target.value })}>
              {TIPOS.map((x) => <option key={x} value={x}>{t(`ia.agente.agendados.freq.${x}`)}</option>)}
            </select>
          </label>
          {freq.tipo !== 'a_cada_horas' && <label>{t('ia.agente.agendados.hora')}<input type="time" value={freq.hora || '08:00'} onChange={(e) => mudarFreq({ hora: e.target.value })} /></label>}
          {freq.tipo === 'a_cada_horas' && <label>{t('ia.agente.agendados.horas')}<input type="number" min={1} max={168} value={freq.horas || 4} onChange={(e) => mudarFreq({ horas: Number(e.target.value) })} /></label>}
          {freq.tipo === 'mensal' && <label>{t('ia.agente.agendados.diaMes')}<input type="number" min={1} max={31} value={freq.dia_mes || 1} onChange={(e) => mudarFreq({ dia_mes: Number(e.target.value) })} /></label>}
          {freq.tipo === 'uma_vez' && <label>{t('ia.agente.agendados.data')}<input type="date" value={freq.data || ''} onChange={(e) => mudarFreq({ data: e.target.value })} /></label>}
          <label>{t('ia.agente.agendados.fuso')}
            <select value={fuso} onChange={(e) => setFuso(e.target.value)}>
              {[...new Set([...FUSOS, fuso])].map((f) => <option key={f} value={f}>{nomeFuso(f)}</option>)}
            </select>
          </label>
        </div>
        {freq.tipo === 'semanal' && (
          <div className="ag-dias">
            {DIAS.map((d) => (
              <label key={d} className="dp-check">
                <input type="checkbox" checked={(freq.dias || []).includes(d)} onChange={(e) => mudarFreq({ dias: e.target.checked ? [...new Set([...(freq.dias || []), d])] : (freq.dias || []).filter((x) => x !== d) })} />
                <span>{t(`ia.agente.agendados.dia.${d}`)}</span>
              </label>
            ))}
          </div>
        )}

        <div className="ag-destinos">
          <span className="ag-rotulo">{t('ia.agente.agendados.destino')}</span>
          <div className="ia-modos">
            {DESTINOS.map((x) => (
              <button key={x} type="button" className={destino.tipo === x ? 'ativo' : ''} onClick={() => mudarDestino({ tipo: x })}>
                <b>{t(`ia.agente.agendados.destinos.${x}`)}</b><span>{t(`ia.agente.agendados.destinos.${x}Texto`)}</span>
              </button>
            ))}
          </div>
          {destino.tipo !== 'aba' && (
            <div className="ia-campos-2">
              <label>{t('ia.agente.agendados.numeroEnvia')}
                <select value={destino.numero_id || ''} onChange={(e) => mudarDestino({ numero_id: Number(e.target.value) })}>
                  {dados.numeros.map((n) => <option key={n.id} value={n.id}>{n.name || n.phone} — {n.status}</option>)}
                </select>
              </label>
              {destino.tipo === 'numero' && <label>{t('ia.agente.agendados.telefone')}<input value={destino.telefone || ''} placeholder="+55 11 99999-9999" onChange={(e) => mudarDestino({ telefone: e.target.value })} /></label>}
              {destino.tipo === 'grupo' && (
                <label>{t('ia.agente.agendados.grupo')}
                  <select value={destino.jid || ''} onChange={(e) => mudarDestino({ jid: e.target.value })}>
                    <option value="">{t('ia.agente.agendados.escolhaGrupo')}</option>
                    {grupos.map((g) => <option key={g.jid} value={g.jid}>{g.nome}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {destino.tipo !== 'aba' && <span className="suave pequeno">{t('ia.agente.agendados.regraWhatsApp')}</span>}
        </div>

        <div className="ia-campos-2">
          <label>{t('ia.agente.agendados.modelo')}
            <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
              {dados.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
            </select>
          </label>
          <label>{t('ia.agente.agendados.teto')}
            <input type="number" min={0.02} max={50} step={0.05} value={teto} onChange={(e) => setTeto(e.target.value)} />
          </label>
        </div>

        <div className="modal-rodape">
          <button type="button" className="btn" onClick={aoFechar}>{t('ia.agente.cancelar')}</button>
          <button type="button" className="btn btn-ouro" disabled={salvando || !nome.trim() || !prompt.trim()} onClick={salvar}>{t('ia.agente.agendados.publicar')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Historico({ agendado, aoFechar, aoAbrirConversa }) {
  const t = useT();
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [aberta, setAberta] = useState(null);
  useEffect(() => { api(`/agente/agendados/${agendado.id}`).then(setDados).catch((e) => aviso(e.message, 'erro')); }, [agendado.id, aviso]);
  return (
    <Modal titulo={t('ia.agente.agendados.historicoDe', { nome: agendado.nome })} onFechar={aoFechar} largo>
      {!dados ? <div className="carregando" /> : !dados.execucoes.length ? <div className="vazio">{t('ia.agente.agendados.semExecucoes')}</div> : (
        <ul className="ag-execucoes">
          {dados.execucoes.map((e) => (
            <li key={e.id}>
              <button type="button" className="ag-execucao" onClick={() => setAberta(aberta === e.id ? null : e.id)}>
                <span className={`ag-acao-status ${e.status === 'aguardando_tentativa' ? 'pendente' : e.status}`}>{t(`ia.agente.agendados.status.${e.status === 'aguardando_tentativa' ? 'tentativa' : e.status}`)}</span>
                <span>{dataHoraCurta(e.inicio)}{e.manual ? ` · ${t('ia.agente.agendados.manual')}` : ''}</span>
                <span className="suave pequeno">{e.enviado_para || ''}{e.custo_usd ? ` · ${dinheiro(e.custo_usd)}` : ''}</span>
              </button>
              {e.erro && <p className="pequeno ag-alerta">{e.erro}</p>}
              {aberta === e.id && e.resposta && <div className="ag-execucao-resposta"><Markdown texto={e.resposta} aoAbrirConversa={aoAbrirConversa} /></div>}
            </li>
          ))}
        </ul>
      )}
      {dados?.agendado?.conversa_id && <p className="pequeno suave"><MessageCircle size={12} /> {t('ia.agente.agendados.naConversa')}</p>}
    </Modal>
  );
}
