import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatarTelefone, linkWhatsApp, tempoDesde, dataHora, dataCurta } from '../utils.js';
import Conversa from './Conversa.jsx';

const DESCRICAO = {
  created: () => 'Lead criado',
  form_submitted: (d) => `Respondeu o formulário${d.formulario ? ` “${d.formulario}”` : ''}`,
  form_resubmitted: (d) => `Respondeu de novo${d.formulario ? ` “${d.formulario}”` : ''}`,
  stage_changed: (d) => `Etapa: ${d.de} → ${d.para}`,
  owner_changed: (d) => (d.para ? `Responsável: ${d.para}` : 'Responsável removido'),
  contact: (d) => `Contato registrado (${d.canal})${d.nota ? `: ${d.nota}` : ''}`,
  note: (d) => d.texto,
  updated: (d) => `Editou ${d.campos?.join(', ')}`,
  meeting_scheduled: (d) => `📅 Agendou “${d.evento}” para ${dataHora(d.inicio)}`,
  meeting_rescheduled: (d) => `📅 Reagendou “${d.evento}” para ${dataHora(d.inicio)}`,
  meeting_canceled: (d) => `Cancelou “${d.evento}”${d.motivo ? ` (${d.motivo})` : ''}`,
};

const valoresIniciais = (l) => ({
  name: l.name || '',
  phone: formatarTelefone(l.phone),
  email: l.email || '',
  company: l.company || '',
  notes: l.notes || '',
});

export default function LeadPanel({ leadId, stages, users, user, horas, onFechar, onAtualizado, onExcluido }) {
  const [lead, setLead] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [reunioes, setReunioes] = useState([]);
  const [form, setForm] = useState({});
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Recarrega o lead. Edições ainda não salvas nos campos de dados são mantidas, a não ser que resetarForm seja pedido.
  const leadAtual = useRef(null);
  const formAtual = useRef(form);
  formAtual.current = form;

  const carregar = useCallback(async ({ resetarForm = false } = {}) => {
    try {
      const d = await api(`/leads/${leadId}`);
      const anterior = leadAtual.current;
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

  useEffect(() => { carregar({ resetarForm: true }); }, [carregar]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const aplicar = async (caminho, opcoes, { resetarForm = false } = {}) => {
    setErro('');
    setSalvando(true);
    try {
      const d = await api(caminho, opcoes);
      if (d?.lead) onAtualizado(d.lead);
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
    if (leadAtual.current) onAtualizado(leadAtual.current);
  };
  const proximaReuniao = reunioes.find((r) => r.status === 'active' && new Date(r.start_time) > new Date());
  const registrarContato = () => aplicar(`/leads/${leadId}/contato`, { method: 'POST', body: { canal: 'whatsapp' } });
  const adicionarNota = async (e) => {
    e.preventDefault();
    if (!nota.trim()) return;
    if (await aplicar(`/leads/${leadId}/notas`, { method: 'POST', body: { texto: nota } })) setNota('');
  };
  const excluir = async () => {
    if (!confirm('Excluir este lead e todo o histórico? Não dá para desfazer.')) return;
    try {
      await api(`/leads/${leadId}`, { method: 'DELETE' });
      onExcluido();
    } catch (e) { setErro(e.message); }
  };

  const respostas = lead?.extra?.respostas || [];
  const utm = lead?.extra?.utm || {};

  return (
    <div className="fundo-painel" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <aside className="painel">
        <div className="painel-topo">
          <h2>{lead ? lead.name || formatarTelefone(lead.phone) || lead.email || `Lead #${lead.id}` : 'Carregando…'}</h2>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        {erro && <div className="erro">{erro}</div>}

        {lead && (
          <div className="painel-corpo">
            {lead.followup_overdue && (
              <div className="aviso-followup">
                ⚠ Sem contato {tempoDesde(lead.last_activity_at)} — limite é {horas} h.
              </div>
            )}

            {proximaReuniao && (
              <div className="aviso-reuniao">
                📅 {proximaReuniao.event_name} — <b>{dataCurta(proximaReuniao.start_time)}</b>
                {proximaReuniao.join_url && <> · <a href={proximaReuniao.join_url} target="_blank" rel="noreferrer">link da reunião</a></>}
              </div>
            )}

            <h4>WhatsApp</h4>
            <Conversa leadId={leadId} onEnviado={aposEnviarMensagem} />

            <div className="acoes">
              <button className="btn btn-ouro" onClick={registrarContato} disabled={salvando} title="Para contatos fora do WhatsApp do CRM (ligação, e-mail…)">✓ Registrar outro contato</button>
              {lead.phone && (
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

            <h4>Dados</h4>
            <div className="grade-2">
              <label>Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Telefone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>E-mail<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Empresa<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
            </div>
            <label>Observações<textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            {mudou && <button className="btn btn-ouro" onClick={salvarDados} disabled={salvando}>Salvar alterações</button>}

            {respostas.length > 0 && (
              <>
                <h4>Respostas do formulário{lead.extra.formulario ? ` — ${lead.extra.formulario}` : ''}</h4>
                <dl className="respostas">
                  {respostas.map((r) => (
                    <div key={r.id}><dt>{r.pergunta}</dt><dd>{r.resposta || '—'}</dd></div>
                  ))}
                </dl>
              </>
            )}
            {Object.keys(utm).length > 0 && (
              <div className="utms">
                {Object.entries(utm).map(([k, v]) => <span key={k} className="tag">{k.replace('utm_', '')}: {v}</span>)}
              </div>
            )}

            <h4>Histórico</h4>
            <form className="nova-nota" onSubmit={adicionarNota}>
              <input placeholder="Escreva uma nota…" value={nota} onChange={(e) => setNota(e.target.value)} />
              <button className="btn" disabled={!nota.trim() || salvando}>Adicionar</button>
            </form>
            <ol className="linha-tempo">
              {eventos.map((ev) => (
                <li key={ev.id} className={`ev-${ev.type}`}>
                  <div>{(DESCRICAO[ev.type] || (() => ev.type))(ev.data || {})}</div>
                  <small>{dataHora(ev.created_at)}{ev.user_name ? ` · ${ev.user_name}` : ' · sistema'}</small>
                </li>
              ))}
            </ol>

            {user.role === 'admin' && <button className="btn btn-perigo" onClick={excluir}>Excluir lead</button>}
          </div>
        )}
      </aside>
    </div>
  );
}
