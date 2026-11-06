// Cartão de uma ação proposta pela assistente: o usuário revisa, edita o que dá para editar e aprova ou recusa.
import { useState } from 'react';
import { ShieldCheck, Check, X, Undo2, Loader2 } from 'lucide-react';
import { api } from '../../../api.js';
import { useT } from '../../../i18n/index.jsx';
import { useAviso } from '../../disparos/comum.jsx';

const LONGOS = new Set(['texto', 'prompt', 'nota']);

function Detalhes({ acao }) {
  const t = useT();
  const d = acao.dados || {};
  if (acao.tipo === 'criar_publico') {
    const nomes = (d.contatos || []).slice(0, 8).map((c) => c.nome || c.telefone).join(', ');
    return <p className="pequeno suave">{t('ia.agente.acao.contatos', { n: (d.contatos || []).length })}{nomes ? `: ${nomes}${(d.contatos || []).length > 8 ? '…' : ''}` : ''}</p>;
  }
  if (acao.tipo === 'criar_disparo' || acao.tipo === 'criar_modelo_disparo') {
    return <ol className="ag-acao-blocos">{(d.blocos || []).map((b, i) => <li key={i}>{b.texto}</li>)}</ol>;
  }
  if (acao.tipo === 'mover_lead' && d.motivo) return <p className="pequeno suave">{t('ia.agente.acao.motivo')}: {d.motivo}</p>;
  return null;
}

export default function CartaoAcao({ acao, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  const [edicao, setEdicao] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const pendente = acao.status === 'pendente';
  const valor = (k) => (edicao[k] !== undefined ? edicao[k] : acao.dados?.[k] ?? '');

  const fazer = async (caminho, corpo, ok) => {
    setOcupado(true);
    try {
      await api(`/agente/acoes/${acao.id}/${caminho}`, { method: 'POST', body: corpo });
      if (ok) aviso(ok);
      aoMudar?.();
    } catch (e) { aviso(e.message, 'erro'); aoMudar?.(); } finally { setOcupado(false); }
  };

  return (
    <div className={`ag-acao ag-acao-${acao.status}`}>
      <div className="ag-acao-topo">
        <span className="ag-acao-tipo"><ShieldCheck size={14} /> {acao.titulo} <span className="suave">#{acao.id}</span></span>
        <span className={`ag-acao-status ${acao.status}`}>{t(`ia.agente.acao.status.${acao.status}`)}</span>
      </div>
      <p className="ag-acao-resumo">{acao.resumo}</p>
      {(acao.editaveis || []).map((k) => (
        <label key={k} className="ag-acao-campo">
          <span>{t(`ia.agente.acao.campo.${k}`)}</span>
          {LONGOS.has(k)
            ? <textarea rows={k === 'prompt' ? 6 : 3} value={valor(k)} disabled={!pendente || ocupado} onChange={(e) => setEdicao((x) => ({ ...x, [k]: e.target.value }))} />
            : <input value={valor(k)} disabled={!pendente || ocupado} onChange={(e) => setEdicao((x) => ({ ...x, [k]: e.target.value }))} />}
        </label>
      ))}
      <Detalhes acao={acao} />
      {acao.erro && <p className="pequeno ag-alerta">{acao.erro}</p>}
      {acao.tipo === 'criar_disparo' && acao.status === 'executada' && <p className="pequeno suave">{t('ia.agente.acao.rascunhoPronto')}</p>}
      <div className="ag-acao-botoes">
        {pendente && (
          <>
            <button type="button" className="btn btn-pequeno btn-verde-leve" disabled={ocupado} onClick={() => fazer('aprovar', { edicao }, t('ia.agente.acao.feito'))}>
              {ocupado ? <Loader2 size={13} className="dp-gira" /> : <Check size={13} />} {t('ia.agente.acao.aprovar')}
            </button>
            <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => fazer('recusar', {})}><X size={13} /> {t('ia.agente.acao.recusar')}</button>
          </>
        )}
        {acao.pode_desfazer && (
          <button type="button" className="btn btn-pequeno" disabled={ocupado} onClick={() => confirm(t('ia.agente.acao.confirmarDesfazer')) && fazer('desfazer', {}, t('ia.agente.acao.desfeito'))}>
            <Undo2 size={13} /> {t('ia.agente.acao.desfazer')}
          </button>
        )}
      </div>
    </div>
  );
}
