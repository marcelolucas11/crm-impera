// Gráficos do Desempenho do Instagram (SVG próprio, sem biblioteca): linha com mira e dica, colunas com dica por
// coluna, barras horizontais e a tabela com os mesmos números (nada fica só na dica).
// Regras: um eixo só, linhas de 2px, colunas de até 24px com ponta arredondada de 4px, grade discreta,
// cores --serie-1 / --serie-2 (validadas para o fundo escuro), legenda quando há 2 séries.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/index.jsx';
import { numero, compacto } from './comum.jsx';

const SUPERFICIE = '#111114';

function useLargura(padrao = 640) {
  const ref = useRef(null);
  const [largura, setLargura] = useState(padrao);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => setLargura(Math.max(220, Math.floor(el.clientWidth)));
    medir();
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    obs?.observe(el);
    return () => obs?.disconnect();
  }, []);
  return [ref, largura];
}

/** Marcas do eixo Y em números redondos (1, 2, 2,5 ou 5 × 10ⁿ), cobrindo de min a max */
export function eixoBonito(min, max, alvo = 4) {
  const lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi === lo) hi = lo + (lo === 0 ? 4 : Math.abs(lo) * 0.1 || 1);
  const bruto = (hi - lo) / alvo;
  const ordem = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= bruto) || 10 * ordem;
  const base = Math.floor(lo / passo) * passo;
  const topo = Math.ceil(hi / passo) * passo;
  const marcas = [];
  for (let v = base; v <= topo + passo / 2; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
  return { base, topo: Math.max(topo, base + passo), marcas };
}

