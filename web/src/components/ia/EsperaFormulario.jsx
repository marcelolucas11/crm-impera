// Espera da IA depois do Yay! Forms: quanto tempo a 1ª mensagem segura para o lead terminar o formulário e agendar no
// Calendly (senão a IA dizia "você não agendou" para quem estava agendando). O estudo lê os leads reais do CRM e sugere o tempo.
import { useState } from 'react';
import { Timer, BarChart3 } from 'lucide-react';
import { api } from '../../api.js';
import { useAviso } from '../disparos/comum.jsx';
import { useT } from '../../i18n/index.jsx';

const MEDIDAS = ['duracao_formulario', 'cadastro_ate_fim', 'fim_ate_agendar', 'agendar_ate_crm', 'cadastro_ate_agendar', 'cadastro_ate_crm'];
const num = (x) => (x === null || x === undefined ? '—' : String(x).replace('.', ','));

export default function EsperaFormulario({ cfg, mudar, admin }) {
  const t = useT();
  const aviso = useAviso();
  const [estudo, setEstudo] = useState(null);
  const [carregando, setCarregando] = useState(false);

  const estudar = async () => {
    setCarregando(true);
    try { setEstudo(await api('/ia/estudo-formulario?dias=60')); } catch (e) { aviso(e.message, 'erro'); } finally { setCarregando(false); }
  };
  const usar = (min) => {
    mudar({ espera_formulario_min: min });
    aviso(t('ia.esperaForm.usado', { min }), 'info');
  };

  const base = estudo?.medidas?.cadastro_ate_agendar;
  return (
    <div className="ia-espera-form">
      <label className="dp-check">
        <input type="checkbox" checked={cfg.iniciar_formulario} disabled={!admin} onChange={(e) => mudar({ iniciar_formulario: e.target.checked })} />
        <span>{t('ia.esperaForm.ligar')}</span>
      </label>
      <span className={`pequeno${cfg.iniciar_formulario ? '' : ' suave'}`}>
        <Timer size={13} className="ia-espera-icone" /> {t('ia.esperaForm.antes')}
        <input className="dp-inline-num" type="number" min={0} max={240} value={cfg.espera_formulario_min ?? 10} disabled={!admin || !cfg.iniciar_formulario}
          onChange={(e) => mudar({ espera_formulario_min: Number(e.target.value) })} /> {t('ia.esperaForm.depois')}
      </span>
      <label className="dp-check">
        <input type="checkbox" checked={cfg.atender_ao_agendar !== false} disabled={!admin || !cfg.iniciar_formulario} onChange={(e) => mudar({ atender_ao_agendar: e.target.checked })} />
        <span>{t('ia.esperaForm.agendou')}</span>
      </label>
      <span className="suave pequeno">{t('ia.esperaForm.conferir')}</span>
      <div>
        <button type="button" className="btn btn-pequeno" onClick={estudar} disabled={carregando}>
          <BarChart3 size={14} /> {carregando ? t('ia.esperaForm.estudando') : t('ia.esperaForm.estudar')}
        </button>
      </div>

      {estudo && (
        <div className="ia-espera-estudo">
          <b>{t('ia.esperaForm.titulo', { dias: estudo.dias })}</b>
          <span className="suave pequeno">{t('ia.esperaForm.resumo', {
            leads: estudo.leads_formulario, completos: estudo.completos, agendaram: estudo.agendaram,
            depois: estudo.agendaram_depois, limite: estudo.limite_agendou_ja_min,
          })}</span>
          {!base?.n ? <span className="pequeno">{t('ia.esperaForm.semDados')}</span> : (
            <>
              <table className="ia-espera-tabela">
                <thead>
                  <tr>
                    <th>{t('ia.esperaForm.colMedida')}</th><th>{t('ia.esperaForm.colN')}</th><th>{t('ia.esperaForm.colMediana')}</th>
                    <th>{t('ia.esperaForm.colP90')}</th><th>{t('ia.esperaForm.colMax')}</th>
                  </tr>
                </thead>
                <tbody>
                  {MEDIDAS.map((k) => {
                    const m = estudo.medidas[k] || { n: 0 };
                    return (
                      <tr key={k} className={k === 'cadastro_ate_agendar' ? 'destaque' : ''}>
                        <td>{t(`ia.esperaForm.m.${k}`)}</td>
                        <td>{m.n}</td>
                        <td>{m.n ? t('ia.esperaForm.min', { n: num(m.mediana) }) : '—'}</td>
                        <td>{m.n ? t('ia.esperaForm.min', { n: num(m.p90) }) : '—'}</td>
                        <td>{m.n ? t('ia.esperaForm.min', { n: num(m.maximo) }) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {estudo.poucos_dados && <span className="pequeno ia-espera-alerta">{t('ia.esperaForm.poucos')}</span>}
              <span className="pequeno">{t('ia.esperaForm.cobertura', {
                atual: estudo.espera_atual_min ?? '—', pAtual: estudo.cobertura_atual ?? '—', pAntes: estudo.cobertura_antes ?? '—',
              })}</span>
              {estudo.sugestao_min !== null && (
                <div className="ia-espera-sugestao">
                  <span className="pequeno"><b>{t('ia.esperaForm.sugestao', { min: estudo.sugestao_min, p: estudo.cobertura_sugestao })}</b></span>
                  {admin && estudo.sugestao_min !== cfg.espera_formulario_min && (
                    <button type="button" className="btn btn-pequeno btn-ouro" onClick={() => usar(estudo.sugestao_min)}>
                      {t('ia.esperaForm.usar', { min: estudo.sugestao_min })}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
