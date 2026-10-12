import { useEffect, useState } from 'react';
import { api } from '../api.js';
import LeadFicha from './LeadFicha.jsx';

// Painel lateral do kanban: ficha do lead + conversa de WhatsApp
export default function LeadPanel({ leadId, stages, users, user, horas, onFechar, onAtualizado, onExcluido }) {
  const [haNumero, setHaNumero] = useState(true);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  useEffect(() => {
    api('/whatsapp/numeros').then((d) => setHaNumero(d.numeros.some((n) => n.status === 'conectado'))).catch(() => {});
  }, []);

  return (
    <div className="fundo-painel" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <aside className="painel">
        <LeadFicha
          leadId={leadId}
          stages={stages}
          users={users}
          user={user}
          horas={horas}
          onAtualizado={onAtualizado}
          onExcluido={onExcluido}
          comConversa
          haNumeroConectado={haNumero}
          acaoTopo={<button className="fechar" onClick={onFechar} aria-label="Fechar">×</button>}
        />
      </aside>
    </div>
  );
}
