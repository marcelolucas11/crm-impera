import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dataHora, tempoDesde } from '../utils.js';
import { useT } from '../i18n/index.jsx';
import { TextoSecreto, CampoSecreto } from './Segredo.jsx';

// O webhook do Yay! Forms manda só códigos. Com o token da API, o CRM busca sozinho o nome de cada formulário
// e o texto de cada pergunta e corrige também os leads e o histórico antigos. Dá para trocar o nome à mão.
export default function FormulariosYay({ aoMensagem, aoErro }) {
  const t = useT();
  const [formularios, setFormularios] = useState([]);
  const [nomes, setNomes] = useState({});
  const [st, setSt] = useState(null);
  const [token, setToken] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api('/yayforms/formularios'), api('/yayforms/catalogo')]);
      setFormularios(d.formularios);
      setNomes(Object.fromEntries(d.formularios.map((f) => [f.form_id, f.nome || ''])));
      setSt(s);
    } catch (e) { aoErro(e.message); }
  }, [aoErro]);

  useEffect(() => { carregar(); }, [carregar]);

  const resumoTexto = (r, a) => t('equipe.yay.resumo', {
    formularios: r?.formularios ?? 0, perguntas: r?.perguntas ?? 0, leads: a?.leads ?? 0, eventos: a?.eventos ?? 0,
  });

  const conectar = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setOcupado(true);
    try {
      const r = await api('/yayforms/token', { method: 'POST', body: { token } });
      setToken('');
      setTrocando(false);
      aoMensagem(`${t('equipe.yay.conectado')} ${resumoTexto(r.resumo, r.aplicados)}`);
    } catch (err) { aoErro(err.message); } finally { setOcupado(false); carregar(); }
  };

  const buscarAgora = async () => {
    setOcupado(true);
    try {
      const r = await api('/yayforms/sincronizar', { method: 'POST' });
      aoMensagem(resumoTexto(r.resumo, r.aplicados));
    } catch (err) { aoErro(err.message); } finally { setOcupado(false); carregar(); }
  };

  const desconectar = async () => {
    if (!confirm(t('equipe.yay.confirmarDesconectar'))) return;
    try {
      await api('/yayforms/token', { method: 'DELETE' });
      aoMensagem(t('equipe.yay.desconectado'));
    } catch (err) { aoErro(err.message); } finally { carregar(); }
  };

  const salvar = async (f) => {
    const nome = (nomes[f.form_id] || '').trim();
    if (nome === (f.nome || '')) return;
    try {
      await api(`/yayforms/formularios/${encodeURIComponent(f.form_id)}`, { method: 'PUT', body: { nome } });
      aoMensagem(nome ? t('equipe.yay.renomeado', { nome }) : t('equipe.yay.nomeRemovido'));
      carregar();
    } catch (e) { aoErro(e.message); }
  };

  const formularioToken = (
    <form onSubmit={conectar} className="form-token">
      <label>{t('equipe.yay.tokenRotulo')}
        <CampoSecreto value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('equipe.yay.tokenPlaceholder')} disabled={ocupado} />
      </label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ouro btn-pequeno" disabled={ocupado || !token.trim()}>{ocupado ? t('equipe.yay.conferindo') : t('equipe.yay.conectar')}</button>
        {trocando && <button type="button" className="btn btn-pequeno" onClick={() => { setTrocando(false); setToken(''); }}>{t('equipe.yay.cancelar')}</button>}
      </div>
      <p className="suave pequeno">{t('equipe.yay.tokenAjuda')}</p>
    </form>
  );

  return (
    <>
      <h3>{t('equipe.yay.titulo')}</h3>
      {st && !st.configurado && (
        <>
          <p className="suave pequeno">{t('equipe.yay.semToken')}</p>
          {formularioToken}
        </>
      )}
      {st?.configurado && (
        <>
          <dl className="dados-integracao">
            <div><dt>{t('equipe.yay.token')}</dt><dd><TextoSecreto valor={st.token_final} />{st.origem_token === 'env' ? t('equipe.yay.tokenEnv') : t('equipe.yay.tokenPainel')}</dd></div>
            <div><dt>{t('equipe.yay.comNome')}</dt><dd>{t('equipe.yay.comNomeValor', { n: st.formularios_com_nome, total: st.formularios_total })}</dd></div>
            <div><dt>{t('equipe.yay.ultimaBusca')}</dt><dd>{st.ultima_sincronizacao ? `${tempoDesde(st.ultima_sincronizacao)} (${dataHora(st.ultima_sincronizacao)})` : t('equipe.yay.nuncaBuscou')}</dd></div>
          </dl>
          {st.ultimo_erro && <div className="erro">{t('equipe.yay.ultimoErro', { erro: st.ultimo_erro })}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-ouro btn-pequeno" onClick={buscarAgora} disabled={ocupado}>{ocupado ? t('equipe.yay.buscando') : t('equipe.yay.buscarAgora')}</button>
            <button className="btn btn-pequeno" onClick={() => setTrocando((v) => !v)} disabled={ocupado}>{t('equipe.yay.trocarToken')}</button>
            {st.origem_token === 'painel' && <button className="btn btn-pequeno btn-perigo" onClick={desconectar}>{t('equipe.yay.desconectar')}</button>}
          </div>
          {trocando && formularioToken}
        </>
      )}

      {formularios.length > 0 && (
        <>
          <p className="suave pequeno">{t('equipe.yay.tabelaAjuda')}</p>
          <table className="tabela">
            <thead><tr><th>{t('equipe.yay.colNome')}</th><th>{t('equipe.yay.colYay')}</th><th>{t('equipe.yay.colRespostas')}</th><th>{t('equipe.yay.colUltima')}</th></tr></thead>
            <tbody>
              {formularios.map((f) => (
                <tr key={f.form_id}>
                  <td>
                    <input
                      placeholder={f.nome_yay || t('equipe.yay.nomePlaceholder')}
                      value={nomes[f.form_id] ?? ''}
                      onChange={(e) => setNomes({ ...nomes, [f.form_id]: e.target.value })}
                      onBlur={() => salvar(f)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      maxLength={120}
                    />
                  </td>
                  <td className="pequeno" title={f.form_id}>
                    {f.nome_yay || <span className="suave">{f.removido ? t('equipe.yay.apagado') : t('equipe.yay.semNomeYay')}</span>}
                  </td>
                  <td>{f.respostas}</td>
                  <td>{dataHora(f.ultima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
