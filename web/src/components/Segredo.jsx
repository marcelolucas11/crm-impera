import { useEffect, useState } from 'react';
import { Eye, EyeOff, Copy } from 'lucide-react';
import { useModoLive } from '../modoLive.js';
import { useT } from '../i18n/index.jsx';

// Tudo que é chave, token, ID ou URL secreta aparece coberto por padrão,
// para não vazar em gravação ou compartilhamento de tela.
// O olho revela por alguns segundos e volta a cobrir sozinho.
const TEMPO_REVELADO_MS = 15000;
export const MASCARA = '••••••••••••';

// No Modo Live o olho fica travado: nada é revelado enquanto a tela está sendo compartilhada.
function useRevelar() {
  const [visivel, setVisivel] = useState(false);
  const { ativo: live } = useModoLive();
  useEffect(() => {
    if (!visivel) return undefined;
    const t = setTimeout(() => setVisivel(false), TEMPO_REVELADO_MS);
    return () => clearTimeout(t);
  }, [visivel]);
  useEffect(() => { if (live) setVisivel(false); }, [live]);
  return [visivel && !live, () => { if (!live) setVisivel((v) => !v); }, live];
}

function BotaoOlho({ visivel, alternar, travado }) {
  const t = useT();
  return (
    <button
      type="button"
      className="segredo-olho"
      onClick={alternar}
      disabled={travado}
      title={travado ? t('live.segredoTravado') : visivel ? 'Cobrir' : 'Mostrar por 15 segundos'}
      aria-label={visivel ? 'Cobrir' : 'Mostrar'}
    >
      {visivel ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

// Texto já salvo (final da chave, URL do webhook, segredo...).
// `aoCopiar` copia o valor real sem precisar revelar na tela.
export function TextoSecreto({ valor, aoCopiar, codigo = false, className = '' }) {
  const [visivel, alternar, travado] = useRevelar();
  if (!valor) return null;
  const texto = visivel ? valor : MASCARA;
  const copiar = () => navigator.clipboard?.writeText(valor).then(() => aoCopiar?.());
  return (
    <span className={`segredo ${className}`}>
      {codigo ? <code className="segredo-texto">{texto}</code> : <span className="segredo-texto">{texto}</span>}
      <BotaoOlho visivel={visivel} alternar={alternar} travado={travado} />
      {aoCopiar && (
        <button type="button" className="segredo-olho" onClick={copiar} title="Copiar" aria-label="Copiar">
          <Copy size={14} />
        </button>
      )}
    </span>
  );
}

// Campo de digitação que fica coberto enquanto se digita ou cola.
export function CampoSecreto({ className = '', ...props }) {
  const [visivel, alternar, travado] = useRevelar();
  return (
    <span className={`segredo-campo ${className}`}>
      <input
        {...props}
        type={visivel ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
      />
      <BotaoOlho visivel={visivel} alternar={alternar} travado={travado} />
    </span>
  );
}
