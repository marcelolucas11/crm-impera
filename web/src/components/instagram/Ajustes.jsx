// Ajustes do Instagram (só administrador): Alice no Direct de cada perfil e a entrevista dela, Direct, comentários
// (desligados de fábrica), relatórios da IA e a coleta das métricas e dos anúncios. A conexão com a Meta fica em
// Equipe e integrações → Instagram.
import { useCallback, useEffect, useState } from 'react';
import { Bot, MessageCircle, MessagesSquare, FileText, Database, Save, RotateCcw, RefreshCw, Camera as IconeInstagram, Megaphone } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde } from '../../utils.js';
import { Interruptor, useAviso } from '../disparos/comum.jsx';
import { rotuloModelo } from '../ia/agente/comum.js';

const CAMPOS = [
  'direct_ativo', 'intervalo_direct_seg', 'comentarios_ativo', 'comentarios_intervalo_min', 'comentarios_dias', 'prompt_sdr',
  'alice_max_mensagens', 'alice_continuar_whatsapp', 'relatorio_semanal', 'relatorio_dia', 'relatorio_hora', 'relatorio_modelo',
  'prompt_analista', 'teto_relatorios_dia', 'coleta_hora', 'anuncios_ativo', 'anuncios_dias', 'posts_diario_dias',
];
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function Bloco({ icone: Icone, titulo, texto, children }) {
  return (
    <section className="cartao-secao ig-ajuste">
      <h2><Icone size={16} /> {titulo}</h2>
      {texto && <p className="suave pequeno">{texto}</p>}
      {children}
    </section>
  );
}

