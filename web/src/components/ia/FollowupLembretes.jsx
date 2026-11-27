// IA → Follow-up e lembretes: o modo follow-up da Alice SDR (11 toques que entendem a conversa, quebram quando o lead
// responde e respeitam travas anti-ban) e os lembretes de reunião (3 dias, 24 h, 12 h, 3 h e 30 min antes), que só
// saem dentro do horário comercial.
//
// Layout: cada bloco é um cartão com título e ações à direita; listas de leads/reuniões são itens empilhados (nada de
// tabela espremida) com os botões numa linha própria que quebra no celular; a barra "Salvar alterações" fica presa no
// rodapé enquanto houver mudança não salva.
import { useCallback, useEffect, useState } from 'react';
import { Repeat, BellRing, Save, ExternalLink, FlaskConical, CircleX, RotateCcw, AlertTriangle, Clock } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde, formatarTelefone } from '../../utils.js';
import { useAviso, Interruptor } from '../disparos/comum.jsx';
import { useT } from '../../i18n/index.jsx';

const DIAS = [1, 2, 3, 4, 5, 6, 0];
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const soHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const rotuloModelo = (m) => `${m.nome} — ${m.nivel}${m.preco ? ` (${m.preco})` : ''}`;
// 24, 48 e 72 h aparecem em horas; o resto, em dias (como foi pedido: 24 h, 48 h, 72 h, 5 dias, 8 dias...)
const unidadeInicial = (h) => (h % 24 === 0 && h > 72 ? 'd' : 'h');
// Não deixa o clique no interruptor abrir/fechar o <details> do toque
const naoAbrir = (e) => e.preventDefault();

function DiasDaSemana({ dias, disabled, aoMudar, t }) {
  return (
    <div className="fu-dias" role="group">
      {DIAS.map((d) => {
        const marcado = dias.includes(d);
        return (
          <button key={d} type="button" disabled={disabled} aria-pressed={marcado} className={`fu-dia ${marcado ? 'ligado' : ''}`}
            onClick={() => aoMudar(marcado ? dias.filter((x) => x !== d) : [...dias, d])}>
            {t(`ia.followup.dia.${d}`)}
          </button>
        );
      })}
    </div>
  );
}

function Janela({ inicio, fim, disabled, aoMudar, t }) {
  return (
    <div className="fu-janela">
      <input type="time" disabled={disabled} value={inicio} onChange={(e) => aoMudar({ inicio: e.target.value, fim })} aria-label={t('ia.followup.travas.janela')} />
      <span className="suave">{t('ia.followup.travas.ate')}</span>
      <input type="time" disabled={disabled} value={fim} onChange={(e) => aoMudar({ inicio, fim: e.target.value })} aria-label={t('ia.followup.travas.janela')} />
    </div>
  );
}

// "seg–sex 07:00–18:00 · sáb 07:00–16:00 · dom sem atendimento"
function resumoHorario(horario, t) {
  if (!horario) return '';
  const grupos = [];
  for (const d of DIAS) {
    const f = horario[d];
    const faixa = f ? `${f.inicio}–${f.fim}` : null;
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.faixa === faixa) ultimo.dias.push(d);
    else grupos.push({ faixa, dias: [d] });
  }
  return grupos.map((g) => {
    const nomes = g.dias.length > 2 ? `${t(`ia.followup.dia.${g.dias[0]}`)}–${t(`ia.followup.dia.${g.dias.at(-1)}`)}` : g.dias.map((d) => t(`ia.followup.dia.${d}`)).join(', ');
    return `${nomes} ${g.faixa || t('ia.lembretes.horario.semAtendimento')}`;
  }).join(' · ');
}

