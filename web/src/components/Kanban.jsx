import { useState } from 'react';
import { formatarTelefone, tempoDesde, iniciais } from '../utils.js';

export default function Kanban({ stages, leads, onMover, onAbrir }) {
  const [sobre, setSobre] = useState(null);

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
              {doEstagio.map((lead) => <Cartao key={lead.id} lead={lead} onAbrir={onAbrir} />)}
              {!doEstagio.length && <div className="vazio">Arraste leads para cá</div>}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function Cartao({ lead, onAbrir }) {
  const titulo = lead.name || formatarTelefone(lead.phone) || lead.email || `Lead #${lead.id}`;
  const semContato = !lead.last_contact_at;
  return (
    <article
      className={`cartao ${lead.followup_overdue ? 'atrasado' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(lead.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onAbrir(lead)}
    >
      <div className="cartao-titulo">{titulo}</div>
      {lead.name && lead.phone && <div className="cartao-linha">{formatarTelefone(lead.phone)}</div>}
      {lead.company && <div className="cartao-linha suave">{lead.company}</div>}
      <div className="cartao-tags">
        <span className={`tag tag-${lead.source}`}>{lead.form_name || (lead.source === 'yayforms' ? 'Yay! Forms' : 'Manual')}</span>
      </div>
      <div className="cartao-rodape">
        <span className={lead.followup_overdue ? 'alerta' : 'suave'}>
          {lead.followup_overdue && '⚠ '}
          {semContato ? `Entrou ${tempoDesde(lead.created_at)}` : `Contato ${tempoDesde(lead.last_contact_at)}`}
        </span>
        {lead.owner_name && <span className="mini-avatar" title={lead.owner_name}>{iniciais(lead.owner_name)}</span>}
      </div>
    </article>
  );
}
