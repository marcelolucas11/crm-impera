import { useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/index.jsx';
import { num, topoBonito, fmtDiaMes, fmtHora, dois, lerPref, salvarPref } from './util.js';

const HORA_MS = 3600000;
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

// Colunas empilhadas por dia: respondidos (cor 1) + ainda sem resposta (cor 2)
function PorDia({ dados }) {
  const [foco, setFoco] = useState(null);
  const max = topoBonito(Math.max(1, ...dados.map((d) => d.entradas)));
  const fmtDia = (iso) => {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  };
  const marcasX = dados.length <= 10 ? dados.map((_, i) => i) : [0, Math.floor(dados.length / 2), dados.length - 1];

  return (
    <>
      <div className="area-colunas">
        <div className="eixo-y">
          {[max, max / 2, 0].map((v) => <span key={v}>{num(v)}</span>)}
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
    </>
  );
}

// Uma coluna por hora do período (no horário de quem está vendo), com os leads que chegaram em cada hora
function PorHora({ leads, inicioMs, fimMs }) {
  const t = useT();
  const area = useRef(null);
  const [foco, setFoco] = useState(null);

  const { baldes, picos } = useMemo(() => {
    const inicio = new Date(inicioMs);
    inicio.setMinutes(0, 0, 0);
    const fim = Math.min(fimMs, Date.now());
    const n = Math.max(1, Math.ceil((fim - inicio.getTime()) / HORA_MS));
    const lista = Array.from({ length: n }, (_, i) => ({ t: inicio.getTime() + i * HORA_MS, total: 0, resp: 0, leads: [] }));
    const porHoraDoDia = Array.from({ length: 24 }, (_, h) => ({ h, total: 0 }));
    for (const l of leads) {
      const d = new Date(l.c);
      const i = Math.floor((d.getTime() - inicio.getTime()) / HORA_MS);
      if (i < 0 || i >= n) continue;
      lista[i].total++;
      if (l.r) lista[i].resp++;
      lista[i].leads.push(l);
      porHoraDoDia[d.getHours()].total++;
    }
    const top = porHoraDoDia.filter((x) => x.total).sort((a, b) => b.total - a.total).slice(0, 3);
    return { baldes: lista, picos: top };
  }, [leads, inicioMs, fimMs]);

  const n = baldes.length;
  const max = topoBonito(Math.max(1, ...baldes.map((b) => b.total)));
  const largura = n > 240 ? 1 : 0.78;
  const sobra = (1 - largura) / 2;
  const rotuloHora = (ms) => {
    const d = new Date(ms);
    return `${t(`estatisticas.semana.${DIAS_SEMANA[d.getDay()]}`)} ${fmtDiaMes(d)}, ${dois(d.getHours())}h`;
  };
  const marcas = n <= 24 ? [0, 6, 12, 18, n - 1].filter((i) => i < n) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
  const rotuloMarca = (ms) => {
    const d = new Date(ms);
    return n <= 48 ? `${dois(d.getHours())}h` : `${fmtDiaMes(d)} ${dois(d.getHours())}h`;
  };

  const mover = (ev) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.floor(((ev.clientX - r.left) / r.width) * n);
    setFoco(i >= 0 && i < n ? i : null);
  };
  const b = foco !== null ? baldes[foco] : null;
  const todos = [...leads].reverse();

  return (
    <>
      <div className="area-colunas">
        <div className="eixo-y">
          {[max, max / 2, 0].map((v) => <span key={v}>{num(v)}</span>)}
        </div>
        <div className="colunas colunas-hora" ref={area} onMouseMove={mover} onMouseLeave={() => setFoco(null)}>
          <div className="grade-h" style={{ bottom: '50%' }} />
          <div className="grade-h" style={{ bottom: '100%' }} />
          <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="svg-horas" aria-hidden="true">
            {foco !== null && <rect x={foco} y="0" width="1" height="100" className="hora-foco" />}
            {baldes.map((bk, i) => {
              if (!bk.total) return null;
              const hTotal = (bk.total / max) * 100;
              const hResp = (bk.resp / max) * 100;
              return (
                <g key={bk.t}>
                  <rect x={i + sobra} y={100 - hTotal} width={largura} height={hTotal - hResp} fill="var(--serie-2)" />
                  <rect x={i + sobra} y={100 - hResp} width={largura} height={hResp} fill="var(--serie-1)" />
                </g>
              );
            })}
          </svg>
          {b && (
            <div className="dica dica-hora" style={foco > n * 0.6 ? { right: `${((n - foco) / n) * 100}%` } : { left: `${((foco + 1) / n) * 100}%` }}>
              <b>{rotuloHora(b.t)}</b>
              <span>{t('estatisticas.hora.leads', { n: num(b.total) })}</span>
              {b.total > 0 && (
                <>
                  <span><i className="chave-cor" style={{ background: 'var(--serie-1)' }} />{t('estatisticas.hora.respondidos', { n: num(b.resp) })}</span>
                  <span><i className="chave-cor" style={{ background: 'var(--serie-2)' }} />{t('estatisticas.hora.semResposta', { n: num(b.total - b.resp) })}</span>
                  <span className="dica-lista">
                    {b.leads.slice(0, 6).map((l) => (
                      <small key={l.id}>{fmtHora(new Date(l.c))} · {l.n || t('estatisticas.hora.semNome')}</small>
                    ))}
                    {b.leads.length > 6 && <small className="suave">{t('estatisticas.hora.mais', { n: b.leads.length - 6 })}</small>}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="eixo-x">
        {marcas.map((i) => (
          <span key={i} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{rotuloMarca(baldes[i].t)}</span>
        ))}
      </div>
      {picos.length > 0 && (
        <p className="picos">
          <b>{t('estatisticas.hora.picos')}</b>
          {picos.map((p) => (
            <span key={p.h} className="pico">{dois(p.h)}h <small>{t('estatisticas.hora.leads', { n: num(p.total) })}</small></span>
          ))}
        </p>
      )}
      <details className="tabela-dados">
        <summary>{t('estatisticas.hora.tabela')}</summary>
        <table className="tabela">
          <thead>
            <tr><th>{t('estatisticas.hora.colData')}</th><th>{t('estatisticas.hora.colHora')}</th><th>{t('estatisticas.hora.colLead')}</th><th>{t('estatisticas.hora.colRespondido')}</th></tr>
          </thead>
          <tbody>
            {todos.slice(0, 500).map((l) => {
              const d = new Date(l.c);
              return (
                <tr key={l.id}>
                  <td>{fmtDiaMes(d)}</td><td>{fmtHora(d)}</td><td>{l.n || t('estatisticas.hora.semNome')}</td>
                  <td>{l.r ? t('estatisticas.sim') : t('estatisticas.nao')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {todos.length > 500 && <p className="suave pequeno">{t('estatisticas.hora.limite', { n: num(todos.length) })}</p>}
      </details>
    </>
  );
}

export default function EntradaLeads({ porDia, leads, inicioMs, fimMs }) {
  const t = useT();
  const [modo, setModoEstado] = useState(() => lerPref('entrada-modo', 'dia'));
  const setModo = (m) => { setModoEstado(m); salvarPref('entrada-modo', m); };

  return (
    <section className="cartao-secao grafico-largo">
      <div className="cabecalho-cartao">
        <h2>{modo === 'dia' ? 'Entrada de leads por dia' : t('estatisticas.hora.titulo')}</h2>
        <div className="segmentado" role="group">
          <button className={modo === 'dia' ? 'ativo' : ''} onClick={() => setModo('dia')}>{t('estatisticas.hora.porDia')}</button>
          <button className={modo === 'hora' ? 'ativo' : ''} onClick={() => setModo('hora')}>{t('estatisticas.hora.porHora')}</button>
        </div>
      </div>
      <div className="grafico">
        <div className="legenda">
          <span><i className="chave-cor" style={{ background: 'var(--serie-1)' }} />Respondidos</span>
          <span><i className="chave-cor" style={{ background: 'var(--serie-2)' }} />Ainda sem resposta</span>
        </div>
        {modo === 'dia' ? <PorDia dados={porDia} /> : <PorHora leads={leads} inicioMs={inicioMs} fimMs={fimMs} />}
      </div>
    </section>
  );
}
