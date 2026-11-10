// Modo Live: seção em Equipe e integrações (todo mundo vê) + selo "AO VIVO" no topo.
import { Radio, Eye, EyeOff } from 'lucide-react';
import { useT } from '../i18n/index.jsx';
import { useModoLive, definirModoLive, mascararNome, mascararTexto } from '../modoLive.js';

export function ConfigModoLive() {
  const t = useT();
  const cfg = useModoLive();
  return (
    <section className="cartao-secao live-secao" data-live-livre>
      <h2><Radio size={18} /> {t('live.titulo')}</h2>
      <p className="suave">{t('live.descricao')}</p>

      <div className={`live-chave ${cfg.ativo ? 'ligada' : ''}`}>
        <button type="button" className={`btn ${cfg.ativo ? 'btn-live-ligado' : 'btn-ouro'}`} onClick={() => definirModoLive({ ativo: !cfg.ativo })}>
          {cfg.ativo ? <><EyeOff size={15} /> {t('live.desligar')}</> : <><Eye size={15} /> {t('live.ligar')}</>}
        </button>
        <span className="suave pequeno">{cfg.ativo ? t('live.ligadoDica') : t('live.atalho')}</span>
      </div>

      <div className="live-exemplo pequeno">
        <span className="suave">{t('live.exemplo')}</span>
        <code>João Silva → {mascararNome('João Silva')}</code>
        <code>(11) 98765-4321 → {mascararTexto('(11) 98765-4321')}</code>
        <code>joao@gmail.com → {mascararTexto('joao@gmail.com')}</code>
      </div>

      <label className="dp-check">
        <input type="checkbox" checked={cfg.fotos} onChange={(e) => definirModoLive({ fotos: e.target.checked })} />
        <span>{t('live.fotos')}</span>
      </label>
      <label className="dp-check">
        <input type="checkbox" checked={cfg.mensagens} onChange={(e) => definirModoLive({ mensagens: e.target.checked })} />
        <span>{t('live.mensagens')}</span>
      </label>
      <p className="suave pequeno">{t('live.sempre')}</p>
    </section>
  );
}

export function SeloModoLive() {
  const t = useT();
  const { ativo } = useModoLive();
  if (!ativo) return null;
  return (
    <button type="button" className="selo-live" onClick={() => definirModoLive({ ativo: false })} title={t('live.seloDica')}>
      <span className="selo-live-ponto" /> {t('live.selo')}
    </button>
  );
}
