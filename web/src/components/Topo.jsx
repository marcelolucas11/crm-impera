import { useState } from 'react';
import { FotoUsuario } from './FotoUsuario.jsx';
import logo from '../assets/logo-impera.png';
import { Users, UserRound, LogOut } from 'lucide-react';

const ABAS = [
  { id: 'kanban', rotulo: 'Kanban' },
  { id: 'whatsapp', rotulo: 'WhatsApp' },
  { id: 'disparos', rotulo: 'Disparos' },
  { id: 'ia', rotulo: 'IA' },
  { id: 'estatisticas', rotulo: 'Estatísticas' },
];

export default function Topo({ user, pagina, setPagina, resumo, sair }) {
  const [menu, setMenu] = useState(false);

  const contador = (id) => {
    if (id === 'whatsapp' && resumo?.conversas_nao_lidas) return resumo.conversas_nao_lidas;
    if (id === 'kanban' && resumo?.aguardando) return resumo.aguardando;
    return 0;
  };

  return (
    <header className="topo">
      <div className="marca-topo">
        <img className="marca-logo" src={logo} alt="" />
        <div className="marca">IMPERA <span>CRM</span></div>
      </div>

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
        <button className={`avatar ${user.foto ? 'avatar-com-foto' : ''}`} onClick={() => setMenu(!menu)} title={user.name}>
          <FotoUsuario usuario={user} tamanho={34} titulo="" />
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <div className="menu-nome">{user.name}<small>{user.email}</small></div>
            {/* Foto e senha ficam na aba Equipe e integrações (seção "Minha conta"); quem não é admin vê só essa seção */}
            <button onClick={() => { setMenu(false); setPagina('equipe'); }}>
              {user.role === 'admin' ? <><Users size={15} /> Equipe e integrações</> : <><UserRound size={15} /> Minha conta</>}
            </button>
            <button onClick={sair}><LogOut size={15} /> Sair</button>
          </div>
        )}
      </div>
    </header>
  );
}
