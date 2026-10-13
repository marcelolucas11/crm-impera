import { useEffect, useRef, useState } from 'react';
import { useFoto, urlFoto } from '../fotos.js';
import { iniciais } from '../utils.js';

// Foto de perfil do WhatsApp (ou iniciais). Só pede a foto quando o avatar aparece na tela.
// chave: "l:<id do lead>", "t:<telefone>" ou "j:<identificador>"
export default function Avatar({ chave, nome, tamanho = 40, lead = false, className = '' }) {
  const ref = useRef(null);
  const [visivel, setVisivel] = useState(false);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!chave || visivel || !ref.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setVisivel(true); return undefined; }
    const obs = new IntersectionObserver((itens) => {
      if (itens.some((i) => i.isIntersecting)) {
        setVisivel(true);
        obs.disconnect();
      }
    }, { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [chave, visivel]);

  const versao = useFoto(visivel ? chave : null);
  useEffect(() => setFalhou(false), [versao]);
  const comFoto = Boolean(chave && versao && !falhou);

  return (
    <span
      ref={ref}
      className={`foto-perfil ${lead ? 'foto-perfil-lead' : ''} ${comFoto ? 'com-foto' : ''} ${className}`}
      style={{ width: tamanho, height: tamanho, flexBasis: tamanho, fontSize: Math.max(10, Math.round(tamanho * 0.34)) }}
      aria-hidden="true"
    >
      {comFoto ? <img src={urlFoto(chave, versao)} alt="" onError={() => setFalhou(true)} draggable={false} /> : nome ? iniciais(nome) : '#'}
    </span>
  );
}
