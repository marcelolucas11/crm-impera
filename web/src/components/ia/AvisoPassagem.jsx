// Aviso flutuante quando a IA passa um lead para a equipe (qualquer tela do CRM)
import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { useEvento } from '../../tempoReal.js';
import './ia.css';

export default function AvisoPassagem({ aoAbrir }) {
  const [aviso, setAviso] = useState(null);
  useEvento('ia', (d) => {
    if (!d?.handoff) return;
    setAviso(d);
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('IA passou um lead para você', { body: d.motivo || 'Abra o CRM para continuar o atendimento.' });
      }
    } catch { /* sem notificação do navegador */ }
  });
  if (!aviso) return null;
  const chave = aviso.lead_id ? `l:${aviso.lead_id}` : aviso.chave;
  return (
    <div className="ia-toast" role="status">
      <BellRing size={18} />
      <div>
        <b>A IA passou um lead para você</b>
        <div className="suave pequeno">{aviso.motivo}</div>
        <div className="ia-toast-acoes">
          <button type="button" className="btn btn-ouro btn-pequeno" onClick={() => { aoAbrir?.(chave); setAviso(null); }}>Abrir conversa</button>
          <button type="button" className="btn btn-pequeno" onClick={() => setAviso(null)}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
