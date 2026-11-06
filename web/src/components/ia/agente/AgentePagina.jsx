// Aba "IA → Agente": a assistente pessoal de cada usuário (chat, agendados, cérebro, ações e ajustes)
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, MessagesSquare, CalendarClock, Brain, ListChecks, Settings2 } from 'lucide-react';
import { api } from '../../../api.js';
import { useEvento } from '../../../tempoReal.js';
import { useT } from '../../../i18n/index.jsx';
import { useAviso } from '../../disparos/comum.jsx';
import Chat from './Chat.jsx';
import Agendados from './Agendados.jsx';
import Cerebro from './Cerebro.jsx';
import Acoes from './Acoes.jsx';
import Ajustes from './Ajustes.jsx';
import { dinheiro } from './comum.js';
import './agente.css';

const SECOES = [
  { id: 'chat', icone: MessagesSquare },
  { id: 'agendados', icone: CalendarClock },
  { id: 'cerebro', icone: Brain },
  { id: 'acoes', icone: ListChecks },
  { id: 'ajustes', icone: Settings2 },
];
const CHAVE = 'crm.agente.secao';

export default function AgentePagina({ user, aoAbrirConversa, aoMudarNome }) {
  const t = useT();
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [secao, setSecaoEstado] = useState(() => { try { const s = localStorage.getItem(CHAVE); return SECOES.some((x) => x.id === s) ? s : 'chat'; } catch { return 'chat'; } });
  const setSecao = (s) => { setSecaoEstado(s); try { localStorage.setItem(CHAVE, s); } catch { /* sem armazenamento */ } };

  const carregar = useCallback(() => api('/agente').then((d) => { setDados(d); aoMudarNome?.(d.config.nome); }).catch((e) => aviso(e.message, 'erro')), [aviso, aoMudarNome]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('agente', (d) => {
    if (d?.usuario && d.usuario !== user.id) return;
    if (d?.alerta) aviso(d.alerta, 'erro');
    if (d?.status === 'ociosa' || d?.acoes || d?.contexto || d?.agendados || d?.transcricao || d?.reconectou) carregar();
  });

  if (!dados) return <div className="dp-centro"><div className="carregando" /></div>;
  const { config: cfg, uso } = dados;

  return (
    <div className="dp-aba ag-pagina">
      <section className="dp-mestre ligada ag-mestre">
        <div className="dp-mestre-icone"><Sparkles size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>{t('ia.agente.titulo', { nome: cfg.nome })}</h2>
          <p className="suave">{t('ia.agente.descricao', { nome: cfg.nome })}</p>
          <p className="dp-mestre-status">
            {t('ia.agente.status.chat', { gasto: dinheiro(uso.chat.gasto), teto: dinheiro(uso.chat.teto) })}
            {' · '}{t('ia.agente.status.agendados', { gasto: dinheiro(uso.agendados.gasto), teto: dinheiro(uso.agendados.teto) })}
            {dados.pendentes > 0 && <> · <button type="button" className="ag-link" onClick={() => setSecao('acoes')}>{t('ia.agente.status.pendentes', { n: dados.pendentes })}</button></>}
            {' · '}{dados.transcricao.pronta ? t('ia.agente.status.transcricaoOn') : t('ia.agente.status.transcricaoOff')}
            {!cfg.chave_configurada && <> · <b className="ag-alerta">{t('ia.agente.status.semChave')}</b></>}
          </p>
        </div>
      </section>

      <nav className="dp-subabas ag-secoes" aria-label={t('ia.agente.secoes')}>
        {SECOES.map((s) => {
          const I = s.icone;
          return (
            <button key={s.id} className={`dp-subaba ${secao === s.id ? 'ativa' : ''}`} onClick={() => setSecao(s.id)} aria-current={secao === s.id ? 'page' : undefined}>
              <I size={15} /> <span>{t(`ia.agente.secao.${s.id}`)}</span>
              {s.id === 'acoes' && dados.pendentes > 0 && <span className="aba-contador">{dados.pendentes}</span>}
              {s.id === 'agendados' && dados.agendados_ativos > 0 && <span className="aba-contador ag-contador-suave">{dados.agendados_ativos}</span>}
            </button>
          );
        })}
      </nav>

      {secao === 'chat' && <Chat user={user} dados={dados} aoAbrirConversa={aoAbrirConversa} aoMudar={carregar} />}
      {secao === 'agendados' && <Agendados user={user} dados={dados} aoAbrirConversa={aoAbrirConversa} />}
      {secao === 'cerebro' && <Cerebro user={user} dados={dados} aoMudar={carregar} />}
      {secao === 'acoes' && <Acoes user={user} aoAbrirConversa={aoAbrirConversa} aoMudar={carregar} />}
      {secao === 'ajustes' && <Ajustes user={user} dados={dados} aoMudar={carregar} />}
    </div>
  );
}
