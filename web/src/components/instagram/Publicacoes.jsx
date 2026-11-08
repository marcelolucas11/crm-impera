// Publicações (feed, reels, carrosséis e stories) com os números de cada uma e o detalhe: evolução dia a dia,
// comparação com a média do perfil e os anúncios que usaram a publicação.
import { useCallback, useEffect, useState } from 'react';
import { Search, ExternalLink, Megaphone } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { dataHora } from '../../utils.js';
import Modal from '../Modal.jsx';
import { useAviso } from '../disparos/comum.jsx';
import { Linha, TabelaDados, diaLongo } from './Graficos.jsx';
import { numero, compacto, reais, Miniatura, paramsDoPeriodo } from './comum.jsx';

const FORMATOS = ['', 'reels', 'foto', 'carrossel', 'video', 'stories'];
const ORDENS = ['recentes', 'visualizacoes', 'alcance', 'interacoes', 'engajamento', 'salvamentos', 'compartilhamentos', 'seguiram'];
const pctTexto = (v) => (v === null || v === undefined ? '—' : `${numero(v, 1)}%`);

function Comparacao({ rotulo, valor, media }) {
  const diferenca = valor !== null && valor !== undefined && media ? Math.round(((valor - media) / media) * 100) : null;
  return (
    <div className="indicador">
      <span className="indicador-rotulo">{rotulo}</span>
      <span className="indicador-valor">{compacto(valor)}</span>
      <span className="indicador-detalhe">
        {diferenca !== null && <span className={`delta ${diferenca > 0 ? 'bom' : diferenca < 0 ? 'ruim' : ''}`}>{diferenca > 0 ? '▲' : diferenca < 0 ? '▼' : '＝'} {Math.abs(diferenca)}%</span>}
        {media ? ` ${compacto(media)}` : ''}
      </span>
    </div>
  );
}

