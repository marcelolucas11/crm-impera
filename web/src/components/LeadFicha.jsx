import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatarTelefone, linkWhatsApp, tempoDesde, dataHora, dataCurta } from '../utils.js';
import Conversa from './Conversa.jsx';
import Avatar from './Avatar.jsx';

const DESCRICAO = {
  created: (d) => `Lead criado${d.origem && d.origem !== 'manual' ? ` (${{ yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', calendly: 'Calendly' }[d.origem] || d.origem})` : ''}`,
  form_submitted: (d) => `Respondeu o formulário${d.formulario ? ` “${d.formulario}”` : ''}`,
  form_resubmitted: (d) => `Respondeu de novo${d.formulario ? ` “${d.formulario}”` : ''}${d.parcial ? ' (sem terminar)' : ''}`,
  form_partial: (d) => `Começou o formulário${d.formulario ? ` “${d.formulario}”` : ''} e parou (resposta parcial)`,
  form_completed: (d) => `✓ Terminou o formulário${d.formulario ? ` “${d.formulario}”` : ''}`,
  form_updated: (d) => `Respondeu mais perguntas${d.formulario ? ` do formulário “${d.formulario}”` : ''}`,
  stage_changed: (d) => `Etapa: ${d.de} → ${d.para}${d.motivo ? ` (${d.motivo})` : ''}`,
  owner_changed: (d) => (d.para ? `Responsável: ${d.para}` : 'Responsável removido'),
  contact: (d) => `Contato registrado (${d.canal})${d.nota ? `: ${d.nota}` : ''}`,
  note: (d) => d.texto,
  updated: (d) => `Editou ${d.campos?.join(', ')}`,
  meeting_scheduled: (d) => `📅 Agendou “${d.evento}” para ${dataHora(d.inicio)}`,
  meeting_rescheduled: (d) => `📅 Reagendou “${d.evento}” para ${dataHora(d.inicio)}`,
  meeting_canceled: (d) => `Cancelou “${d.evento}”${d.motivo ? ` (${d.motivo})` : ''}`,
  waiting_on: (d) => `⏳ Marcado como aguardando resposta${d.nota ? `: ${d.nota}` : ''}`,
  waiting_off: () => '✓ Aguardando resposta resolvido',
};

const valoresIniciais = (l) => ({
  name: l.name || '',
  phone: formatarTelefone(l.phone),
  email: l.email || '',
  company: l.company || '',
  notes: l.notes || '',
});

// Ficha completa do lead. Usada no painel lateral do kanban e ao lado da conversa na tela de WhatsApp.
export default function LeadFicha({
  leadId, stages, users, user, horas, onAtualizado, onExcluido, acaoTopo = null, comConversa = false, haNumeroConectado = true,
}) {
  const [lead, setLead] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [reunioes, setReunioes] = useState([]);
  const [form, setForm] = useState({});
  const [nota, setNota] = useState('');
  const [notaAguardando, setNotaAguardando] = useState('');
  const [marcandoAguardando, setMarcandoAguardando] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Edições ainda não salvas nos campos de dados são mantidas ao recarregar, a não ser que resetarForm seja pedido
  const leadAtual = useRef(null);
  const formAtual = useRef(form);
  formAtual.current = form;

  const carregar = useCallback(async ({ resetarForm = false } = {}) => {
    try {
      const d = await api(`/leads/${leadId}`);
      const anterior = leadAtual.current?.id === d.lead.id ? leadAtual.current : null;
      const sujo = anterior && Object.entries(valoresIniciais(anterior)).some(([k, v]) => (formAtual.current[k] || '') !== v);
      leadAtual.current = d.lead;
      setLead(d.lead);
      setEventos(d.eventos);
      if (resetarForm || !sujo) setForm(valoresIniciais(d.lead));
      api(`/leads/${leadId}/reunioes`).then((r) => setReunioes(r.reunioes)).catch(() => {});
    } catch (e) {
      setErro(e.message);
    }
  }, [leadId]);

  useEffect(() => {
    setMarcandoAguardando(false);
    carregar({ resetarForm: true });
  }, [carregar]);

  const aplicar = async (caminho, opcoes, { resetarForm = false } = {}) => {
    setErro('');
    setSalvando(true);
    try {
      const d = await api(caminho, opcoes);
      if (d?.lead) onAtualizado?.(d.lead);
      await carregar({ resetarForm });
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const mudou = lead && Object.entries(valoresIniciais(lead)).some(([k, v]) => (form[k] || '') !== v);
  const salvarDados = () => aplicar(`/leads/${leadId}`, { method: 'PATCH', body: form }, { resetarForm: true });
  const aposEnviarMensagem = async () => {
    await carregar();
    if (leadAtual.current) onAtualizado?.(leadAtual.current);
  };
  const proximaReuniao = reunioes.find((r) => r.status === 'active' && new Date(r.start_time) > new Date());
  const registrarContato = () => aplicar(`/leads/${leadId}/contato`, { method: 'POST', body: { canal: 'outro' } });
  const adicionarNota = async (e) => {
    e.preventDefault();
    if (!nota.trim()) return;
    if (await aplicar(`/leads/${leadId}/notas`, { method: 'POST', body: { texto: nota } })) setNota('');
  };
  const alternarAguardando = async (ativo) => {
    if (await aplicar(`/leads/${leadId}/aguardando`, { method: 'POST', body: { ativo, nota: notaAguardando } })) {
      setMarcandoAguardando(false);
      setNotaAguardando('');
    }
  };
  const excluir = async () => {
    if (!confirm('Excluir este lead e todo o histórico? Não dá para desfazer.')) return;
    try {
      await api(`/leads/${leadId}`, { method: 'DELETE' });
      onExcluido?.();
    } catch (e) { setErro(e.message); }
  };

  const respostas = lead?.extra?.respostas || [];
  const utm = lead?.extra?.utm || {};
  const variaveis = lead?.extra?.variaveis || {};
  const titulo = lead ? lead.name || formatarTelefone(lead.phone) || lead.email || `Lead #${lead.id}` : 'Carregando…';

  return (
    <div className="ficha">
      <div className="painel-topo">
        {lead?.phone && <Avatar chave={`l:${leadId}`} nome={lead.name || ''} tamanho={44} lead />}
        <div className="painel-titulo">
          <h2>{titulo}</h2>
          {lead && <small className="suave">{lead.stage_name}{lead.owner_name ? ` · ${lead.owner_name}` : ''}</small>}
        </div>
        {acaoTopo}
      </div>
      {erro && <div className="erro margem">{erro}</div>}

      {lead && (
        <div className="painel-corpo">
          {lead.waiting_since ? (
            <div className="aviso-aguardando">
              <div>
                ⏳ <b>Aguardando sua resposta</b> há {tempoDesde(lead.waiting_since).replace('há ', '')}
                {lead.waiting_note && <> — {lead.waiting_note}</>}
                <small className="suave"> · marcado por {lead.waiting_by_name || '—'}</small>
              </div>
              <button className="btn btn-pequeno" onClick={() => alternarAguardando(false)} disabled={salvando}>✓ Resolvido</button>
            </div>
          ) : marcandoAguardando ? (
            <form className="marcar-aguardando" onSubmit={(e) => { e.preventDefault(); alternarAguardando(true); }}>
              <input autoFocus placeholder="O que ele está esperando? (opcional)" value={notaAguardando} onChange={(e) => setNotaAguardando(e.target.value)} maxLength={300} />
              <button className="btn btn-aviso" disabled={salvando}>Marcar</button>
              <button type="button" className="btn" onClick={() => setMarcandoAguardando(false)}>Cancelar</button>
            </form>
          ) : (
            <button className="btn btn-aviso-leve" onClick={() => setMarcandoAguardando(true)}>⏳ Está aguardando minha resposta</button>
          )}

          {lead.followup_overdue && (
            <div className="aviso-followup">⚠ Sem contato {tempoDesde(lead.last_activity_at)} — limite é {horas} h.</div>
          )}

          {proximaReuniao && (
            <div className="aviso-reuniao">
              📅 {proximaReuniao.event_name} — <b>{dataCurta(proximaReuniao.start_time)}</b>
              {proximaReuniao.join_url && <> · <a href={proximaReuniao.join_url} target="_blank" rel="noreferrer">link da reunião</a></>}
            </div>
          )}

          {comConversa && (
            <>
              <h4>WhatsApp</h4>
              <Conversa chave={`l:${leadId}`} nome={lead.name || formatarTelefone(lead.phone)} onEnviado={aposEnviarMensagem} />
            </>
          )}

          <div className="acoes">
            <button className="btn" onClick={registrarContato} disabled={salvando} title="Para contatos fora do WhatsApp do CRM (ligação, e-mail, reunião…)">
              ✓ Registrar contato por outro meio
            </button>
            {comConversa && !haNumeroConectado && lead.phone && (
              <a className="btn" href={linkWhatsApp(lead.phone)} target="_blank" rel="noreferrer">Abrir no WhatsApp Web</a>
            )}
          </div>
          <p className="suave pequeno">
            {lead.last_contact_at ? `Último contato ${tempoDesde(lead.last_contact_at)} (${dataHora(lead.last_contact_at)})` : 'Nenhum contato registrado ainda'}
          </p>

          <div className="grade-2">
            <label>Etapa
              <select value={lead.stage_id} onChange={(e) => aplicar(`/leads/${leadId}`, { method: 'PATCH', body: { stage_id: Number(e.target.value) } })}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Responsável
              <select value={lead.owner_id || ''} onChange={(e) => aplicar(`/leads/${leadId}`, { method: 'PATCH', body: { owner_id: e.target.value ? Number(e.target.value) : null } })}>
                <option value="">Ninguém</option>
                {users.filter((u) => u.active || u.id === lead.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>

          <h4>Anotações</h4>
          <form className="nova-nota" onSubmit={adicionarNota}>
            <input placeholder="Escreva uma anotação…" value={nota} onChange={(e) => setNota(e.target.value)} />
            <button className="btn" disabled={!nota.trim() || salvando}>Adicionar</button>
          </form>

          {respostas.length > 0 && (
            <>
              <h4>Respostas do formulário{lead.extra.formulario ? ` — ${lead.extra.formulario}` : ''}</h4>
              {lead.extra.parcial && (
                <p className="aviso-parcial">◐ Formulário incompleto: a pessoa começou e não terminou. Estas são as respostas até onde ela parou.</p>
              )}
              <dl className="respostas">
                {respostas.map((r) => (
                  <div key={r.id || r.pergunta}><dt>{r.pergunta}</dt><dd>{r.resposta || '—'}</dd></div>
                ))}
              </dl>
            </>
          )}
          {(Object.keys(utm).length > 0 || Object.keys(variaveis).length > 0) && (
            <div className="utms">
              {Object.entries(variaveis).map(([k, v]) => <span key={`v-${k}`} className="tag tag-variavel">{k === 'score' ? 'pontuação' : k}: {v}</span>)}
              {Object.entries(utm).map(([k, v]) => <span key={k} className="tag">{k.replace('utm_', '')}: {v}</span>)}
            </div>
          )}
          {lead.extra?.analise_ia && (
            <details className="analise-ia">
              <summary>Análise de IA do Yay! Forms</summary>
              <p>{lead.extra.analise_ia}</p>
            </details>
          )}

          <h4>Dados</h4>
          <div className="grade-2">
            <label>Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Telefone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>E-mail<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Empresa<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          </div>
          <label>Observações fixas<textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          {mudou && <button className="btn btn-ouro" onClick={salvarDados} disabled={salvando}>Salvar alterações</button>}

          <h4>Histórico</h4>
          <ol className="linha-tempo">
            {eventos.map((ev) => (
              <li key={ev.id} className={`ev-${ev.type}`}>
                <div>{(DESCRICAO[ev.type] || (() => ev.type))(ev.data || {})}</div>
                <small>{dataHora(ev.created_at)}{ev.user_name ? ` · ${ev.user_name}` : ' · sistema'}</small>
              </li>
            ))}
          </ol>

          {user.role === 'admin' && onExcluido && <button className="btn btn-perigo" onClick={excluir}>Excluir lead</button>}
        </div>
      )}
    </div>
  );
}
