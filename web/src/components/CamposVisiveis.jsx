// Escolhe quais campos e respostas do formulário aparecem nos cartões do kanban (salvo no navegador)
import { useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { CAMPOS_FIXOS } from './Kanban.jsx';

export default function CamposVisiveis({ leads, ocultos, setOcultos, onFechar }) {
  // Pergunta (pelo texto) → códigos dela no Yay! Forms. Quem ocultou quando ainda aparecia o código continua oculto.
  const perguntas = useMemo(() => {
    const vistas = new Map();
    leads.forEach((l) => (l.respostas || []).forEach((r) => {
      if (!r.pergunta) return;
      if (!vistas.has(r.pergunta)) vistas.set(r.pergunta, new Set());
      if (r.id) vistas.get(r.pergunta).add(r.id);
    }));
    return [...vistas].map(([texto, ids]) => ({ texto, ids: [...ids] }));
  }, [leads]);
  const set = new Set(ocultos);
  const chavesDe = (k) => {
    const p = perguntas.find((x) => `q:${x.texto}` === k);
    return [k, ...(p ? p.ids.map((id) => `q:${id}`) : [])];
  };
  const oculto = (k) => chavesDe(k).some((c) => set.has(c));
  const alternar = (k) => {
    if (oculto(k)) chavesDe(k).forEach((c) => set.delete(c)); else set.add(k);
    setOcultos([...set]);
  };
  const todas = [...CAMPOS_FIXOS.map(([k]) => k), ...perguntas.map((p) => `q:${p.texto}`)];
  const Linha = ({ k, rotulo }) => (
    <label className="campo-vis">
      <span>{rotulo}</span>
      <button className={`olho ${oculto(k) ? 'fechado' : ''}`} onClick={() => alternar(k)} title={oculto(k) ? 'Mostrar' : 'Ocultar'}>
        {oculto(k) ? <EyeOff size={16} /> : <Eye size={16} />}
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
      {perguntas.length ? perguntas.map((p) => <Linha key={p.texto} k={`q:${p.texto}`} rotulo={p.texto} />) : <div className="suave">Nenhuma resposta de formulário ainda.</div>}
    </div>
  );
}