export function DetalhePost({ id, onFechar }) {
  const t = useT();
  const [p, setP] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api(`/instagram/posts/${encodeURIComponent(id)}`).then((d) => setP(d.post)).catch((e) => setErro(e.message)); }, [id]);
  const m = p?.media_do_perfil || {};
  return (
    <Modal titulo={t('instagram.post.titulo')} onFechar={onFechar} largo>
      {!p && !erro && <div className="dp-centro"><span className="girando" /></div>}
      {erro && <div className="erro">{erro}</div>}
      {p && (
        <div className="ig-post-detalhe">
          <div className="ig-post-cabeca">
            <Miniatura post={p} tamanho={120} />
            <div className="ig-post-textos">
              <span className="tag">{t(`instagram.formato.${p.formato}`)}</span>
              <small className="suave">{dataHora(p.publicado_em)}</small>
              {p.legenda && <p className="ig-legenda-post">{p.legenda}</p>}
              {p.permalink && <a className="link" href={p.permalink} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {t('instagram.post.abrir')}</a>}
            </div>
          </div>
          <p className="suave pequeno">{t('instagram.post.comparacao')}</p>
          <div className="indicadores">
            <Comparacao rotulo={t('instagram.kpi.visualizacoes')} valor={p.visualizacoes} media={m.visualizacoes} />
            <Comparacao rotulo={t('instagram.kpi.alcance')} valor={p.alcance} media={m.alcance} />
            <Comparacao rotulo={t('instagram.kpi.interacoes')} valor={p.interacoes} media={m.interacoes} />
            <Comparacao rotulo={t('instagram.post.salvamentos')} valor={p.salvamentos} media={m.salvamentos} />
            <Comparacao rotulo={t('instagram.post.compartilhamentos')} valor={p.compartilhamentos} media={m.compartilhamentos} />
          </div>
          <dl className="respostas ig-metricas">
            {[
              ['curtidas', p.curtidas], ['comentarios', p.comentarios], ['seguiram', p.seguiram], ['visitas_perfil', p.visitas_perfil],
              ['respostas', p.respostas], ['cliques_link', p.cliques_link], ['reposts', p.reposts],
            ].filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => <div key={k}><dt>{t(`instagram.post.${k}`)}</dt><dd>{numero(v)}</dd></div>)}
            {p.engajamento !== null && <div><dt>{t('instagram.kpi.engajamento')}</dt><dd>{pctTexto(p.engajamento)}</dd></div>}
            {p.tempo_medio_s !== null && <div><dt>{t('instagram.post.tempoMedio')}</dt><dd>{numero(p.tempo_medio_s, 1)} s</dd></div>}
            {p.taxa_pulo !== null && p.taxa_pulo !== undefined && <div><dt>{t('instagram.post.taxaPulo')}</dt><dd>{pctTexto(p.taxa_pulo)}</dd></div>}
            {p.total_visualizacoes !== null && p.total_visualizacoes !== undefined && <div><dt>{t('instagram.post.totalVisualizacoes')}</dt><dd>{numero(p.total_visualizacoes)}</dd></div>}
            <div><dt>{t('instagram.post.comentariosGuardados')}</dt><dd>{numero(p.comentarios_guardados)}</dd></div>
          </dl>
          {p.evolucao?.length > 1 && (
            <>
              <h4>{t('instagram.post.evolucao')}</h4>
              <Linha dias={p.evolucao.map((x) => x.dia)} rotulo={t('instagram.post.evolucao')} altura={180} series={[
                { chave: 'v', nome: t('instagram.kpi.visualizacoes'), cor: 'var(--serie-1)', valores: p.evolucao.map((x) => x.visualizacoes) },
                { chave: 'a', nome: t('instagram.kpi.alcance'), cor: 'var(--serie-2)', valores: p.evolucao.map((x) => x.alcance) },
              ]} />
              <TabelaDados colunas={[
                { chave: 'dia', rotulo: t('instagram.tabela.dia'), formatar: diaLongo },
                { chave: 'visualizacoes', rotulo: t('instagram.kpi.visualizacoes'), num: true, formatar: numero },
                { chave: 'alcance', rotulo: t('instagram.kpi.alcance'), num: true, formatar: numero },
                { chave: 'curtidas', rotulo: t('instagram.post.curtidas'), num: true, formatar: numero },
                { chave: 'comentarios', rotulo: t('instagram.post.comentarios'), num: true, formatar: numero },
                { chave: 'salvamentos', rotulo: t('instagram.post.salvamentos'), num: true, formatar: numero },
                { chave: 'compartilhamentos', rotulo: t('instagram.post.compartilhamentos'), num: true, formatar: numero },
              ]} linhas={p.evolucao} />
            </>
          )}
          {p.anuncios?.length > 0 && (
            <>
              <h4><Megaphone size={14} /> {t('instagram.post.anuncios')}</h4>
              <table className="tabela">
                <thead><tr><th>{t('instagram.anuncios.anuncio')}</th><th>{t('instagram.anuncios.status')}</th><th className="num">{t('instagram.anuncios.gasto')}</th><th className="num">{t('instagram.anuncios.impressoes')}</th><th className="num">{t('instagram.anuncios.conversas')}</th><th className="num">{t('instagram.anuncios.leads')}</th></tr></thead>
                <tbody>
                  {p.anuncios.map((a) => (
                    <tr key={a.id}><td>{a.nome}<br /><small className="suave">{a.campanha_nome}</small></td><td>{a.status ? t(`instagram.anuncios.situacao.${a.status}`) === `instagram.anuncios.situacao.${a.status}` ? a.status : t(`instagram.anuncios.situacao.${a.status}`) : '—'}</td><td className="num">{reais(a.gasto)}</td><td className="num">{numero(a.impressoes)}</td><td className="num">{numero(a.conversas)}</td><td className="num">{numero(a.leads)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="suave pequeno">{p.metricas_em ? t('instagram.post.atualizado', { quando: dataHora(p.metricas_em) }) : t('instagram.post.semNumeros')}</p>
        </div>
      )}
    </Modal>
  );
}

export default function Publicacoes({ periodo, perfil, onAbrirPost }) {
  const t = useT();
  const aviso = useAviso();
  const [formato, setFormato] = useState('');
  const [ordenar, setOrdenar] = useState('recentes');
  const [busca, setBusca] = useState('');
  const [posts, setPosts] = useState(null);

  const carregar = useCallback(async () => {
    const p = paramsDoPeriodo(periodo, perfil);
    if (formato) p.set('formato', formato);
    p.set('ordenar', ordenar);
    if (busca.trim()) p.set('q', busca.trim());
    try { setPosts((await api(`/instagram/posts?${p}`)).posts); } catch (e) { aviso(e.message, 'erro'); }
  }, [periodo, perfil, formato, ordenar, busca, aviso]);
  useEffect(() => { const id = setTimeout(carregar, busca ? 250 : 0); return () => clearTimeout(id); }, [carregar, busca]);
  useEvento('instagram', (d) => { if (d?.posts || d?.stories) carregar(); });

  return (
    <section className="cartao-secao ig-publicacoes">
      <div className="ig-barra">
        <div className="dp-segmentos dp-segmentos-pequeno">
          {FORMATOS.map((f) => <button key={f || 'todos'} type="button" className={formato === f ? 'ativo' : ''} onClick={() => setFormato(f)}>{f ? t(`instagram.formato.${f}`) : t('instagram.formato.todos')}</button>)}
        </div>
        <label className="ig-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t('instagram.publicacoes.buscar')} /></label>
        <span className="espaco" />
        <label className="ig-rotulo-inline">{t('instagram.publicacoes.ordenar')}
          <select className="ig-seletor" value={ordenar} onChange={(e) => setOrdenar(e.target.value)}>
            {ORDENS.map((o) => <option key={o} value={o}>{t(`instagram.ordem.${o}`)}</option>)}
          </select>
        </label>
      </div>
      {!posts && <div className="dp-centro"><span className="girando" /></div>}
      {posts && !posts.length && <p className="suave pequeno">{t('instagram.desempenho.semPublicacoes')}</p>}
      {posts?.length > 0 && (
        <div className="ig-tabela-rolagem">
          <table className="tabela utm-tabela ig-tabela-posts">
            <thead><tr>
              <th>{t('instagram.publicacoes.publicacao')}</th>
              <th className="num">{t('instagram.kpi.visualizacoes')}</th><th className="num">{t('instagram.kpi.alcance')}</th>
              <th className="num">{t('instagram.post.curtidas')}</th><th className="num">{t('instagram.post.comentarios')}</th>
              <th className="num">{t('instagram.post.salvamentos')}</th><th className="num">{t('instagram.post.compartilhamentos')}</th>
              <th className="num">{t('instagram.post.seguiram')}</th><th className="num">{t('instagram.kpi.engajamento')}</th>
            </tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="clicavel" onClick={() => onAbrirPost(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onAbrirPost(p.id)}>
                  <td>
                    <span className="ig-post-linha">
                      <Miniatura post={p} tamanho={44} />
                      <span className="ig-post-textos">
                        <span><span className="tag">{t(`instagram.formato.${p.formato}`)}</span> <small className="suave">{dataHora(p.publicado_em)}</small>{p.pago && <small className="ig-pago"> <Megaphone size={11} /> {reais(p.pago.gasto)}</small>}</span>
                        <small className="ig-legenda-curta">{p.legenda || t('instagram.publicacoes.semLegenda')}</small>
                      </span>
                    </span>
                  </td>
                  <td className="num forte">{numero(p.visualizacoes)}</td><td className="num">{numero(p.alcance)}</td>
                  <td className="num">{numero(p.curtidas)}</td><td className="num">{numero(p.comentarios)}</td>
                  <td className="num">{numero(p.salvamentos)}</td><td className="num">{numero(p.compartilhamentos)}</td>
                  <td className="num">{numero(p.seguiram)}</td><td className="num">{pctTexto(p.engajamento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="suave pequeno">{t('instagram.publicacoes.rodape')}</p>
    </section>
  );
}
