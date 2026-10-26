import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dataHora, tempoDesde } from '../utils.js';

export default function CalendlyStatus({ aoMensagem, aoErro }) {
  const [st, setSt] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [token, setToken] = useState('');
  const [conectando, setConectando] = useState(false);
  const [trocando, setTrocando] = useState(false);

  const carregar = useCallback(async () => {
    try { setSt(await api('/calendly/status')); } catch (e) { aoErro(e.message); }
  }, [aoErro]);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 30000);
    return () => clearInterval(id);
  }, [carregar]);

  const sincronizar = async (dias) => {
    setSincronizando(true);
    try {
      const { resumo } = await api('/calendly/sincronizar', { method: 'POST', body: dias ? { dias } : undefined });
      aoMensagem(`Calendly sincronizado: ${resumo.novos} reunião(ões) nova(s), ${resumo.atualizados} atualizada(s), ${resumo.leads_criados} lead(s) criado(s).`);
    } catch (e) {
      aoErro(e.message);
    } finally {
      setSincronizando(false);
      carregar();
    }
  };

  const conectar = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setConectando(true);
    try {
      const { conta } = await api('/calendly/token', { method: 'POST', body: { token } });
      setToken('');
      setTrocando(false);
      aoMensagem(`Calendly conectado: ${conta.nome} (${conta.email}). As reuniões começam a chegar em instantes.`);
    } catch (err) {
      aoErro(err.message);
    } finally {
      setConectando(false);
      carregar();
    }
  };

  const desconectar = async () => {
    if (!confirm('Desconectar o Calendly? O CRM para de buscar reuniões novas. As reuniões já salvas continuam nos leads.')) return;
    try {
      await api('/calendly/token', { method: 'DELETE' });
      aoMensagem('Calendly desconectado.');
    } catch (err) {
      aoErro(err.message);
    } finally {
      carregar();
    }
  };

  const formularioToken = (
    <form onSubmit={conectar} className="form-token">
      <label>Token pessoal do Calendly
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Cole aqui o token"
          autoComplete="off"
          spellCheck={false}
          disabled={conectando}
        />
      </label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ouro btn-pequeno" disabled={conectando || !token.trim()}>{conectando ? 'Conferindo…' : 'Conectar'}</button>
        {trocando && <button type="button" className="btn btn-pequeno" onClick={() => { setTrocando(false); setToken(''); }}>Cancelar</button>}
      </div>
      <p className="suave pequeno">
        Para gerar o token: no Calendly, vá em <b>Integrações → API e webhooks → Personal access tokens</b> e crie um.
        O CRM confere o token com o Calendly antes de guardar. Ele fica só no servidor do CRM e nunca é mostrado de novo
        (só os 4 últimos caracteres).
      </p>
    </form>
  );

  return (
    <section className="cartao-secao">
      <h2>Calendly</h2>
      {!st ? <p className="suave">Carregando…</p> : !st.configurado ? (
        <>
          <p>Ainda não conectado. Cole o token do Calendly abaixo para o CRM começar a trazer as reuniões.</p>
          {formularioToken}
        </>
      ) : (
        <>
          <p className="suave pequeno">
            O CRM consulta o Calendly a cada {st.intervalo_min} min. Cada reunião nova liga ao lead pelo ID do formulário, telefone ou e-mail
            (ou cria o lead) e o move para <b>Reunião agendada</b>. Cancelamentos e reagendamentos ficam no histórico.
          </p>
          <dl className="dados-integracao">
            <div><dt>Conta</dt><dd>{st.conta ? `${st.conta.nome} (${st.conta.email})` : '—'}</dd></div>
            <div><dt>Token</dt><dd>{st.token_final}{st.origem_token === 'env' ? ' · definido no arquivo .env do servidor' : ' · colado no CRM'}</dd></div>
            <div><dt>Última sincronização</dt><dd>{st.ultima_sincronizacao ? `${tempoDesde(st.ultima_sincronizacao)} (${dataHora(st.ultima_sincronizacao)})` : 'ainda não rodou'}</dd></div>
            <div><dt>Reuniões futuras</dt><dd>{st.reunioes_futuras}</dd></div>
          </dl>
          {st.ultimo_erro && <div className="erro">Último erro: {st.ultimo_erro}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-ouro btn-pequeno" onClick={() => sincronizar()} disabled={sincronizando}>{sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
            <button className="btn btn-pequeno" onClick={() => setTrocando((v) => !v)} disabled={conectando}>Trocar token</button>
            {st.origem_token === 'painel' && <button className="btn btn-pequeno btn-perigo" onClick={desconectar}>Desconectar</button>}
            <button className="btn btn-pequeno" onClick={() => sincronizar(180)} disabled={sincronizando} title="Busca as reuniões dos últimos 180 dias para saber quem já tinha agendado antes">
              Buscar reuniões antigas (180 dias)
            </button>
          </div>
          {trocando && formularioToken}
        </>
      )}
    </section>
  );
}
