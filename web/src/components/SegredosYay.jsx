import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dataHora } from '../utils.js';

// Cada webhook criado no Yay! Forms tem o seu próprio "Secret". Aqui ficam todos: o CRM aceita o webhook
// se a assinatura bater com qualquer um deles.
export default function SegredosYay({ aoMensagem, aoErro, aoMudar }) {
  const [segredos, setSegredos] = useState([]);
  const [nome, setNome] = useState('');
  const [segredo, setSegredo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try { setSegredos((await api('/yayforms/segredos')).segredos); } catch (e) { aoErro(e.message); }
  }, [aoErro]);

  useEffect(() => { carregar(); }, [carregar]);

  const adicionar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('/yayforms/segredos', { method: 'POST', body: { nome, segredo } });
      setNome(''); setSegredo('');
      aoMensagem('Segredo guardado. Webhooks assinados com ele já são aceitos — se algum foi recusado antes, clique em Reprocessar.');
      await carregar();
      aoMudar?.();
    } catch (err) { aoErro(err.message); } finally { setSalvando(false); }
  };

  const remover = async (s) => {
    if (!confirm(`Remover o segredo “${s.nome}”? Webhooks assinados com ele passam a ser recusados.`)) return;
    try {
      await api(`/yayforms/segredos/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      aoMensagem('Segredo removido.');
      await carregar();
      aoMudar?.();
    } catch (err) { aoErro(err.message); }
  };

  return (
    <>
      <h3>Segredos dos webhooks</h3>
      <p className="suave pequeno">
        No Yay! Forms, cada webhook tem um <b>Secret</b> próprio. Cole aqui o de cada webhook que apontar para o CRM.
        {segredos.length === 0
          ? ' Sem nenhum segredo cadastrado, o CRM aceita qualquer webhook enviado para a URL acima.'
          : ' Com pelo menos um cadastrado, só entram webhooks assinados com algum deles.'}
      </p>

      {segredos.length > 0 && (
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Segredo</th><th>Cadastrado</th><th>Último uso</th><th /></tr></thead>
          <tbody>
            {segredos.map((s) => (
              <tr key={s.id}>
                <td>{s.nome}</td>
                <td className="suave pequeno"><code>{s.final}</code></td>
                <td>{s.criado_em ? dataHora(s.criado_em) : '—'}</td>
                <td>{s.fixo ? '—' : s.ultimo_uso ? dataHora(s.ultimo_uso) : 'Nunca'}</td>
                <td>{!s.fixo && <button className="btn btn-pequeno" onClick={() => remover(s)}>Remover</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={adicionar} className="form-linha">
        <input placeholder="Nome (ex.: Formulário rifas)" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
        <input
          placeholder="Cole o Secret do Yay! Forms"
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <button className="btn" disabled={salvando || !segredo.trim()}>Guardar segredo</button>
      </form>
    </>
  );
}
