// Equipe e integrações → Instagram (só administrador): app da Meta, webhook, acesso (login do Facebook ou token de
// usuário do sistema), contas disponíveis e perfis conectados (Alice no Direct, sincronizar, desconectar).
import { useCallback, useEffect, useState } from 'react';
import { Camera as IconeInstagram, KeyRound, Webhook, Link2, RefreshCw, Unplug, Plug, Bot, AlertTriangle, CheckCircle2, ChevronDown, LogIn } from 'lucide-react';
import { api } from '../../api.js';
import { rota } from '../../base.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde, dataHora } from '../../utils.js';
import { TextoSecreto, CampoSecreto } from '../Segredo.jsx';
import { Interruptor } from '../disparos/comum.jsx';
import './instagram.css';

const nf = new Intl.NumberFormat('pt-BR');

function FotoPerfil({ perfil, tamanho = 44 }) {
  const [erro, setErro] = useState(false);
  return (
    <span className="ig-foto" style={{ width: tamanho, height: tamanho }}>
      {perfil.foto && !erro
        ? <img src={rota(`/api/instagram/perfis/${perfil.id}/foto`)} alt="" onError={() => setErro(true)} />
        : <IconeInstagram size={Math.round(tamanho * 0.5)} />}
    </span>
  );
}
export { FotoPerfil };

