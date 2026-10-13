// Atualizar o CRM pela tela (só administrador)
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { dataHora } from '../utils.js';

export default function Atualizacao() {
  const [info, setInfo] = useState(null);
  const [estado, setEstado] = useState('parado'); // parado | buscando | atualizando | falhou
  const [erro, setErro] = useState('');
  const [log, setLog] = useState('');
  const timer = useRef(null);

  useEffect(() => { api('/sistema/versao').then(setInfo).catch(() => {}); return () => clearInterval(timer.current); }, []);

  const buscar = async () => {
    setErro(''); setEstado('buscando');
    try { setInfo(await api('/sistema/versao?buscar=1')); } catch (e) { setErro(e.message); }
    setEstado('parado');
  };

  const atualizar = async () => {
    if (!confirm('Atualizar agora? O CRM faz backup do banco e fica fora do ar por alguns segundos.')) return;
    const antes = info.atual;
    const inicio = Date.now();
    setErro(''); setEstado('atualizando');
    try { await api('/sistema/atualizar', { method: 'POST' }); } catch (e) { setErro(e.message); setEstado('parado'); return; }
    timer.current = setInterval(async () => {
      try {
        const v = await api('/sistema/versao');
        if (v.atual !== antes) { clearInterval(timer.current); window.location.reload(); return; }
        const { log: l } = await api('/sistema/log');
        setLog(l);
        if (/✖|Não consegui|não ligou/.test(l)) { clearInterval(timer.current); setEstado('falhou'); }
      } catch { /* servidor reiniciando */ }
      if (Date.now() - inicio > 5 * 60000) {
        clearInterval(timer.current); setEstado('falhou');
        setErro('A atualização demorou demais. Confira no Terminal: tail -n 40 ../logs/atualizacao.log');
      }
    }, 3000);
  };

  const temNova = info?.novidades?.length > 0;
  // Commit com link para a mesma página no GitHub, para conferir que é a mesma versão
  const commit = (hash) => (info?.github
    ? <a href={`${info.github}/commit/${hash}`} target="_blank" rel="noopener noreferrer"><code>{hash}</code></a>
    : <code>{hash}</code>);
  const numeroNovo = temNova && info.versaoRemota && info.versaoRemota !== info.versao ? info.versaoRemota : null;
  return (
    <section className="cartao-secao">
      <h2>Atualização do CRM</h2>
      {info && (
        <p className="suave">
          Versão instalada: <b>{info.versao || info.atual}</b>
          {info.versao && <> · {commit(info.atual)}</>}
          {info.data ? ` · ${dataHora(info.data)}` : ''}
        </p>
      )}
      {erro && <div className="erro">{erro}</div>}
      {info?.remota && !temNova && (
        <div className="sucesso">✓ O CRM está na versão mais recente{info.versao ? ` (${info.versao})` : ''}, igual à do GitHub.</div>
      )}
      {temNova && (
        <>
          <p>
            Versão nova no GitHub: <b>{numeroNovo || info.remota}</b>
            {numeroNovo && <> · {commit(info.remota)}</>}
            {' '}— <b>{info.novidades.length}</b> {info.novidades.length === 1 ? 'novidade' : 'novidades'}:
          </p>
          <ul className="novidades">{info.novidades.slice(0, 15).map((n, i) => <li key={i}>{n}</li>)}</ul>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={buscar} disabled={estado === 'buscando' || estado === 'atualizando'}>
          {estado === 'buscando' ? 'Buscando…' : 'Buscar atualização'}
        </button>
        {temNova && (
          <button className="btn btn-ouro" onClick={atualizar} disabled={estado === 'atualizando'}>
            {estado === 'atualizando' ? 'Atualizando… a página recarrega sozinha' : 'Atualizar agora'}
          </button>
        )}
      </div>
      {(estado === 'atualizando' || estado === 'falhou') && log && <pre className="log-atualizacao">{log}</pre>}
      {estado === 'falhou' && <p className="alerta">A atualização não terminou. Seus dados estão intactos; se o CRM não abrir, rode ./scripts/voltar-versao.sh no Terminal.</p>}
    </section>
  );
}