export default function FollowupLembretes({ admin, aoAbrirConversa }) {
  const t = useT();
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [fu, setFu] = useState(null);
  const [lb, setLb] = useState(null);
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState(null);
  const [testando, setTestando] = useState(null);
  // Unidade (horas/dias) que cada toque mostra — só da tela, não muda o prazo salvo
  const [unidades, setUnidades] = useState({});

  const carregar = useCallback(async () => {
    try {
      const d = await api('/ia/followup');
      setDados(d);
      if (!alterado) {
        setFu(d.followup.config);
        setLb(d.lembretes.config);
      }
    } catch (e) { aviso(e.message, 'erro'); }
  }, [aviso, alterado]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('ia', (d) => { if (d?.followup || d?.lembretes) carregar(); });

  if (!dados || !fu || !lb) return <section className="cartao-secao"><div className="carregando" /></section>;

  const mudarFu = (campos) => { setFu({ ...fu, ...campos }); setAlterado(true); };
  const mudarToque = (i, campos) => mudarFu({ toques: fu.toques.map((x, j) => (j === i ? { ...x, ...campos } : x)) });
  const mudarLb = (campos) => { setLb({ ...lb, ...campos }); setAlterado(true); };
  const mudarMarco = (id, campos) => mudarLb({ marcos: { ...lb.marcos, [id]: { ...lb.marcos[id], ...campos } } });
  const descartar = () => { setAlterado(false); setFu(dados.followup.config); setLb(dados.lembretes.config); };

  const salvar = async ({ fuExtra = null, lbExtra = null } = {}) => {
    setSalvando(true);
    try {
      // Interruptor ligado/desligado sem outras mudanças: salva só ele (o resto como está no servidor)
      const body = (fuExtra || lbExtra) && !alterado
        ? { ...(fuExtra ? { followup: { ...dados.followup.config, ...fuExtra } } : {}), ...(lbExtra ? { lembretes: { ...dados.lembretes.config, ...lbExtra } } : {}) }
        : { followup: { ...fu, ...(fuExtra || {}) }, lembretes: { ...lb, ...(lbExtra || {}) } };
      const d = await api('/ia/followup/config', { method: 'PUT', body });
      setDados(d);
      setFu(d.followup.config);
      setLb(d.lembretes.config);
      setAlterado(false);
      aviso(t('ia.followup.salvo'));
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  const testar = async (leadId) => {
    setTestando(leadId);
    setTeste(null);
    try {
      setTeste({ leadId, ...(await api('/ia/followup/testar', { method: 'POST', body: { lead_id: leadId } })) });
    } catch (e) { aviso(e.message, 'erro'); } finally { setTestando(null); }
  };
  const tirar = async (leadId) => {
    try {
      await api(`/leads/${leadId}/followup`, { method: 'POST', body: { ativo: false } });
      if (teste?.leadId === leadId) setTeste(null);
      carregar();
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const pf = dados.followup;
  const pl = dados.lembretes;
  const st = pf.status;
  const desligadosToques = fu.toques.filter((x) => !x.ativo).length;

  return (
    <div className={`fu ${alterado && admin ? 'com-barra' : ''}`}>
      {/* ------------------------------------------------------------ follow-up */}
      <section className={`dp-mestre ${dados.followup.config.ativo ? 'ligada' : ''}`}>
        <div className="dp-mestre-icone"><Repeat size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>{t('ia.followup.titulo')}</h2>
          <p className="suave">{t('ia.followup.descricao')}</p>
          <p className="dp-mestre-status">
            {t('ia.followup.statusLinha', { ativos: st.ativos, hoje: st.enviados_hoje, max: dados.followup.config.max_por_dia })}
            {' · '}{t('ia.followup.ultimos30', { ...st.ultimos_30_dias })}
          </p>
          {st.trava && dados.followup.config.ativo && <p className="org-alerta"><AlertTriangle size={14} /> {t('ia.followup.travaAgora', { motivo: st.trava.motivo, ate: quando(new Date(st.trava.ate).toISOString()) })}</p>}
          {!pf.chave_configurada && <p className="org-alerta"><AlertTriangle size={14} /> {t('ia.followup.semChave')}</p>}
        </div>
        <div className="org-mestre-acoes">
          <Interruptor grande ligado={Boolean(dados.followup.config.ativo)} disabled={!admin || salvando} aoMudar={(ativo) => salvar({ fuExtra: { ativo } })} rotulo={dados.followup.config.ativo ? t('ia.followup.ligado') : t('ia.followup.desligado')} />
        </div>
      </section>

      <div className="fu-grade">
        <div className="fu-coluna fu-coluna-listas">
          {/* Leads na lista: primeiro, porque é o que se olha no dia a dia */}
          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.followup.lista.titulo', { n: pf.ativos.length })}</h2>
            {!pf.ativos.length ? <p className="suave pequeno">{t('ia.followup.lista.vazia')}</p> : (
              <ul className="fu-itens">
                {pf.ativos.map((f) => (
                  <li key={f.id} className="fu-item">
                    <div className="fu-item-topo">
                      <b className="fu-item-nome">{f.nome || formatarTelefone(f.phone)}</b>
                      <span className="fu-selo">{t('ia.followup.lista.toqueDe', { feitos: f.etapa, total: fu.toques.length })}</span>
                    </div>
                    <div className="fu-item-info suave pequeno">
                      <span>{f.etapa_kanban}</span>
                      <span><Clock size={12} /> {t('ia.followup.lista.proximoEm', { n: f.proximo_toque, quando: quando(f.proximo_em) })}</span>
                    </div>
                    {f.motivo && <div className="fu-item-motivo pequeno"><AlertTriangle size={12} /> {f.motivo}</div>}
                    {f.ultima_mensagem && <div className="fu-item-msg suave pequeno" title={f.ultima_mensagem}>“{f.ultima_mensagem}”</div>}
                    <div className="fu-item-acoes">
                      <button type="button" className="btn btn-pequeno" onClick={() => aoAbrirConversa?.(`l:${f.lead_id}`)}><ExternalLink size={13} /> {t('ia.followup.lista.abrirCurto')}</button>
                      {admin && (
                        <button type="button" className="btn btn-pequeno" disabled={Boolean(testando)} title={t('ia.followup.lista.testar')} onClick={() => testar(f.lead_id)}>
                          <FlaskConical size={13} /> {testando === f.lead_id ? t('ia.followup.lista.testando') : t('ia.followup.lista.testarCurto')}
                        </button>
                      )}
                      <button type="button" className="btn btn-pequeno fu-btn-tirar" onClick={() => tirar(f.lead_id)}><CircleX size={13} /> {t('ia.followup.lista.tirarCurto')}</button>
                    </div>
                    {teste?.leadId === f.lead_id && (
                      <div className="fu-teste">
                        <b>{t('ia.followup.teste.titulo', { toque: teste.toque, total: teste.total })}</b>
                        <span className="suave pequeno"> · {teste.origem === 'texto' ? t('ia.followup.teste.textoFixo') : teste.modelo}</span>
                        {teste.enviar ? teste.mensagens.map((m, i) => <p key={i}>{m}</p>) : <p>{t('ia.followup.teste.naoEnviaria', { motivo: teste.motivo || '—' })}</p>}
                        {teste.bloqueada && <p className="erro-salvar">{t('ia.followup.teste.bloqueada', { motivo: teste.bloqueada })}</p>}
                        <p className="suave pequeno">{t('ia.followup.teste.nada')}</p>
                        <button type="button" className="btn btn-pequeno" onClick={() => setTeste(null)}>{t('ia.followup.teste.fechar')}</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.followup.recentes.titulo')}</h2>
            {!pf.recentes.length ? <p className="suave pequeno">{t('ia.followup.recentes.vazio')}</p> : (
              <ul className="fu-itens fu-itens-compactos">
                {pf.recentes.map((f) => (
                  <li key={f.id} className="fu-item">
                    <div className="fu-item-topo">
                      <b className="fu-item-nome">{f.nome || formatarTelefone(f.phone)}</b>
                      <span className={`fu-selo fu-status-${f.status}`}>{t(`ia.followup.status.${f.status}`)}</span>
                    </div>
                    <div className="fu-item-info suave pequeno">
                      {f.motivo && <span>{f.motivo}</span>}
                      <span>{tempoDesde(f.encerrado_em)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="fu-coluna fu-coluna-config">
          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.followup.toques.titulo')}</h2>
            <p className="suave pequeno">{t('ia.followup.toques.explica')}{desligadosToques ? ` ${t('ia.followup.toques.desligados', { n: desligadosToques })}` : ''}</p>
            <div className="fu-toques">
              {fu.toques.map((x, i) => {
                const un = unidades[i] || unidadeInicial(x.horas);
                const valor = un === 'd' ? Math.round((x.horas / 24) * 10) / 10 : x.horas;
                return (
                  <details key={i} className={`fu-toque ${x.ativo ? '' : 'desligado'}`}>
                    <summary>
                      <span className="fu-numero">{i + 1}</span>
                      <b>{unidadeInicial(x.horas) === 'd' ? t('ia.followup.toques.dias', { n: x.horas / 24 }) : t('ia.followup.toques.horas', { n: x.horas })}</b>
                      <span className="fu-resumo suave">{x.texto ? t('ia.followup.toques.textoFixo') : x.instrucao}</span>
                      <span className="fu-toque-chave" onClick={naoAbrir} title={t('ia.followup.toques.ligar')}>
                        <Interruptor ligado={x.ativo} disabled={!admin} aoMudar={(ativo) => mudarToque(i, { ativo })} />
                      </span>
                    </summary>
                    <div className="fu-toque-corpo">
                      <div className="fu-campo">
                        <span className="fu-rotulo">{t('ia.followup.toques.prazo')}</span>
                        <div className="fu-linha">
                          <input type="number" className="fu-num" min="1" step="1" disabled={!admin} value={valor}
                            onChange={(e) => mudarToque(i, { horas: Math.max(1, Math.round((Number(e.target.value) || 1) * (un === 'd' ? 24 : 1))) })} />
                          <select disabled={!admin} value={un} onChange={(e) => setUnidades({ ...unidades, [i]: e.target.value })}>
                            <option value="h">{t('ia.followup.toques.unHoras')}</option>
                            <option value="d">{t('ia.followup.toques.unDias')}</option>
                          </select>
                          <span className="suave pequeno">{t('ia.followup.toques.contados')}</span>
                        </div>
                      </div>
                      <label className="fu-campo">
                        <span className="fu-rotulo">{t('ia.followup.toques.instrucao')}</span>
                        <textarea rows={2} disabled={!admin} maxLength={1000} value={x.instrucao} onChange={(e) => mudarToque(i, { instrucao: e.target.value })} />
                      </label>
                      <label className="fu-campo">
                        <span className="fu-rotulo">{t('ia.followup.toques.texto')}</span>
                        <textarea rows={3} disabled={!admin} maxLength={2000} value={x.texto} placeholder={t('ia.followup.toques.textoExemplo')} onChange={(e) => mudarToque(i, { texto: e.target.value })} />
                        <span className="suave pequeno">{t('ia.followup.toques.textoAjuda')}</span>
                      </label>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.followup.escrita.titulo')}</h2>
            <label className="fu-campo">
              <span className="fu-rotulo">{t('ia.followup.escrita.modelo')}</span>
              <select value={fu.modelo} disabled={!admin} onChange={(e) => mudarFu({ modelo: e.target.value })}>
                <option value="">{t('ia.followup.escrita.mesmoModelo', { nome: pf.modelos.find((m) => m.id === pf.modelo_atendimento)?.nome || pf.modelo_atendimento })}</option>
                {pf.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
              </select>
            </label>
            <label className="dp-check fu-check">
              <input type="checkbox" checked={fu.avisar_ao_responder} disabled={!admin} onChange={(e) => mudarFu({ avisar_ao_responder: e.target.checked })} />
              <span>{t('ia.followup.escrita.avisar')}</span>
            </label>
            <label className="fu-campo">
              <span className="fu-rotulo fu-rotulo-acao">
                {t('ia.followup.escrita.prompt')}
                {admin && (
                  <button type="button" className="btn btn-pequeno" onClick={(e) => { e.preventDefault(); mudarFu({ prompt: '' }); }} title={t('ia.followup.restaurarDica')}>
                    <RotateCcw size={12} /> {t('ia.followup.restaurarPrompt')}
                  </button>
                )}
              </span>
              <textarea rows={10} disabled={!admin} maxLength={6000} value={fu.prompt} onChange={(e) => mudarFu({ prompt: e.target.value })} />
            </label>
            <p className="suave pequeno">{t('ia.followup.escrita.contexto')}</p>
          </section>

          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.followup.travas.titulo')}</h2>
            <p className="suave pequeno">{t('ia.followup.travas.explica')}</p>
            <div className="fu-form">
              <div className="fu-campo fu-largo">
                <span className="fu-rotulo">{t('ia.followup.travas.janela')}</span>
                <Janela inicio={fu.janela_inicio} fim={fu.janela_fim} disabled={!admin} t={t} aoMudar={({ inicio, fim }) => mudarFu({ janela_inicio: inicio, janela_fim: fim })} />
                <span className="suave pequeno">{t('ia.followup.travas.fuso', { fuso: pf.fuso })}</span>
              </div>
              <div className="fu-campo fu-largo">
                <span className="fu-rotulo">{t('ia.followup.travas.dias')}</span>
                <DiasDaSemana dias={fu.dias} disabled={!admin} t={t} aoMudar={(dias) => mudarFu({ dias })} />
              </div>
              <label className="fu-campo">
                <span className="fu-rotulo">{t('ia.followup.travas.maxDia')}</span>
                <input type="number" min="1" max="1000" disabled={!admin} value={fu.max_por_dia} onChange={(e) => mudarFu({ max_por_dia: e.target.value })} />
              </label>
              <div className="fu-campo">
                <span className="fu-rotulo">{t('ia.followup.travas.intervalo')}</span>
                <div className="fu-linha">
                  <input type="number" className="fu-num" min="0" max="3600" disabled={!admin} value={fu.intervalo_min_seg} onChange={(e) => mudarFu({ intervalo_min_seg: e.target.value })} />
                  <span className="suave">{t('ia.followup.travas.a')}</span>
                  <input type="number" className="fu-num" min="0" max="3600" disabled={!admin} value={fu.intervalo_max_seg} onChange={(e) => mudarFu({ intervalo_max_seg: e.target.value })} />
                </div>
              </div>
              <label className="fu-campo">
                <span className="fu-rotulo">{t('ia.followup.travas.variacao')}</span>
                <input type="number" min="0" max="240" disabled={!admin} value={fu.variacao_min} onChange={(e) => mudarFu({ variacao_min: e.target.value })} />
              </label>
              <label className="fu-campo">
                <span className="fu-rotulo">{t('ia.followup.travas.minEntre')}</span>
                <input type="number" min="1" max="720" disabled={!admin} value={fu.min_horas_entre_toques} onChange={(e) => mudarFu({ min_horas_entre_toques: e.target.value })} />
              </label>
              <label className="fu-campo">
                <span className="fu-rotulo">{t('ia.followup.travas.aposEquipe')}</span>
                <input type="number" min="0" max="720" disabled={!admin} value={fu.espera_apos_equipe_horas} onChange={(e) => mudarFu({ espera_apos_equipe_horas: e.target.value })} />
              </label>
            </div>
          </section>
        </div>
      </div>

      {/* ------------------------------------------------------------ lembretes de reunião */}
      <section className={`dp-mestre ${dados.lembretes.config.ativo ? 'ligada' : ''}`}>
        <div className="dp-mestre-icone"><BellRing size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>{t('ia.lembretes.titulo')}</h2>
          <p className="suave">{t('ia.lembretes.descricao')}</p>
          <p className="dp-mestre-status">
            {t('ia.lembretes.horario.status', {
              horario: lb.horario === 'personalizado'
                ? resumoHorario(Object.fromEntries(DIAS.map((d) => [d, lb.dias.includes(d) ? { inicio: lb.janela_inicio, fim: lb.janela_fim } : null])), t)
                : resumoHorario(pl.horario_comercial, t),
            })}
          </p>
        </div>
        <div className="org-mestre-acoes">
          <Interruptor grande ligado={Boolean(dados.lembretes.config.ativo)} disabled={!admin || salvando} aoMudar={(ativo) => salvar({ lbExtra: { ativo } })} rotulo={dados.lembretes.config.ativo ? t('ia.followup.ligado') : t('ia.followup.desligado')} />
        </div>
      </section>

      <div className="fu-grade">
        <div className="fu-coluna fu-coluna-listas">
          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.lembretes.proximas', { n: pl.proximas.length })}</h2>
            {!pl.proximas.length ? <p className="suave pequeno">{t('ia.lembretes.semReunioes')}</p> : (
              <>
                <ul className="fu-itens">
                  {pl.proximas.map((r) => (
                    <li key={`${r.lead_id}-${r.inicio}`} className="fu-item">
                      <div className="fu-item-topo">
                        <b className="fu-item-nome">{r.nome}</b>
                        <button type="button" className="btn btn-pequeno" title={t('ia.followup.lista.abrir')} onClick={() => aoAbrirConversa?.(`l:${r.lead_id}`)}><ExternalLink size={13} /></button>
                      </div>
                      <div className="fu-item-info suave pequeno"><span>{t('ia.lembretes.reuniaoEm', { quando: quando(r.inicio) })}</span></div>
                      <div className="fu-marcos">
                        {r.marcos.map((m) => (
                          <span key={m.id} className={`fu-marco ${m.status}`} title={`${t(`ia.lembretes.marco.${m.id}`)} · ${t(`ia.lembretes.marcoStatus.${m.status}`)} · ${quando(m.em)}${m.ajustado ? ` · ${t('ia.lembretes.ajustado')}` : ''}`}>
                            <b>{m.id}</b>
                            {m.status === 'fora_horario' ? <span>{t('ia.lembretes.foraHorarioCurto')}</span> : <span>{soHora(m.em)}{m.ajustado ? ' *' : ''}</span>}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="suave pequeno">{t('ia.lembretes.legenda')}</p>
              </>
            )}
          </section>
          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.lembretes.enviados')}</h2>
            {!pl.enviados.length ? <p className="suave pequeno">{t('ia.lembretes.nenhumEnviado')}</p> : (
              <ul className="fu-itens fu-itens-compactos">
                {pl.enviados.map((e, i) => (
                  <li key={i} className="fu-item">
                    <div className="fu-item-topo">
                      <b className="fu-item-nome">{e.nome || '—'}</b>
                      <span className={`fu-marco ${e.status}`}><b>{e.marco}</b></span>
                    </div>
                    <div className="fu-item-msg suave pequeno" title={e.texto || e.detalhe || ''}>{e.texto || e.detalhe}</div>
                    <div className="suave pequeno">{tempoDesde(e.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="fu-coluna fu-coluna-config">
          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.lembretes.horario.titulo')}</h2>
            <p className="suave pequeno">{t('ia.lembretes.horario.explica')}</p>
            <div className="fu-opcoes" role="radiogroup">
              <label className={`fu-opcao dp-check ${lb.horario !== 'personalizado' ? 'ativa' : ''}`}>
                <input type="radio" name="lb-horario" disabled={!admin} checked={lb.horario !== 'personalizado'} onChange={() => mudarLb({ horario: 'comercial' })} />
                <span><b>{t('ia.lembretes.horario.comercial')}</b><small className="suave">{resumoHorario(pl.horario_comercial, t)}</small></span>
              </label>
              <label className={`fu-opcao dp-check ${lb.horario === 'personalizado' ? 'ativa' : ''}`}>
                <input type="radio" name="lb-horario" disabled={!admin} checked={lb.horario === 'personalizado'} onChange={() => mudarLb({ horario: 'personalizado' })} />
                <span><b>{t('ia.lembretes.horario.personalizado')}</b><small className="suave">{t('ia.lembretes.horario.personalizadoDica')}</small></span>
              </label>
            </div>
            {lb.horario === 'personalizado' && (
              <div className="fu-form">
                <div className="fu-campo fu-largo">
                  <span className="fu-rotulo">{t('ia.lembretes.horario.janela')}</span>
                  <Janela inicio={lb.janela_inicio} fim={lb.janela_fim} disabled={!admin} t={t} aoMudar={({ inicio, fim }) => mudarLb({ janela_inicio: inicio, janela_fim: fim })} />
                </div>
                <div className="fu-campo fu-largo">
                  <span className="fu-rotulo">{t('ia.followup.travas.dias')}</span>
                  <DiasDaSemana dias={lb.dias} disabled={!admin} t={t} aoMudar={(dias) => mudarLb({ dias })} />
                </div>
              </div>
            )}
            <p className="suave pequeno">{t('ia.lembretes.horario.ajuste')}</p>
          </section>

          <section className="cartao-secao">
            <h2 className="fu-titulo">{t('ia.lembretes.textos')}</h2>
            <p className="suave pequeno fu-variaveis">
              {t('ia.lembretes.variaveis')}{' '}
              {['{nome}', '{quando}', '{dia}', '{data}', '{hora}', '{link}', '{evento}', '{atendente}', '{empresa}'].map((v) => <code key={v}>{v}</code>)}
            </p>
            <p className="suave pequeno">{t('ia.lembretes.versoes')}</p>
            <div className="fu-toques">
              {pl.marcos.map((m) => (
                <details key={m.id} className={`fu-toque ${lb.marcos[m.id].ativo ? '' : 'desligado'}`}>
                  <summary>
                    <span className="fu-numero"><BellRing size={13} /></span>
                    <b>{t(`ia.lembretes.marco.${m.id}`)}</b>
                    <span className="fu-resumo suave">{lb.marcos[m.id].texto.split('\n')[0]}</span>
                    <span className="fu-toque-chave" onClick={naoAbrir} title={t('ia.lembretes.ligar')}>
                      <Interruptor ligado={lb.marcos[m.id].ativo} disabled={!admin} aoMudar={(ativo) => mudarMarco(m.id, { ativo })} />
                    </span>
                  </summary>
                  <div className="fu-toque-corpo">
                    <textarea rows={5} disabled={!admin} maxLength={3000} value={lb.marcos[m.id].texto} onChange={(e) => mudarMarco(m.id, { texto: e.target.value })} />
                    <span className="suave pequeno">{t('ia.lembretes.tolerancia', { min: m.tolerancia })}</span>
                  </div>
                </details>
              ))}
            </div>
            <p className="suave pequeno">{t('ia.lembretes.regras')}</p>
          </section>
        </div>
      </div>

      {alterado && admin && (
        <div className="fu-barra-salvar" role="region" aria-live="polite">
          <span>{t('ia.followup.alteracoes')}</span>
          <div className="fu-barra-acoes">
            <button type="button" className="btn btn-pequeno" disabled={salvando} onClick={descartar}>{t('ia.followup.descartar')}</button>
            <button type="button" className="btn btn-ouro btn-pequeno" disabled={salvando} onClick={() => salvar()}><Save size={13} /> {salvando ? t('ia.followup.salvando') : t('ia.followup.salvarTudo')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
