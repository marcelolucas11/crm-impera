import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

export default function NovoLead({ stages, users, user, onFechar, onCriado }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', company: '', stage_id: stages.find((s) => s.role === 'entrada')?.id || stages[0]?.id || '', owner_id: user.id });
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const campo = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const criar = async (e) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const d = await api('/leads', {
        method: 'POST',
        body: { ...form, stage_id: Number(form.stage_id) || undefined, owner_id: Number(form.owner_id) || undefined },
      });
      onCriado(d.lead);
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  };

  return (
    <Modal titulo="Novo lead" onFechar={onFechar}>
      <form className="form" onSubmit={criar}>
        <label>Nome<input {...campo('name')} autoFocus /></label>
        <label>Telefone / WhatsApp<input {...campo('phone')} placeholder="(11) 98765-4321" /></label>
        <label>E-mail<input type="email" {...campo('email')} /></label>
        <label>Empresa<input {...campo('company')} /></label>
        <div className="grade-2">
          <label>Etapa
            <select {...campo('stage_id')}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label>Responsável
            <select {...campo('owner_id')}>{users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </label>
        </div>
        {erro && <div className="erro">{erro}</div>}
        <button className="btn btn-ouro" disabled={enviando}>{enviando ? 'Criando…' : 'Criar lead'}</button>
      </form>
    </Modal>
  );
}
