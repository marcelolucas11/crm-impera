// Monitor da fila (tempo real), modelos de fluxo e lista de bloqueio (não perturbe)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pause, Play, XCircle, RotateCcw, Trash2, Activity, Zap, FlaskConical, Megaphone, ShieldOff, LayoutTemplate, ListChecks,
  CheckCircle2, AlertTriangle, Clock, SkipForward, Loader2, Ban,
} from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { dataHora, tempoDesde } from '../../utils.js';
import { useAviso, Vazio } from './comum.jsx';
import { formatarTelefone, duracaoCurta } from './texto.js';
import { ICONES } from './ConstrutorFluxo.jsx';

const ROTULO_STATUS = { executando: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };
const ROTULO_ITEM = { pendente: 'Na fila', enviando: 'Enviando', enviado: 'Enviado', falha: 'Falha', pulado: 'Pulado', cancelado: 'Cancelado' };
const ICONE_ITEM = { pendente: Clock, enviando: Loader2, enviado: CheckCircle2, falha: AlertTriangle, pulado: SkipForward, cancelado: Ban };
const ICONE_TIPO = { campanha: Megaphone, yayforms: Zap, teste: FlaskConical };

// Atualiza a tela a cada segundo (contagem regressiva dos timers)
export function useRelogio(ativo = true) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!ativo) return undefined;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ativo]);
  return agora;
}

const restante = (iso, agora) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - agora) / 1000)) : 0);

export function frasesAoVivo(c, agora) {
  const v = c.ao_vivo;
  if (c.status === 'pausada') return 'Fila pausada.';
  if (c.status !== 'executando') return null;
  if (!v) return 'Preparando…';
  const s = restante(v.ate, agora);
  switch (v.fase) {
    case 'enviando':
      return s > 0 && v.presenca !== 'nenhuma'
        ? `Bloco ${v.bloco}/${v.blocos} (${v.tipo_bloco}) para ${v.contato} — ${v.presenca === 'recording' ? 'gravando áudio' : 'digitando'}… ${s}s`
        : s > 0 ? `Aguardando ${s}s antes do bloco ${v.bloco}/${v.blocos} (${v.tipo_bloco}) para ${v.contato}…`
          : `Enviando bloco ${v.bloco}/${v.blocos} (${v.tipo_bloco}) para ${v.contato}…`;
    case 'intervalo':
      return `Aguardando timer entre contatos (${duracaoCurta(s)} restantes${v.contato ? ` para enviar para ${v.contato}` : ''})…`;
    case 'lote':
      return `Descanso do lote de segurança — retoma em ${duracaoCurta(s)}${v.contato ? ` com ${v.contato}` : ''}.`;
    case 'janela':
      return `Fora da janela de horário permitido — retoma ${v.ate ? dataHora(v.ate) : 'no próximo horário'}.`;
    case 'desconectado':
      return 'Número de WhatsApp desconectado — a fila continua sozinha quando reconectar.';
    case 'agendado':
      return v.ate ? `Próximo envio agendado em ${duracaoCurta(s)}.` : 'Aguardando…';
    case 'aguardando_leads':
      return 'Ligada — aguardando novos leads do Yay! Forms.';
    case 'sem_fluxo':
      return 'Sem mensagens no fluxo: monte os blocos para começar.';
    default:
      return 'Processando…';
  }
}

function Progresso({ c }) {
  const k = c.contagem;
  const feitos = k.enviado + k.falha + k.pulado + k.cancelado;
  const pct = (n) => (c.total ? `${(n / c.total) * 100}%` : '0%');
  return (
    <div className="dp-progresso">
      <div className="dp-progresso-trilho">
        <span className="ok" style={{ width: pct(k.enviado) }} />
        <span className="falha" style={{ width: pct(k.falha) }} />
        <span className="pulado" style={{ width: pct(k.pulado + k.cancelado) }} />
      </div>
      <div className="dp-progresso-numeros">
        <span><b>Enviados:</b> {k.enviado}/{c.total}</span>
        <span><b>Na fila:</b> {k.pendente + k.enviando}</span>
        <span className={k.falha ? 'alerta' : ''}><b>Falhas:</b> {k.falha}</span>
        {k.pulado > 0 && <span><b>Pulados:</b> {k.pulado}</span>}
        <span className="suave">{c.total ? Math.round((feitos / c.total) * 100) : 0}%</span>
      </div>
    </div>
  );
}

