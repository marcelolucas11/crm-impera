// Revisão dos atendimentos: quem está em "IA atendendo" com mensagem do lead sem resposta, e se alguém vai responder.
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
      const partes = [
        x.retomadas && `${x.retomadas} retomada(s)`,
        x.equipe_assumiu && `${x.equipe_assumiu} já respondida(s) pela equipe`,
        x.passadas_para_equipe && `${x.passadas_para_equipe} passada(s) para você`,
        x.soltas && `${x.soltas} destravada(s)`,
      ].filter(Boolean);
      aviso(!x.ativa ? 'A IA está desligada' : partes.length ? `Revisão: ${partes.join(' · ')}` : `Revisão: as ${x.conversas_ativas} conversa(s) em "IA atendendo" estão em dia`, x.ativa ? undefined : 'info');
    } catch (e) { aviso(e.message, 'erro'); } finally { setRevisando(false); }
  };

  if (!dados) return null;
  const pend = dados.pendencias || [];
  const paradas = pend.filter((p) => ['parada', 'travada'].includes(p.situacao)).length;
  const ultima = dados.ultima_revisao;

  return (
    <>
      <div className={`ia-revisao-faixa${paradas ? ' ia-revisao-alerta' : ''}`}>
        <ListChecks size={16} />
        <span className="pequeno">
          <b>{dados.conversas_ativas}</b> conversa(s) em “IA atendendo”
          {pend.length ? <> · <b>{pend.length}</b> com mensagem do lead sem resposta{paradas ? <> (<b>{paradas}</b> parada(s))</> : ' (todas já na fila da IA)'}</> : ' · todas em dia'}
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
        <Modal titulo="Leads em “IA atendendo” sem resposta" onFechar={() => setAberta(false)} largo>
          <p className="pequeno suave">
            A revisão roda sozinha a cada 5 minutos. As <b>paradas</b> são retomadas de onde pararam (a IA relê as mensagens sem
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
                    {p.primeira_mensagem ? 'A 1ª mensagem da IA não tinha saído' : `${p.mensagens_sem_resposta} msg sem resposta desde ${tempoDesde(p.sem_resposta_desde)}`}
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
