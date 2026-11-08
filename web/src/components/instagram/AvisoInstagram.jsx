// Aviso flutuante (em qualquer tela) quando a Alice passa uma conversa do Instagram para a equipe
// ou pega o WhatsApp de um lead no Direct
import { useState } from 'react';
import { Camera as IconeInstagram } from 'lucide-react';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import '../ia/ia.css';

export default function AvisoInstagram({ aoAbrir }) {
  const t = useT();
  const [aviso, setAviso] = useState(null);
  useEvento('instagram', (d) => {
    if (!d?.handoff || !d.conversa) return;
    setAviso(d);
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(t('instagram.aviso.titulo'), { body: d.motivo || t('instagram.aviso.corpo') });
      }
    } catch { /* sem notificação do navegador */ }
  });
  if (!aviso) return null;
  return (
    <div className="ia-toast ig-toast" role="status">
      <IconeInstagram size={18} />
      <div>
        <b>{aviso.lead_id ? t('instagram.aviso.tituloLead') : t('instagram.aviso.titulo')}</b>
        <div className="suave pequeno">{aviso.motivo}</div>
        <div className="ia-toast-acoes">
          <button type="button" className="btn btn-ouro btn-pequeno" onClick={() => { aoAbrir?.(`ig:${aviso.conversa}`); setAviso(null); }}>{t('instagram.aviso.abrir')}</button>
          <button type="button" className="btn btn-pequeno" onClick={() => setAviso(null)}>{t('instagram.aviso.fechar')}</button>
        </div>
      </div>
    </div>
  );
}
