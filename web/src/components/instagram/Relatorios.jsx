// Relatórios da IA sobre o Instagram: o semanal (toda segunda, automático), os pedidos na hora e os de um período
// escolhido. A IA recebe os números guardados no CRM e escreve o que funcionou, o que não funcionou e o que testar.
import { useCallback, useEffect, useState } from 'react';
import { FileText, Sparkles, Copy, Download, RefreshCw, AlertTriangle, CalendarClock } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento, avisoTem } from '../../tempoReal.js';
import { dataHora } from '../../utils.js';
import { isoDia } from '../estatisticas/util.js';
import { useAviso, Vazio } from '../disparos/comum.jsx';
import Markdown from '../ia/agente/Markdown.jsx';
import { dinheiro, rotuloModelo } from '../ia/agente/comum.js';
import '../ia/agente/agente.css';

const ontem = () => isoDia(new Date(Date.now() - 86400000));
const diasAtras = (n) => isoDia(new Date(Date.now() - (n + 1) * 86400000));

function Gerar({ perfis, modelos, modeloPadrao, gasto, teto, onGerado, t }) {
  const aviso = useAviso();
  const [perfil, setPerfil] = useState('');
  const [atalho, setAtalho] = useState('7');
  const [de, setDe] = useState(diasAtras(6));
  const [ate, setAte] = useState(ontem());
  const [modelo, setModelo] = useState(modeloPadrao || modelos?.[0]?.id || '');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (!modelo && modeloPadrao) setModelo(modeloPadrao); }, [modeloPadrao, modelo]);

  const escolherAtalho = (a) => {
    setAtalho(a);
    if (a === 'personalizado') return;
    const n = Number(a);
    setDe(diasAtras(n - 1));
    setAte(ontem());
  };
  const gerar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const r = await api('/instagram/relatorios', { method: 'POST', body: { perfil_id: perfil ? Number(perfil) : null, de, ate, modelo } });
      aviso(t('instagram.relatorios.pedido'), 'info');
      onGerado(r.id);
    } catch (err) { aviso(err.message, 'erro'); } finally { setOcupado(false); }
  };
  const valido = de && ate && de <= ate;
  return (
    <form className="cartao-secao ig-gerar" onSubmit={gerar}>
      <h2><Sparkles size={16} /> {t('instagram.relatorios.novo')}</h2>
      <p className="suave pequeno">{t('instagram.relatorios.novoTexto')}</p>
      {perfis.length > 1 && (
        <label>{t('instagram.relatorios.perfil')}
          <select value={perfil} onChange={(e) => setPerfil(e.target.value)}>
            <option value="">{t('instagram.direct.todosPerfis')}</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>@{p.username}</option>)}
          </select>
        </label>
      )}
      <div className="ig-campo">
        <span className="ig-campo-rotulo">{t('instagram.relatorios.periodo')}</span>
        <div className="dp-segmentos dp-segmentos-pequeno">
          {['7', '14', '30', '90', 'personalizado'].map((a) => (
            <button key={a} type="button" className={atalho === a ? 'ativo' : ''} onClick={() => escolherAtalho(a)}>
              {a === 'personalizado' ? t('instagram.periodo.personalizado') : t('instagram.periodo.dias', { n: a })}
            </button>
          ))}
        </div>
      </div>
      <div className="grade-2">
        <label>{t('instagram.periodo.de')}<input type="date" value={de} max={ate} onChange={(e) => { setDe(e.target.value); setAtalho('personalizado'); }} /></label>
        <label>{t('instagram.periodo.ate')}<input type="date" value={ate} min={de} max={isoDia(new Date())} onChange={(e) => { setAte(e.target.value); setAtalho('personalizado'); }} /></label>
      </div>
      <label>{t('instagram.relatorios.modelo')}
        <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
          {(modelos || []).map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
        </select>
      </label>
      <button className="btn btn-ouro" disabled={ocupado || !valido || gasto >= teto}>
        <FileText size={15} /> {ocupado ? t('instagram.relatorios.pedindo') : t('instagram.relatorios.gerar')}
      </button>
      <p className="suave pequeno">{t('instagram.relatorios.gastoHoje', { gasto: dinheiro(gasto), teto: dinheiro(teto) })}</p>
      {gasto >= teto && <p className="alerta pequeno">{t('instagram.relatorios.tetoAtingido')}</p>}
    </form>
  );
}

