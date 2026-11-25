// Aparência e desempenho: seção em Equipe e integrações (todo mundo vê; vale só para este navegador).
// Os efeitos pesados ficam desligados por padrão; ligar deixa o CRM como era antes da v0.34.
import { Gauge } from 'lucide-react';
import { useT } from '../i18n/index.jsx';
import { useAparencia, definirAparencia } from '../aparencia.js';

export function ConfigAparencia() {
  const t = useT();
  const cfg = useAparencia();
  return (
    <section className="cartao-secao live-secao aparencia-secao">
      <div className="live-titulo">
        <h2><Gauge size={17} /> {t('aparencia.titulo')}</h2>
        <p className="suave pequeno">{t('aparencia.descricao')}</p>
      </div>
      <div className="aparencia-opcoes">
        <label className="live-opcao aparencia-opcao">
          <input type="checkbox" checked={cfg.fundoAnimado} onChange={(e) => definirAparencia({ fundoAnimado: e.target.checked })} />
          <span><b>{t('aparencia.fundoAnimado')}</b><small className="suave">{t('aparencia.fundoAnimadoDica')}</small></span>
        </label>
        <label className="live-opcao aparencia-opcao">
          <input type="checkbox" checked={cfg.vidroAvancado} onChange={(e) => definirAparencia({ vidroAvancado: e.target.checked })} />
          <span><b>{t('aparencia.vidroAvancado')}</b><small className="suave">{t('aparencia.vidroAvancadoDica')}</small></span>
        </label>
      </div>
    </section>
  );
}
