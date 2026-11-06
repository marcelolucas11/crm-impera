// Ajustes da assistente: nome, modelos, tetos de custo, fuso, canal do WhatsApp e (administradores) transcrição de áudio
import { useCallback, useEffect, useState } from 'react';
import { Settings2, Smartphone, AudioLines, Save, Download, Loader2, Cpu } from 'lucide-react';
import { api } from '../../../api.js';
import { useEvento } from '../../../tempoReal.js';
import { useT } from '../../../i18n/index.jsx';
import { useAviso, Interruptor } from '../../disparos/comum.jsx';
import { rotuloModelo, FUSOS, nomeFuso, dataHoraCurta } from './comum.js';

export default function Ajustes({ dados, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  const [cfg, setCfg] = useState(dados.config);
  const [telefones, setTelefones] = useState((dados.config.whatsapp_telefones || []).join(', '));
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (!alterado) { setCfg(dados.config); setTelefones((dados.config.whatsapp_telefones || []).join(', ')); } }, [dados.config]); // eslint-disable-line react-hooks/exhaustive-deps
  const mudar = (p) => { setCfg((c) => ({ ...c, ...p })); setAlterado(true); };

  const salvar = async () => {
    setSalvando(true);
    try {
      await api('/agente/config', { method: 'PUT', body: { ...cfg, whatsapp_telefones: telefones } });
      setAlterado(false);
      aviso(t('ia.agente.ajustes.salvo'));
      aoMudar?.();
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  return (
    <div className="ag-ajustes">
      <section className="cartao-secao ia-pagina">
        <h2><Settings2 size={16} /> {t('ia.agente.ajustes.titulo')}</h2>
        <div className="ia-campos-3">
          <label>{t('ia.agente.ajustes.nome')}<input value={cfg.nome} maxLength={40} onChange={(e) => mudar({ nome: e.target.value })} /></label>
          <label>{t('ia.agente.ajustes.fuso')}
            <select value={cfg.fuso} onChange={(e) => mudar({ fuso: e.target.value })}>
              {[...new Set([...FUSOS, cfg.fuso])].map((f) => <option key={f} value={f}>{nomeFuso(f)}</option>)}
            </select>
          </label>
        </div>
        <div className="ia-campos-3">
          {['modelo_chat', 'modelo_agendados', 'modelo_contexto'].map((k) => (
            <label key={k}>{t(`ia.agente.ajustes.${k}`)}
              <select value={cfg[k]} onChange={(e) => mudar({ [k]: e.target.value })}>
                {dados.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="ia-campos-2">
          <label>{t('ia.agente.ajustes.tetoChat')}<input type="number" min={0.05} max={500} step={0.5} value={cfg.teto_chat_dia} onChange={(e) => mudar({ teto_chat_dia: e.target.value })} /></label>
          <label>{t('ia.agente.ajustes.tetoAgendados')}<input type="number" min={0.05} max={500} step={0.5} value={cfg.teto_agendados_dia} onChange={(e) => mudar({ teto_agendados_dia: e.target.value })} /></label>
        </div>
        <p className="suave pequeno">{t('ia.agente.ajustes.tetosTexto')}</p>
      </section>

      <section className="cartao-secao ia-pagina">
        <div className="dp-secao-topo">
          <h2><Smartphone size={16} /> {t('ia.agente.ajustes.whatsTitulo')}</h2>
          <Interruptor ligado={Boolean(cfg.whatsapp_ativo)} aoMudar={(v) => mudar({ whatsapp_ativo: v })} rotulo={cfg.whatsapp_ativo ? t('ia.agente.ligado') : t('ia.agente.desligado')} />
        </div>
        <p className="suave pequeno">{t('ia.agente.ajustes.whatsTexto', { nome: cfg.nome })}</p>
        <div className="ia-campos-2">
          <label>{t('ia.agente.ajustes.telefones')}<input value={telefones} placeholder="+55 11 99999-9999" onChange={(e) => { setTelefones(e.target.value); setAlterado(true); }} /></label>
          <label>{t('ia.agente.ajustes.numeroResponde')}
            <select value={cfg.whatsapp_numero_id || ''} onChange={(e) => mudar({ whatsapp_numero_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('ia.agente.ajustes.mesmoNumero')}</option>
              {dados.numeros.map((n) => <option key={n.id} value={n.id}>{n.name || n.phone} — {n.status}</option>)}
            </select>
          </label>
        </div>
        <label className="dp-check">
          <input type="checkbox" checked={Boolean(cfg.whatsapp_proprio)} onChange={(e) => mudar({ whatsapp_proprio: e.target.checked })} />
          <span>{t('ia.agente.ajustes.proprio')}</span>
        </label>
        <p className="suave pequeno">{t('ia.agente.ajustes.comandos')}</p>
      </section>

      <div className="ag-salvar-fixo">
        <button type="button" className="btn btn-ouro" disabled={!alterado || salvando} onClick={salvar}><Save size={14} /> {t('ia.agente.salvar')}</button>
      </div>

      <Transcricao admin={dados.admin} />
    </div>
  );
}

function Transcricao({ admin }) {
  const t = useT();
  const aviso = useAviso();
  const [s, setS] = useState(null);
  const carregar = useCallback(() => api('/agente/transcricao').then(setS).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('agente', (d) => { if (d?.transcricao) carregar(); });
  useEffect(() => {
    if (s?.instalacao?.status !== 'instalando') return undefined;
    const id = setInterval(carregar, 5000);
    return () => clearInterval(id);
  }, [s?.instalacao?.status, carregar]);

  const mudar = async (p) => {
    try { setS(await api('/agente/transcricao', { method: 'PUT', body: p })); } catch (e) { aviso(e.message, 'erro'); }
  };
  const instalar = async () => {
    if (!confirm(t('ia.agente.transcricao.confirmarInstalar'))) return;
    try { setS(await api('/agente/transcricao/instalar', { method: 'POST' })); } catch (e) { aviso(e.message, 'erro'); }
  };

  if (!s) return <section className="cartao-secao"><div className="carregando" /></section>;
  const instalando = s.instalacao?.status === 'instalando';
  const recomendado = s.servidor.ram_gb >= 6 ? 'small' : 'base';

  return (
    <section className="cartao-secao ia-pagina">
      <div className="dp-secao-topo">
        <h2><AudioLines size={16} /> {t('ia.agente.transcricao.titulo')}</h2>
        {s.instalada && <Interruptor ligado={Boolean(s.config.ativo)} disabled={!admin} aoMudar={(v) => mudar({ ativo: v })} rotulo={s.config.ativo ? t('ia.agente.ligada') : t('ia.agente.desligada')} />}
      </div>
      <p className="suave pequeno">{t('ia.agente.transcricao.explicacao')}</p>
      <p className="pequeno"><Cpu size={13} /> {t('ia.agente.transcricao.servidor', { cpus: s.servidor.cpus, ram: String(s.servidor.ram_gb).replace('.', ','), livre: String(s.servidor.ram_livre_gb).replace('.', ',') })}</p>

      {!s.instalada ? (
        <div className="ag-transcricao-instalar">
          {instalando ? (
            <p><Loader2 size={14} className="dp-gira" /> {t('ia.agente.transcricao.instalando')}</p>
          ) : (
            <>
              {s.instalacao?.status === 'erro' && <p className="pequeno ag-alerta">{s.instalacao.erro}</p>}
              <button type="button" className="btn btn-ouro" disabled={!admin} onClick={instalar}><Download size={14} /> {t('ia.agente.transcricao.instalar')}</button>
              {!admin && <span className="suave pequeno"> {t('ia.agente.transcricao.soAdmin')}</span>}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="ia-campos-3">
            <label>{t('ia.agente.transcricao.modelo')}
              <select value={s.config.modelo} disabled={!admin} onChange={(e) => mudar({ modelo: e.target.value })}>
                {s.modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.ram}{m.id === recomendado ? ` · ${t('ia.agente.transcricao.recomendado')}` : ''}</option>)}
              </select>
            </label>
            <label>{t('ia.agente.transcricao.idioma')}
              <select value={s.config.idioma} disabled={!admin} onChange={(e) => mudar({ idioma: e.target.value })}>
                {s.idiomas.map((i) => <option key={i} value={i}>{t(`ia.agente.transcricao.idiomas.${i}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="dp-check">
            <input type="checkbox" checked={Boolean(s.config.auto_novos)} disabled={!admin} onChange={(e) => mudar({ auto_novos: e.target.checked })} />
            <span>{t('ia.agente.transcricao.autoNovos')}</span>
          </label>
          <p className="suave pequeno">
            {t('ia.agente.transcricao.numeros', { feitos: s.transcritos_7_dias, fila: s.na_fila, mb: s.modelos_baixados_mb })}
            {s.ultima_medida && ` ${t('ia.agente.transcricao.medida', { segundos: s.ultima_medida.segundos, tempo: Math.round(s.ultima_medida.ms / 1000), quando: dataHoraCurta(s.ultima_medida.em) })}`}
          </p>
        </>
      )}
    </section>
  );
}
