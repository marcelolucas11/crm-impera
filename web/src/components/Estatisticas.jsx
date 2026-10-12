import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const PERIODOS = [7, 30, 90];
const ORIGENS = { yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', calendly: 'Calendly', manual: 'Manual' };
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

function topoBonito(max) {
  if (max <= 4) return 4;
  const ordem = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * ordem >= max) return m * ordem;
  return 10 * ordem;
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

// Colunas empilhadas por dia: respondidos (cor 1) + ainda sem resposta (cor 2)
function EntradasPorDia({ dados }) {
  const [foco, setFoco] = useState(null);
  const max = topoBonito(Math.max(1, ...dados.map((d) => d.entradas)));
  const fmtDia = (iso) => {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  };
  const marcasX = dados.length <= 10 ? dados.map((_, i) => i) : [0, Math.floor(dados.length / 2), dados.length - 1];

  return (
    <div className="grafico">
      <div className="legenda">
        <span><i className="chave-cor" style={{ background: 'var(--serie-1)' }} />Respondidos</span>
        <span><i className="chave-cor" style={{ background: 'var(--serie-2)' }} />Ainda sem resposta</span>
      </div>
      <div className="area-colunas">
        <div className="eixo-y">
          {[max, max / 2, 0].map((v) => <span key={v}>{nf.format(v)}</span>)}
        </div>
        <div className="colunas" onMouseLeave={() => setFoco(null)}>
          <div className="grade-h" style={{ bottom: '50%' }} />
          <div className="grade-h" style={{ bottom: '100%' }} />
          {dados.map((d, i) => {
            const semResposta = d.entradas - d.respondidos;
            return (
              <div key={d.dia} className="coluna-dia" onMouseEnter={() => setFoco(i)} onFocus={() => setFoco(i)} tabIndex={0}>
                <div className="pilha" style={{ height: `${(d.entradas / max) * 100}%` }}>
                  {semResposta > 0 && <div className="seg seg-2" style={{ flexGrow: semResposta }} />}
                  {d.respondidos > 0 && <div className="seg seg-1" style={{ flexGrow: d.respondidos }} />}
                </div>
                {foco === i && (
                  <div className={`dica ${i > dados.length * 0.7 ? 'dica-esq' : ''}`}>
                    <b>{fmtDia(d.dia)}</b>
                    <span>{num(d.entradas)} {d.entradas === 1 ? 'lead' : 'leads'}</span>
                    <span><i className="chave-cor" style={{ background: 'var(--serie-1)' }} />{num(d.respondidos)} respondidos</span>
                    <span><i className="chave-cor" style={{ background: 'var(--serie-2)' }} />{num(semResposta)} sem resposta</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="eixo-x">
        {marcasX.map((i) => (
          <span key={i} style={{ left: `${((i + 0.5) / dados.length) * 100}%` }}>{fmtDia(dados[i].dia)}</span>
        ))}
      </div>
      <details className="tabela-dados">
        <summary>Ver em tabela</summary>
        <table className="tabela">
          <thead><tr><th>Dia</th><th>Leads</th><th>Respondidos</th><th>Sem resposta</th></tr></thead>
          <tbody>
            {[...dados].reverse().map((d) => (
              <tr key={d.dia}><td>{fmtDia(d.dia)}</td><td>{d.entradas}</td><td>{d.respondidos}</td><td>{d.entradas - d.respondidos}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
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
            {i.rotulo}
          </span>
          <span className="barra-trilho">
            <span className="barra" style={{ width: `${Math.max(i.valor ? 2 : 0, (i.valor / max) * 100)}%` }} />
            <span className="barra-valor">{num(i.valor)}{i.extra ? <small className="suave"> {i.extra}</small> : null}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Estatisticas({ setErro }) {
  const [dias, setDias] = useState(30);
  const [e, setE] = useState(null);

  const carregar = useCallback(async () => {
    try {
      setE(await api(`/estatisticas?dias=${dias}&fuso=${-new Date().getTimezoneOffset()}`));
    } catch (err) {
      setErro(err.message);
    }
  }, [dias, setErro]);

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
  const { entrada, agora, resultados } = e;

  return (
    <div className="pagina pagina-larga estatisticas">
      <div className="cabecalho-pagina">
        <h1>Estatísticas</h1>
        <div className="seletor-periodo" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p} className={`chip ${dias === p ? 'ativo' : ''}`} onClick={() => setDias(p)}>Últimos {p} dias</button>
          ))}
        </div>
      </div>

      <section>
        <h2 className="titulo-secao">Entrada e resposta</h2>
        <div className="indicadores">
          <Indicador destaque rotulo="Leads novos" valor={num(entrada.novos)} variacao={entrada.variacao} detalhe={`vs ${num(entrada.anteriores)} nos ${dias} dias anteriores`} />
          <Indicador rotulo="Taxa de resposta" valor={pct(entrada.taxa_resposta)} detalhe={`${num(entrada.respondidos)} de ${num(entrada.novos)} já contatados`} />
          <Indicador rotulo="Tempo até a 1ª resposta" valor={duracao(entrada.tempo_resposta_mediana_min)} detalhe={entrada.tempo_resposta_media_min !== null ? `mediana · média ${duracao(entrada.tempo_resposta_media_min)}` : 'mediana'} />
          <Indicador rotulo="Respondidos em até 1 hora" valor={pct(entrada.taxa_resposta_1h)} detalhe={`${num(entrada.respondidos_em_1h)} leads`} />
        </div>
      </section>

      <section>
        <h2 className="titulo-secao">Follow-up agora</h2>
        <div className="indicadores">
          <Indicador rotulo="Follow-up em dia" valor={pct(agora.taxa_followup_em_dia)} detalhe={`${num(agora.em_dia)} de ${num(agora.abertos)} leads em andamento`} />
          <Indicador rotulo={`Sem contato há mais de ${e.followup_horas} h`} valor={num(agora.atrasados)} detalhe="⚠ precisam de follow-up" />
          <Indicador rotulo="Aguardando sua resposta" valor={num(agora.aguardando)} detalhe="⏳ marcados no botão" />
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
        <section className="cartao-secao grafico-largo">
          <h2>Entrada de leads por dia</h2>
          <EntradasPorDia dados={e.por_dia} />
        </section>
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
