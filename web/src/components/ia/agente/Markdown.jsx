// Markdown simples e seguro (sem HTML cru) para as respostas da assistente: títulos, listas, tabelas, código,
// negrito/itálico e links. Chaves de conversa (g:…@g.us, l:123) viram botões que abrem a conversa no WhatsApp.
import { Fragment } from 'react';
import { useT } from '../../../i18n/index.jsx';

const RE_INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|(?<![\w*])\*[^*\n]+\*(?!\w)|(?<!\w)_[^_\n]+_(?!\w)|\bg:[\w.:-]+@g\.us\b|\bl:\d+\b|\big:\d+\b)/g;

function inline(texto, aoAbrir, chave = 'i', t = (c) => c) {
  const partes = String(texto).split(RE_INLINE);
  return partes.map((p, i) => {
    const k = `${chave}-${i}`;
    if (!p) return null;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={k}>{inline(p.slice(2, -2), aoAbrir, k, t)}</strong>;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={k}>{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={k} href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    if (/^g:[\w.:-]+@g\.us$|^l:\d+$|^ig:\d+$/.test(p)) {
      const rotulo = p.startsWith('ig:') ? t('ia.agente.md.instagram') : p.startsWith('g:') ? t('ia.agente.md.grupo') : t('ia.agente.md.lead', { id: p.slice(2) });
      return aoAbrir ? <button key={k} type="button" className="ag-chave" onClick={() => aoAbrir(p)} title={t('ia.agente.md.abrir')}>{rotulo}</button> : <code key={k}>{p}</code>;
    }
    if ((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_'))) return p.length > 2 ? <em key={k}>{p.slice(1, -1)}</em> : p;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

const ehLinhaTabela = (l) => /^\s*\|.*\|\s*$/.test(l);
const ehSeparador = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const celulas = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export default function Markdown({ texto, aoAbrirConversa }) {
  const t = useT();
  const fmt = (txt, k) => inline(txt, aoAbrirConversa, k, t);
  const linhas = String(texto || '').replace(/\r\n?/g, '\n').split('\n');
  const blocos = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (/^\s*```/.test(l)) {
      const corpo = [];
      i++;
      while (i < linhas.length && !/^\s*```/.test(linhas[i])) corpo.push(linhas[i++]);
      i++;
      blocos.push(<pre key={blocos.length}><code>{corpo.join('\n')}</code></pre>);
      continue;
    }
    const titulo = l.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (titulo) {
      const nivel = Math.min(4, titulo[1].length + 1);
      const Tag = `h${nivel}`;
      blocos.push(<Tag key={blocos.length}>{fmt(titulo[2], `h${i}`)}</Tag>);
      i++;
      continue;
    }
    if (ehLinhaTabela(l) && i + 1 < linhas.length && ehSeparador(linhas[i + 1])) {
      const cab = celulas(l);
      i += 2;
      const corpo = [];
      while (i < linhas.length && ehLinhaTabela(linhas[i])) corpo.push(celulas(linhas[i++]));
      blocos.push(
        <div key={blocos.length} className="ag-tabela"><table>
          <thead><tr>{cab.map((c, j) => <th key={j}>{fmt(c, `th${i}${j}`)}</th>)}</tr></thead>
          <tbody>{corpo.map((r, k) => <tr key={k}>{cab.map((_, j) => <td key={j}>{fmt(r[j] ?? '', `td${i}${k}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>
      );
      continue;
    }
    if (/^\s*([-*+•]|\d+[.)])\s+/.test(l)) {
      const ordenada = /^\s*\d+[.)]/.test(l);
      const itens = [];
      while (i < linhas.length && /^\s*([-*+•]|\d+[.)])\s+/.test(linhas[i])) {
        const recuo = linhas[i].match(/^\s*/)[0].length;
        itens.push({ recuo, texto: linhas[i].replace(/^\s*([-*+•]|\d+[.)])\s+/, '') });
        i++;
      }
      const Tag = ordenada ? 'ol' : 'ul';
      blocos.push(<Tag key={blocos.length}>{itens.map((it, k) => <li key={k} style={it.recuo >= 2 ? { marginLeft: Math.min(3, Math.floor(it.recuo / 2)) * 16 } : undefined}>{fmt(it.texto, `li${i}${k}`)}</li>)}</Tag>);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const corpo = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) corpo.push(linhas[i++].replace(/^\s*>\s?/, ''));
      blocos.push(<blockquote key={blocos.length}>{fmt(corpo.join(' '), `q${i}`)}</blockquote>);
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { blocos.push(<hr key={blocos.length} />); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const paragrafo = [];
    while (i < linhas.length && linhas[i].trim() && !/^\s*(```|#{1,6}\s|>|([-*+•]|\d+[.)])\s+)/.test(linhas[i]) && !(ehLinhaTabela(linhas[i]) && ehSeparador(linhas[i + 1] || ''))) paragrafo.push(linhas[i++]);
    blocos.push(<p key={blocos.length}>{paragrafo.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{fmt(p, `p${i}${k}`)}</Fragment>)}</p>);
  }
  return <div className="ag-md">{blocos}</div>;
}