/** Rótulo do eixo Y: um estilo só por eixo (inteiro abaixo de 10 mil; "mil"/"mi" quando o eixo passa disso) */
function rotuloEixo(max) {
  if (max >= 1e6) return (v) => `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (max >= 1e4) return (v) => (v === 0 ? '0' : `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`);
  return (v) => numero(v, 1);
}

export const diaCurto = (iso) => {
  const [, m, d] = String(iso).split('-');
  return `${d}/${m}`;
};
export const diaLongo = (iso) => {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};

function marcasX(n, largura, minimo = 64) {
  const cabe = Math.max(2, Math.floor(largura / minimo));
  const passo = Math.max(1, Math.ceil(n / cabe));
  const r = [];
  for (let i = 0; i < n; i += passo) r.push(i);
  if (n > 1 && r[r.length - 1] !== n - 1 && (n - 1 - r[r.length - 1]) * (largura / n) > minimo * 0.7) r.push(n - 1);
  return r;
}

export function Legenda({ series, tipo = 'linha' }) {
  return (
    <div className="legenda ig-legenda">
      {series.map((s) => (
        <span key={s.chave}>
          {tipo === 'linha' ? <i className="ig-chave-linha" style={{ background: s.cor }} /> : <i className="chave-cor" style={{ background: s.cor }} />}
          {s.nome}
        </span>
      ))}
    </div>
  );
}

/** Tabela com os números do gráfico (acessível e para copiar) */
export function TabelaDados({ colunas, linhas, titulo }) {
  const t = useT();
  return (
    <details className="tabela-dados">
      <summary>{titulo || t('instagram.graficos.verTabela')}</summary>
      <div className="ig-tabela-rolagem">
        <table className="tabela">
          <thead><tr>{colunas.map((c) => <th key={c.chave} className={c.num ? 'num' : ''}>{c.rotulo}</th>)}</tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={l.chave ?? i}>{colunas.map((c) => <td key={c.chave} className={c.num ? 'num' : ''}>{c.formatar ? c.formatar(l[c.chave], l) : l[c.chave] ?? '—'}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Linha (1 ou 2 séries do mesmo tipo de número). dias: ['AAAA-MM-DD'], series: [{ chave, nome, cor, valores }]
 * Dias sem número (null) interrompem a linha.
 */
const larguraRotulos = (textos) => Math.max(36, 10 + Math.max(...textos.map((x) => String(x).length)) * 6.4);

export function Linha({ dias, series, altura = 220, formatar = numero, formatarEixo = null, rotulo }) {
  const t = useT();
  const [caixa, largura] = useLargura();
  const [foco, setFoco] = useState(null);
  const n = dias.length;
  const valores = series.flatMap((s) => s.valores.filter((v) => v !== null && v !== undefined));
  const minimo = valores.length ? Math.min(...valores) : 0;
  const maximo = valores.length ? Math.max(...valores) : 0;
  // Seguidores: o eixo não começa no zero (a variação some se começar); contagens por dia começam no zero
  const comecaNoZero = minimo >= 0 && (minimo === 0 || minimo < maximo * 0.5);
  const eixo = eixoBonito(comecaNoZero ? 0 : minimo, Math.max(maximo, comecaNoZero ? 1 : maximo));
  const { base, topo } = eixo;
  const ultimos = series.map((s) => {
    for (let i = s.valores.length - 1; i >= 0; i--) if (s.valores[i] !== null && s.valores[i] !== undefined) return { i, v: s.valores[i] };
    return null;
  });
  const fmtEixo = formatarEixo || rotuloEixo(Math.max(Math.abs(topo), Math.abs(base)), formatar);
  const esq = larguraRotulos(eixo.marcas.map(fmtEixo));
  const cima = 12;
  const baixo = 24;
  const alturaUtil = altura - cima - baixo;
  const y = (v) => cima + alturaUtil - ((v - base) / (topo - base || 1)) * alturaUtil;
  const ys = ultimos.map((u) => (u ? y(u.v) : null));
  const rotulosFim = series.length === 1 || (ys.length === 2 && ys[0] !== null && ys[1] !== null && Math.abs(ys[0] - ys[1]) >= 16);
  const dir = rotulosFim ? 62 : 14;
  const larguraUtil = largura - esq - dir;
  const x = (i) => esq + (n <= 1 ? larguraUtil / 2 : (i / (n - 1)) * larguraUtil);
  const ticks = eixo.marcas;

  const caminhos = useMemo(() => series.map((s) => {
    let d = '';
    let aberto = false;
    const soltos = [];
    s.valores.forEach((v, i) => {
      if (v === null || v === undefined) { aberto = false; return; }
      const vizinhoAntes = i > 0 && s.valores[i - 1] !== null && s.valores[i - 1] !== undefined;
      const vizinhoDepois = i < s.valores.length - 1 && s.valores[i + 1] !== null && s.valores[i + 1] !== undefined;
      if (!vizinhoAntes && !vizinhoDepois) soltos.push(i);
      d += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      aberto = true;
    });
    return { d, soltos };
  }), [series, largura, topo, base, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * largura;
    const i = Math.round(((px - esq) / (larguraUtil || 1)) * (n - 1));
    setFoco(Math.max(0, Math.min(n - 1, i)));
  };
  const tecla = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setFoco((f) => Math.min(n - 1, (f ?? -1) + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setFoco((f) => Math.max(0, (f ?? n) - 1)); }
    if (e.key === 'Escape') setFoco(null);
  };
  const xsMarcas = marcasX(n, larguraUtil);

  if (!valores.length) return <p className="suave pequeno ig-sem-dados">{t('instagram.graficos.semDados')}</p>;
  return (
    <div className="ig-grafico" ref={caixa}>
      {series.length > 1 && <Legenda series={series} />}
      <div className="ig-grafico-area">
        <svg width={largura} height={altura} role="img" aria-label={rotulo} tabIndex={0}
          onPointerMove={mover} onPointerLeave={() => setFoco(null)} onKeyDown={tecla} onBlur={() => setFoco(null)}>
          {ticks.map((v, k) => (
            <g key={k}>
              <line x1={esq} x2={largura - dir} y1={y(v)} y2={y(v)} className={k === 0 && base === 0 ? 'ig-eixo' : 'ig-grade'} />
              <text x={esq - 8} y={y(v)} className="ig-eixo-texto" textAnchor="end" dominantBaseline="middle">{fmtEixo(v)}</text>
            </g>
          ))}
          {xsMarcas.map((i) => <text key={i} x={x(i)} y={altura - 6} className="ig-eixo-texto" textAnchor="middle">{diaCurto(dias[i])}</text>)}
          {caminhos.map((c, k) => (
            <g key={series[k].chave}>
              <path d={c.d} fill="none" stroke={series[k].cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {c.soltos.map((i) => <circle key={i} cx={x(i)} cy={y(series[k].valores[i])} r="3" fill={series[k].cor} />)}
            </g>
          ))}
          {rotulosFim && ultimos.map((u, k) => u && (
            <text key={series[k].chave} x={x(u.i) + 8} y={y(u.v)} className="ig-rotulo-fim" dominantBaseline="middle">{compacto(u.v)}</text>
          ))}
          {foco !== null && (
            <g pointerEvents="none">
              <line x1={x(foco)} x2={x(foco)} y1={cima} y2={cima + alturaUtil} className="ig-mira" />
              {series.map((s) => (s.valores[foco] === null || s.valores[foco] === undefined ? null : (
                <circle key={s.chave} cx={x(foco)} cy={y(s.valores[foco])} r="5" fill={s.cor} stroke={SUPERFICIE} strokeWidth="2" />
              )))}
            </g>
          )}
        </svg>
        {foco !== null && (
          <div className={`dica ig-dica ${x(foco) > largura * 0.65 ? 'ig-dica-esq' : ''}`} style={{ left: x(foco), top: cima }}>
            <small className="suave">{diaLongo(dias[foco])}</small>
            {series.map((s) => (
              <span key={s.chave} className="ig-dica-linha">
                <i className="ig-chave-linha" style={{ background: s.cor }} />
                <b>{s.valores[foco] === null || s.valores[foco] === undefined ? '—' : formatar(s.valores[foco])}</b>
                <small>{s.nome}</small>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Colunas de uma série. itens: [{ chave, rotulo, rotuloLongo?, valor }] */
export function Colunas({ itens, altura = 180, formatar = numero, formatarEixo = null, cor = 'var(--serie-1)', rotulo, nome }) {
  const t = useT();
  const [caixa, largura] = useLargura();
  const [foco, setFoco] = useState(null);
  const n = itens.length;
  const maximo = Math.max(0, ...itens.map((i) => Number(i.valor) || 0));
  const eixo = eixoBonito(0, Math.max(1, maximo));
  const topo = eixo.topo;
  const fmtEixo = formatarEixo || rotuloEixo(topo, formatar);
  const esq = larguraRotulos(eixo.marcas.map(fmtEixo));
  const dir = 8;
  const cima = 16;
  const baixo = 24;
  const alturaUtil = altura - cima - baixo;
  const faixa = (largura - esq - dir) / Math.max(1, n);
  const larguraBarra = Math.max(2, Math.min(24, faixa - 2));
  const y = (v) => cima + alturaUtil - (v / topo) * alturaUtil;
  const ticks = eixo.marcas;
  const xsMarcas = marcasX(n, largura - esq - dir, 44);
  const indiceMaior = itens.findIndex((i) => (Number(i.valor) || 0) === maximo && maximo > 0);

  if (!n || maximo === 0) return <p className="suave pequeno ig-sem-dados">{t('instagram.graficos.semDados')}</p>;
  const coluna = (i, v) => {
    const h = Math.max(0, (v / topo) * alturaUtil);
    const x0 = esq + faixa * i + (faixa - larguraBarra) / 2;
    const yb = cima + alturaUtil;
    if (h <= 0) return null;
    const r = Math.min(4, h, larguraBarra / 2);
    return `M${x0},${yb} L${x0},${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} L${x0 + larguraBarra - r},${yb - h} Q${x0 + larguraBarra},${yb - h} ${x0 + larguraBarra},${yb - h + r} L${x0 + larguraBarra},${yb} Z`;
  };
  return (
    <div className="ig-grafico" ref={caixa}>
      <div className="ig-grafico-area">
        <svg width={largura} height={altura} role="img" aria-label={rotulo}>
          {ticks.map((v, k) => (
            <g key={k}>
              <line x1={esq} x2={largura - dir} y1={y(v)} y2={y(v)} className={k === 0 ? 'ig-eixo' : 'ig-grade'} />
              <text x={esq - 8} y={y(v)} className="ig-eixo-texto" textAnchor="end" dominantBaseline="middle">{fmtEixo(v)}</text>
            </g>
          ))}
          {xsMarcas.map((i) => <text key={i} x={esq + faixa * i + faixa / 2} y={altura - 6} className="ig-eixo-texto" textAnchor="middle">{itens[i].rotulo}</text>)}
          {itens.map((it, i) => {
            const v = Number(it.valor) || 0;
            const d = coluna(i, v);
            return (
              <g key={it.chave} className={`ig-coluna ${foco === i ? 'foco' : ''}`}>
                {d && <path d={d} fill={cor} />}
                <rect x={esq + faixa * i} y={cima} width={faixa} height={alturaUtil} fill="transparent" tabIndex={0}
                  aria-label={`${it.rotuloLongo || it.rotulo}: ${formatar(it.valor)}`}
                  onPointerEnter={() => setFoco(i)} onPointerLeave={() => setFoco(null)} onFocus={() => setFoco(i)} onBlur={() => setFoco(null)} />
              </g>
            );
          })}
          {indiceMaior >= 0 && (
            <text x={Math.min(largura - 30, Math.max(esq + 20, esq + faixa * indiceMaior + faixa / 2))} y={y(maximo) - 5} className="ig-rotulo-fim" textAnchor="middle">{formatar === numero ? compacto(maximo) : formatar(maximo)}</text>
          )}
        </svg>
        {foco !== null && (
          <div className={`dica ig-dica ${esq + faixa * foco > largura * 0.65 ? 'ig-dica-esq' : ''}`} style={{ left: esq + faixa * foco + faixa / 2, top: cima }}>
            <small className="suave">{itens[foco].rotuloLongo || itens[foco].rotulo}</small>
            <span className="ig-dica-linha">
              <i className="chave-cor" style={{ background: cor }} />
              <b>{formatar(itens[foco].valor)}</b>
              {nome && <small>{nome}</small>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Barras horizontais (ranking): itens [{ chave, rotulo, valor, detalhe? }] */
export function BarrasH({ itens, formatar = numero, cor = 'var(--serie-1)', vazio }) {
  const t = useT();
  if (!itens.length) return <p className="suave pequeno ig-sem-dados">{vazio || t('instagram.graficos.semDados')}</p>;
  const max = Math.max(1, ...itens.map((i) => Number(i.valor) || 0));
  return (
    <div className="barras">
      {itens.map((i) => (
        <div key={i.chave} className="barra-linha" title={`${i.rotulo}: ${formatar(i.valor)}${i.detalhe ? ` · ${i.detalhe}` : ''}`}>
          <span className="barra-rotulo"><span className="barra-rotulo-texto">{i.rotulo}</span></span>
          <span className="barra-trilho">
            <span className="barra-espaco">
              <span className="barra" style={{ width: `${Math.max(i.valor ? 2 : 0, ((Number(i.valor) || 0) / max) * 100)}%`, background: cor }} />
            </span>
            <span className="barra-valor">{formatar(i.valor)}{i.detalhe ? <small className="suave"> · {i.detalhe}</small> : null}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
