import { useState } from 'react';
import { iniciais } from '../utils.js';
import TrocarSenha from './TrocarSenha.jsx';

const ABAS = [
  { id: 'kanban', rotulo: 'Kanban' },
  { id: 'whatsapp', rotulo: 'WhatsApp' },
  { id: 'estatisticas', rotulo: 'Estatísticas' },
];

export default function Topo({ user, pagina, setPagina, resumo, sair }) {
  const [menu, setMenu] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  const contador = (id) => {
    if (id === 'whatsapp' && resumo?.conversas_nao_lidas) return resumo.conversas_nao_lidas;
    if (id === 'kanban' && resumo?.aguardando) return resumo.aguardando;
    return 0;
  };

  return (
    <header className="topo">
      <div className="marca">IMPERA <span>CRM</span></div>

      <nav className="abas" aria-label="Telas do CRM">
        {ABAS.map((a) => (
          <button
            key={a.id}
            className={`aba ${pagina === a.id ? 'ativa' : ''}`}
            onClick={() => setPagina(a.id)}
            aria-current={pagina === a.id ? 'page' : undefined}
          >
            {a.rotulo}
            {contador(a.id) > 0 && (
              <span className={`aba-contador ${a.id === 'kanban' ? 'aviso' : ''}`} title={a.id === 'kanban' ? 'Leads aguardando sua resposta' : 'Conversas com mensagens novas'}>
                {contador(a.id)}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="usuario">
        <button className="avatar" onClick={() => setMenu(!menu)} title={user.name}>{iniciais(user.name)}</button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <div className="menu-nome">{user.name}<small>{user.email}</small></div>
            {user.role === 'admin' && <button onClick={() => { setMenu(false); setPagina('equipe'); }}>Equipe e integrações</button>}
            <button onClick={() => { setMenu(false); setTrocandoSenha(true); }}>Trocar minha senha</button>
            <button onClick={sair}>Sair</button>
          </div>
        )}
      </div>
      {trocandoSenha && <TrocarSenha onFechar={() => setTrocandoSenha(false)} />}
    </header>
  );
}
