import { useEffect, useRef } from 'react';

// Seletor de emoji completo e offline (emoji-mart, MIT — dados embutidos no CRM, nada é baixado da internet):
// busca, categorias, tom de pele e "usados com frequência" (guardados no navegador).
// Carregado só quando é aberto, para não pesar na primeira tela.
let carregamento = null;
function carregar() {
  if (!carregamento) {
    carregamento = Promise.all([
      import('emoji-mart'),
      import('@emoji-mart/data'),
      import('@emoji-mart/data/i18n/pt.json'),
    ]).then(([modulo, dados, i18n]) => ({ Picker: modulo.Picker, dados: dados.default || dados, i18n: i18n.default || i18n }));
  }
  return carregamento;
}

export const temaAtual = () => (document.querySelector('.wa-tela')?.dataset.tema === 'claro' ? 'light' : 'dark');

export default function SeletorEmoji({ onEscolher, onFechar, className = '', ignorar = null }) {
  const ref = useRef(null);
  const escolher = useRef(onEscolher);
  const fechar = useRef(onFechar);
  escolher.current = onEscolher;
  fechar.current = onFechar;

  useEffect(() => {
    let picker = null;
    let cancelado = false;
    carregar().then(({ Picker, dados, i18n }) => {
      if (cancelado || !ref.current) return;
      picker = new Picker({
        data: dados,
        i18n,
        locale: 'pt',
        theme: temaAtual(),
        set: 'native',
        previewPosition: 'none',
        skinTonePosition: 'search',
        navPosition: 'top',
        searchPosition: 'sticky',
        perLine: Math.max(8, Math.min(16, Math.floor(((ref.current.parentElement?.clientWidth || 352) - 28) / 36))),
        maxFrequentRows: 2,
        autoFocus: true,
        onEmojiSelect: (e) => escolher.current?.(e.native),
      });
      ref.current.appendChild(picker);
    }).catch(() => {});
    return () => {
      cancelado = true;
      picker?.remove();
    };
  }, []);

  useEffect(() => {
    const fora = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return;
      if (ignorar && e.target.closest?.(ignorar)) return;
      fechar.current?.();
    };
    const tecla = (e) => e.key === 'Escape' && fechar.current?.();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [ignorar]);

  return <div className={`seletor-emoji-mart ${className}`} ref={ref} onMouseDown={(e) => e.stopPropagation()} />;
}
