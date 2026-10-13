import { useState, useEffect } from 'react';
import { formatarTelefone, tempoDesde, iniciais, dataCurta } from '../utils.js';
import Avatar from './Avatar.jsx';

const ORIGENS = { yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', calendly: 'Calendly', manual: 'Manual' };

export default function Kanban({ stages, leads, onMover, onAbrir, ocultos = [] }) {
  const [sobre, setSobre] = useState(null);
  const [, setTique] = useState(0);
  useEffect(() => { const t = setInterval(() => setTique((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const oculto = new Set(ocultos);

  return (
    <main className="kanban">
      {stages.map((etapa) => {
        const doEstagio = leads.filter((l) => l.stage_id === etapa.id);
        return (
          <section
            key={etapa.id}
            className={`coluna ${sobre === etapa.id ? 'coluna-alvo' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setSobre(etapa.id); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSobre(null); }}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              const id = Number(e.dataTransfer.getData('text/plain'));
              const lead = leads.find((l) => l.id === id);
              if (lead && lead.stage_id !== etapa.id) onMover(id, etapa.id);
            }}
          >
            <header className="coluna-topo">
              <span className="ponto" style={{ background: etapa.color }} />
              <h3>{etapa.name}</h3>
              <span className="contagem">{doEstagio.length}</span>
            </header>
            <div className="coluna-cartoes">
              {doEstagio.map((lead) => <Cartao key={lead.id} lead={lead} onAbrir={onAbrir} oculto={oculto} />)}
              {!doEstagio.length && <div className="vazio">Arraste leads para cá</div>}
            </div>
          </section>
        );
      })}
    </main>
  );
}

export const CAMPOS_FIXOS = [
  ['telefone', 'Telefone'], ['email', 'E-mail'], ['data', 'Data de preenchimento'], ['iniciado', 'Iniciado há…'],
  ['resposta', 'Última resposta no WhatsApp'], ['origem', 'Origem / formulário'], ['responsavel', 'Responsável'],
];

function dataDia(d) {
  return d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

function Cartao({ lead, onAbrir, oculto }) {
  const ver = (k) => !oculto.has(k);
  const titulo = lead.name || formatarTelefone(lead.phone) || lead.email || `Lead #${lead.id}`;
  const respostas = (lead.respostas || []).filter((r) => r.pergunta && ver(`q:${r.pergunta}`) && String(r.resposta ?? '').trim());
  return (
    <article
      className={`cartao ${lead.followup_overdue ? 'atrasado' : ''} ${lead.waiting_since ? 'aguardando' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(lead.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onAbrir(lead)}
    >
      {lead.waiting_since && (
        <div className="faixa-aguardando" title={lead.waiting_note || 'Aguardando sua resposta'}>
          ⏳ Aguardando resposta · {tempoDesde(lead.waiting_since).replace('há ', '')}
        </div>
      )}
      <div className="cartao-cabeca">
        {lead.phone && <Avatar chave={`l:${lead.id}`} nome={lead.name || ''} tamanho={34} lead />}
        <div className="cartao-nome">
          <div className="cartao-titulo">{titulo}</div>
          {ver('telefone') && lead.name && lead.phone && <div className="cartao-linha">{formatarTelefone(lead.phone)}</div>}
        </div>
        {ver('data') && <span className="cartao-data">{dataDia(lead.created_at)}</span>}
      </div>
      {ver('email') && lead.email && <div className="cartao-linha suave">{lead.email}</div>}
      {respostas.length > 0 && (
        <div className="cartao-respostas">
          {respostas.map((r) => <div key={r.pergunta} className="cartao-resp" title={r.pergunta}>{r.resposta}</div>)}
        </div>
      )}
      <div className="cartao-tags">
        {ver('origem') && <span className={`tag tag-${lead.source}`}>{lead.form_name || ORIGENS[lead.source] || 'Manual'}</span>}
        {lead.next_meeting_at && <span className="tag tag-reuniao">📅 {dataCurta(lead.next_meeting_at)}</span>}
        {lead.unread_count > 0 && <span className="tag tag-mensagens">💬 {lead.unread_count} {lead.unread_count === 1 ? 'nova' : 'novas'}</span>}
      </div>
      <div className="cartao-rodape">
        <div className="cartao-timers">
          {ver('iniciado') && (
            <span className={lead.followup_overdue ? 'alerta' : 'suave'}>{lead.followup_overdue && '⚠ '}Iniciado {tempoDesde(lead.created_at)}</span>
          )}
          {ver('resposta') && lead.last_msg_at && (
            <span className={`timer-resp ${lead.last_msg_from_me ? 'minha' : 'dele'}`}
              title={lead.last_msg_from_me ? 'A última mensagem foi sua' : 'A última mensagem foi do lead'}>
              💬 Respondido {tempoDesde(lead.last_msg_at)}
            </span>
          )}
        </div>
        {ver('responsavel') && lead.owner_name && <span className="mini-avatar" title={lead.owner_name}>{iniciais(lead.owner_name)}</span>}
      </div>
    </article>
  );
}
