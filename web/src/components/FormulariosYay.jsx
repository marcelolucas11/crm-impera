import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dataHora } from '../utils.js';

// O webhook do Yay! Forms não manda o nome do formulário, só o ID. Aqui você dá um nome a cada um.
export default function FormulariosYay({ aoMensagem, aoErro }) {
  const [formularios, setFormularios] = useState([]);
  const [nomes, setNomes] = useState({});

  const carregar = useCallback(async () => {
    try {
      const d = await api('/yayforms/formularios');
      setFormularios(d.formularios);
      setNomes(Object.fromEntries(d.formularios.map((f) => [f.form_id, f.nome || ''])));
    } catch (e) { aoErro(e.message); }
  }, [aoErro]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (f) => {
    const nome = (nomes[f.form_id] || '').trim();
    if (nome === (f.nome || '')) return;
    try {
      await api(`/yayforms/formularios/${encodeURIComponent(f.form_id)}`, { method: 'PUT', body: { nome } });
      aoMensagem(nome ? `Formulário renomeado para “${nome}”. Os leads dele já mostram o nome novo.` : 'Nome do formulário removido.');
      carregar();
    } catch (e) { aoErro(e.message); }
  };

  if (!formularios.length) return null;
  return (
    <>
      <h3>Nomes dos formulários</h3>
      <p className="suave pequeno">O Yay! Forms envia só o código do formulário. Dê um nome para ele aparecer nos cards, nos filtros e nas estatísticas.</p>
      <table className="tabela">
        <thead><tr><th>Nome no CRM</th><th>Código</th><th>Respostas</th><th>Última</th></tr></thead>
        <tbody>
          {formularios.map((f) => (
            <tr key={f.form_id}>
              <td>
                <input
                  placeholder="Ex.: Formulário de rifas"
                  value={nomes[f.form_id] ?? ''}
                  onChange={(e) => setNomes({ ...nomes, [f.form_id]: e.target.value })}
                  onBlur={() => salvar(f)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  maxLength={120}
                />
              </td>
              <td className="suave pequeno">{f.form_id}</td>
              <td>{f.respostas}</td>
              <td>{dataHora(f.ultima)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