function Leitura({ id, t }) {
  const aviso = useAviso();
  const [r, setR] = useState(null);
  const carregar = useCallback(() => api(`/instagram/relatorios/${id}`).then((d) => setR(d.relatorio)).catch((e) => aviso(e.message, 'erro')), [id, aviso]);
  useEffect(() => { setR(null); carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (avisoTem(d, 'relatorio', id)) carregar(); });
  if (!r) return <div className="cartao-secao dp-centro"><span className="girando" /></div>;
  const copiar = () => navigator.clipboard?.writeText(r.texto || '').then(() => aviso(t('instagram.relatorios.copiado'))).catch(() => {});
  const baixar = () => {
    const url = URL.createObjectURL(new Blob([r.texto || ''], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(r.titulo || 'relatorio-instagram').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <article className="cartao-secao ig-leitura">
      <div className="cabecalho-cartao">
        <div>
          <h2>{r.titulo}</h2>
          <p className="suave pequeno">
            {[r.modelo_nome, r.custo_usd ? dinheiro(r.custo_usd) : null, r.concluido_em ? dataHora(r.concluido_em) : dataHora(r.criado_em)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {r.status === 'pronto' && (
          <div className="acoes-linha">
            <button type="button" className="btn btn-pequeno" onClick={copiar}><Copy size={13} /> {t('instagram.relatorios.copiar')}</button>
            <button type="button" className="btn btn-pequeno" onClick={baixar}><Download size={13} /> {t('instagram.relatorios.baixar')}</button>
          </div>
        )}
      </div>
      {r.status === 'gerando' && <div className="dp-centro"><span className="girando" /> <span className="suave">{t('instagram.relatorios.gerando')}</span></div>}
      {r.status === 'erro' && <p className="alerta"><AlertTriangle size={14} /> {r.erro || t('instagram.relatorios.erro')}</p>}
      {r.status === 'pronto' && <Markdown texto={r.texto} />}
    </article>
  );
}

export default function Relatorios({ perfis, modelos, modeloPadrao }) {
  const t = useT();
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [aberto, setAberto] = useState(null);

  const carregar = useCallback(() => api('/instagram/relatorios').then((d) => {
    setDados(d);
    setAberto((a) => a ?? d.relatorios.find((r) => r.status === 'pronto')?.id ?? d.relatorios[0]?.id ?? null);
  }).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (d?.relatorio) carregar(); });

  const lista = dados?.relatorios || [];
  return (
    <div className="pagina pagina-larga ig-aba">
      <div className="ig-relatorios">
        <div className="ig-relatorios-lado">
          <Gerar perfis={perfis} modelos={modelos} modeloPadrao={modeloPadrao} gasto={dados?.gasto_hoje || 0} teto={dados?.teto ?? 1} onGerado={(id) => { setAberto(id); carregar(); }} t={t} />
          <section className="cartao-secao ig-lista-relatorios">
            <div className="cabecalho-cartao">
              <h2>{t('instagram.relatorios.historico')}</h2>
              <button type="button" className="botao-icone" onClick={carregar} aria-label={t('instagram.relatorios.recarregar')}><RefreshCw size={15} /></button>
            </div>
            {!lista.length && <p className="suave pequeno">{t('instagram.relatorios.nenhum')}</p>}
            {lista.map((r) => (
              <button key={r.id} type="button" className={`ig-item-relatorio ${aberto === r.id ? 'ativo' : ''}`} onClick={() => setAberto(r.id)}>
                <span className="ig-item-relatorio-topo">
                  {r.tipo === 'semanal' ? <CalendarClock size={13} /> : <FileText size={13} />}
                  <b>{r.titulo}</b>
                </span>
                <small className="suave">
                  {r.status === 'gerando' ? t('instagram.relatorios.statusGerando') : r.status === 'erro' ? t('instagram.relatorios.statusErro') : dataHora(r.concluido_em || r.criado_em)}
                  {r.criado_por ? ` · ${r.criado_por}` : r.tipo === 'semanal' ? ` · ${t('instagram.relatorios.automatico')}` : ''}
                </small>
              </button>
            ))}
          </section>
        </div>
        <div className="ig-relatorios-centro">
          {aberto ? <Leitura key={aberto} id={aberto} t={t} /> : (
            <section className="cartao-secao"><Vazio icone={FileText} titulo={t('instagram.relatorios.vazioTitulo')}>{t('instagram.relatorios.vazio')}</Vazio></section>
          )}
        </div>
      </div>
    </div>
  );
}
