// Anúncios das contas da Impera ligados aos perfis: o que a Meta conta (gasto, impressões, conversas) ao lado do que
// aconteceu no CRM com quem chegou por eles (conversa no Direct → lead → reunião → fechado).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ExternalLink, Trophy } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { useAviso, Vazio } from '../disparos/comum.jsx';
import { numero, reais, paramsDoPeriodo } from './comum.jsx';

const COLUNAS = ['gasto', 'impressoes', 'alcance', 'cliques_link', 'conversas_meta', 'conversas_crm', 'leads_crm', 'reunioes_crm', 'fechados_crm', 'custo_por_conversa', 'custo_por_lead_crm'];
const DINHEIRO = new Set(['gasto', 'custo_por_conversa', 'custo_por_lead_crm']);
const STATUS = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED', 'PENDING_REVIEW']);

export default function Anuncios({ periodo, perfil }) {
  const t = useT();
  const aviso = useAviso();
  const [lista, setLista] = useState(null);
  const [ordem, setOrdem] = useState('gasto');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    try { setLista((await api(`/instagram/anuncios?${paramsDoPeriodo(periodo, perfil)}`)).anuncios); } catch (e) { aviso(e.message, 'erro'); }
  }, [periodo, perfil, aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (d?.anuncios) carregar(); });

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = (lista || []).filter((a) => !termo || `${a.nome} ${a.campanha || ''} ${a.conjunto || ''}`.toLowerCase().includes(termo));
    // Custo: menor é melhor (sem número vai para o fim)
    const custo = ordem.startsWith('custo');
    return [...base].sort((a, b) => {
      const x = a[ordem];
      const y = b[ordem];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return custo ? x - y : y - x;
    });
  }, [lista, ordem, busca]);

  const total = useMemo(() => {
    const r = Object.fromEntries(COLUNAS.map((c) => [c, 0]));
    for (const a of filtrados) for (const c of COLUNAS) if (!c.startsWith('custo')) r[c] += Number(a[c]) || 0;
    r.custo_por_conversa = r.conversas_meta ? r.gasto / r.conversas_meta : null;
    r.custo_por_lead_crm = r.leads_crm ? r.gasto / r.leads_crm : null;
    return r;
  }, [filtrados]);

  const melhor = useMemo(() => {
    const comLead = filtrados.filter((a) => a.custo_por_lead_crm !== null);
    return comLead.length > 1 ? comLead.reduce((m, a) => (a.custo_por_lead_crm < m.custo_por_lead_crm ? a : m)).id : null;
  }, [filtrados]);

  const valor = (c, v) => (DINHEIRO.has(c) ? reais(v) : numero(v));

  return (
    <section className="cartao-secao ig-anuncios">
      <div className="cabecalho-cartao">
        <div>
          <h2>{t('instagram.anuncios.titulo')}</h2>
          <p className="suave pequeno">{t('instagram.anuncios.sub')}</p>
        </div>
        <label className="ig-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t('instagram.anuncios.buscar')} /></label>
      </div>
      {!lista && <div className="dp-centro"><span className="girando" /></div>}
      {lista && !lista.length && <Vazio titulo={t('instagram.anuncios.vazioTitulo')}>{t('instagram.anuncios.vazio')}</Vazio>}
      {filtrados.length > 0 && (
        <div className="ig-tabela-rolagem">
          <table className="tabela utm-tabela">
            <thead>
              <tr>
                <th>{t('instagram.anuncios.anuncio')}</th>
                {COLUNAS.map((c) => (
                  <th key={c} className="num"><button type="button" className={ordem === c ? 'ordem' : ''} onClick={() => setOrdem(c)} title={t(`instagram.anuncios.dica.${c}`)}>{t(`instagram.anuncios.col.${c}`)}</button></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((a) => (
                <tr key={a.id} className={a.id === melhor ? 'melhor' : ''}>
                  <td>
                    <span className="utm-nome-dentro">
                      {a.id === melhor && <Trophy size={13} className="trofeu" aria-label={t('instagram.anuncios.melhor')} />}
                      <span title={a.nome}>{a.nome}</span>
                    </span>
                    <small className="suave">{[a.campanha, a.status ? (STATUS.has(a.status) ? t(`instagram.anuncios.situacao.${a.status}`) : a.status) : null].filter(Boolean).join(' · ')}</small>
                    {a.permalink && <> <a className="link" href={a.permalink} target="_blank" rel="noreferrer"><ExternalLink size={11} /></a></>}
                  </td>
                  {COLUNAS.map((c) => <td key={c} className={`num ${c === ordem ? 'forte' : ''}`}>{valor(c, a[c])}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>{t('instagram.anuncios.total')}</td>{COLUNAS.map((c) => <td key={c} className="num">{valor(c, total[c])}</td>)}</tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="suave pequeno">{t('instagram.anuncios.rodape')}</p>
    </section>
  );
}