export default function InstagramConexao({ aoMensagem, aoErro }) {
  const t = useT();
  const [d, setD] = useState(null);
  const [app, setApp] = useState({ app_id: '', app_secret: '', config_id: '', versao_api: '' });
  const [token, setToken] = useState('');
  const [contas, setContas] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [mostrarApp, setMostrarApp] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const x = await api('/instagram/config');
      setD(x);
      setApp((a) => ({ ...a, app_id: a.app_id || x.config.app_id || '', config_id: a.config_id || x.config.config_id || '', versao_api: x.config.versao_api || '' }));
      if (!x.config.app_id || !x.config.segredo_configurado) setMostrarApp(true);
    } catch (e) { aoErro?.(e.message); }
  }, [aoErro]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('instagram', (x) => { if (x?.perfis || x?.conexao || x?.erro) carregar(); });

  // Voltou do login do Facebook (?ig=ok ou ?ig=erro&msg=…)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ig = p.get('ig');
    if (!ig) return;
    if (ig === 'ok') aoMensagem?.(t('instagram.conexao.loginOk'));
    else aoErro?.(t('instagram.conexao.loginErro', { msg: p.get('msg') || '' }));
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
    buscarContas();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const executar = async (chave, fn, sucesso) => {
    setOcupado(chave);
    aoErro?.('');
    try {
      const r = await fn();
      if (sucesso) aoMensagem?.(sucesso);
      await carregar();
      return r;
    } catch (e) {
      aoErro?.(e.message);
      return null;
    } finally { setOcupado(''); }
  };

  const salvarApp = () => executar('app', async () => {
    const corpo = { app_id: app.app_id, config_id: app.config_id };
    if (app.app_secret) corpo.app_secret = app.app_secret;
    if (app.versao_api) corpo.versao_api = app.versao_api;
    await api('/instagram/app', { method: 'PUT', body: corpo });
    setApp((a) => ({ ...a, app_secret: '' }));
  }, t('instagram.conexao.appSalvo'));

  const entrar = () => executar('login', async () => {
    const r = await api('/instagram/oauth/inicio');
    window.location.href = r.url;
  });
  const salvarToken = () => executar('token', async () => {
    await api('/instagram/token', { method: 'POST', body: { token } });
    setToken('');
    await buscarContas();
  }, t('instagram.conexao.tokenSalvo'));
  const removerToken = () => {
    if (!confirm(t('instagram.conexao.removerAcessoConfirma'))) return;
    executar('remover', () => api('/instagram/token', { method: 'DELETE' }), t('instagram.conexao.acessoRemovido'));
  };
  async function buscarContas() {
    setOcupado('contas');
    try { setContas((await api('/instagram/contas')).contas); } catch (e) { aoErro?.(e.message); } finally { setOcupado(''); }
  }
  const conectar = (igId) => executar(`conectar-${igId}`, async () => {
    await api('/instagram/perfis', { method: 'POST', body: { ig_id: igId } });
    await buscarContas();
  }, t('instagram.conexao.perfilConectado'));
  const desconectar = (p) => {
    if (!confirm(t('instagram.conexao.desconectarConfirma', { perfil: p.username }))) return;
    executar(`desc-${p.id}`, () => api(`/instagram/perfis/${p.id}`, { method: 'DELETE' }), t('instagram.conexao.perfilDesconectado'));
  };
  const mudarPerfil = (p, corpo, msg) => executar(`perfil-${p.id}`, () => api(`/instagram/perfis/${p.id}`, { method: 'PATCH', body: corpo }), msg);

  if (!d) return <section className="cartao-secao"><h2><IconeInstagram size={18} /> Instagram</h2><div className="carregando" /></section>;
  const c = d.conexao;
  const perfisAtivos = d.perfis.filter((p) => p.ativo);
  const appPronto = d.config.app_id && d.config.segredo_configurado;

  return (
    <section className="cartao-secao ig-conexao">
      <div className="ig-conexao-topo">
        <h2><IconeInstagram size={18} /> Instagram</h2>
        <span className={`ig-selo ${c.conectado ? 'ok' : ''}`}>
          {c.conectado ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {c.conectado
            ? t(c.tipo === 'sistema' ? 'instagram.conexao.conectadoSistema' : 'instagram.conexao.conectadoUsuario', { conta: c.conta || 'Meta' })
            : t('instagram.conexao.naoConectado')}
        </span>
      </div>
      <p className="suave pequeno">{t('instagram.conexao.explica')}</p>
      {c.vence_logo && <div className="erro">{t('instagram.conexao.venceLogo', { data: dataHora(c.expira_em) })}</div>}
      {c.escopos_faltando?.length > 0 && <div className="erro">{t('instagram.conexao.escoposFaltando', { lista: c.escopos_faltando.join(', ') })}</div>}
      {!d.publica_https && <div className="erro">{t('instagram.conexao.semHttps')}</div>}

      {/* 1. App da Meta */}
      <div className="ig-passo">
        <button type="button" className="ig-passo-titulo" onClick={() => setMostrarApp((v) => !v)} aria-expanded={mostrarApp}>
          <span className="ig-num">1</span> <KeyRound size={15} /> {t('instagram.conexao.passoApp')}
          {appPronto && <span className="ig-ok"><CheckCircle2 size={14} /> {t('instagram.conexao.pronto')}</span>}
          <ChevronDown size={15} className={`ig-seta ${mostrarApp ? 'aberta' : ''}`} />
        </button>
        {mostrarApp && (
          <div className="ig-passo-corpo">
            <p className="suave pequeno">{t('instagram.conexao.appExplica')}</p>
            <div className="grade-2">
              <label>{t('instagram.conexao.appId')}<CampoSecreto value={app.app_id} onChange={(e) => setApp({ ...app, app_id: e.target.value.trim() })} placeholder="123456789012345" /></label>
              <label>{t('instagram.conexao.appSegredo')}
                <CampoSecreto value={app.app_secret} onChange={(e) => setApp({ ...app, app_secret: e.target.value })} placeholder={d.config.segredo_configurado ? t('instagram.conexao.segredoGuardado', { fim: d.config.segredo_final }) : '••••'} />
              </label>
              <label>{t('instagram.conexao.configId')}<CampoSecreto value={app.config_id} onChange={(e) => setApp({ ...app, config_id: e.target.value.trim() })} placeholder={t('instagram.conexao.opcional')} /></label>
              <label>{t('instagram.conexao.versao')}<input value={app.versao_api} onChange={(e) => setApp({ ...app, versao_api: e.target.value.trim() })} placeholder="v25.0" /></label>
            </div>
            <div className="acoes-linha">
              <button type="button" className="btn btn-ouro" onClick={salvarApp} disabled={ocupado === 'app'}>{t('instagram.conexao.salvarApp')}</button>
            </div>
            <p className="suave pequeno">{t('instagram.conexao.retornoExplica')}</p>
            <div className="copiar"><TextoSecreto valor={d.urls.retorno} codigo className="segredo-largo" aoCopiar={() => aoMensagem?.(t('instagram.conexao.copiado'))} /></div>
          </div>
        )}
      </div>

      {/* 2. Webhook */}
      <div className="ig-passo">
        <div className="ig-passo-titulo estatico"><span className="ig-num">2</span> <Webhook size={15} /> {t('instagram.conexao.passoWebhook')}</div>
        <div className="ig-passo-corpo">
          <p className="suave pequeno">{t('instagram.conexao.webhookExplica')}</p>
          <label>{t('instagram.conexao.webhookUrl')}<div className="copiar"><TextoSecreto valor={d.urls.webhook} codigo className="segredo-largo" aoCopiar={() => aoMensagem?.(t('instagram.conexao.copiado'))} /></div></label>
          <label>{t('instagram.conexao.webhookToken')}<div className="copiar"><TextoSecreto valor={d.config.verify_token} codigo className="segredo-largo" aoCopiar={() => aoMensagem?.(t('instagram.conexao.copiado'))} /></div></label>
          <p className="suave pequeno">{t('instagram.conexao.webhookCampos')}</p>
        </div>
      </div>

      {/* 3. Acesso */}
      <div className="ig-passo">
        <div className="ig-passo-titulo estatico"><span className="ig-num">3</span> <Link2 size={15} /> {t('instagram.conexao.passoAcesso')}</div>
        <div className="ig-passo-corpo">
          <div className="ig-duas-opcoes">
            <div className="ig-opcao">
              <b>{t('instagram.conexao.opcaoSistema')}</b>
              <p className="suave pequeno">{t('instagram.conexao.opcaoSistemaExplica')}</p>
              <div className="ig-linha-token">
                <CampoSecreto value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" />
                <button type="button" className="btn btn-ouro" onClick={salvarToken} disabled={!token.trim() || ocupado === 'token'}>{t('instagram.conexao.salvarToken')}</button>
              </div>
            </div>
            <div className="ig-opcao">
              <b>{t('instagram.conexao.opcaoLogin')}</b>
              <p className="suave pequeno">{t('instagram.conexao.opcaoLoginExplica')}</p>
              <button type="button" className="btn" onClick={entrar} disabled={!appPronto || ocupado === 'login'} title={!appPronto ? t('instagram.conexao.precisaApp') : ''}>
                <LogIn size={15} /> {t('instagram.conexao.entrarFacebook')}
              </button>
            </div>
          </div>
          {c.conectado && (
            <p className="suave pequeno">
              {c.expira_em ? t('instagram.conexao.expiraEm', { data: dataHora(c.expira_em) }) : t('instagram.conexao.naoExpira')}
              {' · '}
              <button type="button" className="link-botao" onClick={removerToken}>{t('instagram.conexao.removerAcesso')}</button>
            </p>
          )}
        </div>
      </div>

      {/* 4. Perfis */}
      <div className="ig-passo">
        <div className="ig-passo-titulo estatico"><span className="ig-num">4</span> <Plug size={15} /> {t('instagram.conexao.passoPerfis')}</div>
        <div className="ig-passo-corpo">
          <div className="acoes-linha ig-acoes-esq">
            <button type="button" className="btn" onClick={buscarContas} disabled={!c.conectado || ocupado === 'contas'}>
              <RefreshCw size={14} className={ocupado === 'contas' ? 'girando' : ''} /> {t('instagram.conexao.buscarContas')}
            </button>
          </div>
          {contas && (
            <table className="tabela">
              <thead><tr><th>{t('instagram.conexao.colPagina')}</th><th>{t('instagram.conexao.colInstagram')}</th><th>{t('instagram.conexao.colSeguidores')}</th><th /></tr></thead>
              <tbody>
                {contas.length === 0 && <tr><td colSpan={4} className="suave">{t('instagram.conexao.nenhumaConta')}</td></tr>}
                {contas.map((x) => (
                  <tr key={x.page_id}>
                    <td>{x.page_nome}</td>
                    <td>{x.instagram ? `@${x.instagram.username}` : <span className="suave">{t('instagram.conexao.semInstagram')}</span>}</td>
                    <td>{x.instagram?.seguidores != null ? nf.format(x.instagram.seguidores) : '—'}</td>
                    <td className="acoes-linha">
                      {x.instagram && (x.conectado
                        ? <span className="ig-ok"><CheckCircle2 size={14} /> {t('instagram.conexao.jaConectado')}</span>
                        : <button type="button" className="btn btn-ouro btn-pequeno" onClick={() => conectar(x.instagram.ig_id)} disabled={ocupado === `conectar-${x.instagram.ig_id}`}>{t('instagram.conexao.conectar')}</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {perfisAtivos.length === 0 && <p className="suave pequeno">{t('instagram.conexao.nenhumPerfil')}</p>}
          <div className="ig-perfis">
            {perfisAtivos.map((p) => (
              <div key={p.id} className="ig-perfil-cartao">
                <div className="ig-perfil-topo">
                  <FotoPerfil perfil={p} />
                  <div className="ig-perfil-nome">
                    <b>@{p.username}</b>
                    <small className="suave">{p.nome || p.page_nome} · {t('instagram.conexao.seguidores', { n: nf.format(p.seguidores || 0) })}</small>
                  </div>
                  <span className="espaco" />
                  <Interruptor ligado={p.alice_ativa} aoMudar={(v) => mudarPerfil(p, { alice_ativa: v }, v ? t('instagram.conexao.aliceLigada', { perfil: p.username }) : t('instagram.conexao.aliceDesligada', { perfil: p.username }))}
                    rotulo={<><Bot size={14} /> {t('instagram.conexao.aliceNoDirect')}</>} />
                </div>
                <div className="ig-perfil-status">
                  <span>{p.webhook_em ? t('instagram.conexao.webhookVisto', { quando: tempoDesde(p.webhook_em) }) : t('instagram.conexao.webhookNunca')}</span>
                  <span>{p.inscrito_em ? t('instagram.conexao.inscrita') : t('instagram.conexao.naoInscrita')}</span>
                  <span>{p.sync_direct_em ? t('instagram.conexao.directSync', { quando: tempoDesde(p.sync_direct_em) }) : t('instagram.conexao.directNunca')}</span>
                  <span>{p.sync_conta_em ? t('instagram.conexao.metricasSync', { quando: tempoDesde(p.sync_conta_em) }) : t('instagram.conexao.metricasNunca')}</span>
                  {p.conta_desde && <span>{t('instagram.conexao.historicoDesde', { data: p.conta_desde.split('-').reverse().join('/') })}{p.conta_backfill_ok ? '' : ` ${t('instagram.conexao.completando')}`}</span>}
                </div>
                {p.ultimo_erro && <div className="erro pequeno">{p.ultimo_erro} <small>({tempoDesde(p.ultimo_erro_em)})</small></div>}
                {p.inscricao_erro && <div className="erro pequeno">{t('instagram.conexao.inscricaoErro', { erro: p.inscricao_erro })}</div>}
                <label className="ig-utm">{t('instagram.conexao.utm')}
                  <input defaultValue={p.config?.utm_contem || ''} placeholder="instagram, ig"
                    onBlur={(e) => e.target.value !== (p.config?.utm_contem || '') && mudarPerfil(p, { config: { utm_contem: e.target.value } }, t('instagram.conexao.utmSalvo'))} />
                </label>
                <div className="acoes-linha">
                  <button type="button" className="btn btn-pequeno" onClick={() => executar(`sync-${p.id}`, () => api(`/instagram/perfis/${p.id}/sincronizar`, { method: 'POST' }), t('instagram.conexao.sincronizando'))}>
                    <RefreshCw size={13} /> {t('instagram.conexao.sincronizar')}
                  </button>
                  {!p.inscrito_em && (
                    <button type="button" className="btn btn-pequeno" onClick={() => executar(`insc-${p.id}`, () => api(`/instagram/perfis/${p.id}/inscrever`, { method: 'POST' }), t('instagram.conexao.inscricaoFeita'))}>
                      <Webhook size={13} /> {t('instagram.conexao.inscrever')}
                    </button>
                  )}
                  <button type="button" className="btn btn-pequeno btn-perigo-leve" onClick={() => desconectar(p)}><Unplug size={13} /> {t('instagram.conexao.desconectar')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <details className="tabela-dados">
        <summary>{t('instagram.conexao.registro')}</summary>
        <table className="tabela">
          <tbody>
            {d.registro.length === 0 && <tr><td className="suave">{t('instagram.conexao.registroVazio')}</td></tr>}
            {d.registro.map((r) => (
              <tr key={r.id} className={r.tipo === 'erro' ? 'ig-linha-erro' : ''}>
                <td className="ig-quando">{dataHora(r.criado_em)}</td>
                <td>{r.username ? `@${r.username}` : '—'}</td>
                <td>{r.detalhe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