function Numero({ rotulo, valor, onChange, min, max, passo = 1, sufixo, dica }) {
  return (
    <label className="ig-numero" title={dica || undefined}>
      <span>{rotulo}</span>
      <span className="ig-numero-campo">
        <input type="number" min={min} max={max} step={passo} value={valor ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        {sufixo && <small className="suave">{sufixo}</small>}
      </span>
    </label>
  );
}

export default function Ajustes({ perfis: perfisAtivos, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [form, setForm] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState('');

  const carregar = useCallback(async () => {
    try {
      const d = await api('/instagram/config');
      setDados(d);
      setForm((f) => f || Object.fromEntries(CAMPOS.map((k) => [k, d.config[k]])));
    } catch (e) { aviso(e.message, 'erro'); }
  }, [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (d?.perfis || d?.conexao) carregar(); });

  if (!dados || !form) return <div className="pagina"><div className="dp-centro"><span className="girando" /></div></div>;
  const cfg = dados.config;
  const mudou = CAMPOS.some((k) => form[k] !== cfg[k]);
  const campo = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const perfis = dados.perfis.filter((p) => p.ativo);
  void perfisAtivos;

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await api('/instagram/ajustes', { method: 'PUT', body: form });
      setDados((d) => ({ ...d, config: r.config }));
      setForm(Object.fromEntries(CAMPOS.map((k) => [k, r.config[k]])));
      aviso(t('instagram.ajustes.salvos'));
      aoMudar?.();
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };
  const acao = async (chave, fn, ok) => {
    setOcupado(chave);
    try { await fn(); aviso(ok); carregar(); aoMudar?.(); } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(''); }
  };
  const alice = (p, ligada) => acao(`alice-${p.id}`, () => api(`/instagram/perfis/${p.id}`, { method: 'PATCH', body: { alice_ativa: ligada } }),
    ligada ? t('instagram.conexao.aliceLigada', { perfil: p.username }) : t('instagram.conexao.aliceDesligada', { perfil: p.username }));

  return (
    <div className="pagina ig-aba ig-ajustes">
      <div className="ig-barra ig-barra-salvar">
        <p className="suave pequeno">{t('instagram.ajustes.explica')}</p>
        <span className="espaco" />
        {mudou && <button type="button" className="btn" onClick={() => setForm(Object.fromEntries(CAMPOS.map((k) => [k, cfg[k]])))} disabled={salvando}>{t('instagram.ajustes.descartar')}</button>}
        <button type="button" className="btn btn-ouro" onClick={salvar} disabled={!mudou || salvando}><Save size={15} /> {salvando ? t('instagram.ajustes.salvando') : t('instagram.ajustes.salvar')}</button>
      </div>

      <Bloco icone={Bot} titulo={t('instagram.ajustes.alice.titulo')} texto={t('instagram.ajustes.alice.texto')}>
        <div className="ig-lista-perfis">
          {perfis.length === 0 && <p className="suave pequeno">{t('instagram.conexao.nenhumPerfil')}</p>}
          {perfis.map((p) => (
            <div key={p.id} className="ig-linha-perfil">
              <span><IconeInstagram size={14} /> <b>@{p.username}</b> <small className="suave">{p.nome || ''}</small></span>
              <Interruptor ligado={p.alice_ativa} disabled={ocupado === `alice-${p.id}`} aoMudar={(v) => alice(p, v)}
                rotulo={p.alice_ativa ? t('instagram.ajustes.alice.ligada') : t('instagram.ajustes.alice.desligada')} />
            </div>
          ))}
        </div>
        <p className="dp-dica-admin">{t('instagram.ajustes.alice.requisitos')}</p>
        <label className="ig-texto-grande">
          <span className="ig-campo-topo">
            <span>{t('instagram.ajustes.alice.entrevista')}</span>
            <button type="button" className="link-botao pequeno" onClick={() => campo('prompt_sdr')('')}><RotateCcw size={12} /> {t('instagram.ajustes.restaurar')}</button>
          </span>
          <textarea rows={9} value={form.prompt_sdr} onChange={(e) => campo('prompt_sdr')(e.target.value)} maxLength={6000} placeholder={t('instagram.ajustes.padraoSeVazio')} />
        </label>
        <div className="ig-linha-campos">
          <Numero rotulo={t('instagram.ajustes.alice.maxMensagens')} valor={form.alice_max_mensagens} min={2} max={40} onChange={campo('alice_max_mensagens')} dica={t('instagram.ajustes.alice.maxMensagensDica')} />
        </div>
        <Interruptor ligado={Boolean(form.alice_continuar_whatsapp)} aoMudar={campo('alice_continuar_whatsapp')} rotulo={t('instagram.ajustes.alice.continuarWhatsapp')} />
        <p className="suave pequeno">{t('instagram.ajustes.alice.continuarWhatsappDica')}</p>
      </Bloco>

      <Bloco icone={MessageCircle} titulo={t('instagram.ajustes.direct.titulo')} texto={t('instagram.ajustes.direct.texto')}>
        <Interruptor ligado={Boolean(form.direct_ativo)} aoMudar={campo('direct_ativo')} rotulo={t('instagram.ajustes.direct.ativo')} />
        <div className="ig-linha-campos">
          <Numero rotulo={t('instagram.ajustes.direct.intervalo')} valor={form.intervalo_direct_seg} min={30} max={900} sufixo={t('instagram.ajustes.segundos')} onChange={campo('intervalo_direct_seg')} dica={t('instagram.ajustes.direct.intervaloDica')} />
        </div>
      </Bloco>

      <Bloco icone={MessagesSquare} titulo={t('instagram.ajustes.comentarios.titulo')} texto={t('instagram.ajustes.comentarios.texto')}>
        <Interruptor grande ligado={Boolean(form.comentarios_ativo)} aoMudar={campo('comentarios_ativo')} rotulo={form.comentarios_ativo ? t('instagram.ajustes.ligado') : t('instagram.ajustes.desligado')} />
        <div className="ig-linha-campos">
          <Numero rotulo={t('instagram.ajustes.comentarios.intervalo')} valor={form.comentarios_intervalo_min} min={5} max={240} sufixo={t('instagram.ajustes.minutos')} onChange={campo('comentarios_intervalo_min')} />
          <Numero rotulo={t('instagram.ajustes.comentarios.dias')} valor={form.comentarios_dias} min={1} max={90} sufixo={t('instagram.ajustes.dias')} onChange={campo('comentarios_dias')} dica={t('instagram.ajustes.comentarios.diasDica')} />
        </div>
      </Bloco>

      <Bloco icone={FileText} titulo={t('instagram.ajustes.relatorios.titulo')} texto={t('instagram.ajustes.relatorios.texto')}>
        <Interruptor ligado={Boolean(form.relatorio_semanal)} aoMudar={campo('relatorio_semanal')} rotulo={t('instagram.ajustes.relatorios.semanal')} />
        <div className="ig-linha-campos">
          <label className="ig-numero"><span>{t('instagram.ajustes.relatorios.dia')}</span>
            <select value={form.relatorio_dia} onChange={(e) => campo('relatorio_dia')(Number(e.target.value))}>
              {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{t(`instagram.semanaLonga.${d}`)}</option>)}
            </select>
          </label>
          <label className="ig-numero"><span>{t('instagram.ajustes.relatorios.hora')}</span>
            <input type="time" value={form.relatorio_hora} onChange={(e) => campo('relatorio_hora')(e.target.value)} />
          </label>
          <label className="ig-numero ig-numero-largo"><span>{t('instagram.ajustes.relatorios.modelo')}</span>
            <select value={form.relatorio_modelo} onChange={(e) => campo('relatorio_modelo')(e.target.value)}>
              {(cfg.modelos || []).map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
            </select>
          </label>
          <Numero rotulo={t('instagram.ajustes.relatorios.teto')} valor={form.teto_relatorios_dia} min={0.05} max={200} passo={0.05} sufixo="US$" onChange={campo('teto_relatorios_dia')} />
        </div>
        <p className="suave pequeno">{t('instagram.ajustes.relatorios.fuso', { fuso: cfg.fuso })}</p>
        <label className="ig-texto-grande">
          <span className="ig-campo-topo">
            <span>{t('instagram.ajustes.relatorios.analista')}</span>
            <button type="button" className="link-botao pequeno" onClick={() => campo('prompt_analista')('')}><RotateCcw size={12} /> {t('instagram.ajustes.restaurar')}</button>
          </span>
          <textarea rows={8} value={form.prompt_analista} onChange={(e) => campo('prompt_analista')(e.target.value)} maxLength={8000} placeholder={t('instagram.ajustes.padraoSeVazio')} />
        </label>
      </Bloco>

      <Bloco icone={Database} titulo={t('instagram.ajustes.coleta.titulo')} texto={t('instagram.ajustes.coleta.texto')}>
        <div className="ig-linha-campos">
          <label className="ig-numero"><span>{t('instagram.ajustes.coleta.hora')}</span>
            <input type="time" value={form.coleta_hora} onChange={(e) => campo('coleta_hora')(e.target.value)} />
          </label>
          <Numero rotulo={t('instagram.ajustes.coleta.evolucao')} valor={form.posts_diario_dias} min={7} max={730} sufixo={t('instagram.ajustes.dias')} onChange={campo('posts_diario_dias')} dica={t('instagram.ajustes.coleta.evolucaoDica')} />
        </div>
        <Interruptor ligado={Boolean(form.anuncios_ativo)} aoMudar={campo('anuncios_ativo')} rotulo={<><Megaphone size={14} /> {t('instagram.ajustes.coleta.anuncios')}</>} />
        <div className="ig-linha-campos">
          <Numero rotulo={t('instagram.ajustes.coleta.anunciosDias')} valor={form.anuncios_dias} min={7} max={1095} sufixo={t('instagram.ajustes.dias')} onChange={campo('anuncios_dias')} dica={t('instagram.ajustes.coleta.anunciosDiasDica')} />
        </div>
        <div className="ig-lista-perfis">
          {perfis.map((p) => (
            <div key={p.id} className="ig-linha-perfil">
              <span><IconeInstagram size={14} /> <b>@{p.username}</b> <small className="suave">{p.sync_conta_em ? t('instagram.conexao.metricasSync', { quando: tempoDesde(p.sync_conta_em) }) : t('instagram.conexao.metricasNunca')}</small></span>
              <button type="button" className="btn btn-pequeno" disabled={ocupado === `sync-${p.id}`}
                onClick={() => acao(`sync-${p.id}`, () => api(`/instagram/perfis/${p.id}/sincronizar`, { method: 'POST' }), t('instagram.conexao.sincronizando'))}>
                <RefreshCw size={13} /> {t('instagram.conexao.sincronizar')}
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-pequeno ig-botao-sozinho" disabled={ocupado === 'anuncios' || !perfis.length}
          onClick={() => acao('anuncios', () => api('/instagram/anuncios/sincronizar', { method: 'POST' }), t('instagram.ajustes.coleta.anunciosBuscando'))}>
          <Megaphone size={13} /> {t('instagram.ajustes.coleta.anunciosAgora')}
        </button>
      </Bloco>
      <p className="suave pequeno">{t('instagram.ajustes.conexaoNaEquipe')}</p>
    </div>
  );
}
