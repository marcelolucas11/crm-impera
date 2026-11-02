import { useMemo, useState } from 'react';
import { ChevronRight, Settings2, Trophy } from 'lucide-react';
import { useT } from '../../i18n/index.jsx';
import { num, pct, taxa, lerPref, salvarPref, etapasDoLead } from './util.js';

const NIVEIS = ['campanha', 'conjunto', 'anuncio'];
// Padrão do Meta Ads: campaign.name → utm_campaign, adset.name → utm_medium, ad.name → utm_content.
// utm_term fica de fora do padrão: o link do Calendly usa ele para levar o ID da resposta do formulário.
const CANDIDATOS = {
  campanha: ['utm_campaign'],
  conjunto: ['utm_medium', 'utm_adset', 'utm_conjunto'],
  anuncio: ['utm_content', 'utm_ad', 'utm_anuncio'],
};
const SEM = '\u0000sem';

function mapaPadrao(chaves) {
  const m = {};
  for (const n of NIVEIS) m[n] = CANDIDATOS[n].find((c) => chaves.includes(c)) || CANDIDATOS[n][0];
  return m;
}

// UTMs: de qual campanha, conjunto e anúncio vieram os leads e quantos estão (ou passaram) nas colunas escolhidas
export default function Utms({ leads, etapas, chaves }) {
  const t = useT();
  const [nivel, setNivel] = useState('campanha');
  const [filtro, setFiltro] = useState({ campanha: null, conjunto: null });
  const [modo, setModoEstado] = useState(() => lerPref('utm-modo', 'agora'));
  const [mapaSalvo, setMapaSalvo] = useState(() => lerPref('utm-mapa', null));
  const [colunasSalvas, setColunasSalvas] = useState(() => lerPref('utm-colunas', null));
  const [ordem, setOrdem] = useState('colunas');
  const [ajustes, setAjustes] = useState(false);

  const mapa = { ...mapaPadrao(chaves), ...(mapaSalvo || {}) };
  const porId = useMemo(() => new Map(etapas.map((s) => [s.id, s])), [etapas]);
  const padraoColunas = useMemo(() => {
    const ganhos = etapas.filter((s) => s.tipo === 'won').map((s) => s.id);
    if (ganhos.length) return ganhos;
    const abertas = etapas.filter((s) => s.tipo === 'open');
    return abertas.length ? [abertas[abertas.length - 1].id] : [];
  }, [etapas]);
  const colunas = (colunasSalvas || padraoColunas).filter((id) => porId.has(id));
  const primeiraEtapa = etapas[0]?.id;

  const setModo = (m) => { setModoEstado(m); salvarPref('utm-modo', m); };
  const alternarColuna = (id) => {
    const nova = colunas.includes(id) ? colunas.filter((x) => x !== id) : [...colunas, id];
    const ordenada = etapas.map((s) => s.id).filter((x) => nova.includes(x));
    setColunasSalvas(ordenada);
    salvarPref('utm-colunas', ordenada);
  };
  const trocarMapa = (n, chave) => {
    const novo = { ...mapa, [n]: chave };
    setMapaSalvo(novo);
    salvarPref('utm-mapa', novo);
  };
  const valorDe = (l, n) => l.u?.[mapa[n]] || SEM;

  const { linhas, totais, comUtm } = useMemo(() => {
    const doFiltro = leads.filter(
      (l) => (!filtro.campanha || valorDe(l, 'campanha') === filtro.campanha) && (!filtro.conjunto || valorDe(l, 'conjunto') === filtro.conjunto)
    );
    const grupos = new Map();
    const tot = { total: 0, nas: 0, por: Object.fromEntries(colunas.map((id) => [id, 0])) };
    for (const l of doFiltro) {
      const chave = valorDe(l, nivel);
      if (!grupos.has(chave)) grupos.set(chave, { chave, total: 0, nas: 0, por: Object.fromEntries(colunas.map((id) => [id, 0])) });
      const g = grupos.get(chave);
      g.total++;
      tot.total++;
      const etapasLead = modo === 'agora' ? new Set([l.s]) : etapasDoLead(l, primeiraEtapa);
      let entrou = false;
      for (const id of colunas) {
        if (etapasLead.has(id)) { g.por[id]++; tot.por[id]++; entrou = true; }
      }
      if (entrou) { g.nas++; tot.nas++; }
    }
    const lista = [...grupos.values()].map((g) => ({ ...g, taxa: taxa(g.nas, g.total) }));
    const chave = ordem === 'leads' ? (g) => [g.total, g.nas] : ordem === 'taxa' ? (g) => [g.taxa ?? -1, g.nas] : (g) => [g.nas, g.total];
    lista.sort((a, b) => {
      if ((a.chave === SEM) !== (b.chave === SEM)) return a.chave === SEM ? 1 : -1;
      const [a1, a2] = chave(a);
      const [b1, b2] = chave(b);
      return b1 - a1 || b2 - a2;
    });
    const com = doFiltro.filter((l) => valorDe(l, nivel) !== SEM).length;
    return { linhas: lista, totais: tot, comUtm: com };
  }, [leads, filtro, nivel, colunas, modo, ordem, primeiraEtapa, mapa.campanha, mapa.conjunto, mapa.anuncio]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxLeads = Math.max(1, ...linhas.map((g) => g.total));
  // "Melhor taxa" só entre estruturas com volume mínimo (evita 1 lead = 100%)
  const minimo = Math.max(3, Math.ceil(totais.total * 0.05));
  const elegiveis = linhas.filter((g) => g.chave !== SEM && g.total >= minimo && g.nas > 0);
  const melhor = elegiveis.reduce((m, g) => (!m || g.taxa > m.taxa ? g : m), null);
  const nome = (chave) => (chave === SEM ? t('estatisticas.utm.semUtm') : chave);

  const descer = (g) => {
    if (g.chave === SEM || nivel === 'anuncio') return;
    if (nivel === 'campanha') { setFiltro({ campanha: g.chave, conjunto: null }); setNivel('conjunto'); }
    else { setFiltro((f) => ({ ...f, conjunto: g.chave })); setNivel('anuncio'); }
  };
  const irPara = (n) => {
    if (n === 'campanha') setFiltro({ campanha: null, conjunto: null });
    if (n === 'conjunto') setFiltro((f) => ({ ...f, conjunto: null }));
    setNivel(n);
  };

  return (
    <section className="cartao-secao grafico-largo utms">
      <div className="cabecalho-cartao">
        <div>
          <h2>{t('estatisticas.utm.titulo')}</h2>
          <p className="suave pequeno">{t('estatisticas.utm.sub')}</p>
        </div>
        <div className="utm-topo">
          <div className="segmentado" role="group">
            {NIVEIS.map((n) => (
              <button key={n} className={nivel === n ? 'ativo' : ''} onClick={() => setNivel(n)}>{t(`estatisticas.utm.${n}`)}</button>
            ))}
          </div>
          <button className={`chip ${ajustes ? 'ativo' : ''}`} onClick={() => setAjustes((v) => !v)} aria-expanded={ajustes} title={t('estatisticas.utm.parametros')}>
            <Settings2 size={15} />
          </button>
        </div>
      </div>

      {ajustes && (
        <div className="utm-ajustes">
          <p className="suave pequeno">{t('estatisticas.utm.parametrosAjuda')}</p>
          <div className="utm-mapa">
            {NIVEIS.map((n) => (
              <label key={n}>
                <span>{t(`estatisticas.utm.${n}`)}</span>
                <select value={mapa[n]} onChange={(ev) => trocarMapa(n, ev.target.value)}>
                  {[...new Set([mapa[n], ...chaves])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="utm-colunas">
        <span className="utm-rotulo">{t('estatisticas.utm.colunas')}</span>
        <div className="utm-chips">
          {etapas.map((s) => (
            <button key={s.id} className={`chip chip-etapa ${colunas.includes(s.id) ? 'ativo' : ''}`} onClick={() => alternarColuna(s.id)}>
              <i className="ponto" style={{ background: s.cor }} />{s.nome}
            </button>
          ))}
        </div>
        <div className="segmentado segmentado-pequeno" role="group">
          <button className={modo === 'agora' ? 'ativo' : ''} onClick={() => setModo('agora')}>{t('estatisticas.utm.estaoAgora')}</button>
          <button className={modo === 'passou' ? 'ativo' : ''} onClick={() => setModo('passou')}>{t('estatisticas.utm.jaPassaram')}</button>
        </div>
      </div>

      <nav className="utm-trilha" aria-label={t('estatisticas.utm.caminho')}>
        <button onClick={() => irPara('campanha')} className={!filtro.campanha ? 'atual' : ''}>{t('estatisticas.utm.todasCampanhas')}</button>
        {filtro.campanha && (
          <>
            <ChevronRight size={14} />
            <button onClick={() => irPara('conjunto')} className={!filtro.conjunto ? 'atual' : ''}>{nome(filtro.campanha)}</button>
          </>
        )}
        {filtro.conjunto && (
          <>
            <ChevronRight size={14} />
            <button className="atual" onClick={() => irPara('anuncio')}>{nome(filtro.conjunto)}</button>
          </>
        )}
        <span className="suave pequeno utm-cobertura">
          {t('estatisticas.utm.cobertura', { n: num(comUtm), total: num(totais.total), p: pct(taxa(comUtm, totais.total)), param: mapa[nivel] })}
        </span>
      </nav>

      {!totais.total ? (
        <p className="suave pequeno">{t('estatisticas.utm.vazio')}</p>
      ) : (
        <div className="utm-tabela-rolagem">
          <table className="tabela utm-tabela">
            <thead>
              <tr>
                <th>{t(`estatisticas.utm.${nivel}`)}</th>
                <th className="num"><button className={ordem === 'leads' ? 'ordem' : ''} onClick={() => setOrdem('leads')}>{t('estatisticas.utm.leads')}</button></th>
                {colunas.length > 1 && colunas.map((id) => <th key={id} className="num">{porId.get(id)?.nome}</th>)}
                <th className="num">
                  <button className={ordem === 'colunas' ? 'ordem' : ''} onClick={() => setOrdem('colunas')}>
                    {colunas.length === 1 ? porId.get(colunas[0])?.nome : t('estatisticas.utm.nasColunas')}
                  </button>
                </th>
                <th className="num"><button className={ordem === 'taxa' ? 'ordem' : ''} onClick={() => setOrdem('taxa')}>{t('estatisticas.utm.taxa')}</button></th>
                <th className="utm-col-barra">{t('estatisticas.utm.visual')}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((g) => {
                const clicavel = g.chave !== SEM && nivel !== 'anuncio';
                return (
                  <tr key={g.chave} className={`${clicavel ? 'clicavel' : ''} ${melhor === g ? 'melhor' : ''}`} onClick={() => descer(g)}>
                    <td title={nome(g.chave)}>
                      <span className="utm-nome-dentro">
                        {melhor === g && <Trophy size={13} className="trofeu" />}
                        <span className={g.chave === SEM ? 'suave' : ''}>{nome(g.chave)}</span>
                        {clicavel && <ChevronRight size={13} className="suave" />}
                      </span>
                    </td>
                    <td className="num">{num(g.total)}</td>
                    {colunas.length > 1 && colunas.map((id) => <td key={id} className="num">{num(g.por[id])}</td>)}
                    <td className="num forte">{num(g.nas)}</td>
                    <td className="num"><span className="utm-taxa">{pct(g.taxa)}</span></td>
                    <td className="utm-col-barra">
                      <span className="utm-trilho">
                        <span className="utm-barra-total" style={{ width: `${(g.total / maxLeads) * 100}%` }}>
                          <span className="utm-barra-nas" style={{ width: `${g.total ? (g.nas / g.total) * 100 : 0}%` }} />
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('estatisticas.utm.total')}</td>
                <td className="num">{num(totais.total)}</td>
                {colunas.length > 1 && colunas.map((id) => <td key={id} className="num">{num(totais.por[id])}</td>)}
                <td className="num">{num(totais.nas)}</td>
                <td className="num">{pct(taxa(totais.nas, totais.total))}</td>
                <td className="utm-col-barra">
                  <span className="legenda">
                    <span><i className="chave-cor utm-cor-total" />{t('estatisticas.utm.leads')}</span>
                    <span><i className="chave-cor utm-cor-nas" />{t('estatisticas.utm.nasColunas')}</span>
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {melhor && (
        <p className="utm-destaque">
          <Trophy size={14} />
          {t('estatisticas.utm.melhor', { nome: nome(melhor.chave), p: pct(melhor.taxa), n: num(melhor.nas), total: num(melhor.total), min: minimo })}
        </p>
      )}
    </section>
  );
}
