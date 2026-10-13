// Texto das mensagens com a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```monoespaçado```)
// e links clicáveis. Gera elementos React (nunca HTML cru).

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]|www\.[^\s<]+[^\s<.,;:!?)\]'"])/gi;
const MARCAS_RE = /(```[\s\S]+?```|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

// @5511999999999 vira @Nome (menções em grupos)
function comMencoes(texto, chave, mencoes) {
  if (!mencoes || !texto.includes('@')) return [texto];
  const partes = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(/@(\d{5,20})/g)) {
    if (!(m[1] in mencoes)) continue;
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    partes.push(<span key={`${chave}-m${i++}`} className="mencao">@{mencoes[m[1]] || m[1]}</span>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

function formatar(texto, chave, mencoes = null) {
  const partes = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(MARCAS_RE)) {
    const antes = texto[m.index - 1];
    const depois = texto[m.index + m[0].length];
    // A marca só vale grudada em palavra: "2*3*4" não vira negrito
    if (m[0][0] !== '`' && ((antes && /\w/.test(antes)) || (depois && /\w/.test(depois)))) continue;
    if (m.index > ultimo) partes.push(...comMencoes(texto.slice(ultimo, m.index), `${chave}-a${i}`, mencoes));
    const bruto = m[0];
    const k = `${chave}-${i++}`;
    if (bruto.startsWith('```')) partes.push(<code key={k} className="fmt-bloco">{bruto.slice(3, -3)}</code>);
    else if (bruto[0] === '`') partes.push(<code key={k}>{bruto.slice(1, -1)}</code>);
    else if (bruto[0] === '*') partes.push(<b key={k}>{formatar(bruto.slice(1, -1), k, mencoes)}</b>);
    else if (bruto[0] === '_') partes.push(<i key={k}>{formatar(bruto.slice(1, -1), k, mencoes)}</i>);
    else partes.push(<s key={k}>{formatar(bruto.slice(1, -1), k, mencoes)}</s>);
    ultimo = m.index + bruto.length;
  }
  if (ultimo < texto.length) partes.push(...comMencoes(texto.slice(ultimo), `${chave}-z`, mencoes));
  return partes;
}

// Realça o termo buscado
export function realcar(texto, termo) {
  if (!termo || !texto) return texto;
  const i = texto.toLowerCase().indexOf(termo.toLowerCase());
  if (i < 0) return texto;
  return <>{texto.slice(0, i)}<mark>{texto.slice(i, i + termo.length)}</mark>{texto.slice(i + termo.length)}</>;
}

export function TextoFormatado({ texto, mencoes = null }) {
  if (!texto) return null;
  const partes = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(URL_RE)) {
    if (m.index > ultimo) partes.push(...formatar(texto.slice(ultimo, m.index), `t${i}`, mencoes));
    const url = m[0].startsWith('http') ? m[0] : `https://${m[0]}`;
    partes.push(<a key={`u${i}`} href={url} target="_blank" rel="noreferrer noopener">{m[0]}</a>);
    ultimo = m.index + m[0].length;
    i++;
  }
  if (ultimo < texto.length) partes.push(...formatar(texto.slice(ultimo), `t${i}`, mencoes));
  return <>{partes}</>;
}
