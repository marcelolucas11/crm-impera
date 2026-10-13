// Aba "Disparos": saudação automática do Yay! Forms, disparo personalizado, listas de contatos e monitor da fila
import { useCallback, useEffect, useState } from 'react';
import { Zap, Megaphone, Users, Activity } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { ProvedorAvisos } from './comum.jsx';
import AbaYayForms from './AbaYayForms.jsx';
import AbaCampanha from './AbaCampanha.jsx';
import AbaListas from './AbaListas.jsx';
import AbaMonitor from './AbaMonitor.jsx';
import './disparos.css';

const SUBABAS = [
  { id: 'yayforms', rotulo: 'Automação Yay! Forms', icone: Zap },
  { id: 'campanha', rotulo: 'Disparo personalizado', icone: Megaphone },
  { id: 'listas', rotulo: 'Listas de contatos', icone: Users },
  { id: 'monitor', rotulo: 'Monitor, modelos e bloqueio', icone: Activity },
];
const CHAVE = 'crm.disparos.subaba';

export default function DisparosPagina() {
  const [aba, setAbaEstado] = useState(() => {
    try { const a = localStorage.getItem(CHAVE); return SUBABAS.some((s) => s.id === a) ? a : 'yayforms'; } catch { return 'yayforms'; }
  });
  const setAba = (a) => { setAbaEstado(a); try { localStorage.setItem(CHAVE, a); } catch { /* sem armazenamento */ } };
  const [numeros, setNumeros] = useState([]);
  const [ativas, setAtivas] = useState(0);
  const [modelo, setModelo] = useState(null);
  const [lista, setLista] = useState(null);

  const carregarNumeros = useCallback(() => api('/whatsapp/numeros').then((d) => setNumeros(d.numeros)).catch(() => {}), []);
  const carregarAtivas = useCallback(() => api('/disparos/campanhas')
    .then((d) => setAtivas(d.campanhas.filter((c) => c.status === 'executando' && c.tipo !== 'yayforms').length)).catch(() => {}), []);
  useEffect(() => { carregarNumeros(); carregarAtivas(); }, [carregarNumeros, carregarAtivas]);
  useEvento('whatsapp', (d) => { if (d?.numeros || d?.reconectou) carregarNumeros(); });
  useEvento('disparos', carregarAtivas);

  return (
    <ProvedorAvisos>
      <div className="pagina pagina-larga dp-pagina">
        <div className="cabecalho-pagina">
          <h1>Disparos</h1>
          <nav className="dp-subabas" aria-label="Áreas de disparos">
            {SUBABAS.map((s) => {
              const I = s.icone;
              return (
                <button key={s.id} className={`dp-subaba ${aba === s.id ? 'ativa' : ''}`} onClick={() => setAba(s.id)} aria-current={aba === s.id ? 'page' : undefined}>
                  <I size={15} /> <span>{s.rotulo}</span>
                  {s.id === 'monitor' && ativas > 0 && <span className="aba-contador" title="Campanhas em andamento">{ativas}</span>}
                </button>
              );
            })}
          </nav>
        </div>
        {aba === 'yayforms' && <AbaYayForms numeros={numeros} />}
        {aba === 'campanha' && (
          <AbaCampanha numeros={numeros} modeloInicial={modelo} aoConsumirModelo={() => setModelo(null)}
            listaInicial={lista} aoConsumirLista={() => setLista(null)} aoIniciar={() => setAba('monitor')} />
        )}
        {aba === 'listas' && <AbaListas aoUsarLista={(l) => { setLista(l); setAba('campanha'); }} />}
        {aba === 'monitor' && <AbaMonitor aoUsarModelo={(m) => { setModelo(m); setAba('campanha'); }} />}
      </div>
    </ProvedorAvisos>
  );
}
