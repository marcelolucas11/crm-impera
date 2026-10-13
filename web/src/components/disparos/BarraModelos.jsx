// "Carregar modelo" e "Salvar fluxo como modelo" — usados nos dois construtores de fluxo
import { useEffect, useRef, useState } from 'react';
import { LayoutTemplate, Save, ChevronDown } from 'lucide-react';
import { api } from '../../api.js';
import { useAviso, hidratarBlocos } from './comum.jsx';
import { paraEnvio, novoId } from './texto.js';

export default function BarraModelos({ blocos, setBlocos }) {
  const aviso = useAviso();
  const [modelos, setModelos] = useState([]);
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  const carregar = () => api('/disparos/modelos').then((d) => setModelos(d.modelos)).catch(() => {});
  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!ref.current?.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const usar = async (m) => {
    setAberto(false);
    if (blocos.some((b) => b.texto || b.midia_id) && !window.confirm(`Trocar o fluxo atual pelo modelo “${m.nome}”?`)) return;
    setBlocos((await hidratarBlocos(m.blocos, api)).map((b) => ({ ...b, id: novoId() })));
    aviso(`Modelo “${m.nome}” carregado`);
  };

  const salvar = async () => {
    if (!blocos.length) { aviso('Monte pelo menos um bloco antes de salvar', 'erro'); return; }
    const nome = window.prompt('Nome do modelo (ex.: Boas-vindas com áudio):');
    if (!nome?.trim()) return;
    try {
      await api('/disparos/modelos', { method: 'POST', body: { nome, blocos: paraEnvio(blocos) } });
      aviso('Fluxo salvo como modelo');
      carregar();
    } catch (e) { aviso(e.message, 'erro'); }
  };

  return (
    <div className="dp-barra-modelos" ref={ref}>
      <button type="button" className="btn btn-pequeno" onClick={() => { carregar(); setAberto(!aberto); }}>
        <LayoutTemplate size={13} /> Carregar modelo <ChevronDown size={12} />
      </button>
      <button type="button" className="btn btn-pequeno" onClick={salvar}><Save size={13} /> Salvar fluxo como modelo</button>
      {aberto && (
        <div className="menu dp-menu-modelos">
          {!modelos.length && <div className="suave pequeno" style={{ padding: 10 }}>Nenhum modelo salvo ainda.</div>}
          {modelos.map((m) => (
            <button key={m.id} type="button" onClick={() => usar(m)}>
              <b>{m.nome}</b>
              <small className="suave">{m.blocos.length} bloco(s)</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
