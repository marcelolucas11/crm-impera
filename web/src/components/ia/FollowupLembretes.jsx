// IA → Follow-up e lembretes: o modo follow-up da Alice SDR (11 toques que entendem a conversa, quebram quando o lead
// responde e respeitam travas anti-ban) e os lembretes de reunião (3 dias, 24 h, 12 h, 3 h e 30 min antes).
import { useCallback, useEffect, useState } from 'react';
import { Repeat, BellRing, Save, ExternalLink, FlaskConical, CircleX, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde, formatarTelefone } from '../../utils.js';
import { useAviso, Interruptor } from '../disparos/comum.jsx';
import { useT } from '../../i18n/index.jsx';

const DIAS = [1, 2, 3, 4, 5, 6, 0];
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const rotuloModelo = (m) => `${m.nome} — ${m.nivel}${m.preco ? ` (${m.preco})` : ''}`;
// 24, 48 e 72 h aparecem em horas; o resto, em dias (como foi pedido: 24 h, 48 h, 72 h, 5 dias, 8 dias...)
const emDias = (h) => h % 24 === 0 && h > 72;

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
  const mudarMarco = (id, campos) => { setLb({ ...lb, marcos: { ...lb.marcos, [id]: { ...lb.marcos[id], ...campos } } }); setAlterado(true); };

  const salvar = async ({ fuExtra = null, lbExtra = null } = {}) => {
    setSalvando(true);
    try {
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
      carregar();
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const pf = dados.followup;
  const pl = dados.lembretes;
  const st = pf.status;
  const desligadosToques = fu.toques.filter((x) => !x.ativo).length;

  return (
    <div className="fu">
      {/* ------------------------------------------------------------ follow-up */}
      <section className={`dp-mestre ${fu.ativo ? 'ligada' : ''}`}>
        <div className="dp-mestre-icone"><Repeat size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>{t('ia.followup.titulo')}</h2>
          <p className="suave">{t('ia.followup.descricao')}</p>
          <p className="dp-mestre-status">
            {t('ia.followup.statusLinha', { ativos: st.ativos, hoje: st.enviados_hoje, max: fu.max_por_dia })}
            {' · '}{t('ia.followup.ultimos30', { ...st.ultimos_30_dias })}
          </p>
          {st.trava && fu.ativo && <p className="org-alerta"><AlertTriangle size={14} /> {t('ia.followup.travaAgora', { motivo: st.trava.motivo, ate: quando(new Date(st.trava.ate).toISOString()) })}</p>}
          {!pf.chave_configurada && <p className="org-alerta"><AlertTriangle size={14} /> {t('ia.followup.semChave')}</p>}
        </div>
        <div className="org-mestre-acoes">
          <Interruptor grande ligado={Boolean(dados.followup.config.ativo)} disabled={!admin || salvando} aoMudar={(ativo) => salvar({ fuExtra: { ativo } })} rotulo={dados.followup.config.ativo ? t('ia.followup.ligado') : t('ia.followup.desligado')} />
        </div>
      </section>

      {alterado && admin && (
        <div className="dp-dica-admin fu-salvar">
          {t('ia.followup.alteracoes')}
          {' '}<button type="button" className="btn btn-ouro btn-pequeno" disabled={salvando} onClick={() => salvar()}><Save size={13} /> {salvando ? t('ia.followup.salvando') : t('ia.followup.salvar')}</button>
          {' '}<button type="button" className="btn btn-pequeno" disabled={salvando} onClick={() => { setAlterado(false); setFu(dados.followup.config); setLb(dados.lembretes.config); }}>{t('ia.followup.descartar')}</button>
        </div>
      )}

      <div className="fu-grade">
        <div className="dp-coluna-principal">
          <section className="cartao-secao">
            <h2>{t('ia.followup.toques.titulo')}</h2>
            <p className="suave pequeno">{t('ia.followup.toques.explica')}{desligadosToques ? ` ${t('ia.followup.toques.desligados', { n: desligadosToques })}` : ''}</p>
            <div className="fu-toques">
              {fu.toques.map((x, i) => {
                const dias = emDias(x.horas);
                return (
                  <details key={i} className={`fu-toque ${x.ativo ? '' : 'desligado'}`}>
                    <summary>
                      <span className="fu-numero">{i + 1}</span>
                      <b>{dias ? t('ia.followup.toques.dias', { n: x.horas / 24 }) : t('ia.followup.toques.horas', { n: x.horas })}</b>
                      <span className="fu-resumo suave">{x.texto ? t('ia.followup.toques.textoFixo') : x.instrucao}</span>
                      <input type="checkbox" checked={x.ativo} disabled={!admin} title={t('ia.followup.toques.ligar')}
                        onClick={(e) => e.stopPropagation()} onChange={(e) => mudarToque(i, { ativo: e.target.checked })} />
                    </summary>
                    <div className="fu-toque-corpo">
                      <label>{t('ia.followup.toques.prazo')}
                        <span className="fu-prazo">
                          <input type="number" min="1" disabled={!admin} value={dias ? x.horas / 24 : x.horas}
                            onChange={(e) => mudarToque(i, { horas: Math.max(1, Math.round(Number(e.target.value) || 1)) * (dias ? 24 : 1) })} />
                          <select disabled={!admin} value={dias ? 'd' : 'h'} onChange={(e) => mudarToque(i, { horas: e.target.value === 'd' ? Math.max(4, Math.round(x.horas / 24)) * 24 : x.horas })}>
                            <option value="h">{t('ia.followup.toques.unHoras')}</option>
                            <option value="d">{t('ia.followup.toques.unDias')}</option>
                          </select>
                          <span className="suave pequeno">{t('ia.followup.toques.contados')}</span>
                        </span>
                      </label>
                      <label>{t('ia.followup.toques.instrucao')}
                        <textarea rows={2} disabled={!admin} maxLength={1000} value={x.instrucao} onChange={(e) => mudarToque(i, { instrucao: e.target.value })} />
                      </label>
                      <label>{t('ia.followup.toques.texto')}
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
            <h2>{t('ia.followup.escrita.titulo')}</h2>
            <div className="fu-campos">
              <label>{t('ia.followup.escrita.modelo')}
                <select value={fu.modelo} disabled={!admin} onChange={(e) => mudarFu({ modelo: e.target.value })}>
                  <option value="">{t('ia.followup.escrita.mesmoModelo', { nome: pf.modelos.find((m) => m.id === pf.modelo_atendimento)?.nome || pf.modelo_atendimento })}</option>
                  {pf.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
                </select>
              </label>
            </div>
            <label className="fu-check">
              <input type="checkbox" checked={fu.avisar_ao_responder} disabled={!admin} onChange={(e) => mudarFu({ avisar_ao_responder: e.target.checked })} />
              {t('ia.followup.escrita.avisar')}
            </label>
            <label className="fu-prompt">{t('ia.followup.escrita.prompt')}
              <textarea rows={10} disabled={!admin} maxLength={6000} value={fu.prompt} onChange={(e) => mudarFu({ prompt: e.target.value })} />
            </label>
            <p className="suave pequeno">{t('ia.followup.escrita.contexto')}</p>
            {admin && (
              <button type="button" className="btn btn-pequeno fu-restaurar" onClick={() => mudarFu({ prompt: '' })} title={t('ia.followup.restaurarDica')}>
                <RotateCcw size={12} /> {t('ia.followup.restaurarPrompt')}
              </button>
            )}
          </section>

          <section className="cartao-secao">
            <h2>{t('ia.followup.travas.titulo')}</h2>
            <p className="suave pequeno">{t('ia.followup.travas.explica')}</p>
            <div className="fu-campos">
              <label>{t('ia.followup.travas.janela')}
                <span className="fu-prazo">
                  <input type="time" disabled={!admin} value={fu.janela_inicio} onChange={(e) => mudarFu({ janela_inicio: e.target.value })} />
                  <span>{t('ia.followup.travas.ate')}</span>
                  <input type="time" disabled={!admin} value={fu.janela_fim} onChange={(e) => mudarFu({ janela_fim: e.target.value })} />
                </span>
                <span className="suave pequeno">{t('ia.followup.travas.fuso', { fuso: pf.fuso })}</span>
              </label>
              <label>{t('ia.followup.travas.dias')}
                <span className="fu-dias">
                  {DIAS.map((d) => (
                    <label key={d} className="com-icone">
                      <input type="checkbox" disabled={!admin} checked={fu.dias.includes(d)}
                        onChange={(e) => mudarFu({ dias: e.target.checked ? [...fu.dias, d] : fu.dias.filter((x) => x !== d) })} />
                      {t(`ia.followup.dia.${d}`)}
                    </label>
                  ))}
                </span>
              </label>
              <label>{t('ia.followup.travas.maxDia')}
                <input type="number" min="1" max="1000" disabled={!admin} value={fu.max_por_dia} onChange={(e) => mudarFu({ max_por_dia: e.target.value })} />
              </label>
              <label>{t('ia.followup.travas.intervalo')}
                <span className="fu-prazo">
                  <input type="number" min="0" max="3600" disabled={!admin} value={fu.intervalo_min_seg} onChange={(e) => mudarFu({ intervalo_min_seg: e.target.value })} />
                  <span>{t('ia.followup.travas.a')}</span>
                  <input type="number" min="0" max="3600" disabled={!admin} value={fu.intervalo_max_seg} onChange={(e) => mudarFu({ intervalo_max_seg: e.target.value })} />
                </span>
              </label>
              <label>{t('ia.followup.travas.variacao')}
                <input type="number" min="0" max="240" disabled={!admin} value={fu.variacao_min} onChange={(e) => mudarFu({ variacao_min: e.target.value })} />
              </label>
              <label>{t('ia.followup.travas.minEntre')}
                <input type="number" min="1" max="720" disabled={!admin} value={fu.min_horas_entre_toques} onChange={(e) => mudarFu({ min_horas_entre_toques: e.target.value })} />
              </label>
              <label>{t('ia.followup.travas.aposEquipe')}
                <input type="number" min="0" max="720" disabled={!admin} value={fu.espera_apos_equipe_horas} onChange={(e) => mudarFu({ espera_apos_equipe_horas: e.target.value })} />
              </label>
            </div>
          </section>
        </div>

        <div>
          <section className="cartao-secao">
            <h2>{t('ia.followup.lista.titulo', { n: pf.ativos.length })}</h2>
            {!pf.ativos.length ? <p className="suave pequeno">{t('ia.followup.lista.vazia')}</p> : (
              <table className="fu-lista">
                <thead><tr><th>{t('ia.followup.lista.lead')}</th><th>{t('ia.followup.lista.toque')}</th><th>{t('ia.followup.lista.proximo')}</th><th /></tr></thead>
                <tbody>
                  {pf.ativos.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <b>{f.nome || formatarTelefone(f.phone)}</b>
                        <div className="suave pequeno">{f.etapa_kanban}</div>
                        {f.ultima_mensagem && <div className="suave pequeno fu-msg" title={f.ultima_mensagem}>“{f.ultima_mensagem}”</div>}
                      </td>
                      <td>{f.etapa}/{fu.toques.length}</td>
                      <td>
                        {quando(f.proximo_em)}
                        {f.motivo && <div className="suave pequeno">{f.motivo}</div>}
                      </td>
                      <td className="acoes-linha">
                        <button type="button" className="btn btn-pequeno" title={t('ia.followup.lista.abrir')} onClick={() => aoAbrirConversa?.(`l:${f.lead_id}`)}><ExternalLink size={13} /></button>
                        {admin && <button type="button" className="btn btn-pequeno" disabled={testando === f.lead_id} title={t('ia.followup.lista.testar')} onClick={() => testar(f.lead_id)}><FlaskConical size={13} /></button>}
                        <button type="button" className="btn btn-pequeno" title={t('ia.followup.lista.tirar')} onClick={() => tirar(f.lead_id)}><CircleX size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {testando && <p className="suave pequeno">{t('ia.followup.teste.escrevendo')}</p>}
            {teste && (
              <div className="fu-teste">
                <b>{t('ia.followup.teste.titulo', { toque: teste.toque, total: teste.total })}</b>
                <span className="suave pequeno"> · {teste.origem === 'texto' ? t('ia.followup.teste.textoFixo') : teste.modelo}</span>
                {teste.enviar ? teste.mensagens.map((m, i) => <p key={i}>{m}</p>) : <p>{t('ia.followup.teste.naoEnviaria', { motivo: teste.motivo || '—' })}</p>}
                {teste.bloqueada && <p className="erro-salvar">{t('ia.followup.teste.bloqueada', { motivo: teste.bloqueada })}</p>}
                <p className="suave pequeno">{t('ia.followup.teste.nada')}</p>
              </div>
            )}
          </section>

          <section className="cartao-secao">
            <h2>{t('ia.followup.recentes.titulo')}</h2>
            {!pf.recentes.length ? <p className="suave pequeno">{t('ia.followup.recentes.vazio')}</p> : (
              <table className="fu-lista">
                <tbody>
                  {pf.recentes.map((f) => (
                    <tr key={f.id}>
                      <td><b>{f.nome || formatarTelefone(f.phone)}</b><div className="suave pequeno">{f.motivo}</div></td>
                      <td>{t(`ia.followup.status.${f.status}`)}</td>
                      <td className="suave pequeno">{tempoDesde(f.encerrado_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      {/* ------------------------------------------------------------ lembretes de reunião */}
      <section className={`dp-mestre ${dados.lembretes.config.ativo ? 'ligada' : ''}`}>
        <div className="dp-mestre-icone"><BellRing size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>{t('ia.lembretes.titulo')}</h2>
          <p className="suave">{t('ia.lembretes.descricao')}</p>
        </div>
        <div className="org-mestre-acoes">
          <Interruptor grande ligado={Boolean(dados.lembretes.config.ativo)} disabled={!admin || salvando} aoMudar={(ativo) => salvar({ lbExtra: { ativo } })} rotulo={dados.lembretes.config.ativo ? t('ia.followup.ligado') : t('ia.followup.desligado')} />
        </div>
      </section>

      <div className="fu-grade">
        <section className="cartao-secao">
          <h2>{t('ia.lembretes.textos')}</h2>
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
                  <input type="checkbox" checked={lb.marcos[m.id].ativo} disabled={!admin} onClick={(e) => e.stopPropagation()} onChange={(e) => mudarMarco(m.id, { ativo: e.target.checked })} />
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

        <div>
          <section className="cartao-secao">
            <h2>{t('ia.lembretes.proximas', { n: pl.proximas.length })}</h2>
            {!pl.proximas.length ? <p className="suave pequeno">{t('ia.lembretes.semReunioes')}</p> : (
              <table className="fu-lista">
                <tbody>
                  {pl.proximas.map((r) => (
                    <tr key={`${r.lead_id}-${r.inicio}`}>
                      <td>
                        <b>{r.nome}</b><div className="suave pequeno">{quando(r.inicio)}</div>
                      </td>
                      <td>
                        <span className="fu-marcos">
                          {r.marcos.map((m) => <span key={m.id} className={`fu-marco ${m.status}`} title={`${t(`ia.lembretes.marcoStatus.${m.status}`)} · ${quando(m.em)}`}>{m.id}</span>)}
                        </span>
                      </td>
                      <td><button type="button" className="btn btn-pequeno" onClick={() => aoAbrirConversa?.(`l:${r.lead_id}`)}><ExternalLink size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="cartao-secao">
            <h2>{t('ia.lembretes.enviados')}</h2>
            {!pl.enviados.length ? <p className="suave pequeno">{t('ia.lembretes.nenhumEnviado')}</p> : (
              <table className="fu-lista">
                <tbody>
                  {pl.enviados.map((e, i) => (
                    <tr key={i}>
                      <td><b>{e.nome || '—'}</b> <span className={`fu-marco ${e.status}`}>{e.marco}</span><div className="suave pequeno fu-msg" title={e.texto || e.detalhe || ''}>{e.texto || e.detalhe}</div></td>
                      <td className="suave pequeno">{tempoDesde(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
