// Ações da assistente: o que está aguardando aprovação e o histórico do que foi feito, recusado ou desfeito.
import { useCallback, useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { api } from '../../../api.js';
import { useEvento } from '../../../tempoReal.js';
import { useT } from '../../../i18n/index.jsx';
import { useAviso } from '../../disparos/comum.jsx';
import CartaoAcao from './CartaoAcao.jsx';
import { dataHoraCurta } from './comum.js';

export default function Acoes({ user, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  const [lista, setLista] = useState(null);
  const carregar = useCallback(() => api('/agente/acoes?limite=150').then((d) => setLista(d.acoes)).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('agente', (d) => { if (!d?.usuario || d.usuario === user.id) carregar(); });

  if (!lista) return <div className="carregando" />;
  const pendentes = lista.filter((a) => a.status === 'pendente');
  const historico = lista.filter((a) => a.status !== 'pendente');
  const mudou = () => { carregar(); aoMudar?.(); };

  return (
    <div className="ag-acoes">
      <section className="cartao-secao">
        <h2><ListChecks size={16} /> {t('ia.agente.acoes.pendentes', { n: pendentes.length })}</h2>
        <p className="suave pequeno">{t('ia.agente.acoes.explicacao')}</p>
        {!pendentes.length ? <div className="vazio">{t('ia.agente.acoes.nenhumaPendente')}</div> : (
          <div className="ag-acoes-grade">{pendentes.map((a) => <CartaoAcao key={a.id} acao={a} aoMudar={mudou} />)}</div>
        )}
      </section>
      <section className="cartao-secao">
        <h2>{t('ia.agente.acoes.historico')}</h2>
        {!historico.length ? <div className="vazio">{t('ia.agente.acoes.semHistorico')}</div> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>#</th><th>{t('ia.agente.acoes.quando')}</th><th>{t('ia.agente.acoes.oque')}</th><th>{t('ia.agente.acoes.situacao')}</th><th /></tr></thead>
              <tbody>
                {historico.map((a) => (
                  <tr key={a.id}>
                    <td className="suave">{a.id}</td>
                    <td className="pequeno">{dataHoraCurta(a.decidida_em || a.created_at)}</td>
                    <td><b>{a.titulo}</b><br /><span className="pequeno">{a.resumo}</span>{a.erro && <><br /><span className="pequeno ag-alerta">{a.erro}</span></>}</td>
                    <td><span className={`ag-acao-status ${a.status}`}>{t(`ia.agente.acao.status.${a.status}`)}</span></td>
                    <td>{a.pode_desfazer && <CartaoDesfazer acao={a} aoMudar={mudou} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function CartaoDesfazer({ acao, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  return (
    <button type="button" className="btn btn-pequeno" onClick={async () => {
      if (!confirm(t('ia.agente.acao.confirmarDesfazer'))) return;
      try { await api(`/agente/acoes/${acao.id}/desfazer`, { method: 'POST' }); aviso(t('ia.agente.acao.desfeito')); aoMudar(); } catch (e) { aviso(e.message, 'erro'); }
    }}>{t('ia.agente.acao.desfazer')}</button>
  );
}
