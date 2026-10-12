import { useState } from 'react';
import { iniciais } from '../utils.js';
import TrocarSenha from './TrocarSenha.jsx';

export default function Header({
  user, busca, setBusca, atrasados, horas, soAtrasados, setSoAtrasados, soMeus, setSoMeus, onNovo, irParaEquipe, sair,
}) {
  const [menu, setMenu] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  return (
    <header className="topo">
      <div className="marca">IMPERA <span>CRM</span></div>

      <input
        className="busca"
        type="search"
        placeholder="Buscar nome, telefone, e-mail ou formulário…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      <div className="filtros">
        <button
          className={`chip ${soAtrasados ? 'ativo' : ''} ${atrasados ? 'chip-alerta' : ''}`}
          onClick={() => setSoAtrasados(!soAtrasados)}
          title={`Leads sem contato há mais de ${horas} h`}
        >
          {atrasados ? `⚠ ${atrasados} sem contato` : '✓ Follow-up em dia'}
        </button>
        <button className={`chip ${soMeus ? 'ativo' : ''}`} onClick={() => setSoMeus(!soMeus)}>Meus leads</button>
      </div>

      <button className="btn btn-ouro" onClick={onNovo}>+ Novo lead</button>

      <div className="usuario">
        <button className="avatar" onClick={() => setMenu(!menu)} title={user.name}>{iniciais(user.name)}</button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <div className="menu-nome">{user.name}<small>{user.email}</small></div>
            {user.role === 'admin' && <button onClick={() => { setMenu(false); irParaEquipe(); }}>Equipe e integrações</button>}
            <button onClick={() => { setMenu(false); setTrocandoSenha(true); }}>Trocar minha senha</button>
            <button onClick={sair}>Sair</button>
          </div>
        )}
      </div>
      {trocandoSenha && <TrocarSenha onFechar={() => setTrocandoSenha(false)} />}
    </header>
  );
}
