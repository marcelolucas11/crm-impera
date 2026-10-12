import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

const TIPOS = [
  ['open', 'Em andamento'],
  ['won', 'Ganho (fechado)'],
  ['lost', 'Perdido'],
];

// Edita as colunas do kanban: nome, cor, tipo, ordem, papel automático, criar e apagar (movendo os leads)
export default function EditorEtapas({ stages, aoMudar, onFechar }) {
  const [etapas, setEtapas] = useState(stages);
  const [nomes, setNomes] = useState(() => Object.fromEntries(stages.map((s) => [s.id, s.name])));
  const [erro, setErro] = useState('');
  const [apagando, setApagando] = useState(null);
  const [destino, setDestino] = useState('');
  const [novaNome, setNovaNome] = useState('');

  const aplicar = async (caminho, opcoes) => {
    setErro('');
    try {
      const d = await api(caminho, opcoes);
      setEtapas(d.stages);
      // Atualiza os nomes, mas não apaga o que a pessoa está digitando no campo em foco
      const focado = document.activeElement?.dataset?.etapa;
      setNomes((atual) => Object.fromEntries(d.stages.map((s) => [s.id, String(s.id) === focado ? atual[s.id] ?? s.name : s.name])));
      aoMudar(d.stages);
      return d;
    } catch (e) {
      setErro(e.message);
      return null;
    }
  };

  const salvarNome = (s) => {
    const nome = (nomes[s.id] || '').trim();
    if (!nome) return setNomes({ ...nomes, [s.id]: s.name });
    if (nome !== s.name) aplicar(`/stages/${s.id}`, { method: 'PATCH', body: { name: nome } });
  };

  const mover = (indice, direcao) => {
    const ids = etapas.map((s) => s.id);
    const alvo = indice + direcao;
    if (alvo < 0 || alvo >= ids.length) return;
    [ids[indice], ids[alvo]] = [ids[alvo], ids[indice]];
    aplicar('/stages/ordem', { method: 'POST', body: { ids } });
  };

  const criar = async (e) => {
    e.preventDefault();
    const nome = novaNome.trim();
    if (!nome) return;
    const ultimaAberta = [...etapas].reverse().find((s) => s.kind === 'open');
    if (await aplicar('/stages', { method: 'POST', body: { name: nome, depois_de: ultimaAberta?.id } })) setNovaNome('');
  };

  const confirmarApagar = async () => {
    const etapa = apagando;
    const qs = etapa.total > 0 ? `?mover_para=${destino}` : '';
    if (await aplicar(`/stages/${etapa.id}${qs}`, { method: 'DELETE' })) {
      setApagando(null);
      setDestino('');
    }
  };

  return (
    <Modal titulo="Editar etapas do kanban" onFechar={onFechar} largo>
      <div className="editor-etapas">
        <p className="suave pequeno">
          Monte o seu passo a passo: renomeie, mude a ordem, a cor e o tipo de cada coluna. Apagar uma coluna nunca apaga leads —
          eles vão para a coluna que você escolher.
        </p>

        <div className="linhas-etapas">
          {etapas.map((s, i) => (
            <div key={s.id} className="linha-etapa">
              <div className="ordem-botoes">
                <button className="btn btn-pequeno" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Mover para a esquerda">↑</button>
                <button className="btn btn-pequeno" onClick={() => mover(i, 1)} disabled={i === etapas.length - 1} aria-label="Mover para a direita">↓</button>
              </div>
              <input
                type="color"
                className="cor-etapa"
                value={s.color}
                onChange={(e) => aplicar(`/stages/${s.id}`, { method: 'PATCH', body: { color: e.target.value } })}
                aria-label={`Cor de ${s.name}`}
              />
              <input
                className="nome-etapa"
                data-etapa={s.id}
                value={nomes[s.id] ?? s.name}
                maxLength={40}
                onChange={(e) => setNomes({ ...nomes, [s.id]: e.target.value })}
                onBlur={() => salvarNome(s)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <select value={s.kind} onChange={(e) => aplicar(`/stages/${s.id}`, { method: 'PATCH', body: { kind: e.target.value } })}>
                {TIPOS.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
              </select>
              <select
                value={s.role || ''}
                disabled={s.kind !== 'open'}
                onChange={(e) => aplicar(`/stages/${s.id}`, { method: 'PATCH', body: { role: e.target.value || null } })}
                title="Recebe leads automaticamente"
              >
                <option value="">Sem automação</option>
                <option value="entrada">Leads novos entram aqui</option>
                <option value="reuniao">Reuniões do Calendly vêm para cá</option>
              </select>
              <span className="suave pequeno total-etapa">{s.total} {s.total === 1 ? 'lead' : 'leads'}</span>
              <button className="btn btn-pequeno btn-perigo-leve" onClick={() => { setApagando(s); setDestino(''); }}>Apagar</button>
            </div>
          ))}
        </div>

        <form className="form-linha form-linha-2" onSubmit={criar}>
          <input placeholder="Nome da nova etapa (ex.: Aguardando Pix)" value={novaNome} onChange={(e) => setNovaNome(e.target.value)} maxLength={40} />
          <button className="btn btn-ouro" disabled={!novaNome.trim()}>+ Adicionar etapa</button>
        </form>
        <p className="suave pequeno">A etapa nova entra depois da última etapa em andamento. Use ↑ ↓ para posicionar.</p>

        {apagando && (
          <div className="confirmar-apagar">
            <b>Apagar a etapa “{apagando.name}”?</b>
            {apagando.total > 0 ? (
              <label>
                Os {apagando.total} leads desta etapa vão para:
                <select value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Escolha uma etapa…</option>
                  {etapas.filter((s) => s.id !== apagando.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            ) : (
              <span className="suave">Esta etapa está vazia.</span>
            )}
            <div className="acoes">
              <button className="btn" onClick={() => setApagando(null)}>Cancelar</button>
              <button className="btn btn-perigo-cheio" onClick={confirmarApagar} disabled={apagando.total > 0 && !destino}>Apagar etapa</button>
            </div>
          </div>
        )}

        {erro && <div className="erro">{erro}</div>}
      </div>
    </Modal>
  );
}
