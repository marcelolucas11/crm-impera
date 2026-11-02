import { useEffect, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useT } from '../../i18n/index.jsx';
import { PERIODOS, isoDia, fmtDiaMes } from './util.js';

// Seletor de período: fixos (hoje, ontem, 3/7/30/90 dias) + janela personalizada (de/até)
export default function Periodo({ valor, onChange }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const hoje = isoDia(new Date());
  const [de, setDe] = useState(valor.de || isoDia(new Date(Date.now() - 6 * 86400000)));
  const [ate, setAte] = useState(valor.ate || hoje);
  const caixa = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (ev) => { if (caixa.current && !caixa.current.contains(ev.target)) setAberto(false); };
    const esc = (ev) => { if (ev.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fechar); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const rotulo = (p) => (p === 'hoje' ? t('estatisticas.periodo.hoje') : p === 'ontem' ? t('estatisticas.periodo.ontem') : t('estatisticas.periodo.ultimos', { n: p }));
  const personalizado = valor.tipo === 'personalizado';
  const dataCurta = (iso) => {
    const [a, m, d] = iso.split('-').map(Number);
    return fmtDiaMes(new Date(a, m - 1, d));
  };
  const valido = de && ate && de <= ate;

  return (
    <div className="seletor-periodo" role="group" aria-label={t('estatisticas.periodo.rotulo')}>
      {PERIODOS.map((p) => (
        <button key={p} className={`chip ${valor.tipo === p ? 'ativo' : ''}`} onClick={() => onChange({ tipo: p })}>
          {rotulo(p)}
        </button>
      ))}
      <div className="periodo-personalizado" ref={caixa}>
        <button className={`chip ${personalizado ? 'ativo' : ''}`} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          <CalendarRange size={15} />
          {personalizado ? `${dataCurta(valor.de)} – ${dataCurta(valor.ate)}` : t('estatisticas.periodo.personalizado')}
        </button>
        {aberto && (
          <div className="periodo-pop">
            <label>
              <span>{t('estatisticas.periodo.de')}</span>
              <input type="date" value={de} max={ate || hoje} onChange={(ev) => setDe(ev.target.value)} />
            </label>
            <label>
              <span>{t('estatisticas.periodo.ate')}</span>
              <input type="date" value={ate} min={de} max={hoje} onChange={(ev) => setAte(ev.target.value)} />
            </label>
            <button
              className="btn btn-ouro"
              disabled={!valido}
              onClick={() => { onChange({ tipo: 'personalizado', de, ate }); setAberto(false); }}
            >
              {t('estatisticas.periodo.aplicar')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
