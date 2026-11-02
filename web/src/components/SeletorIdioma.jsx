// Escolha do idioma do CRM (PT-BR / ES / EN). Aparece no menu do usuário e na tela de login.
import { Languages } from 'lucide-react';
import { IDIOMAS, useIdioma } from '../i18n/index.jsx';

export default function SeletorIdioma({ compacto = false }) {
  const { idioma, setIdioma, t } = useIdioma();
  return (
    <div className={`seletor-idioma ${compacto ? 'compacto' : ''}`} role="group" aria-label={t('idioma.titulo')}>
      {!compacto && <span className="seletor-idioma-titulo"><Languages size={15} /> {t('idioma.titulo')}</span>}
      <div className="seletor-idioma-opcoes">
        {IDIOMAS.map((i) => (
          <button
            key={i.id}
            type="button"
            className={idioma === i.id ? 'ativo' : ''}
            aria-pressed={idioma === i.id}
            title={i.rotulo}
            onClick={() => setIdioma(i.id)}
          >
            {i.curto}
          </button>
        ))}
      </div>
    </div>
  );
}
