import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dataHora, tempoDesde } from '../utils.js';
import WhatsAppNumeros from './WhatsAppNumeros.jsx';
import CalendlyStatus from './CalendlyStatus.jsx';
import FormulariosYay from './FormulariosYay.jsx';
import SegredosYay from './SegredosYay.jsx';
import Atualizacao from './Atualizacao.jsx';

export default function Equipe({ user }) {
  const [users, setUsers] = useState([]);
  const [novo, setNovo] = useState({ name: '', email: '', senha: '', role: 'member' });
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [yay, setYay] = useState(null);
  const [eventos, setEventos] = useState([]);

  const carregar = useCallback(async () => {
    try {
      const [u, c, ev] = await Promise.all([api('/users'), api('/yayforms/config'), api('/yayforms/eventos')]);
      setUsers(u.users);
      setYay(c);
      setEventos(ev.eventos);
    } catch (e) { setErro(e.message); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const executar = async (fn, sucesso) => {
    setErro(''); setMsg('');
    try { await fn(); setMsg(sucesso); await carregar(); } catch (e) { setErro(e.message); }
  };

  const criar = (e) => {
    e.preventDefault();
    executar(async () => {
      await api('/users', { method: 'POST', body: novo });
      setNovo({ name: '', email: '', senha: '', role: 'member' });
    }, 'Usuário criado.');
  };

  const redefinir = (u) => {
    const senha = prompt(`Nova senha para ${u.name} (mín. 8 caracteres):`);
    if (senha) executar(() => api(`/users/${u.id}`, { method: 'PATCH', body: { senha } }), `Senha de ${u.name} redefinida.`);
  };

  const urlWebhook = yay ? yay.url || `${window.location.origin}${yay.caminho}` : '';

  return (
    <>
      <div className="pagina">
        {erro && <div className="erro">{erro}</div>}
        {msg && <div className="sucesso">{msg}</div>}

        {user?.role === 'admin' && <Atualizacao />}

        <section className="cartao-secao">
          <h2>Equipe</h2>
          <table className="tabela">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Último acesso</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'inativo'}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} disabled={u.id === user.id}
                      onChange={(e) => executar(() => api(`/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Papel atualizado.')}>
                      <option value="member">Equipe</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </td>
                  <td>{u.last_login_at ? tempoDesde(u.last_login_at) : 'nunca'}</td>
                  <td>{u.active ? 'Ativo' : 'Desativado'}</td>
                  <td>
                    <div className="acoes-linha">
                      <button className="btn btn-pequeno" onClick={() => redefinir(u)}>Senha</button>
                      {u.id !== user.id && (
                        <button className="btn btn-pequeno"
                          onClick={() => executar(() => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), u.active ? 'Usuário desativado.' : 'Usuário reativado.')}>
                          {u.active ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Adicionar pessoa</h3>
          <form className="form-linha" onSubmit={criar}>
            <input placeholder="Nome" value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} required />
            <input type="email" placeholder="E-mail" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} required />
            <input type="text" placeholder="Senha inicial (mín. 8)" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} minLength={8} required />
            <select value={novo.role} onChange={(e) => setNovo({ ...novo, role: e.target.value })}>
              <option value="member">Equipe</option>
              <option value="admin">Administrador</option>
            </select>
            <button className="btn btn-ouro">Adicionar</button>
          </form>
        </section>

        <WhatsAppNumeros aoMensagem={setMsg} aoErro={setErro} />
        <CalendlyStatus aoMensagem={setMsg} aoErro={setErro} />

        <section className="cartao-secao">
          <h2>Yay! Forms</h2>
          <p className="suave">Cole esta URL em <b>Integrar → Webhooks → Add webhook</b> no formulário e escolha o formato <b>V2</b>.</p>
          <div className="copiar">
            <code>{urlWebhook}</code>
            <button className="btn btn-pequeno" onClick={() => navigator.clipboard?.writeText(urlWebhook).then(() => setMsg('URL copiada.'))}>Copiar</button>
          </div>
          {!yay?.url && (
            <p className="suave pequeno">
              Enquanto o CRM roda no Mac, o endereço acima só funciona nesta máquina. Para o Yay! Forms alcançar o CRM,
              use o endereço público do Tailscale Funnel e preencha PUBLIC_URL no .env.
            </p>
          )}
          <p className="suave pequeno">Assinatura: {yay?.assinatura_ativa ? 'conferida (só entram webhooks com um dos segredos abaixo)' : 'não conferida (nenhum segredo cadastrado)'}</p>

          <SegredosYay aoMensagem={setMsg} aoErro={setErro} aoMudar={carregar} />

          <FormulariosYay aoMensagem={setMsg} aoErro={setErro} />

          <h3>Últimos recebidos</h3>
          {eventos.length === 0 ? <p className="suave">Nenhum webhook recebido ainda.</p> : (
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Resposta</th><th>Status</th><th>Lead</th><th /></tr></thead>
              <tbody>
                {eventos.map((ev) => (
                  <tr key={ev.id}>
                    <td>{dataHora(ev.received_at)}</td>
                    <td title={ev.sinal_parcial ? `Campo usado: ${ev.sinal_parcial}` : 'O webhook não indicou; contada como completa'}>{ev.parcial ? 'Parcial' : 'Completa'}</td>
                    <td className={ev.status === 'error' || ev.status === 'assinatura_invalida' ? 'alerta' : ''}>{{ processed: 'Processado', duplicado: 'Repetido (nada novo)', error: `Erro: ${ev.error}`, assinatura_invalida: 'Recusado: segredo não cadastrado' }[ev.status] || 'Recebido'}</td>
                    <td>{ev.lead_id ? `#${ev.lead_id}` : '—'}</td>
                    <td>
                      {(ev.status === 'error' || ev.status === 'received' || ev.status === 'assinatura_invalida') && (
                        <button className="btn btn-pequeno" onClick={() => executar(() => api(`/yayforms/eventos/${ev.id}/reprocessar`, { method: 'POST' }), 'Reprocessado.')}>Reprocessar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