function Fila() {
  const aviso = useAviso();
  const [campanhas, setCampanhas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const agora = useRelogio();

  const carregar = useCallback(async () => {
    try {
      const d = await api('/disparos/campanhas');
      setCampanhas(d.campanhas);
      setSelecionada((s) => s ?? (d.campanhas.find((c) => c.status === 'executando' && c.tipo !== 'yayforms') || d.campanhas[0])?.id ?? null);
    } catch (e) { aviso(e.message, 'erro'); } finally { setCarregando(false); }
  }, [aviso]);

  const carregarDetalhe = useCallback(async () => {
    if (!selecionada) { setDetalhe(null); return; }
    try {
      setDetalhe(await api(`/disparos/campanhas/${selecionada}${filtro ? `?status=${filtro}` : ''}`));
    } catch (e) { setDetalhe(null); }
  }, [selecionada, filtro]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarDetalhe(); }, [carregarDetalhe]);
  useEvento('disparos', () => { carregar(); carregarDetalhe(); });

  const acao = async (caminho, msg, metodo = 'POST') => {
    try {
      const r = await api(`/disparos/campanhas/${selecionada}${caminho}`, { method: metodo });
      aviso(typeof msg === 'function' ? msg(r) : msg);
      if (metodo === 'DELETE') setSelecionada(null);
      carregar();
      carregarDetalhe();
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const c = detalhe?.campanha;
  const ativas = campanhas.filter((x) => x.status === 'executando' || x.status === 'pausada');
  const antigas = campanhas.filter((x) => x.status !== 'executando' && x.status !== 'pausada');

  const ItemLista = ({ x }) => {
    const I = ICONE_TIPO[x.tipo] || Megaphone;
    const feitos = x.contagem.enviado + x.contagem.falha + x.contagem.pulado + x.contagem.cancelado;
    return (
      <button type="button" className={`dp-camp ${selecionada === x.id ? 'ativa' : ''}`} onClick={() => setSelecionada(x.id)}>
        <span className={`dp-camp-icone ${x.status}`}><I size={15} /></span>
        <span className="dp-camp-meio">
          <b>{x.nome}</b>
          <small>
            <span className={`led ${x.status === 'executando' ? 'led-verde' : x.status === 'pausada' ? 'led-ambar' : 'led-apagado'}`} /> {ROTULO_STATUS[x.status]}
            {' · '}{x.tipo === 'yayforms' ? `${x.contagem.enviado} enviados` : `${feitos}/${x.total}`}
            {x.contagem.falha ? <span className="alerta"> · {x.contagem.falha} falha(s)</span> : null}
          </small>
        </span>
      </button>
    );
  };

  if (carregando) return <div className="dp-centro"><div className="carregando" /></div>;
  if (!campanhas.length) return <Vazio icone={Activity} titulo="Nenhum disparo ainda">As campanhas e a saudação do Yay! Forms aparecem aqui, com o progresso em tempo real.</Vazio>;

  return (
    <div className="dp-monitor">
      <aside className="dp-monitor-lista">
        {ativas.length > 0 && <h4 className="titulo-secao">Em andamento</h4>}
        {ativas.map((x) => <ItemLista key={x.id} x={x} />)}
        {antigas.length > 0 && <h4 className="titulo-secao">Histórico</h4>}
        {antigas.map((x) => <ItemLista key={x.id} x={x} />)}
      </aside>

      <section className="dp-monitor-detalhe">
        {!c ? <div className="dp-centro"><div className="carregando" /></div> : (
          <>
            <div className="dp-monitor-topo">
              <div>
                <h2>{c.nome}</h2>
                <span className="suave pequeno">
                  {c.numero_nome ? `Número: ${c.numero_nome}` : 'Qualquer número conectado'} · criada {tempoDesde(c.created_at)}
                  {c.criado_por_nome ? ` por ${c.criado_por_nome}` : ''}{c.finished_at ? ` · terminou ${dataHora(c.finished_at)}` : ''}
                </span>
              </div>
              <div className="acoes">
                {c.status === 'executando' && <button className="btn btn-aviso-leve" onClick={() => acao('/pausar', 'Fila pausada')}><Pause size={14} /> Pausar fila</button>}
                {c.status === 'pausada' && <button className="btn btn-verde-leve" onClick={() => acao('/retomar', 'Fila retomada')}><Play size={14} /> Retomar fila</button>}
                {c.contagem.falha > 0 && <button className="btn" onClick={() => acao('/reenviar-falhas', (r) => `${r.reenviados} contato(s) de volta na fila`)}><RotateCcw size={14} /> Reenviar só falhas</button>}
                {c.tipo !== 'yayforms' && (c.status === 'executando' || c.status === 'pausada') && (
                  <button className="btn btn-perigo-leve" onClick={() => window.confirm('Cancelar este disparo? Os contatos que ainda estão na fila não vão receber.') && acao('/cancelar', 'Disparo cancelado')}><XCircle size={14} /> Cancelar disparo</button>
                )}
                {c.tipo !== 'yayforms' && (c.status === 'concluida' || c.status === 'cancelada') && (
                  <button className="btn btn-perigo-leve" onClick={() => window.confirm('Apagar esta campanha e o histórico dela?') && acao('', 'Campanha apagada', 'DELETE')}><Trash2 size={14} /> Apagar</button>
                )}
              </div>
            </div>

            {frasesAoVivo(c, agora) && (
              <div className={`dp-ao-vivo ${c.status} ${['desconectado', 'janela', 'sem_fluxo'].includes(c.ao_vivo?.fase) ? 'aviso' : ''}`}>
                <span className={`led ${c.status === 'executando' ? (c.ao_vivo?.fase === 'desconectado' || c.ao_vivo?.fase === 'janela' ? 'led-ambar' : 'led-verde') : 'led-ambar'}`} />
                {frasesAoVivo(c, agora)}
              </div>
            )}

            {c.tipo !== 'yayforms' && <Progresso c={c} />}
            {c.tipo === 'yayforms' && (
              <div className="dp-progresso-numeros">
                <span><b>Enviados:</b> {c.contagem.enviado}</span>
                <span><b>Agendados:</b> {c.contagem.pendente + c.contagem.enviando}</span>
                <span className={c.contagem.falha ? 'alerta' : ''}><b>Falhas:</b> {c.contagem.falha}</span>
                <span><b>Pulados:</b> {c.contagem.pulado}</span>
              </div>
            )}

            <div className="dp-fluxo-resumo">
              {c.blocos.map((b, i) => {
                const I = ICONES[b.tipo];
                return <span key={b.id || i} className="tag" title={b.texto}><I size={11} /> {i + 1}. {b.tipo === 'texto' ? (b.texto || '').slice(0, 26) || 'texto' : b.tipo}{b.espera?.segundos ? ` · ${b.espera.segundos}s` : ''}</span>;
              })}
              {c.tipo === 'campanha' && c.config?.intervalo && (
                <span className="tag"><Clock size={11} /> {c.config.intervalo.modo === 'fixo' ? `${c.config.intervalo.fixo}s entre contatos` : `${c.config.intervalo.min}–${c.config.intervalo.max}s entre contatos`}
                  {c.config.lote?.ativo ? ` · pausa ${c.config.lote.minutos} min a cada ${c.config.lote.contatos}` : ''}</span>
              )}
            </div>

            <div className="dp-log-topo">
              <h3>Log por contato</h3>
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(ROTULO_ITEM).map(([k, v]) => <option key={k} value={k}>{v}{c.contagem[k] ? ` (${c.contagem[k]})` : ''}</option>)}
              </select>
            </div>
            {detalhe.itens.length === 0 ? <p className="suave">Nada por aqui.</p> : (
              <div className="dp-tabela-rolagem">
                <table className="tabela dp-log">
                  <thead><tr><th>Contato</th><th>Status</th><th>Horário</th><th>Detalhe</th></tr></thead>
                  <tbody>
                    {detalhe.itens.map((it) => {
                      const I = ICONE_ITEM[it.status] || Clock;
                      return (
                        <tr key={it.id}>
                          <td><b>{it.nome || '—'}</b><br /><span className="suave pequeno">{it.phone === '-' ? 'sem telefone' : formatarTelefone(it.phone)}</span></td>
                          <td><span className={`dp-status dp-status-${it.status}`}><I size={13} className={it.status === "enviando" ? "dp-gira" : ""} /> {ROTULO_ITEM[it.status]}</span></td>
                          <td className="pequeno">{it.enviado_em ? dataHora(it.enviado_em) : it.agendado_para && it.status === 'pendente' ? `agendado ${dataHora(it.agendado_para)}` : it.iniciado_em ? dataHora(it.iniciado_em) : '—'}</td>
                          <td className="pequeno">{it.erro || (it.status === 'enviando' || (it.status === 'pendente' && it.bloco_atual) ? `${it.bloco_atual}/${c.blocos.length} blocos enviados` : '')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Modelos({ aoUsarModelo }) {
  const aviso = useAviso();
  const [modelos, setModelos] = useState(null);
  const carregar = useCallback(() => api('/disparos/modelos').then((d) => setModelos(d.modelos)).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  const apagar = async (m) => {
    if (!window.confirm(`Apagar o modelo “${m.nome}”?`)) return;
    try { await api(`/disparos/modelos/${m.id}`, { method: 'DELETE' }); aviso('Modelo apagado'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };
  if (!modelos) return <div className="dp-centro"><div className="carregando" /></div>;
  if (!modelos.length) return <Vazio icone={LayoutTemplate} titulo="Nenhum modelo salvo">No construtor de mensagens, use “Salvar fluxo como modelo” para guardar sequências prontas e carregar com 1 clique.</Vazio>;
  return (
    <div className="dp-modelos">
      {modelos.map((m) => (
        <div key={m.id} className="dp-modelo">
          <div className="dp-modelo-topo"><b>{m.nome}</b><span className="suave pequeno">{tempoDesde(m.updated_at)}</span></div>
          <div className="dp-fluxo-resumo">
            {m.blocos.map((b, i) => { const I = ICONES[b.tipo]; return <span key={i} className="tag"><I size={11} /> {b.tipo === 'texto' ? (b.texto || '').slice(0, 30) || 'texto' : b.tipo}</span>; })}
          </div>
          <div className="acoes">
            <button className="btn btn-pequeno btn-ouro" onClick={() => aoUsarModelo(m)}>Usar numa campanha</button>
            <button className="btn btn-pequeno btn-perigo-leve" onClick={() => apagar(m)}><Trash2 size={12} /> Apagar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Bloqueio() {
  const aviso = useAviso();
  const [lista, setLista] = useState(null);
  const [novo, setNovo] = useState({ telefone: '', motivo: '' });
  const [busca, setBusca] = useState('');
  const carregar = useCallback(() => api('/disparos/bloqueio').then((d) => setLista(d.bloqueados)).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  const adicionar = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/disparos/bloqueio', { method: 'POST', body: novo });
      aviso(`${formatarTelefone(r.telefone)} não recebe mais disparos`);
      setNovo({ telefone: '', motivo: '' });
      carregar();
    } catch (er) { aviso(er.message, 'erro'); }
  };
  const remover = async (t) => {
    try { await api(`/disparos/bloqueio/${t}`, { method: 'DELETE' }); aviso('Número liberado'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
  };
  const filtrada = useMemo(() => (lista || []).filter((b) => !busca || (b.nome || '').toLowerCase().includes(busca.toLowerCase()) || b.telefone.includes(busca.replace(/\D/g, '') || '¬')), [lista, busca]);
  return (
    <div className="dp-bloqueio">
      <p className="suave">Números desta lista são pulados automaticamente em qualquer disparo — campanhas e saudação do Yay! Forms —, mesmo que estejam numa lista de contatos.</p>
      <form className="dp-bloqueio-form" onSubmit={adicionar}>
        <input placeholder="Telefone com DDD" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} required />
        <input placeholder="Motivo (opcional) — ex.: pediu para não receber" value={novo.motivo} onChange={(e) => setNovo({ ...novo, motivo: e.target.value })} />
        <button className="btn btn-perigo-leve"><ShieldOff size={14} /> Bloquear</button>
      </form>
      {lista && lista.length > 6 && <input placeholder="Buscar na lista…" value={busca} onChange={(e) => setBusca(e.target.value)} />}
      {!lista ? <div className="dp-centro"><div className="carregando" /></div> : !lista.length ? <p className="suave">Nenhum número bloqueado.</p> : (
        <table className="tabela">
          <thead><tr><th>Número</th><th>Nome</th><th>Motivo</th><th>Desde</th><th /></tr></thead>
          <tbody>
            {filtrada.map((b) => (
              <tr key={b.telefone}>
                <td>{formatarTelefone(b.telefone)}</td>
                <td>{b.nome || '—'}</td>
                <td className="suave">{b.motivo || '—'}</td>
                <td className="pequeno">{dataHora(b.created_at)}{b.criado_por_nome ? ` · ${b.criado_por_nome}` : ''}</td>
                <td><div className="acoes-linha"><button className="btn btn-pequeno" onClick={() => remover(b.telefone)}>Liberar</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AbaMonitor({ aoUsarModelo }) {
  const [secao, setSecao] = useState('fila');
  return (
    <div className="dp-aba">
      <div className="dp-segmentos dp-segmentos-secao">
        <button type="button" className={secao === 'fila' ? 'ativo' : ''} onClick={() => setSecao('fila')}><ListChecks size={14} /> Fila e histórico</button>
        <button type="button" className={secao === 'modelos' ? 'ativo' : ''} onClick={() => setSecao('modelos')}><LayoutTemplate size={14} /> Modelos de fluxo</button>
        <button type="button" className={secao === 'bloqueio' ? 'ativo' : ''} onClick={() => setSecao('bloqueio')}><ShieldOff size={14} /> Não perturbe</button>
      </div>
      {secao === 'fila' && <Fila />}
      {secao === 'modelos' && <section className="cartao-secao"><Modelos aoUsarModelo={aoUsarModelo} /></section>}
      {secao === 'bloqueio' && <section className="cartao-secao"><h2>Lista de bloqueio</h2><Bloqueio /></section>}
    </div>
  );
}
