import { useEffect } from 'react';

// Foto ou vídeo em tela cheia (Esc ou clique fora fecha)
export default function Visualizador({ midia, onFechar }) {
  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);

  if (!midia) return null;
  const url = `/api/whatsapp/midia/${midia.id}`;
  return (
    <div className="visualizador" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="visualizador-topo">
        <span className="suave">{midia.titulo}</span>
        <span className="espaco" />
        <a className="btn btn-pequeno" href={`${url}?download=1`}>⬇ Baixar</a>
        <button className="btn btn-pequeno" onClick={onFechar} aria-label="Fechar">✕</button>
      </div>
      <div className="visualizador-corpo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
        {midia.tipo === 'video' ? (
          <video src={url} controls autoPlay playsInline />
        ) : (
          <img src={url} alt={midia.legenda || ''} />
        )}
      </div>
      {midia.legenda && <div className="visualizador-legenda">{midia.legenda}</div>}
    </div>
  );
}
