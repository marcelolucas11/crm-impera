// Janela por cima (ficha do lead, lista de reuniões): o botão/gesto "voltar" do celular fecha a janela de cima
// em vez de sair do CRM. Cada janela aberta ocupa uma entrada no histórico do navegador; fechar pelo × devolve a entrada.
import { useEffect, useRef } from 'react';

let seq = 0;

export function useFecharComVoltar(ativo, fechar) {
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;

  useEffect(() => {
    if (!ativo || typeof window === 'undefined' || !window.history?.pushState) return undefined;
    seq += 1;
    const marca = `crm-camada-${seq}`;
    let saiuPeloVoltar = false;
    try { window.history.pushState({ ...(window.history.state || {}), crmCamada: marca }, ''); } catch { return undefined; }
    const aoVoltar = () => {
      // A entrada desta janela saiu do histórico (voltar): fecha só ela
      if (window.history.state?.crmCamada !== marca && !saiuPeloVoltar) {
        saiuPeloVoltar = true;
        fecharRef.current?.();
      }
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
      // Fechou pelo × (ou trocou de tela): tira do histórico a entrada que esta janela colocou
      if (!saiuPeloVoltar && window.history.state?.crmCamada === marca) window.history.back();
    };
  }, [ativo]);
}
