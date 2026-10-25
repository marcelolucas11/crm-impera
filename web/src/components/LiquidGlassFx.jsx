import { useEffect } from 'react';

// Efeitos do visual "Liquid Glass" que o CSS sozinho não consegue fazer:
//  1) filtros SVG de refração (a luz do fundo "dobra" nas bordas do vidro, com dispersão em cores);
//  2) luz que acompanha o ponteiro e leve inclinação 3D nos cartões.
// Só estético: não lê nem altera dados, não recebe cliques e não toca em nenhuma regra do CRM.
// Sem este componente (ou sem suporte do navegador) o CRM continua igual, só sem a distorção e o brilho animado.

// Mapas de deslocamento: cinza neutro (128) no miolo e rampa nas bordas.
// Canal R empurra a imagem na horizontal, canal G na vertical → o fundo parece "entrar" no vidro pelas bordas, como numa lente.
const mapa = (horizontal, borda) => {
  const [x2, y2] = horizontal ? ['1', '0'] : ['0', '1'];
  const b = Math.round(borda * 100);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}">` +
    `<stop offset="0" stop-color="#fff"/><stop offset="${b}%" stop-color="#808080"/>` +
    `<stop offset="${100 - b}%" stop-color="#808080"/><stop offset="1" stop-color="#000"/>` +
    `</linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const MAPA_X = mapa(true, 0.2);
const MAPA_Y = mapa(false, 0.2);

// Quais superfícies reagem ao ponteiro e quais também se inclinam
const SUPERFICIES = '.cartao, .cartao-secao, .indicador, .coluna, .login-caixa, .btn, .chip, .aba';
const INCLINAM = '.cartao, .indicador';

function detectarRefracao() {
  try {
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
    const ua = navigator.userAgent || '';
    const chromium = /Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua) && !/Firefox\//.test(ua);
    // Safari e Firefox não aplicam filtros SVG ao fundo do vidro; lá ficam desfoque + brilho
    return chromium && typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#lg-refracao)');
  } catch {
    return false;
  }
}

export default function LiquidGlassFx() {
  useEffect(() => {
    const raiz = document.documentElement;
    const refrata = detectarRefracao();
    if (refrata) raiz.classList.add('lg-refrata');

    const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const comMouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (reduzir || !comMouse) return () => raiz.classList.remove('lg-refrata');

    let quadro = 0;
    let ultimo = null;
    let evento = null;

    const limpar = (el) => {
      if (!el) return;
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
    };

    const aplicar = () => {
      quadro = 0;
      const e = evento;
      if (!e) return;
      raiz.style.setProperty('--mx', `${e.clientX}px`);
      raiz.style.setProperty('--my', `${e.clientY}px`);
      if (e.buttons) return; // arrastando um cartão: não mexe na inclinação
      const alvo = e.target instanceof Element ? e.target.closest(SUPERFICIES) : null;
      if (alvo !== ultimo) { limpar(ultimo); ultimo = alvo; }
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = ((e.clientX - r.left) / r.width) * 100;
      const py = ((e.clientY - r.top) / r.height) * 100;
      alvo.style.setProperty('--px', `${px.toFixed(1)}%`);
      alvo.style.setProperty('--py', `${py.toFixed(1)}%`);
      if (alvo.matches(INCLINAM)) {
        alvo.style.setProperty('--rx', `${(((py - 50) / 50) * -4.5).toFixed(2)}deg`);
        alvo.style.setProperty('--ry', `${(((px - 50) / 50) * 5.5).toFixed(2)}deg`);
      }
    };

    const aoMover = (e) => {
      evento = e;
      if (!quadro) quadro = requestAnimationFrame(aplicar);
    };
    const aoSair = () => { limpar(ultimo); ultimo = null; evento = null; };

    window.addEventListener('pointermove', aoMover, { passive: true });
    document.addEventListener('pointerleave', aoSair);
    window.addEventListener('blur', aoSair);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', aoMover);
      document.removeEventListener('pointerleave', aoSair);
      window.removeEventListener('blur', aoSair);
      limpar(ultimo);
      raiz.classList.remove('lg-refrata');
    };
  }, []);

  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', pointerEvents: 'none' }}>
      <defs>
        {/* Lente completa: deslocamento + dispersão cromática (vermelho, verde e azul dobram em graus ligeiramente diferentes) */}
        <filter id="lg-refracao" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
          <feImage href={MAPA_X} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
          <feImage href={MAPA_Y} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
          <feColorMatrix in="mx" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="mr" />
          <feColorMatrix in="my" type="matrix" values="0 0 0 0 0  1 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="mg" />
          <feBlend in="mr" in2="mg" mode="screen" result="mapa" />
          <feDisplacementMap in="SourceGraphic" in2="mapa" scale="0.13" xChannelSelector="R" yChannelSelector="G" result="d1" />
          <feDisplacementMap in="SourceGraphic" in2="mapa" scale="0.11" xChannelSelector="R" yChannelSelector="G" result="d2" />
          <feDisplacementMap in="SourceGraphic" in2="mapa" scale="0.09" xChannelSelector="R" yChannelSelector="G" result="d3" />
          <feColorMatrix in="d1" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cr" />
          <feColorMatrix in="d2" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cg" />
          <feColorMatrix in="d3" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cb" />
          <feBlend in="cr" in2="cg" mode="screen" result="rg" />
          <feBlend in="rg" in2="cb" mode="screen" />
        </filter>
        {/* Versão leve para botões, chips e abas: um deslocamento só, mais discreto */}
        <filter id="lg-refracao-leve" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
          <feImage href={MAPA_X} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
          <feImage href={MAPA_Y} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
          <feColorMatrix in="mx" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="mr" />
          <feColorMatrix in="my" type="matrix" values="0 0 0 0 0  1 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="mg" />
          <feBlend in="mr" in2="mg" mode="screen" result="mapa" />
          <feDisplacementMap in="SourceGraphic" in2="mapa" scale="0.22" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
