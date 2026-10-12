import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

export default function TrocarSenha({ onFechar }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);

  const salvar = async (e) => {
    e.preventDefault();
    setErro('');
    try {
      await api('/auth/senha', { method: 'POST', body: { atual, nova } });
      setOk(true);
    } catch (err) {
      setErro(err.message);
    }
  };

  return (
    <Modal titulo="Trocar minha senha" onFechar={onFechar}>
      {ok ? (
        <>
          <p>Senha alterada.</p>
          <button className="btn btn-ouro" onClick={onFechar}>Fechar</button>
        </>
      ) : (
        <form onSubmit={salvar} className="form">
          <label>Senha atual<input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} required /></label>
          <label>Nova senha (mín. 8)<input type="password" value={nova} onChange={(e) => setNova(e.target.value)} minLength={8} required /></label>
          {erro && <div className="erro">{erro}</div>}
          <button className="btn btn-ouro">Salvar</button>
        </form>
      )}
    </Modal>
  );
}
