// Revisão dos atendimentos: quem a IA ainda vai abordar ("IA irá atender"), quem está em "IA atendendo" com mensagem do
// lead sem resposta, e se alguém vai responder.
// A revisão roda sozinha a cada 5 min; o botão "Revisar agora" faz na hora e retoma de onde parou quem ficou parado.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ListChecks, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde, formatarTelefone } from '../../utils.js';
import Modal from '../Modal.jsx';
import { useAviso } from '../disparos/comum.jsx';

const SITUACAO = {
  parada: ['Parada — ninguém ia responder', 'erro'],
  atrasada: ['Fila travada — hora vencida', 'erro'],
  retomada: ['Retomada agora', 'ok'],
  agendada: ['Na fila da IA', 'neutro'],
  atendendo_agora: ['IA respondendo agora', 'ok'],
  travada: ['Atendimento travado', 'erro'],
  aguardando_aprovacao: ['Esperando você aprovar (copiloto)', 'aviso'],
};
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

export default function RevisaoAtendimento({ admin, aoAbrir }) {
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [aberta, setAberta] = useState(false);
  const [revisando, setRevisando] = useState(false);

  const carregar = useCallback(() => api('/ia/revisao').then(setDados).catch(() => {}), []);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('ia', () => carregar());

  const revisar = async () => {
    setRevisando(true);
    try {
      const r = await api('/ia/revisao', { method: 'POST' });
      setDados(r);
      const x = r.resultado;
      if (!x.ativa) { aviso('A IA está desligada', 'info'); return; }
      // Diz o que fez E o que está esperando — antes dizia "em dia" mesmo com leads parados na fila
      const corrigiu = [
        x.retomadas && `${x.retomadas} retomada(s)`,
        x.destravadas && `${x.destravadas} destravada(s) da fila`,
        x.soltas && `${x.soltas} atendimento(s) preso(s) solto(s)`,
        x.equipe_assumiu && `${x.equipe_assumiu} já respondida(s) pela equipe`,
        x.passadas_para_equipe && `${x.passadas_para_equipe} passada(s) para você`,
      ].filter(Boolean);
      const esperando = [
        x.ira_atender && `${x.ira_atender} em “IA irá atender”`,
        x.na_fila && `${x.na_fila} na fila${x.proxima ? ` (próxima ~${hora(x.proxima)})` : ''}`,
        x.aguardando_aprovacao && `${x.aguardando_aprovacao} esperando sua aprovação`,
      ].filter(Boolean);
      const texto = [
        corrigiu.length ? `Revisão: ${corrigiu.join(' · ')}` : 'Revisão: nada parado para corrigir',
        esperando.length ? esperando.join(' · ') : 'ninguém esperando resposta',
        x.motivo_espera ? `Segurando agora: ${x.motivo_espera}` : null,
      ].filter(Boolean).join(' — ');
      aviso(texto, x.motivo_espera && !corrigiu.length ? 'info' : undefined);
    } catch (e) { aviso(e.message, 'erro'); } finally { setRevisando(false); }
  };

  if (!dados) return null;
  const pend = dados.pendencias || [];
  const paradas = pend.filter((p) => ['parada', 'travada', 'atrasada'].includes(p.situacao)).length;
  const ultima = dados.ultima_revisao;

  return (
    <>
      <div className={`ia-revisao-faixa${paradas ? ' ia-revisao-alerta' : ''}`}>
        <ListChecks size={16} />
        <span className="pequeno">
          {dados.ira_atender ? <><b>{dados.ira_atender}</b> em “IA irá atender” · </> : null}
          <b>{dados.atendendo ?? dados.conversas_ativas}</b> em “IA atendendo”
          {pend.length ? <> · <b>{pend.length}</b> esperando a IA{paradas ? <> (<b>{paradas}</b> parada(s))</> : <> (todas na fila{dados.proxima ? `, próxima ~${hora(dados.proxima)}` : ''})</>}</> : ' · todas em dia'}
          {ultima && <span className="suave"> · última revisão {tempoDesde(ultima.em)}{ultima.retomadas ? `, retomou ${ultima.retomadas}` : ''}</span>}
        </span>
        {pend.length > 0 && <button type="button" className="btn btn-pequeno" onClick={() => setAberta(true)}>Ver quem</button>}
        {admin && (
          <button type="button" className="btn btn-pequeno btn-ouro" disabled={revisando} onClick={revisar}>
            <RefreshCw size={13} className={revisando ? 'girando-icone' : ''} /> {revisando ? 'Revisando…' : 'Revisar agora'}
          </button>
        )}
      </div>
      {aberta && createPortal(
        <Modal titulo="Leads esperando a IA" onFechar={() => setAberta(false)} largo>
          <p className="pequeno suave">
            Aqui entram os leads em <b>“IA irá atender”</b> (a IA ainda não mandou a 1ª mensagem) e os em <b>“IA atendendo”</b> com
            mensagem do lead sem resposta. A revisão roda sozinha a cada 5 minutos. As <b>paradas</b> e a <b>fila travada</b> são retomadas de onde pararam (a IA relê as mensagens sem
            resposta), sempre respeitando as travas de proteção e o horário. Se alguém da equipe já respondeu, a IA sai da conversa;
            depois de 3 tentativas sem conseguir, ela passa o lead para você.
          </p>
          <div className="ia-fila-lista">
            {pend.map((p) => {
              const [rotulo, tipo] = SITUACAO[p.situacao] || [p.situacao, 'neutro'];
              return (
                <div key={p.conversa_id} className="ia-revisao-item">
                  <span className="ia-fila-nome">{p.nome || 'Sem nome'}{p.phone && <span className="suave pequeno"> · {formatarTelefone(p.phone)}</span>}</span>
                  <span className={`ia-status ia-status-${tipo}`}>{rotulo}</span>
                  <span className="pequeno suave">
                    {p.primeira_mensagem ? 'IA irá atender — a 1ª mensagem ainda não saiu' : `${p.mensagens_sem_resposta} msg sem resposta desde ${tempoDesde(p.sem_resposta_desde)}`}
                    {['agendada', 'retomada'].includes(p.situacao) && p.proxima_em ? ` · responde por volta de ${hora(p.proxima_em)}` : ''}
                    {p.motivo_espera ? ` · ${p.motivo_espera}` : ''}
                  </span>
                  {p.ultima_mensagem && <span className="pequeno ia-revisao-msg">“{p.ultima_mensagem}”</span>}
                  <button type="button" className="btn btn-pequeno" onClick={() => { setAberta(false); aoAbrir?.(p.lead_id ? `l:${p.lead_id}` : p.chave); }}>
                    <ExternalLink size={13} /> Abrir
                  </button>
                </div>
              );
            })}
          </div>
          <div className="ia-dir-rodape">
            <span className="pequeno suave">{paradas ? `${paradas} parada(s) — clique em Revisar agora para retomar já` : 'Nenhuma parada: a IA vai responder todas'}</span>
            <span className="ia-dir-acoes">
              <button type="button" className="btn btn-pequeno" onClick={() => setAberta(false)}>Fechar</button>
              {admin && <button type="button" className="btn btn-ouro" disabled={revisando} onClick={revisar}><RefreshCw size={14} /> {revisando ? 'Revisando…' : 'Revisar agora'}</button>}
            </span>
          </div>
        </Modal>,
        document.body
      )}
    </>
  );
}
