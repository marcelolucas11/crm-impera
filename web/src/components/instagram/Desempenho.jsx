// Desempenho do Instagram: visão geral (indicadores, séries diárias, funil post → Direct → lead → fechado),
// publicações, anúncios ligados aos perfis e público/horários. Tudo vem do que o CRM guardou (coleta a cada 24 h).
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarRange, LayoutDashboard, Images, Megaphone, Users, Info } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { dataHora } from '../../utils.js';
import { isoDia } from '../estatisticas/util.js';
import { useAviso } from '../disparos/comum.jsx';
import { Linha, Colunas, BarrasH, TabelaDados, diaCurto, diaLongo } from './Graficos.jsx';
import { numero, compacto, reais, Miniatura, paramsDoPeriodo } from './comum.jsx';

import Publicacoes, { DetalhePost } from './Publicacoes.jsx';
import Anuncios from './Anuncios.jsx';

const DIAS = [7, 30, 90, 180, 365];
const VISOES = [['geral', LayoutDashboard], ['publicacoes', Images], ['anuncios', Megaphone], ['publico', Users]];
const ler = (k, p) => { try { return JSON.parse(localStorage.getItem(k)) ?? p; } catch { return p; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
const pctTexto = (v) => (v === null || v === undefined ? '—' : `${numero(v, 1)}%`);
const variacaoLocal = (a, b) => (a === null || b === null || b === undefined || !b ? null : Math.round(((a - b) / b) * 1000) / 10);

export function PeriodoIg({ valor, onChange }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const hoje = isoDia(new Date());
  const [de, setDe] = useState(valor.de || isoDia(new Date(Date.now() - 29 * 86400000)));
  const [ate, setAte] = useState(valor.ate || hoje);
  const caixa = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const personalizado = valor.tipo === 'personalizado';
  return (
    <div className="seletor-periodo" role="group" aria-label={t('instagram.periodo.rotulo')}>
      {DIAS.map((n) => (
        <button key={n} type="button" className={`chip ${!personalizado && valor.dias === n ? 'ativo' : ''}`} onClick={() => onChange({ tipo: 'dias', dias: n })}>
          {t('instagram.periodo.dias', { n })}
        </button>
      ))}
      <div className="periodo-personalizado" ref={caixa}>
        <button type="button" className={`chip ${personalizado ? 'ativo' : ''}`} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          <CalendarRange size={15} /> {personalizado ? `${diaCurto(valor.de)} – ${diaCurto(valor.ate)}` : t('instagram.periodo.personalizado')}
        </button>
        {aberto && (
          <div className="periodo-pop">
            <label><span>{t('instagram.periodo.de')}</span><input type="date" value={de} max={ate || hoje} onChange={(e) => setDe(e.target.value)} /></label>
            <label><span>{t('instagram.periodo.ate')}</span><input type="date" value={ate} min={de} max={hoje} onChange={(e) => setAte(e.target.value)} /></label>
            <button type="button" className="btn btn-ouro" disabled={!de || !ate || de > ate} onClick={() => { onChange({ tipo: 'personalizado', de, ate }); setAberto(false); }}>
              {t('instagram.periodo.aplicar')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Indicador({ rotulo, valor, detalhe, variacao, bomQuandoSobe = true, destaque = false, dica }) {
  let delta = null;
  if (variacao !== null && variacao !== undefined) {
    const sobe = variacao > 0;
    const bom = variacao === 0 || bomQuandoSobe === null ? null : sobe === bomQuandoSobe;
    delta = <span className={`delta ${bom === null ? '' : bom ? 'bom' : 'ruim'}`}>{variacao === 0 ? '＝' : sobe ? '▲' : '▼'} {numero(Math.abs(variacao), 1)}%</span>;
  }
  return (
    <div className={`indicador ${destaque ? 'destaque' : ''}`} title={dica || undefined}>
      <span className="indicador-rotulo">{rotulo}</span>
      <span className="indicador-valor">{valor}</span>
      <span className="indicador-detalhe">{delta}{delta && detalhe ? ' ' : ''}{detalhe}</span>
    </div>
  );
}

function Secao({ titulo, sub, children, largo = false, acoes = null }) {
  return (
    <section className={`cartao-secao grafico ${largo ? 'grafico-largo' : ''}`}>
      <div className="cabecalho-cartao">
        <div><h2>{titulo}</h2>{sub && <p className="suave pequeno">{sub}</p>}</div>
        {acoes}
      </div>
      {children}
    </section>
  );
}

function VisaoGeral({ d, t, onAbrirPost, multiplos }) {
  const a = d.atual;
  const b = d.antes;
  const v = d.variacoes;
  const leads = a.direct.leads + a.leads_formulario;
  const leadsAntes = b.direct.leads + b.leads_formulario;
  const dias = d.serie.map((x) => x.dia);
  const temGasto = a.anuncios.gasto > 0 || d.serie.some((x) => x.gasto);
  const funil = d.funil.map((f, i) => {
    const anterior = d.funil[i - 1]?.valor;
    return {
      chave: f.etapa, rotulo: t(`instagram.funil.${f.etapa}`), valor: f.valor ?? 0,
      detalhe: i > 0 && anterior ? t('instagram.funil.taxa', { p: numero(((f.valor || 0) / anterior) * 100, ((f.valor || 0) / anterior) * 100 < 1 ? 2 : 1) }) : null,
    };
  });
  const porFormato = d.por_formato.map((f) => ({
    chave: f.formato, rotulo: t(`instagram.formato.${f.formato}`), valor: f.media_visualizacoes,
    detalhe: `${t('instagram.desempenho.publicacoesN', { n: f.publicacoes })}${f.engajamento !== null ? ` · ${pctTexto(f.engajamento)}` : ''}`,
  }));

  return (
    <>
      <div className="indicadores">
        <Indicador destaque rotulo={t('instagram.kpi.seguidores')} valor={compacto(a.seguidores)} variacao={v.seguidores}
          detalhe={a.ganho_seguidores !== null ? t('instagram.kpi.ganho', { n: `${a.ganho_seguidores >= 0 ? '+' : ''}${numero(a.ganho_seguidores)}` }) : null} />
        <Indicador rotulo={t('instagram.kpi.visualizacoes')} valor={compacto(a.visualizacoes)} variacao={v.visualizacoes} detalhe={t('instagram.kpi.vsAnterior', { n: compacto(b.visualizacoes) })} />
        <Indicador rotulo={t('instagram.kpi.alcance')} valor={compacto(a.alcance)} variacao={v.alcance} dica={t('instagram.kpi.alcanceDica')} detalhe={t('instagram.kpi.vsAnterior', { n: compacto(b.alcance) })} />
        <Indicador rotulo={t('instagram.kpi.interacoes')} valor={compacto(a.interacoes)} variacao={v.interacoes}
          detalhe={t('instagram.kpi.interacoesDetalhe', { curtidas: compacto(a.curtidas), comentarios: compacto(a.comentarios), salvamentos: compacto(a.salvamentos), compartilhamentos: compacto(a.compartilhamentos) })} />
        <Indicador rotulo={t('instagram.kpi.engajamento')} valor={pctTexto(a.engajamento_alcance)} variacao={v.engajamento_alcance} dica={t('instagram.kpi.engajamentoDica')} />
        <Indicador rotulo={t('instagram.kpi.conversas')} valor={numero(a.direct.conversas_novas)} variacao={v.conversas_novas}
          detalhe={t('instagram.kpi.conversasDetalhe', { n: numero(a.direct.conversas_de_anuncio) })} />
        <Indicador rotulo={t('instagram.kpi.leads')} valor={numero(leads)} variacao={variacaoLocal(leads, leadsAntes)}
          detalhe={t('instagram.kpi.leadsDetalhe', { direct: numero(a.direct.leads), form: numero(a.leads_formulario) })} />
        <Indicador rotulo={t('instagram.kpi.gasto')} valor={reais(a.anuncios.gasto)} variacao={v.gasto} bomQuandoSobe={null}
          detalhe={a.anuncios.custo_por_conversa !== null ? t('instagram.kpi.custoConversa', { valor: reais(a.anuncios.custo_por_conversa) }) : t('instagram.kpi.semAnuncios')} />
      </div>

      {a.dias_com_dados < d.periodo.dias && (
        <p className="ig-nota"><Info size={14} /> {t('instagram.desempenho.diasSemDados', { com: a.dias_com_dados, total: d.periodo.dias })}</p>
      )}

      <div className="graficos">
        <Secao titulo={t('instagram.grafico.seguidores')} sub={t('instagram.grafico.seguidoresSub')} largo>
          <Linha dias={dias} rotulo={t('instagram.grafico.seguidores')} series={[{ chave: 's', nome: t('instagram.kpi.seguidores'), cor: 'var(--serie-1)', valores: d.serie.map((x) => x.seguidores) }]} />
          <TabelaDados colunas={[
            { chave: 'dia', rotulo: t('instagram.tabela.dia'), formatar: diaLongo },
            { chave: 'seguidores', rotulo: t('instagram.kpi.seguidores'), num: true, formatar: numero },
            { chave: 'novos_seguidores', rotulo: t('instagram.tabela.saldo'), num: true, formatar: (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${numero(x)}`) },
          ]} linhas={d.serie} />
        </Secao>

        <Secao titulo={t('instagram.grafico.visualizacoes')} sub={t('instagram.grafico.visualizacoesSub')} largo>
          <Linha dias={dias} rotulo={t('instagram.grafico.visualizacoes')} series={[
            { chave: 'v', nome: t('instagram.kpi.visualizacoes'), cor: 'var(--serie-1)', valores: d.serie.map((x) => x.visualizacoes) },
            { chave: 'a', nome: t('instagram.kpi.alcance'), cor: 'var(--serie-2)', valores: d.serie.map((x) => x.alcance) },
          ]} />
          <TabelaDados colunas={[
            { chave: 'dia', rotulo: t('instagram.tabela.dia'), formatar: diaLongo },
            { chave: 'visualizacoes', rotulo: t('instagram.kpi.visualizacoes'), num: true, formatar: numero },
            { chave: 'alcance', rotulo: t('instagram.kpi.alcance'), num: true, formatar: numero },
            { chave: 'interacoes', rotulo: t('instagram.kpi.interacoes'), num: true, formatar: numero },
          ]} linhas={d.serie} />
        </Secao>

        <Secao titulo={t('instagram.grafico.conversas')} sub={t('instagram.grafico.conversasSub')} largo={!temGasto}>
          <Colunas nome={t('instagram.kpi.conversas')} rotulo={t('instagram.grafico.conversas')}
            itens={d.serie.map((x) => ({ chave: x.dia, rotulo: diaCurto(x.dia), rotuloLongo: diaLongo(x.dia), valor: x.conversas }))} />
        </Secao>

        {temGasto && (
          <Secao titulo={t('instagram.grafico.gasto')} sub={t('instagram.grafico.gastoSub')}>
            <Colunas nome={t('instagram.kpi.gasto')} formatar={reais} formatarEixo={(v) => `R$ ${numero(v)}`} rotulo={t('instagram.grafico.gasto')}
              itens={d.serie.map((x) => ({ chave: x.dia, rotulo: diaCurto(x.dia), rotuloLongo: diaLongo(x.dia), valor: x.gasto || 0 }))} />
          </Secao>
        )}

        <Secao titulo={t('instagram.funil.titulo')} sub={t('instagram.funil.sub')}>
          <BarrasH itens={funil} />
        </Secao>

        <Secao titulo={t('instagram.grafico.formatos')} sub={t('instagram.grafico.formatosSub')}>
          <BarrasH itens={porFormato} vazio={t('instagram.desempenho.semPublicacoes')} />
        </Secao>

        <Secao titulo={t('instagram.desempenho.melhores')} sub={t('instagram.desempenho.melhoresSub')} largo>
          {d.melhores.length ? (
            <div className="ig-melhores">
              {d.melhores.map((p) => (
                <button key={p.id} type="button" className="ig-post-cartao" onClick={() => onAbrirPost(p.id)}>
                  <Miniatura post={p} tamanho={92} />
                  <span className="ig-post-textos">
                    <span className="tag">{t(`instagram.formato.${p.formato}`)}</span>
                    <small className="suave">{dataHora(p.publicado_em)}</small>
                    <b>{t('instagram.desempenho.visualizacoesN', { n: compacto(p.visualizacoes) })}</b>
                    <small>{t('instagram.desempenho.resumoPost', { alcance: compacto(p.alcance), interacoes: compacto(p.interacoes), eng: pctTexto(p.engajamento) })}</small>
                    {p.pago && <small className="ig-pago"><Megaphone size={11} /> {t('instagram.desempenho.impulsionado', { valor: reais(p.pago.gasto) })}</small>}
                  </span>
                </button>
              ))}
            </div>
          ) : <p className="suave pequeno">{t('instagram.desempenho.semPublicacoes')}</p>}
        </Secao>

        {multiplos && d.perfis?.length > 1 && (
          <Secao titulo={t('instagram.desempenho.perfis')} largo>
            <div className="ig-tabela-rolagem">
              <table className="tabela utm-tabela">
                <thead><tr>
                  <th>{t('instagram.tabela.perfil')}</th><th className="num">{t('instagram.kpi.seguidores')}</th><th className="num">{t('instagram.tabela.ganho')}</th>
                  <th className="num">{t('instagram.kpi.visualizacoes')}</th><th className="num">{t('instagram.kpi.interacoes')}</th><th className="num">{t('instagram.kpi.engajamento')}</th>
                  <th className="num">{t('instagram.tabela.publicacoes')}</th><th className="num">{t('instagram.kpi.conversas')}</th><th className="num">{t('instagram.kpi.leads')}</th><th className="num">{t('instagram.kpi.gasto')}</th>
                </tr></thead>
                <tbody>
                  {d.perfis.map((p) => (
                    <tr key={p.perfil_id}>
                      <td>@{p.username}</td><td className="num">{numero(p.seguidores)}</td>
                      <td className="num">{p.ganho_seguidores === null ? '—' : `${p.ganho_seguidores >= 0 ? '+' : ''}${numero(p.ganho_seguidores)}`}</td>
                      <td className="num">{numero(p.visualizacoes)}</td><td className="num">{numero(p.interacoes)}</td><td className="num">{pctTexto(p.engajamento_alcance)}</td>
                      <td className="num">{numero(p.publicacoes)}</td><td className="num">{numero(p.conversas)}</td><td className="num">{numero(p.leads)}</td><td className="num">{reais(p.gasto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Secao>
        )}
      </div>
      <p className="suave pequeno">
        {t('instagram.desempenho.coleta', { conta: d.coleta?.conta ? dataHora(d.coleta.conta) : '—', posts: d.coleta?.posts ? dataHora(d.coleta.posts) : '—' })}
        {d.coleta?.desde ? ` · ${t('instagram.desempenho.historicoDesde', { dia: String(d.coleta.desde).split('-').reverse().join('/') })}` : ''}
      </p>
    </>
  );
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const nomePais = (() => {
  try { const d = new Intl.DisplayNames(['pt-BR'], { type: 'region' }); return (c) => { try { return d.of(c) || c; } catch { return c; } }; } catch { return (c) => c; }
})();
const inicioIdade = (k) => Number(String(k).match(/\d+/)?.[0] ?? 999);
const ROTULO_RECORTE = { age: 'idade', gender: 'genero', city: 'cidade', country: 'pais' };

function PublicoHorarios({ d, t }) {
  const [tipo, setTipo] = useState('seguidores');
  const online = d.horarios.seguidores_online;
  const temOnline = online.some((h) => h.seguidores !== null);
  const melhores = d.horarios.publicacao.filter((g) => g.publicacoes >= 1).slice(0, 10).map((g) => ({
    chave: `${g.dia}-${g.hora}`, rotulo: `${t(`instagram.semana.${SEMANA[g.dia]}`)} ${String(g.hora).padStart(2, '0')}h`,
    valor: g.media, detalhe: t('instagram.desempenho.publicacoesN', { n: g.publicacoes }),
  }));
  const publico = d.publico?.[tipo] || {};
  const genero = (k) => ({ F: t('instagram.publico.feminino'), M: t('instagram.publico.masculino'), U: t('instagram.publico.naoInformado') }[k] || k);
  return (
    <div className="graficos">
      <Secao titulo={t('instagram.grafico.online')} sub={t('instagram.grafico.onlineSub', { fuso: d.horarios.fuso })} largo>
        {temOnline
          ? <Colunas nome={t('instagram.kpi.seguidores')} rotulo={t('instagram.grafico.online')} itens={online.map((h) => ({ chave: h.hora, rotulo: `${h.hora}h`, rotuloLongo: `${String(h.hora).padStart(2, '0')}:00`, valor: h.seguidores || 0 }))} />
          : <p className="suave pequeno">{t('instagram.grafico.onlineVazio')}</p>}
      </Secao>
      <Secao titulo={t('instagram.grafico.horarios')} sub={t('instagram.grafico.horariosSub')} largo>
        <BarrasH itens={melhores} vazio={t('instagram.desempenho.semPublicacoes')} />
      </Secao>
      <Secao titulo={t('instagram.publico.titulo')} sub={t('instagram.publico.sub')} largo
        acoes={(
          <div className="dp-segmentos dp-segmentos-pequeno">
            {['seguidores', 'engajado'].map((x) => <button key={x} type="button" className={tipo === x ? 'ativo' : ''} onClick={() => setTipo(x)}>{t(`instagram.publico.${x}`)}</button>)}
          </div>
        )}>
        {Object.keys(publico).length ? (
          <div className="ig-publico">
            {['age', 'gender', 'city', 'country'].filter((r) => publico[r]?.length).map((r) => {
              const total = publico[r].reduce((s, x) => s + x.valor, 0);
              return (
                <div key={r}>
                  <h4>{t(`instagram.publico.${ROTULO_RECORTE[r]}`)}</h4>
                  <BarrasH itens={(r === 'age' ? [...publico[r]].sort((a, b) => inicioIdade(a.chave) - inicioIdade(b.chave)) : publico[r]).slice(0, 10).map((x) => ({
                    chave: x.chave, rotulo: r === 'gender' ? genero(x.chave) : r === 'country' ? nomePais(x.chave) : x.chave, valor: x.valor, detalhe: total ? pctTexto((x.valor / total) * 100) : null,
                  }))} />
                </div>
              );
            })}
          </div>
        ) : <p className="suave pequeno">{t('instagram.publico.vazio')}</p>}
      </Secao>
    </div>
  );
}

export default function Desempenho({ user, perfis }) {
  const t = useT();
  const aviso = useAviso();
  const [visao, setVisaoEstado] = useState(() => ler('crm.igDesempenhoVisao', 'geral'));
  const [periodo, setPeriodoEstado] = useState(() => ler('crm.igPeriodo', { tipo: 'dias', dias: 30 }));
  const [perfil, setPerfilEstado] = useState(() => ler('crm.igPerfilDesempenho', ''));
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [post, setPost] = useState(null);
  const setVisao = (v) => { setVisaoEstado(v); gravar('crm.igDesempenhoVisao', v); };
  const setPeriodo = (p) => { setPeriodoEstado(p); gravar('crm.igPeriodo', p); };
  const setPerfil = (p) => { setPerfilEstado(p); gravar('crm.igPerfilDesempenho', p); };
  const perfilValido = perfis.some((p) => String(p.id) === String(perfil)) ? perfil : '';
  void user;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setDados(await api(`/instagram/desempenho?${paramsDoPeriodo(periodo, perfilValido)}`)); } catch (e) { aviso(e.message, 'erro'); } finally { setCarregando(false); }
  }, [periodo, perfilValido, aviso]);
  useEffect(() => { if (visao === 'geral' || visao === 'publico') carregar(); }, [carregar, visao]);
  useEvento('instagram', (d) => { if ((d?.metricas || d?.posts || d?.anuncios) && (visao === 'geral' || visao === 'publico')) carregar(); });

  return (
    <div className="pagina pagina-larga ig-aba ig-desempenho">
      <div className="ig-barra">
        <PeriodoIg valor={periodo} onChange={setPeriodo} />
        {perfis.length > 1 && (
          <select className="ig-seletor" value={perfilValido} onChange={(e) => setPerfil(e.target.value)}>
            <option value="">{t('instagram.direct.todosPerfis')}</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>@{p.username}</option>)}
          </select>
        )}
        <span className="espaco" />
        <div className="dp-segmentos">
          {VISOES.map(([id, Icone]) => <button key={id} type="button" className={visao === id ? 'ativo' : ''} onClick={() => setVisao(id)}><Icone size={13} /> {t(`instagram.visao.${id}`)}</button>)}
        </div>
      </div>
      {dados?.periodo && (visao === 'geral' || visao === 'publico') && (
        <p className="suave pequeno ig-periodo-texto">{t('instagram.desempenho.periodoTexto', { de: diaLongo(dados.periodo.de), ate: diaLongo(dados.periodo.ate), antes: `${diaCurto(dados.anterior.de)} – ${diaCurto(dados.anterior.ate)}` })}</p>
      )}

      <div className={carregando && dados ? 'ig-recarregando' : ''}>
        {(visao === 'geral' || visao === 'publico') && !dados && <div className="dp-centro"><span className="girando" /></div>}
        {visao === 'geral' && dados && <VisaoGeral d={dados} t={t} onAbrirPost={setPost} multiplos={!perfilValido} />}
        {visao === 'publico' && dados && <PublicoHorarios d={dados} t={t} />}
        {visao === 'publicacoes' && <Publicacoes periodo={periodo} perfil={perfilValido} onAbrirPost={setPost} />}
        {visao === 'anuncios' && <Anuncios periodo={periodo} perfil={perfilValido} />}
      </div>
      {post && <DetalhePost id={post} onFechar={() => setPost(null)} />}
    </div>
  );
}
