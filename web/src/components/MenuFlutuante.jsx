import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

// Lista de opções que abre embaixo de um botão (chips da barra rápida, foto do responsável no cartão).
// Fica por cima de tudo (portal no <body>), então não é cortada pela coluna do kanban.
// ancora: o elemento do botão. Fecha ao clicar fora, Esc, rolar a página ou redimensionar.
export default function MenuFlutuante({ ancora, aoFechar, children, largura = 240, alinhar = 'esquerda', className = '' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!ancora) return;
    const r = ancora.getBoundingClientRect();
    const alturaMenu = ref.current?.offsetHeight || 0;
    const margem = 8;
    let left = alinhar === 'direita' ? r.right - largura : r.left;
    left = Math.max(margem, Math.min(left, window.innerWidth - largura - margem));
    let top = r.bottom + 6;
    if (alturaMenu && top + alturaMenu > window.innerHeight - margem && r.top - alturaMenu - 6 > margem) top = r.top - alturaMenu - 6;
    setPos({ left, top, maxHeight: Math.max(160, window.innerHeight - top - margem) });
  }, [ancora, largura, alinhar]);

  useEffect(() => {
    const fora = (e) => {
      if (ref.current?.contains(e.target) || ancora?.contains(e.target)) return;
      aoFechar();
    };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); aoFechar(); } };
    const rolou = (e) => { if (!ref.current?.contains(e.target)) aoFechar(); };
    document.addEventListener('mousedown', fora, true);
    document.addEventListener('keydown', tecla, true);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', aoFechar);
    return () => {
      document.removeEventListener('mousedown', fora, true);
      document.removeEventListener('keydown', tecla, true);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', aoFechar);
    };
  }, [ancora, aoFechar]);

  // Eventos do portal sobem pela árvore do React: sem isto, clicar numa opção abriria o cartão por baixo
  const parar = (e) => e.stopPropagation();

  return createPortal(
    <div
      ref={ref}
      className={`menu-flutuante ${className}`}
      role="menu"
      style={{ width: largura, left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight }}
      onClick={parar}
      onMouseDown={parar}
      onDragStart={parar}
    >
      {children}
    </div>,
    document.body
  );
}

export function OpcaoMenu({ marcada = false, onClick, icone = null, children, detalhe = null, desativada = false }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={marcada} className={`opcao-menu ${marcada ? 'marcada' : ''}`} onClick={onClick} disabled={desativada}>
      {icone && <span className="opcao-menu-icone">{icone}</span>}
      <span className="opcao-menu-texto">
        {children}
        {detalhe && <small>{detalhe}</small>}
      </span>
      {marcada && <Check size={15} className="opcao-menu-check" />}
    </button>
  );
}

export function TituloMenu({ children }) {
  return <div className="titulo-menu">{children}</div>;
}
