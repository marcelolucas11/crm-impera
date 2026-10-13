// Peças comuns da aba Disparos: avisos flutuantes (toasts), chave liga/desliga, envio de arquivo e o contexto da página
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { rota } from '../../base.js';

const ContextoAvisos = createContext(() => {});
export const useAviso = () => useContext(ContextoAvisos);

export function ProvedorAvisos({ children }) {
  const [avisos, setAvisos] = useState([]);
  const seq = useRef(0);
  const fechar = useCallback((id) => setAvisos((l) => l.filter((a) => a.id !== id)), []);
  // aviso('Salvo!') · aviso('Deu erro', 'erro') · aviso('Atenção', 'info')
  const aviso = useCallback((texto, tipo = 'ok') => {
    const id = ++seq.current;
    setAvisos((l) => [...l.slice(-3), { id, texto: String(texto), tipo }]);
    setTimeout(() => fechar(id), tipo === 'erro' ? 7000 : 3800);
  }, [fechar]);
  return (
    <ContextoAvisos.Provider value={aviso}>
      {children}
      <div className="dp-avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`dp-aviso dp-aviso-${a.tipo}`}>
            {a.tipo === 'erro' ? <AlertTriangle size={16} /> : a.tipo === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}
            <span>{a.texto}</span>
            <button onClick={() => fechar(a.id)} aria-label="Fechar aviso"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ContextoAvisos.Provider>
  );
}

export function Interruptor({ ligado, aoMudar, rotulo, disabled = false, grande = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      disabled={disabled}
      className={`dp-interruptor ${ligado ? 'ligado' : ''} ${grande ? 'grande' : ''}`}
      onClick={() => aoMudar(!ligado)}
    >
      <span className="dp-interruptor-trilho"><span className="dp-interruptor-bola" /></span>
      {rotulo && <span className="dp-interruptor-rotulo">{rotulo}</span>}
    </button>
  );
}

// Manda um arquivo (ou gravação) para o servidor e devolve a mídia salva { id, nome, mime, tamanho }
export async function enviarArquivo(arquivo, nome) {
  const params = new URLSearchParams({ nome: nome || arquivo.name || 'arquivo', mime: arquivo.type || 'application/octet-stream' });
  const resp = await fetch(rota(`/api/disparos/midias?${params}`), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: arquivo,
  });
  let dados = null;
  try { dados = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new Error(dados?.erro || `Erro ${resp.status}`);
  return dados.midia;
}

export const urlMidia = (id) => rota(`/api/disparos/midias/${id}`);

export function Vazio({ icone: Icone, titulo, children }) {
  return (
    <div className="dp-vazio">
      {Icone && <Icone size={30} strokeWidth={1.4} />}
      <b>{titulo}</b>
      {children && <span>{children}</span>}
    </div>
  );
}

// Blocos vindos do servidor só têm o id do arquivo: busca nome/tipo/tamanho para a tela mostrar
export async function hidratarBlocos(blocos, apiFn) {
  const lista = Array.isArray(blocos) ? blocos : [];
  const ids = [...new Set(lista.map((b) => b.midia_id).filter(Boolean))];
  let mapa = new Map();
  if (ids.length) {
    try {
      const d = await apiFn(`/disparos/midias?ids=${ids.join(',')}`);
      mapa = new Map(d.midias.map((m) => [m.id, m]));
    } catch { /* mostra só o id */ }
  }
  return lista.map((b) => ({ nome_arquivo: '', ptt: true, ...b, midia: b.midia_id ? mapa.get(b.midia_id) || null : null }));
}
