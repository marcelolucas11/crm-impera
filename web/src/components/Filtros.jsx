import { useMemo } from 'react';

export const FILTROS_VAZIOS = {
  comNome: false,
  comTelefone: false,
  comEmail: false,
  semNome: false,
  origens: [],
  formulario: '',
  responsavel: 'todos',
  atrasados: false,
  aguardando: false,
  mensagensNovas: false,
  comReuniao: false,
  nuncaContatado: false,
  formIncompleto: false,
  formCompleto: false,
  periodo: 'todos',
};

const ORIGENS = [
  ['yayforms', 'Yay! Forms'],
  ['whatsapp', 'WhatsApp'],
  ['calendly', 'Calendly'],
  ['manual', 'Manual'],
];

const PERIODOS = [
  ['todos', 'Qualquer data'],
  ['hoje', 'Hoje'],
  ['7', 'Últimos 7 dias'],
  ['30', 'Últimos 30 dias'],
];

export function contarFiltros(f) {
  let n = 0;
  for (const k of ['comNome', 'comTelefone', 'comEmail', 'semNome', 'atrasados', 'aguardando', 'mensagensNovas', 'comReuniao', 'nuncaContatado', 'formIncompleto', 'formCompleto']) if (f[k]) n++;
  if (f.origens.length) n++;
  if (f.formulario) n++;
  if (f.responsavel !== 'todos') n++;
  if (f.periodo !== 'todos') n++;
  return n;
}

export function aplicarFiltros(leads, f, user) {
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const limiteData = f.periodo === 'hoje' ? inicioHoje.getTime() : f.periodo === 'todos' ? null : Date.now() - Number(f.periodo) * 86400000;

  return leads.filter((l) => {
    if (f.comNome && !l.name) return false;
    if (f.semNome && l.name) return false;
    if (f.comTelefone && !l.phone) return false;
    if (f.comEmail && !l.email) return false;
    if (f.origens.length && !f.origens.includes(l.source)) return false;
    if (f.formulario && l.form_name !== f.formulario) return false;
    if (f.responsavel === 'eu' && l.owner_id !== user.id) return false;
    if (f.responsavel === 'ninguem' && l.owner_id) return false;
    if (/^\d+$/.test(f.responsavel) && l.owner_id !== Number(f.responsavel)) return false;
    if (f.atrasados && !l.followup_overdue) return false;
    if (f.aguardando && !l.waiting_since) return false;
    if (f.mensagensNovas && !(l.unread_count > 0)) return false;
    if (f.comReuniao && !l.next_meeting_at) return false;
    if (f.nuncaContatado && l.first_contact_at) return false;
    if (f.formIncompleto && !l.form_partial) return false;
    if (f.formCompleto && (l.source !== 'yayforms' || l.form_partial)) return false;
    if (limiteData && new Date(l.created_at).getTime() < limiteData) return false;
    return true;
  });
}

function Marcar({ marcado, aoMudar, children }) {
  return (
    <label className={`opcao ${marcado ? 'marcada' : ''}`}>
      <input type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
      {children}
    </label>
  );
}

export default function PainelFiltros({ filtros, setFiltros, leads, users, total, visiveis }) {
  const formularios = useMemo(
    () => [...new Set(leads.map((l) => l.form_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [leads]
  );
  const muda = (campo) => (valor) => setFiltros({ ...filtros, [campo]: valor });
  const alternarOrigem = (o) =>
    setFiltros({ ...filtros, origens: filtros.origens.includes(o) ? filtros.origens.filter((x) => x !== o) : [...filtros.origens, o] });

  return (
    <div className="painel-filtros">
      <div className="grupo-filtro">
        <span className="rotulo-filtro">Dados preenchidos</span>
        <Marcar marcado={filtros.comNome} aoMudar={(v) => setFiltros({ ...filtros, comNome: v, semNome: v ? false : filtros.semNome })}>Com nome</Marcar>
        <Marcar marcado={filtros.semNome} aoMudar={(v) => setFiltros({ ...filtros, semNome: v, comNome: v ? false : filtros.comNome })}>Sem nome</Marcar>
        <Marcar marcado={filtros.comTelefone} aoMudar={muda('comTelefone')}>Com WhatsApp/telefone</Marcar>
        <Marcar marcado={filtros.comEmail} aoMudar={muda('comEmail')}>Com e-mail</Marcar>
      </div>

      <div className="grupo-filtro">
        <span className="rotulo-filtro">Situação</span>
        <Marcar marcado={filtros.aguardando} aoMudar={muda('aguardando')}>⏳ Aguardando minha resposta</Marcar>
        <Marcar marcado={filtros.atrasados} aoMudar={muda('atrasados')}>⚠ Follow-up atrasado</Marcar>
        <Marcar marcado={filtros.mensagensNovas} aoMudar={muda('mensagensNovas')}>💬 Mensagem nova</Marcar>
        <Marcar marcado={filtros.comReuniao} aoMudar={muda('comReuniao')}>📅 Reunião marcada</Marcar>
        <Marcar marcado={filtros.nuncaContatado} aoMudar={muda('nuncaContatado')}>Nunca contatado</Marcar>
        <Marcar marcado={filtros.formIncompleto} aoMudar={(v) => setFiltros({ ...filtros, formIncompleto: v, formCompleto: v ? false : filtros.formCompleto })}>◐ Formulário incompleto</Marcar>
        <Marcar marcado={filtros.formCompleto} aoMudar={(v) => setFiltros({ ...filtros, formCompleto: v, formIncompleto: v ? false : filtros.formIncompleto })}>Formulário completo</Marcar>
      </div>

      <div className="grupo-filtro">
        <span className="rotulo-filtro">Origem</span>
        {ORIGENS.map(([id, rotulo]) => (
          <Marcar key={id} marcado={filtros.origens.includes(id)} aoMudar={() => alternarOrigem(id)}>{rotulo}</Marcar>
        ))}
      </div>

      <div className="grupo-filtro selects">
        <label>Formulário
          <select value={filtros.formulario} onChange={(e) => muda('formulario')(e.target.value)}>
            <option value="">Todos</option>
            {formularios.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>Responsável
          <select value={filtros.responsavel} onChange={(e) => muda('responsavel')(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="eu">Meus leads</option>
            <option value="ninguem">Sem responsável</option>
            {users.filter((u) => u.active).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
        </label>
        <label>Entrada
          <select value={filtros.periodo} onChange={(e) => muda('periodo')(e.target.value)}>
            {PERIODOS.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
          </select>
        </label>
      </div>

      <div className="rodape-filtros">
        <span className="suave">Mostrando {visiveis} de {total} leads</span>
        <button className="btn btn-pequeno" onClick={() => setFiltros(FILTROS_VAZIOS)} disabled={!contarFiltros(filtros)}>Limpar filtros</button>
      </div>
    </div>
  );
}
