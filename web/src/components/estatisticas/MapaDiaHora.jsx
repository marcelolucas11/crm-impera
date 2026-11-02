import { useMemo, useState } from 'react';
import { useT } from '../../i18n/index.jsx';
import { num, pct, taxa, dois, fmtDiaMes } from './util.js';

// Linhas de segunda a domingo; getDay() do JS começa no domingo
const LINHAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
const METRICAS = ['leads', 'respondidos', 'taxa'];

// Mapa de calor: entrada de leads por dia da semana × hora do dia (horário de quem está vendo)
export default function MapaDiaHora({ leads, inicioMs, fimMs }) {
  const t = useT();
  const [metrica, setMetrica] = useState('leads');
  const [foco, setFoco] = useState(null);

  const grade = useMemo(() => {
    const g = LINHAS.map(() => Array.from({ length: 24 }, () => ({ total: 0, resp: 0 })));
    for (const l of leads) {
      const d = new Date(l.c);
      const c = g[(d.getDay() + 6) % 7][d.getHours()];
      c.total++;
      if (l.r) c.resp++;
    }
    return g;
  }, [leads]);

  const valor = (c) => (metrica === 'leads' ? c.total : metrica === 'respondidos' ? c.resp : c.total ? (c.resp / c.total) * 100 : 0);
  const max = Math.max(0, ...grade.flat().map(valor));
  const corDe = (c) => {
    const v = valor(c);
    if (!v || !max) return undefined;
    const r = Math.pow(v / max, 0.75);
    return { background: `rgba(54, 128, 240, ${(0.14 + r * 0.82).toFixed(3)})`, boxShadow: r > 0.85 ? '0 0 14px rgba(54, 128, 240, .45)' : undefined };
  };
  const ultimo = new Date(Math.min(fimMs, Date.now()) - 1);
  const celula = foco ? grade[foco.d][foco.h] : null;

  return (
    <section className="cartao-secao grafico-largo">
      <div className="cabecalho-cartao">
        <div>
          <h2>{t('estatisticas.mapa.titulo')}</h2>
          <p className="suave pequeno">
            {t('estatisticas.mapa.sub', { de: fmtDiaMes(new Date(inicioMs)), ate: fmtDiaMes(ultimo) })}
          </p>
        </div>
        <div className="segmentado" role="group">
          {METRICAS.map((m) => (
            <button key={m} className={metrica === m ? 'ativo' : ''} onClick={() => setMetrica(m)}>{t(`estatisticas.mapa.${m}`)}</button>
          ))}
        </div>
      </div>
      <div className="mapa-rolagem">
        <div className="mapa" onMouseLeave={() => setFoco(null)}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="mapa-hora">{h % 3 === 0 ? `${h}h` : ''}</span>
          ))}
          {LINHAS.map((dia, d) => (
            <div key={dia} className="mapa-linha">
              <span className="mapa-dia">{t(`estatisticas.semana.${dia}`)}</span>
              {grade[d].map((c, h) => (
                <button
                  key={h}
                  className={`mapa-celula ${foco && foco.d === d && foco.h === h ? 'foco' : ''}`}
                  style={corDe(c)}
                  onMouseEnter={() => setFoco({ d, h })}
                  onFocus={() => setFoco({ d, h })}
                  aria-label={`${t(`estatisticas.semana.${dia}`)} ${h}h: ${c.total}`}
                >
                  {foco && foco.d === d && foco.h === h && (
                    <span className={`dica dica-mapa ${h > 15 ? 'dica-esq' : ''} ${d < 2 ? 'dica-baixo' : ''}`}>
                      <b>{t('estatisticas.mapa.dica', { dia: t(`estatisticas.semana.${dia}`), h: dois(h) })}</b>
                      <span className="dica-par"><span>{t('estatisticas.mapa.leads')}</span><b>{num(celula.total)}</b></span>
                      <span className="dica-par"><span>{t('estatisticas.mapa.respondidos')}</span><b>{num(celula.resp)}</b></span>
                      <span className="dica-par"><span>{t('estatisticas.mapa.semResposta')}</span><b>{num(celula.total - celula.resp)}</b></span>
                      <span className="dica-par"><span>{t('estatisticas.mapa.taxa')}</span><b>{pct(taxa(celula.resp, celula.total))}</b></span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mapa-legenda">
        <span>{t('estatisticas.mapa.menor')}</span>
        <i className="mapa-gradiente" />
        <span>{t('estatisticas.mapa.maior')}</span>
      </div>
    </section>
  );
}
