import { useRef, useState } from 'react';
import { ChevronDown, Smartphone, UserRound, Users, UserX } from 'lucide-react';
import MenuFlutuante, { OpcaoMenu, TituloMenu } from './MenuFlutuante.jsx';
import { FotoUsuario } from './FotoUsuario.jsx';
import { formatarTelefone } from '../utils.js';

// Chip da barra rápida que abre uma lista de opções (mesmo estilo dos outros chips)
function ChipMenu({ ativo, icone, rotulo, titulo, className = '', largura = 260, children }) {
  const botao = useRef(null);
  const [aberto, setAberto] = useState(false);
  const fechar = () => setAberto(false);
  return (
    <>
      <button ref={botao} type="button" className={`chip chip-menu ${ativo ? 'ativo' : ''} ${aberto ? 'aberto' : ''} ${className}`}
        onClick={() => setAberto((v) => !v)} title={titulo} aria-haspopup="menu" aria-expanded={aberto}>
        {icone} <span className="chip-menu-rotulo">{rotulo}</span> <ChevronDown size={13} className="chip-menu-seta" />
      </button>
      {aberto && (
        <MenuFlutuante ancora={botao.current} aoFechar={fechar} largura={largura}>
          {typeof children === 'function' ? children(fechar) : children}
        </MenuFlutuante>
      )}
    </>
  );
}

// Filtro de responsável. valor: 'todos' | 'eu' | 'ninguem' | '<id>'
export function ChipResponsavel({ valor, aoMudar, users, user, contagem = {} }) {
  const ativos = users.filter((u) => u.active);
  const escolhido = /^\d+$/.test(valor) ? users.find((u) => String(u.id) === valor) : null;
  const rotulo = valor === 'eu' ? 'Meus leads' : valor === 'ninguem' ? 'Sem responsável' : escolhido ? escolhido.name.split(' ')[0] : 'Responsável';
  const icone = escolhido ? <FotoUsuario usuario={escolhido} tamanho={18} /> : valor === 'ninguem' ? <UserX size={14} /> : <UserRound size={14} />;
  const n = (k) => (contagem[k] !== undefined ? ` · ${contagem[k]}` : '');
  return (
    <ChipMenu ativo={valor !== 'todos'} icone={icone} rotulo={rotulo} titulo="Filtrar por responsável" className="chip-responsavel">
      {(fechar) => {
        const escolher = (v) => { aoMudar(v); fechar(); };
        return (
          <>
            <TituloMenu>Mostrar leads de</TituloMenu>
            <OpcaoMenu marcada={valor === 'todos'} onClick={() => escolher('todos')} icone={<Users size={16} />}>Todos{n('todos')}</OpcaoMenu>
            <OpcaoMenu marcada={valor === 'eu'} onClick={() => escolher('eu')} icone={<FotoUsuario usuario={user} tamanho={22} />}>Meus leads{n(String(user.id))}</OpcaoMenu>
            <OpcaoMenu marcada={valor === 'ninguem'} onClick={() => escolher('ninguem')} icone={<FotoUsuario usuario={null} tamanho={22} />}>Sem responsável{n('ninguem')}</OpcaoMenu>
            {ativos.length > 0 && <TituloMenu>Equipe</TituloMenu>}
            {ativos.map((u) => (
              <OpcaoMenu key={u.id} marcada={valor === String(u.id)} onClick={() => escolher(String(u.id))} icone={<FotoUsuario usuario={u} tamanho={22} />}>
                {u.name}{n(String(u.id))}
              </OpcaoMenu>
            ))}
          </>
        );
      }}
    </ChipMenu>
  );
}

const conectado = (n) => n?.status === 'conectado';

// Qual WhatsApp usar. valor: '' (automático / todos) ou o id do número em texto.
// textoVazio: como chamar a opção sem número fixo ("Automático" no kanban, "Todos os números" na aba WhatsApp)
export function ChipWhatsApp({ numeros, valor, aoMudar, textoVazio = 'Automático', detalheVazio = '', titulo = 'Escolher o WhatsApp' }) {
  const lista = numeros || [];
  const atual = lista.find((n) => String(n.id) === String(valor)) || null;
  const rotulo = atual ? atual.name : lista.length ? textoVazio : 'Nenhum WhatsApp';
  const led = atual ? (conectado(atual) ? 'led-verde' : 'led-vermelho') : lista.some(conectado) ? 'led-verde' : 'led-apagado';
  return (
    <ChipMenu ativo={Boolean(atual)} icone={<><Smartphone size={14} /><i className={`led ${led}`} /></>} rotulo={rotulo} titulo={titulo} className="chip-whatsapp" largura={280}>
      {(fechar) => {
        const escolher = (v) => { aoMudar(v); fechar(); };
        return (
          <>
            <TituloMenu>WhatsApp</TituloMenu>
            {!lista.length && <p className="menu-vazio">Nenhum número conectado. Um administrador conecta em <b>Equipe e integrações</b>.</p>}
            {lista.length > 0 && (
              <OpcaoMenu marcada={!atual} onClick={() => escolher('')} icone={<Smartphone size={16} />} detalhe={detalheVazio}>{textoVazio}</OpcaoMenu>
            )}
            {lista.map((n) => (
              <OpcaoMenu key={n.id} marcada={atual?.id === n.id} onClick={() => escolher(String(n.id))}
                icone={<i className={`led ${conectado(n) ? 'led-verde' : 'led-vermelho'}`} />}
                detalhe={[n.phone ? formatarTelefone(n.phone) : null, conectado(n) ? null : 'desconectado'].filter(Boolean).join(' · ')}>
                {n.name}
              </OpcaoMenu>
            ))}
          </>
        );
      }}
    </ChipMenu>
  );
}
