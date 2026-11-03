import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';
import Periodo from './estatisticas/Periodo.jsx';
import EntradaLeads from './estatisticas/EntradaLeads.jsx';
import MapaDiaHora from './estatisticas/MapaDiaHora.jsx';
import FunilVendas from './estatisticas/FunilVendas.jsx';
import Utms from './estatisticas/Utms.jsx';
import { janelaDoPeriodo, lerPref, salvarPref } from './estatisticas/util.js';
import './estatisticas/estatisticas.css';

const ORIGENS = { yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', manual: 'Manual' };
const nf = new Intl.NumberFormat('pt-BR');
const num = (v) => (v === null || v === undefined ? '—' : nf.format(v));
const pct = (v) => (v === null || v === undefined ? '—' : `${nf.format(v)}%`);

function duracao(min) {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 >= 1 ? ` ${Math.round(min % 60)} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
}

function Indicador({ rotulo, valor, detalhe, variacao, bomQuandoSobe = true, destaque = false }) {
  let delta = null;
  if (variacao !== null && variacao !== undefined) {
    const sobe = variacao > 0;
    const bom = variacao === 0 ? null : sobe === bomQuandoSobe;
    delta = (
      <span className={`delta ${bom === null ? '' : bom ? 'bom' : 'ruim'}`}>
        {variacao === 0 ? '＝' : sobe ? '▲' : '▼'} {nf.format(Math.abs(variacao))}%
      </span>
    );
  }
  return (
    <div className={`indicador ${destaque ? 'destaque' : ''}`}>
      <span className="indicador-rotulo">{rotulo}</span>
      <span className="indicador-valor">{valor}</span>
      <span className="indicador-detalhe">{delta}{delta && detalhe ? ' ' : ''}{detalhe}</span>
    </div>
  );
}

// Barras horizontais de uma série só (cor 1); o rótulo e o valor ficam em texto
function Barras({ itens, vazio = 'Sem dados no período.' }) {
  if (!itens.length) return <p className="suave pequeno">{vazio}</p>;
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div className="barras">
      {itens.map((i) => (
        <div key={i.chave} className="barra-linha" title={i.dica || `${i.rotulo}: ${num(i.valor)}`}>
          <span className="barra-rotulo">
            {i.cor && <i className="ponto" style={{ background: i.cor }} />}
            <span className="barra-rotulo-texto">{i.rotulo}</span>
          </span>
          <span className="barra-trilho">
            <span className="barra-espaco">
              <span className="barra" style={{ width: `${Math.max(i.valor ? 2 : 0, (i.valor / max) * 100)}%` }} />
            </span>
            <span className="barra-valor">{num(i.valor)}{i.extra ? <small className="suave"> {i.extra}</small> : null}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Estatisticas({ setErro }) {
  const t = useT();
  const [periodo, setPeriodoEstado] = useState(() => lerPref('periodo', { tipo: '30' }));
  const [e, setE] = useState(null);
  const setPeriodo = (p) => { setPeriodoEstado(p); salvarPref('periodo', p); };

  const carregar = useCallback(async () => {
    try {
      const { inicio, fim } = janelaDoPeriodo(periodo);
      const q = new URLSearchParams({ inicio: inicio.toISOString(), fim: fim.toISOString(), fuso: String(-new Date().getTimezoneOffset()) });
      setE(await api(`/estatisticas?${q}`));
    } catch (err) {
      setErro(err.message);
    }
  }, [periodo, setErro]);

  useEffect(() => {
    carregar();
    const id = setInterval(() => { if (!document.hidden) carregar(); }, 60000);
    return () => clearInterval(id);
  }, [carregar]);

  const origens = useMemo(
    () => (e?.por_origem || []).map((o) => ({ chave: o.origem, rotulo: ORIGENS[o.origem] || o.origem, valor: o.total })),
    [e]
  );
  const formularios = useMemo(
    () =>
      (e?.por_formulario || []).map((f) => ({
        chave: f.formulario,
        rotulo: f.formulario,
        valor: f.total,
        extra: `· ${Math.round((f.respondidos / f.total) * 100)}% respondidos`,
      })),
    [e]
  );
  const etapas = useMemo(
    () => (e?.por_etapa || []).map((s) => ({ chave: s.id, rotulo: s.nome, valor: s.total, cor: s.cor })),
    [e]
  );

  if (!e) return <div className="pagina"><div className="carregando" /></div>;
  const { entrada, agora, resultados, funil_forms: funil } = e;
  const inicioMs = Date.parse(e.periodo.desde);
  const fimMs = Date.parse(e.periodo.ate);

  return (
    <div className="pagina pagina-larga estatisticas">
      <div className="cabecalho-pagina">
        <h1>Estatísticas</h1>
        <Periodo valor={periodo} onChange={setPeriodo} />
      </div>

      <section>
        <h2 className="titulo-secao">Entrada e resposta</h2>
        <div className="indicadores">
          <Indicador destaque rotulo="Leads novos" valor={num(entrada.novos)} variacao={entrada.variacao} detalhe={t('estatisticas.vsAnterior', { n: num(entrada.anteriores) })} />
          <Indicador rotulo="Taxa de resposta" valor={pct(entrada.taxa_resposta)} detalhe={`${num(entrada.respondidos)} de ${num(entrada.novos)} já contatados`} />
          <Indicador rotulo="Tempo até a 1ª resposta" valor={duracao(entrada.tempo_resposta_mediana_min)} detalhe={entrada.tempo_resposta_media_min !== null ? `mediana · média ${duracao(entrada.tempo_resposta_media_min)}` : 'mediana'} />
          <Indicador rotulo="Respondidos em até 1 hora" valor={pct(entrada.taxa_resposta_1h)} detalhe={`${num(entrada.respondidos_em_1h)} leads`} />
        </div>
      </section>

      {funil && (
        <section>
          <h2 className="titulo-secao">Formulário → reunião (Calendly)</h2>
          <div className="indicadores">
            <Indicador rotulo="Iniciaram o formulário" valor={num(funil.iniciaram)} detalhe="leads do Yay! Forms no período" />
            <Indicador rotulo="Completaram o formulário" valor={num(funil.completaram)} detalhe={funil.taxa_conclusao !== null ? `${pct(funil.taxa_conclusao)} de quem iniciou` : ''} />
            <Indicador destaque rotulo="Completaram e agendaram" valor={num(funil.completaram_e_agendaram)} detalhe={funil.taxa_agendamento !== null ? `${pct(funil.taxa_agendamento)} de quem completou` : ''} />
            <Indicador rotulo="Completaram e não agendaram" valor={num(funil.completaram_sem_agendar)} detalhe="filtro no kanban: “Completou o form e não agendou”" />
          </div>
        </section>
      )}

      <section>
        <h2 className="titulo-secao">Follow-up agora</h2>
        <div className="indicadores">
          <Indicador rotulo="Follow-up em dia" valor={pct(agora.taxa_followup_em_dia)} detalhe={`${num(agora.em_dia)} de ${num(agora.abertos)} leads em andamento`} />
          <Indicador rotulo={`Sem contato há mais de ${e.followup_horas} h`} valor={num(agora.atrasados)} detalhe="precisam de follow-up" />
          <Indicador rotulo="Aguardando sua resposta" valor={num(agora.aguardando)} detalhe="marcados no botão" />
          <Indicador rotulo="Nunca contatados" valor={num(agora.nunca_contatados)} detalhe="em andamento, sem nenhum contato" />
        </div>
      </section>

      <section>
        <h2 className="titulo-secao">Resultados no período</h2>
        <div className="indicadores">
          <Indicador rotulo="Fechados (ganhos)" valor={num(resultados.ganhos)} detalhe={resultados.taxa_conversao !== null ? `${pct(resultados.taxa_conversao)} dos leads novos` : ''} />
          <Indicador rotulo="Perdidos" valor={num(resultados.perdidos)} />
          <Indicador rotulo="Reuniões agendadas" valor={num(resultados.reunioes_agendadas)} detalhe={resultados.reunioes_canceladas ? `${num(resultados.reunioes_canceladas)} canceladas` : 'pelo Calendly'} />
          <Indicador rotulo="Mensagens de WhatsApp" valor={num(resultados.mensagens_recebidas + resultados.mensagens_enviadas)} detalhe={`${num(resultados.mensagens_recebidas)} recebidas · ${num(resultados.mensagens_enviadas)} enviadas`} />
        </div>
      </section>

      <div className="graficos">
        <FunilVendas leads={e.leads || []} etapas={e.por_etapa} />
        <EntradaLeads porDia={e.por_dia} leads={e.leads || []} inicioMs={inicioMs} fimMs={fimMs} />
        <MapaDiaHora leads={e.leads || []} inicioMs={inicioMs} fimMs={fimMs} />
        <Utms leads={e.leads || []} etapas={e.por_etapa} chaves={e.chaves_utm || []} />
        <section className="cartao-secao">
          <h2>Leads novos por origem</h2>
          <Barras itens={origens} />
        </section>
        <section className="cartao-secao">
          <h2>Formulários que mais trazem leads</h2>
          <Barras itens={formularios} vazio="Nenhum lead de formulário no período." />
        </section>
        <section className="cartao-secao">
          <h2>Leads por etapa agora</h2>
          <Barras itens={etapas} />
        </section>
        <section className="cartao-secao">
          <h2>Equipe</h2>
          <table className="tabela">
            <thead>
              <tr><th>Responsável</th><th>Em andamento</th><th>Atrasados</th><th>Aguardando</th><th>Respondidos*</th><th>Ganhos*</th></tr>
            </thead>
            <tbody>
              {e.por_responsavel.map((r) => (
                <tr key={r.nome}>
                  <td>{r.nome}</td><td>{num(r.abertos)}</td><td>{num(r.atrasados)}</td><td>{num(r.aguardando)}</td>
                  <td>{num(r.respondidos_periodo)}</td><td>{num(r.ganhos_periodo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="suave pequeno">* no período escolhido</p>
        </section>
      </div>
    </div>
  );
}
