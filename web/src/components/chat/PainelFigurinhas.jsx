import { useCallback, useEffect, useRef, useState } from 'react';
import { Star, Plus, Clock, Heart, RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { rota } from '../../base.js';
import { useEvento } from '../../tempoReal.js';

// Figurinhas: favoritas (do celular e do CRM) e recentes (enviadas e recebidas).
// "Criar" transforma uma imagem (ou vídeo/GIF curto, vira animada) em figurinha 512×512.
export default function PainelFigurinhas({ onEnviar, onErro }) {
  const [aba, setAba] = useState('favoritas');
  const [dados, setDados] = useState(null);
  const [criando, setCriando] = useState(false);
  const arquivo = useRef(null);

  const carregar = useCallback(() => {
    api('/whatsapp/figurinhas').then(setDados).catch((e) => onErro?.(e.message));
  }, [onErro]);
  useEffect(carregar, [carregar]);
  useEvento('whatsapp', (d) => { if (d?.figurinhas || d?.midia) carregar(); });

  const favoritar = async (f) => {
    try {
      await api(`/whatsapp/figurinhas/${f.id}/favorita`, { method: 'POST', body: { favorita: !f.crm_favorite } });
      carregar();
    } catch (e) { onErro?.(e.message); }
  };

  const criar = async (lista) => {
    const a = lista?.[0];
    if (!a) return;
    setCriando(true);
    try {
      const resp = await fetch(rota(`/api/whatsapp/figurinhas?mime=${encodeURIComponent(a.type || '')}`), {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: a,
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(d.erro || `Erro ${resp.status}`);
      setAba('favoritas');
      carregar();
    } catch (e) {
      onErro?.(e.message);
    } finally {
      setCriando(false);
    }
  };

  const lista = (dados?.[aba] || []).filter((f) => f.pronta);
  const pendentes = (dados?.[aba] || []).filter((f) => !f.pronta).length;

  return (
    <div className="painel-figurinhas">
      <div className="figurinhas-abas">
        <button type="button" className={aba === 'favoritas' ? 'ativa' : ''} onClick={() => setAba('favoritas')} title="Favoritas"><Heart size={18} /> Favoritas</button>
        <button type="button" className={aba === 'recentes' ? 'ativa' : ''} onClick={() => setAba('recentes')} title="Recentes"><Clock size={18} /> Recentes</button>
        <span className="espaco" />
        <button type="button" onClick={() => arquivo.current?.click()} disabled={criando} title="Criar figurinha a partir de uma imagem, GIF ou vídeo curto">
          {criando ? <RefreshCw size={18} className="girando-icone" /> : <Plus size={18} />} Criar
        </button>
        <input ref={arquivo} type="file" accept="image/*,video/*" hidden onChange={(e) => { criar(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="figurinhas-grade">
        {!dados && <span className="girando" />}
        {dados && !lista.length && (
          <p className="figurinhas-vazio">
            {aba === 'favoritas'
              ? 'Nenhuma figurinha favorita ainda. As favoritas do celular aparecem aqui depois da sincronização (Equipe e integrações → Sincronizar figurinhas). Você também pode favoritar no CRM ou criar uma.'
              : 'As figurinhas enviadas e recebidas aparecem aqui.'}
          </p>
        )}
        {lista.map((f) => (
          <span key={f.id} className="figurinha-item">
            <button type="button" className="figurinha-botao" onClick={() => onEnviar(f.id)} title="Enviar figurinha">
              <img src={rota(`/api/whatsapp/figurinhas/${f.id}/arquivo`)} alt="Figurinha" loading="lazy" />
            </button>
            <button type="button" className={`figurinha-estrela ${f.crm_favorite || f.phone_favorite ? 'ativa' : ''}`}
              title={f.phone_favorite && !f.crm_favorite ? 'Favorita no celular' : f.crm_favorite ? 'Tirar das favoritas do CRM' : 'Favoritar'}
              onClick={() => favoritar(f)}>
              <Star size={13} fill={f.crm_favorite || f.phone_favorite ? 'currentColor' : 'none'} />
            </button>
          </span>
        ))}
        {pendentes > 0 && <p className="figurinhas-vazio">Baixando {pendentes} figurinha(s) do celular…</p>}
      </div>
    </div>
  );
}
