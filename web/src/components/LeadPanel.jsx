import { useEffect, useState } from 'react';
import { api } from '../api.js';
import LeadFicha from './LeadFicha.jsx';
import { useFecharComVoltar } from '../voltar.js';

// Painel lateral do kanban: ficha do lead + conversa de WhatsApp
// numeroPreferido: WhatsApp escolhido na barra do kanban (vazio = automático)
export default function LeadPanel({ leadId, stages, users, user, horas, onFechar, onAtualizado, onExcluido, numeroPreferido = '', sobreLista = false }) {
  const [haNumero, setHaNumero] = useState(true);
  // Celular: o botão/gesto "voltar" fecha a ficha (e volta para a lista ou o kanban) em vez de sair do CRM
  useFecharComVoltar(true, onFechar);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  useEffect(() => {
    api('/whatsapp/numeros').then((d) => setHaNumero(d.numeros.some((n) => n.status === 'conectado'))).catch(() => {});
  }, []);

  return (
    <div className={`fundo-painel ${sobreLista ? 'fundo-sobre-lista' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
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
          numeroPreferido={numeroPreferido}
          acaoTopo={<button className="fechar" onClick={onFechar} aria-label="Fechar">×</button>}
        />
      </aside>
    </div>
  );
}
