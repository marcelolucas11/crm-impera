import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dataHora, tempoDesde } from '../utils.js';

export default function CalendlyStatus({ aoMensagem, aoErro }) {
  const [st, setSt] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    try { setSt(await api('/calendly/status')); } catch (e) { aoErro(e.message); }
  }, [aoErro]);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 30000);
    return () => clearInterval(id);
  }, [carregar]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const { resumo } = await api('/calendly/sincronizar', { method: 'POST' });
      aoMensagem(`Calendly sincronizado: ${resumo.novos} reunião(ões) nova(s), ${resumo.atualizados} atualizada(s), ${resumo.leads_criados} lead(s) criado(s).`);
    } catch (e) {
      aoErro(e.message);
    } finally {
      setSincronizando(false);
      carregar();
    }
  };

  return (
    <section className="cartao-secao">
      <h2>Calendly</h2>
      {!st ? <p className="suave">Carregando…</p> : !st.configurado ? (
        <>
          <p>Ainda não conectado. No Terminal, dentro da pasta <code>app</code>, rode:</p>
          <div className="copiar"><code>./scripts/configurar-calendly.sh</code></div>
          <p className="suave pequeno">O comando pede o token pessoal do Calendly e grava só neste computador. Ele nunca vai para o GitHub.</p>
        </>
      ) : (
        <>
          <p className="suave pequeno">
            O CRM consulta o Calendly a cada {st.intervalo_min} min. Cada reunião nova liga ao lead pelo e-mail ou telefone
            (ou cria o lead) e o move para <b>Reunião agendada</b>. Cancelamentos e reagendamentos ficam no histórico.
          </p>
          <dl className="dados-integracao">
            <div><dt>Conta</dt><dd>{st.conta ? `${st.conta.nome} (${st.conta.email})` : '—'}</dd></div>
            <div><dt>Última sincronização</dt><dd>{st.ultima_sincronizacao ? `${tempoDesde(st.ultima_sincronizacao)} (${dataHora(st.ultima_sincronizacao)})` : 'ainda não rodou'}</dd></div>
            <div><dt>Reuniões futuras</dt><dd>{st.reunioes_futuras}</dd></div>
          </dl>
          {st.ultimo_erro && <div className="erro">Último erro: {st.ultimo_erro}</div>}
          <div><button className="btn btn-ouro btn-pequeno" onClick={sincronizar} disabled={sincronizando}>{sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button></div>
        </>
      )}
    </section>
  );
}
