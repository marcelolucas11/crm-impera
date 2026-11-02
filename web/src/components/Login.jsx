import { useState } from 'react';
import { api } from '../api.js';
import logo from '../assets/logo-impera.png';
import FundoLogo3D from './FundoLogo3D.jsx';
import { useT } from '../i18n/index.jsx';
import SeletorIdioma from './SeletorIdioma.jsx';

export default function Login({ aoEntrar }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, senha } });
      aoEntrar(d.user);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="tela-cheia login-fundo">
      <FundoLogo3D modo="login" />
      <form className="login-caixa" onSubmit={entrar}>
        <div className="login-marca">
          <img className="login-logo" src={logo} alt="" />
          <div className="marca marca-grande">IMPERA <span>CRM</span></div>
          <p className="login-sub">{t('login.sub')}</p>
        </div>
        <label>
          {t('login.email')}
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          {t('login.senha')}
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        {erro && <div className="erro">{erro}</div>}
        <button className="btn btn-ouro" disabled={enviando}>{enviando ? t('login.entrando') : t('login.entrar')}</button>
        <SeletorIdioma compacto />
      </form>
    </div>
  );
}
