// Cartão do perfil → "Direct pelo login do Instagram" (plugin não oficial, motor instagrapi).
// Instala o motor, liga com o cookie sessionid (e um proxy opcional), mostra a situação e volta para a API oficial.
// Desempenho, publicações, comentários e anúncios continuam pela API oficial da Meta.
import { useState } from 'react';
import { Cookie, Download, RefreshCw, Power, AlertTriangle, CheckCircle2, PauseCircle, ShieldAlert } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { tempoDesde, dataHora } from '../../utils.js';
import { CampoSecreto } from '../Segredo.jsx';

const INTERVALOS = [30, 45, 60, 90, 120, 300];

export default function DirectLogin({ perfil, login, instalacao, executar, ocupado }) {
  const t = useT();
  const [sessionid, setSessionid] = useState('');
  const [proxy, setProxy] = useState('');
  const [trocando, setTrocando] = useState(false);
  const e = login || {};
  const instalado = instalacao?.instalado;
  const instalando = instalacao?.status === 'instalando';
  const mostrarForm = instalado && (!e.ligado || e.parado || trocando);
  const chave = (x) => `login-${x}-${perfil.id}`;

  const ligar = () => executar(chave('ligar'), async () => {
    const corpo = { sessionid };
    if (proxy.trim() || trocando) corpo.proxy = proxy.trim();
    await api(`/instagram/perfis/${perfil.id}/login`, { method: 'POST', body: corpo });
    setSessionid('');
    setProxy('');
    setTrocando(false);
  }, t('instagram.login.ligado', { perfil: perfil.username }));
  const desligar = () => {
    if (!confirm(t('instagram.login.desligarConfirma', { perfil: perfil.username }))) return;
    executar(chave('desligar'), () => api(`/instagram/perfis/${perfil.id}/login`, { method: 'DELETE' }), t('instagram.login.desligado'));
  };
  const instalar = () => executar('login-instalar', () => api('/instagram/login/instalar', { method: 'POST' }), t('instagram.login.instalando'));
  const buscar = () => executar(chave('buscar'), () => api(`/instagram/perfis/${perfil.id}/login/buscar`, { method: 'POST' }), t('instagram.login.buscando'));
  const intervalo = (seg) => executar(chave('intervalo'), () => api(`/instagram/perfis/${perfil.id}/login`, { method: 'PATCH', body: { intervalo_seg: Number(seg) } }), t('instagram.login.intervaloSalvo'));

  let selo;
  if (!e.ligado) selo = <span className="ig-login-selo"><Power size={13} /> {t('instagram.login.seloOficial')}</span>;
  else if (e.parado) selo = <span className="ig-login-selo erro"><AlertTriangle size={13} /> {t('instagram.login.seloParado')}</span>;
  else if (e.pausado_ate) selo = <span className="ig-login-selo aviso"><PauseCircle size={13} /> {t('instagram.login.seloPausado', { hora: dataHora(e.pausado_ate) })}</span>;
  else selo = <span className="ig-login-selo ok"><CheckCircle2 size={13} /> {t('instagram.login.seloLigado', { perfil: e.username || perfil.username })}</span>;

  return (
    <div className="ig-login">
      <div className="ig-login-topo">
        <b><Cookie size={14} /> {t('instagram.login.titulo')}</b>
        {selo}
      </div>

      {!instalado && (
        <>
          <p className="suave pequeno">{t('instagram.login.explica')}</p>
          <p className="ig-login-risco pequeno"><ShieldAlert size={13} /> {t('instagram.login.risco')}</p>
          {instalacao?.status === 'erro' && <div className="erro pequeno">{t('instagram.login.instalacaoErro', { erro: instalacao.erro })}</div>}
          <div className="acoes-linha ig-acoes-esq">
            <button type="button" className="btn btn-pequeno" onClick={instalar} disabled={instalando || ocupado === 'login-instalar'}>
              {instalando ? <RefreshCw size={13} className="girando" /> : <Download size={13} />} {instalando ? t('instagram.login.instalandoBotao') : t('instagram.login.instalar')}
            </button>
          </div>
        </>
      )}

      {instalado && e.ligado && (
        <div className="ig-perfil-status">
          <span>{e.ultima_busca_em ? t('instagram.login.ultimaBusca', { quando: tempoDesde(e.ultima_busca_em) }) : t('instagram.login.nuncaBuscou')}</span>
          {e.proxy ? <span>{t('instagram.login.comProxy', { proxy: e.proxy })}</span> : <span>{t('instagram.login.semProxy')}</span>}
          <span>{t('instagram.login.semJanela')}</span>
        </div>
      )}
      {e.erro && <div className="erro pequeno">{e.erro} {e.erro_em && <small>({tempoDesde(e.erro_em)})</small>}</div>}

      {mostrarForm && (
        <div className="ig-login-form">
          {!e.ligado && <p className="suave pequeno">{t('instagram.login.explicaLigar')}</p>}
          <details className="ig-login-ajuda">
            <summary>{t('instagram.login.comoPegar')}</summary>
            <ol className="pequeno">
              <li>{t('instagram.login.passo1', { perfil: perfil.username })}</li>
              <li>{t('instagram.login.passo2')}</li>
              <li>{t('instagram.login.passo3')}</li>
              <li>{t('instagram.login.passo4')}</li>
            </ol>
            <p className="suave pequeno">{t('instagram.login.dicaSair')}</p>
          </details>
          <label className="ig-utm">{t('instagram.login.sessionid')}
            <CampoSecreto value={sessionid} onChange={(x) => setSessionid(x.target.value)} placeholder="1234567890%3AAbCd…" />
          </label>
          <label className="ig-utm">{t('instagram.login.proxy')}
            <CampoSecreto value={proxy} onChange={(x) => setProxy(x.target.value)} placeholder={e.proxy ? t('instagram.login.proxyAtual', { proxy: e.proxy }) : 'http://usuario:senha@host:porta'} />
          </label>
          <div className="acoes-linha ig-acoes-esq">
            <button type="button" className="btn btn-ouro btn-pequeno" onClick={ligar} disabled={!sessionid.trim() || ocupado === chave('ligar')}>
              <Cookie size={13} /> {e.ligado ? t('instagram.login.reconectar') : t('instagram.login.ligar')}
            </button>
            {trocando && <button type="button" className="btn btn-pequeno" onClick={() => setTrocando(false)}>{t('instagram.login.cancelar')}</button>}
          </div>
        </div>
      )}

      {instalado && e.ligado && (
        <div className="acoes-linha ig-acoes-esq">
          <label className="ig-login-intervalo pequeno">{t('instagram.login.intervalo')}
            <select value={e.intervalo_seg} onChange={(x) => intervalo(x.target.value)}>
              {[...new Set([...INTERVALOS, e.intervalo_seg])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-pequeno" onClick={buscar} disabled={e.parado || ocupado === chave('buscar')}><RefreshCw size={13} /> {t('instagram.login.buscarAgora')}</button>
          {!trocando && !e.parado && <button type="button" className="btn btn-pequeno" onClick={() => setTrocando(true)}><Cookie size={13} /> {t('instagram.login.trocarCookie')}</button>}
          <button type="button" className="btn btn-pequeno btn-perigo-leve" onClick={desligar}><Power size={13} /> {t('instagram.login.desligar')}</button>
        </div>
      )}
      {instalado && <p className="suave pequeno ig-login-rodape">{t('instagram.login.rodape', { versao: instalacao?.versao || '?' })}</p>}
    </div>
  );
}
