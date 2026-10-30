import { useRef, useState } from 'react';
import { api } from '../api.js';
import TrocarSenha from './TrocarSenha.jsx';
import { FotoUsuario, prepararFoto } from './FotoUsuario.jsx';
import logo from '../assets/logo-impera.png';
import { Users, KeyRound, LogOut, Camera, Trash2 } from 'lucide-react';

const ABAS = [
  { id: 'kanban', rotulo: 'Kanban' },
  { id: 'whatsapp', rotulo: 'WhatsApp' },
  { id: 'disparos', rotulo: 'Disparos' },
  { id: 'ia', rotulo: 'IA' },
  { id: 'estatisticas', rotulo: 'Estatísticas' },
];

export default function Topo({ user, pagina, setPagina, resumo, sair, aoMudarFoto, setErro }) {
  const [menu, setMenu] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const entradaFoto = useRef(null);

  // Minha foto (aparece nos cartões dos leads de que sou responsável)
  const escolherFoto = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      const foto = await prepararFoto(arquivo);
      const d = await api(`/users/${user.id}/foto`, { method: 'PUT', body: { foto } });
      aoMudarFoto?.(d.user);
    } catch (err) { setErro?.(err.message); }
  };
  const removerFoto = async () => {
    setMenu(false);
    try { const d = await api(`/users/${user.id}/foto`, { method: 'DELETE' }); aoMudarFoto?.(d.user); } catch (err) { setErro?.(err.message); }
  };

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
            <button onClick={() => { setMenu(false); entradaFoto.current?.click(); }}><Camera size={15} /> {user.foto ? 'Trocar minha foto' : 'Adicionar minha foto'}</button>
            {user.foto && <button onClick={removerFoto}><Trash2 size={15} /> Remover minha foto</button>}
            {user.role === 'admin' && <button onClick={() => { setMenu(false); setPagina('equipe'); }}><Users size={15} /> Equipe e integrações</button>}
            <button onClick={() => { setMenu(false); setTrocandoSenha(true); }}><KeyRound size={15} /> Trocar minha senha</button>
            <button onClick={sair}><LogOut size={15} /> Sair</button>
          </div>
        )}
      </div>
      <input ref={entradaFoto} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={escolherFoto} />
      {trocandoSenha && <TrocarSenha onFechar={() => setTrocandoSenha(false)} />}
    </header>
  );
}
