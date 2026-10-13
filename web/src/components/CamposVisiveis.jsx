// Escolhe quais campos e respostas do formulário aparecem nos cartões do kanban (salvo no navegador)
import { useMemo } from 'react';
import { CAMPOS_FIXOS } from './Kanban.jsx';

export default function CamposVisiveis({ leads, ocultos, setOcultos, onFechar }) {
  const perguntas = useMemo(() => {
    const vistas = new Set();
    leads.forEach((l) => (l.respostas || []).forEach((r) => r.pergunta && vistas.add(r.pergunta)));
    return [...vistas];
  }, [leads]);
  const set = new Set(ocultos);
  const alternar = (k) => { set.has(k) ? set.delete(k) : set.add(k); setOcultos([...set]); };
  const todas = [...CAMPOS_FIXOS.map(([k]) => k), ...perguntas.map((p) => `q:${p}`)];
  const Linha = ({ k, rotulo }) => (
    <label className="campo-vis">
      <span>{rotulo}</span>
      <button className={`olho ${set.has(k) ? 'fechado' : ''}`} onClick={() => alternar(k)} title={set.has(k) ? 'Mostrar' : 'Ocultar'}>
        {set.has(k) ? '🙈' : '👁'}
      </button>
    </label>
  );
  return (
    <div className="painel-campos">
      <div className="painel-campos-topo">
        <strong>Campos visíveis nos cartões</strong>
        <div className="espaco" />
        <button className="link" onClick={() => setOcultos([])}>Exibir todos</button>
        <button className="link" onClick={() => setOcultos(todas)}>Ocultar todos</button>
        <button className="link" onClick={onFechar}>Fechar</button>
      </div>
      <h5>Informações do lead</h5>
      {CAMPOS_FIXOS.map(([k, r]) => <Linha key={k} k={k} rotulo={r} />)}
      <h5>Perguntas do formulário</h5>
      {perguntas.length ? perguntas.map((p) => <Linha key={p} k={`q:${p}`} rotulo={p} />) : <div className="suave">Nenhuma resposta de formulário ainda.</div>}
    </div>
  );
}
