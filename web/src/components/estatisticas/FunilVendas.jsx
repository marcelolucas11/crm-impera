import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, SlidersHorizontal, RotateCcw, ArrowDown } from 'lucide-react';
import { useT } from '../../i18n/index.jsx';
import { num, pct, taxa, lerPref, salvarPref, etapasDoLead } from './util.js';

// Configuração salva: ordem de todas as etapas + quais entram no funil. Etapa nova entra no fim, desmarcada.
function configuracao(etapas, salvo) {
  const ids = etapas.map((s) => s.id);
  const padraoAtivos = etapas.filter((s) => s.tipo !== 'lost').map((s) => s.id);
  if (!salvo?.ordem) return { ordem: ids, ativos: padraoAtivos };
  const ordem = salvo.ordem.filter((id) => ids.includes(id)).concat(ids.filter((id) => !salvo.ordem.includes(id)));
  const ativos = (salvo.ativos || []).filter((id) => ids.includes(id));
  return { ordem, ativos: ativos.length ? ativos : padraoAtivos };
}

// Funil de vendas: quantos leads do período chegaram (ou passaram) por cada etapa escolhida, na ordem escolhida
export default function FunilVendas({ leads, etapas }) {
  const t = useT();
  const [salvo, setSalvo] = useState(() => lerPref('funil', null));
  const [editando, setEditando] = useState(false);
  const cfg = useMemo(() => configuracao(etapas, salvo), [etapas, salvo]);
  const porId = useMemo(() => new Map(etapas.map((s) => [s.id, s])), [etapas]);
  const passos = cfg.ordem.filter((id) => cfg.ativos.includes(id));
  const primeiraEtapa = etapas[0]?.id;

  const gravar = (novo) => { setSalvo(novo); salvarPref('funil', novo); };
  const mover = (id, dir) => {
    const ordem = [...cfg.ordem];
    const i = ordem.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ordem.length) return;
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
    gravar({ ...cfg, ordem });
  };
  const alternar = (id) => {
    const ativos = cfg.ativos.includes(id) ? cfg.ativos.filter((x) => x !== id) : [...cfg.ativos, id];
    if (ativos.length) gravar({ ...cfg, ativos });
  };
  // Início/fim: marca a etapa escolhida e tira do funil o que vier antes (início) ou depois (fim) dela na ordem
  const definirPonta = (id, ponta) => {
    const pos = cfg.ordem.indexOf(id);
    const ativos = cfg.ordem.filter((x, i) => (x === id) || (cfg.ativos.includes(x) && (ponta === 'inicio' ? i > pos : i < pos)));
    gravar({ ...cfg, ativos });
  };

  const linhas = useMemo(() => {
    const indice = new Map(passos.map((id, i) => [id, i]));
    const chegaram = passos.map(() => 0);
    const agora = passos.map(() => 0);
    for (const l of leads) {
      let alcance = -1;
      for (const id of etapasDoLead(l, primeiraEtapa)) {
        const i = indice.get(id);
        if (i !== undefined && i > alcance) alcance = i;
      }
      for (let i = 0; i <= alcance; i++) chegaram[i]++;
      const atual = indice.get(l.s);
      if (atual !== undefined) agora[atual]++;
    }
    return passos.map((id, i) => ({ etapa: porId.get(id), total: chegaram[i], agora: agora[i] }));
  }, [leads, passos, porId, primeiraEtapa]);

  const topo = Math.max(1, linhas[0]?.total || 0, ...linhas.map((l) => l.total));
  const inicio = linhas[0];
  const fim = linhas[linhas.length - 1];
  let maiorQueda = null;
  for (let i = 1; i < linhas.length; i++) {
    const antes = linhas[i - 1].total;
    if (!antes) continue;
    const perda = 100 - (linhas[i].total / antes) * 100;
    if (!maiorQueda || perda > maiorQueda.perda) maiorQueda = { perda: Math.round(perda), de: linhas[i - 1].etapa, para: linhas[i].etapa };
  }

  return (
    <section className="cartao-secao grafico-largo funil">
      <div className="cabecalho-cartao">
        <div>
          <h2>{t('estatisticas.funil.titulo')}</h2>
          <p className="suave pequeno">{t('estatisticas.funil.sub')}</p>
        </div>
        <button className={`chip ${editando ? 'ativo' : ''}`} onClick={() => setEditando((v) => !v)} aria-expanded={editando}>
          <SlidersHorizontal size={15} /> {t('estatisticas.funil.configurar')}
        </button>
      </div>

      {editando && (
        <div className="funil-config">
          <div className="funil-pontas">
            <label>
              <span>{t('estatisticas.funil.inicio')}</span>
              <select value={passos[0] ?? ''} onChange={(ev) => definirPonta(Number(ev.target.value), 'inicio')}>
                {cfg.ordem.map((id) => <option key={id} value={id}>{porId.get(id)?.nome}</option>)}
              </select>
            </label>
            <label>
              <span>{t('estatisticas.funil.fim')}</span>
              <select value={passos[passos.length - 1] ?? ''} onChange={(ev) => definirPonta(Number(ev.target.value), 'fim')}>
                {cfg.ordem.map((id) => <option key={id} value={id}>{porId.get(id)?.nome}</option>)}
              </select>
            </label>
            <button className="btn" onClick={() => gravar(null)}><RotateCcw size={14} /> {t('estatisticas.funil.padrao')}</button>
          </div>
          <p className="suave pequeno">{t('estatisticas.funil.ajuda')}</p>
          <ol className="funil-lista">
            {cfg.ordem.map((id, i) => {
              const s = porId.get(id);
              const ativo = cfg.ativos.includes(id);
              return (
                <li key={id} className={ativo ? '' : 'desligada'}>
                  <label className="funil-item">
                    <input type="checkbox" checked={ativo} onChange={() => alternar(id)} />
                    <i className="ponto" style={{ background: s.cor }} />
                    <span>{s.nome}</span>
                    {id === passos[0] && <em className="selo-ponta">{t('estatisticas.funil.inicio')}</em>}
                    {id === passos[passos.length - 1] && passos.length > 1 && <em className="selo-ponta">{t('estatisticas.funil.fim')}</em>}
                  </label>
                  <span className="funil-setas">
                    <button className="btn btn-pequeno funil-seta" disabled={i === 0} onClick={() => mover(id, -1)} aria-label={t('estatisticas.funil.subir')}><ChevronUp size={16} /></button>
                    <button className="btn btn-pequeno funil-seta" disabled={i === cfg.ordem.length - 1} onClick={() => mover(id, 1)} aria-label={t('estatisticas.funil.descer')}><ChevronDown size={16} /></button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {inicio && fim && linhas.length > 1 && (
        <div className="funil-resumo">
          <span>
            {t('estatisticas.funil.conversao', { de: inicio.etapa.nome, para: fim.etapa.nome })}
            <b>{pct(taxa(fim.total, inicio.total))}</b>
          </span>
          {maiorQueda && maiorQueda.perda > 0 && (
            <span>
              {t('estatisticas.funil.maiorQueda', { de: maiorQueda.de.nome, para: maiorQueda.para.nome })}
              <b className="ruim">−{maiorQueda.perda}%</b>
            </span>
          )}
        </div>
      )}

      <div className="funil-etapas">
        {linhas.map((l, i) => {
          const largura = Math.max(l.total ? 3 : 0, (l.total / topo) * 100);
          const doAnterior = i > 0 ? taxa(l.total, linhas[i - 1].total) : null;
          return (
            <div key={l.etapa.id} className="funil-bloco">
              {i > 0 && (
                <div className="funil-passagem">
                  <ArrowDown size={13} /> {t('estatisticas.funil.passaram', { p: pct(doAnterior) })}
                </div>
              )}
              <div className="funil-linha">
                <span className="funil-nome"><i className="ponto" style={{ background: l.etapa.cor }} />{l.etapa.nome}</span>
                <span className="funil-trilho">
                  <span
                    className="funil-barra"
                    style={{ width: `${largura}%`, '--cor-etapa': l.etapa.cor }}
                  >
                    <b>{num(l.total)}</b>
                  </span>
                </span>
                <span className="funil-numeros">
                  <b>{pct(taxa(l.total, inicio.total))}</b>
                  <small>{t('estatisticas.funil.agora', { n: num(l.agora) })}</small>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
