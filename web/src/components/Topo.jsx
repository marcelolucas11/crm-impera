import { useCallback, useEffect, useState } from 'react';
import { FotoUsuario } from './FotoUsuario.jsx';
import logo from '../assets/logo-impera.png';
import { Users, UserRound, LogOut, Radio, SquareKanban, MessageCircle, Camera, Send, Bot, ChartColumn, BellRing, Download } from 'lucide-react';
import { useInstalacao } from '../pwa.js';
import { SeloModoLive } from './ModoLive.jsx';
import { useModoLive, alternarModoLive } from '../modoLive.js';
import { useT } from '../i18n/index.jsx';
import { api } from '../api.js';
import { useEvento, useAtualizacaoPeriodica } from '../tempoReal.js';
import { ORDEM_TELAS, podeVer, pode } from '../permissoes.js';
import SeletorIdioma from './SeletorIdioma.jsx';

// Ícones das abas (aparecem na barra de baixo do celular)
const ICONES = { kanban: SquareKanban, whatsapp: MessageCircle, instagram: Camera, disparos: Send, ia: Bot, estatisticas: ChartColumn };

export default function Topo({ user, pagina, setPagina, resumo, sair }) {
  const [menu, setMenu] = useState(false);
  const { ativo: live } = useModoLive();
  const [instagram, setInstagram] = useState(null);
  const t = useT();
  const instalacao = useInstalacao();
  const abas = ORDEM_TELAS.filter((id) => podeVer(user, id));

  // Contador da aba Instagram: conversas do Direct não lidas (e comentários novos, para quem vê comentários)
  const veInstagram = podeVer(user, 'instagram');
  const carregarInstagram = useCallback(() => {
    if (!veInstagram) return;
    api('/instagram/resumo').then(setInstagram).catch(() => {});
  }, [veInstagram]);
  useEffect(() => {
    carregarInstagram();
  }, [carregarInstagram]);
  useAtualizacaoPeriodica(carregarInstagram, { semTempoReal: 30000, comTempoReal: 180000, ligado: veInstagram });
  useEvento('instagram', (d) => { if (d?.conversa || d?.comentarios || d?.reconectou) carregarInstagram(); });

  const contador = (id) => {
    if (id === 'whatsapp' && resumo?.conversas_nao_lidas) return resumo.conversas_nao_lidas;
    if (id === 'kanban' && resumo?.aguardando) return resumo.aguardando;
    if (id === 'instagram' && instagram) {
      return (pode(user, 'instagram') ? instagram.nao_lidas || 0 : 0) + (pode(user, 'instagram_comentarios') ? instagram.comentarios || 0 : 0);
    }
    return 0;
  };
  const dicaContador = (id) => (id === 'kanban' ? t('topo.aguardando') : id === 'instagram' ? t('topo.instagramPendencias') : t('topo.naoLidas'));

  return (
    <header className="topo">
      <div className="marca-topo">
        <img className="marca-logo" src={logo} alt="" />
        <div className="marca">IMPERA <span>CRM</span></div>
      </div>

      <nav className="abas" aria-label={t('topo.navegacao')}>
        {abas.map((id) => ({ id, rotulo: t(`topo.aba.${id}`) })).map((a) => (
          <button
            key={a.id}
            className={`aba ${pagina === a.id ? 'ativa' : ''}`}
            onClick={() => setPagina(a.id)}
            aria-current={pagina === a.id ? 'page' : undefined}
          >
            {ICONES[a.id] && <span className="aba-icone" aria-hidden="true">{(() => { const I = ICONES[a.id]; return <I size={21} strokeWidth={1.9} />; })()}</span>}
            <span className="aba-rotulo">{a.rotulo}</span>
            <span className="aba-rotulo-curto" aria-hidden="true">{t(`topo.abaCurta.${a.id}`)}</span>
            {contador(a.id) > 0 && (
              <span className={`aba-contador ${a.id === 'kanban' ? 'aviso' : ''} ${a.id === 'instagram' ? 'aba-contador-ig' : ''}`} title={dicaContador(a.id)}>
                {contador(a.id)}
              </span>
            )}
          </button>
        ))}
      </nav>

      <SeloModoLive />
      <div className="usuario">
        <button className={`avatar ${user.foto ? 'avatar-com-foto' : ''}`} onClick={() => setMenu(!menu)} title={user.name}>
          <FotoUsuario usuario={user} tamanho={34} titulo="" />
        </button>
        {menu && (
          <div className="menu menu-conta" onMouseLeave={() => setMenu(false)}>
            <div className="menu-nome">{user.name}<small>{user.email}</small></div>
            {/* Foto e senha ficam na aba Equipe e integrações (seção "Minha conta"); quem não é admin vê só essa seção */}
            <button onClick={() => { setMenu(false); setPagina('equipe'); }}>
              {user.role === 'admin' ? <><Users size={15} /> {t('topo.equipe')}</> : <><UserRound size={15} /> {t('topo.minhaConta')}</>}
            </button>
            <button onClick={() => { setMenu(false); window.__crmEquipeAba = 'notificacoes'; setPagina('equipe'); window.dispatchEvent(new CustomEvent('crm-equipe-aba', { detail: 'notificacoes' })); }}>
              <BellRing size={15} /> {t('topo.notificacoes')}
            </button>
            {instalacao.podeInstalar && !instalacao.instalado && (
              <button onClick={() => { setMenu(false); instalacao.instalar(); }}><Download size={15} /> {t('topo.instalarApp')}</button>
            )}
            <button onClick={() => { alternarModoLive(); setMenu(false); }}><Radio size={15} /> {live ? t('live.desligar') : t('live.ligar')}</button>
            <button onClick={sair}><LogOut size={15} /> {t('topo.sair')}</button>
            <SeletorIdioma />
          </div>
        )}
      </div>
    </header>
  );
}
