import { useState, useEffect, useRef } from 'react';
import { formatarTelefone, tempoDesde, dataCurta } from '../utils.js';
import { CalendarDays, MessageCircle, CircleDashed, BellRing, X, Check, Minus, UserX } from 'lucide-react';
import Avatar from './Avatar.jsx';
import { FotoUsuario } from './FotoUsuario.jsx';
import MenuFlutuante, { OpcaoMenu, TituloMenu } from './MenuFlutuante.jsx';

const ORIGENS = { yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', calendly: 'Calendly', manual: 'Manual' };

// Ordem dos cartões dentro de cada coluna (de cima para baixo). Vale igual em todas as etapas,
// então um lead movido de fase cai na mesma posição relativa na coluna nova.
export const ORDENS = [
  ['formulario', 'Início do formulário'],
  ['interacao', 'Última interação'],
];

const dataFormulario = (l) => l.form_started_at || l.created_at || '';

export function ordenarLeads(lista, ordem) {
  const copia = [...lista];
  if (ordem === 'interacao') {
    // Última mensagem no WhatsApp (de qualquer lado) mais recente em cima; quem nunca trocou mensagem vai
    // para baixo, do formulário mais novo para o mais velho
    return copia.sort((a, b) => {
      const ma = a.last_msg_at || '';
      const mb = b.last_msg_at || '';
      if (ma !== mb) return ma < mb ? 1 : -1;
      const fa = dataFormulario(a), fb = dataFormulario(b);
      return fa === fb ? b.id - a.id : fa < fb ? 1 : -1;
    });
  }
  // Leads mais novos (início do formulário) em cima, mais velhos embaixo
  return copia.sort((a, b) => {
    const fa = dataFormulario(a), fb = dataFormulario(b);
    return fa === fb ? b.id - a.id : fa < fb ? 1 : -1;
  });
}

/**
 * selecionados: Set de ids quando o modo "Selecionar" está ligado (null = desligado).
 * Ligado, clicar no cartão marca/desmarca em vez de abrir a ficha.
 */
export default function Kanban({
  stages, leads, onMover, onAbrir, onLimparNotificacao, ordem = 'formulario', ocultos = [],
  users = [], onMudarResponsavel, selecionados = null, onAlternarSelecao, onMarcarVarios,
}) {
  const [sobre, setSobre] = useState(null);
  const [, setTique] = useState(0);
  useEffect(() => { const t = setInterval(() => setTique((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const oculto = new Set(ocultos);

  return (
    <main className={`kanban ${selecionados ? 'com-barra-selecao' : ''}`}>
      {stages.map((etapa) => {
        const doEstagio = ordenarLeads(leads.filter((l) => l.stage_id === etapa.id), ordem);
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
              {selecionados && <MarcarColuna ids={doEstagio.map((l) => l.id)} selecionados={selecionados} onMarcarVarios={onMarcarVarios} nome={etapa.name} />}
              <span className="ponto" style={{ background: etapa.color }} />
              <h3>{etapa.name}</h3>
              <span className="contagem">{doEstagio.length}</span>
            </header>
            <div className="coluna-cartoes">
              {doEstagio.map((lead) => (
                <Cartao key={lead.id} lead={lead} onAbrir={onAbrir} onLimparNotificacao={onLimparNotificacao} oculto={oculto}
                  users={users} onMudarResponsavel={onMudarResponsavel}
                  modoSelecao={Boolean(selecionados)} selecionado={Boolean(selecionados?.has(lead.id))} onAlternarSelecao={onAlternarSelecao} />
              ))}
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

// Caixinha do topo da coluna: marca/desmarca todos os cartões visíveis dessa etapa
function MarcarColuna({ ids, selecionados, onMarcarVarios, nome }) {
  const marcados = ids.filter((id) => selecionados.has(id)).length;
  const todos = ids.length > 0 && marcados === ids.length;
  return (
    <button type="button" className={`marca-kanban ${todos ? 'marcada' : marcados ? 'parcial' : ''}`} disabled={!ids.length}
      onClick={() => onMarcarVarios?.(ids, !todos)} title={todos ? `Desmarcar todos de ${nome}` : `Selecionar todos de ${nome}`}
      aria-label={todos ? `Desmarcar todos de ${nome}` : `Selecionar todos de ${nome}`}>
      {todos ? <Check size={12} strokeWidth={3} /> : marcados ? <Minus size={12} strokeWidth={3} /> : null}
    </button>
  );
}

// Foto do responsável no canto inferior esquerdo; clicar abre a lista da equipe para trocar
function Responsavel({ lead, users, onMudar }) {
  const botao = useRef(null);
  const [aberto, setAberto] = useState(false);
  const dono = lead.owner_id ? { id: lead.owner_id, name: lead.owner_name || 'Responsável', foto: lead.owner_foto || null } : null;
  const ativos = users.filter((u) => u.active || u.id === lead.owner_id);
  const escolher = (id) => { setAberto(false); if ((id || null) !== (lead.owner_id || null)) onMudar?.(lead.id, id); };
  return (
    <>
      <button
        ref={botao}
        type="button"
        className={`cartao-responsavel ${aberto ? 'aberto' : ''}`}
        title={dono ? `Responsável: ${dono.name} — clique para trocar` : 'Sem responsável — clique para escolher'}
        aria-label={dono ? `Responsável: ${dono.name}. Trocar` : 'Escolher responsável'}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setAberto((v) => !v); }}
      >
        <FotoUsuario usuario={dono} tamanho={26} titulo="" />
      </button>
      {aberto && (
        <MenuFlutuante ancora={botao.current} aoFechar={() => setAberto(false)} largura={240}>
          <TituloMenu>Responsável pelo lead</TituloMenu>
          {ativos.map((u) => (
            <OpcaoMenu key={u.id} marcada={u.id === lead.owner_id} onClick={() => escolher(u.id)} icone={<FotoUsuario usuario={u} tamanho={22} />}>
              {u.name}
            </OpcaoMenu>
          ))}
          <OpcaoMenu marcada={!lead.owner_id} onClick={() => escolher(null)} icone={<UserX size={16} />}>Sem responsável</OpcaoMenu>
        </MenuFlutuante>
      )}
    </>
  );
}

function Cartao({ lead, onAbrir, onLimparNotificacao, oculto, users, onMudarResponsavel, modoSelecao, selecionado, onAlternarSelecao }) {
  const ver = (k) => !oculto.has(k);
  const titulo = lead.name || formatarTelefone(lead.phone) || lead.email || `Lead #${lead.id}`;
  const respostas = (lead.respostas || []).filter((r) => r.pergunta && ver(`q:${r.pergunta}`) && String(r.resposta ?? '').trim());
  return (
    <article
      className={`cartao ${lead.sem_resposta ? 'com-notif' : ''} ${lead.followup_overdue ? 'atrasado' : ''} ${lead.waiting_since ? 'aguardando' : ''} ${!lead.first_contact_at ? 'nunca' : ''} ${lead.closing_since ? 'fechando' : ''} ${modoSelecao ? 'em-selecao' : ''} ${selecionado ? 'selecionado' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(lead.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={(e) => {
        // Ctrl/⌘ + clique também seleciona, mesmo fora do modo "Selecionar"
        if (modoSelecao || e.ctrlKey || e.metaKey) onAlternarSelecao?.(lead.id);
        else onAbrir(lead);
      }}
      aria-pressed={modoSelecao ? selecionado : undefined}
    >
      {modoSelecao && (
        <span className={`marca-kanban cartao-caixa ${selecionado ? 'marcada' : ''}`} aria-hidden="true">
          {selecionado && <Check size={12} strokeWidth={3} />}
        </span>
      )}
      {lead.sem_resposta && (
        <div className="cartao-notif" title={`O lead mandou mensagem ${tempoDesde(lead.last_in_at)} e ainda não foi respondido`}>
          <span className="cartao-notif-sino"><BellRing size={12} strokeWidth={2.2} /></span>
          <span className="cartao-notif-texto">{tempoDesde(lead.last_in_at).replace('há ', '')}</span>
          <button
            type="button"
            className="cartao-notif-limpar"
            title="Limpar notificação"
            aria-label="Limpar notificação"
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onLimparNotificacao?.(lead.id); }}
          >
            <X size={11} strokeWidth={2.6} />
          </button>
        </div>
      )}
      {(lead.closing_since || lead.waiting_since || lead.followup_overdue || !lead.first_contact_at) && (
        <div className="cartao-status">
          {lead.closing_since && (
            <span className="selo selo-verde" title={lead.closing_note || 'Vai fechar — aguardando a decisão do lead'}>
              <i className="led led-verde" /> Aguardando fechar · {tempoDesde(lead.closing_since).replace('há ', '')}
            </span>
          )}
          {lead.waiting_since && (
            <span className="selo selo-ambar" title={lead.waiting_note || 'Aguardando sua resposta'}>
              <i className="led led-ambar" /> Aguardando resposta · {tempoDesde(lead.waiting_since).replace('há ', '')}
            </span>
          )}
          {!lead.first_contact_at && (
            <span className="selo selo-azul" title="Ninguém falou com este lead ainda">
              <i className="led led-azul" /> Nunca contatado
            </span>
          )}
          {lead.followup_overdue && (
            <span className="selo selo-vermelho" title="Sem contato há mais tempo que o limite de follow-up">
              <i className="led led-vermelho" /> Sem contato
            </span>
          )}
        </div>
      )}
      <div className="cartao-cabeca">
        {lead.phone && <Avatar chave={`l:${lead.id}`} nome={lead.name || ''} tamanho={34} lead />}
        <div className="cartao-nome">
          <div className="cartao-titulo">{titulo}</div>
          {ver('telefone') && lead.name && lead.phone && <div className="cartao-linha">{formatarTelefone(lead.phone)}</div>}
        </div>
        {ver('data') && <span className="cartao-data">{dataDia(lead.form_started_at || lead.created_at)}</span>}
      </div>
      {ver('email') && lead.email && <div className="cartao-linha suave">{lead.email}</div>}
      {respostas.length > 0 && (
        <div className="cartao-respostas">
          {respostas.map((r) => <div key={r.pergunta} className="cartao-resp" title={r.pergunta}>{r.resposta}</div>)}
        </div>
      )}
      <div className="cartao-tags">
        {ver('origem') && <span className={`tag tag-${lead.source}`}>{lead.form_name || ORIGENS[lead.source] || 'Manual'}</span>}
        {lead.form_partial && <span className="tag tag-parcial" title="Começou o formulário e não terminou (resposta parcial do Yay! Forms)"><CircleDashed size={11} strokeWidth={2} /> Form. incompleto</span>}
        {lead.next_meeting_at && <span className="tag tag-reuniao"><CalendarDays size={11} strokeWidth={2} /> {dataCurta(lead.next_meeting_at)}</span>}
        {lead.unread_count > 0 && <span className="tag tag-mensagens"><MessageCircle size={11} strokeWidth={2} /> {lead.unread_count} {lead.unread_count === 1 ? 'nova' : 'novas'}</span>}
      </div>
      <div className="cartao-rodape">
        {ver('responsavel') && <Responsavel lead={lead} users={users} onMudar={onMudarResponsavel} />}
        <div className="cartao-timers">
          {ver('iniciado') && (
            <span className={lead.followup_overdue ? 'alerta' : 'suave'}>Iniciado {tempoDesde(lead.form_started_at || lead.created_at)}</span>
          )}
          {ver('resposta') && lead.last_msg_at && (
            <span className={`timer-resp ${lead.last_msg_from_me ? 'minha' : 'dele'}`}
              title={lead.last_msg_from_me ? 'A última mensagem foi sua' : 'A última mensagem foi do lead'}>
              <MessageCircle size={11} strokeWidth={2} /> Respondido {tempoDesde(lead.last_msg_at)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
