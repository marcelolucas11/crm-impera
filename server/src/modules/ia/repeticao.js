// Alice sem repetição: não cumprimenta de novo ("boa tarde") quem ela (ou a equipe, ou a saudação automática) já
// cumprimentou no mesmo dia/conversa, e não manda de novo frases que já foram ditas na conversa.
//
// Duas camadas:
//  1) no pedido para o modelo: avisa que o cumprimento já foi feito e lista as frases já usadas (contextoDeRepeticao);
//  2) depois da resposta (rede de segurança): tira o cumprimento do começo dos balões e descarta balões que repetem
//     uma mensagem anterior (tirarRepeticoes). O modelo às vezes ignora a instrução: aqui ele não passa.

const HORA = 3600 * 1000;
// Conversa "em andamento": mandamos mensagem há menos de N horas (cobre a virada da meia-noite)
const HORAS_EM_ANDAMENTO = 8;

// Cumprimento no começo do balão: "Boa tarde, João!", "Oi, João, boa tarde!", "Olá!", "Bom dia de novo 😊"...
// (sem a flag "i": o nome precisa começar com maiúscula, então as palavras do cumprimento aceitam as duas formas)
const ci = (palavra) => [...palavra].map((c) => (/\p{L}/u.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c)).join('');
const SAUDACOES = `(?:${ci('bom')}\\s+${ci('dia')}|${ci('boa')}\\s+(?:${ci('tarde')}|${ci('noite')})|${ci('ol')}[${'áaÁA'}]|${ci('o')}[iI]+|${ci('opa')}|${ci('e')}\\s*${ci('a')}[íiÍI])(?![\\p{L}])`;
const EMOJI = '[\\p{Extended_Pictographic}\\u{FE0F}\\u{200D}]';
const NOME = "\\p{Lu}[\\p{L}'-]{1,20}(?=\\s*[,!.?;:…])";
const DE_NOVO = `(?:\\s+(?:${ci('de')}\\s+${ci('novo')}|${ci('novamente')}|${ci('mais')}\\s+${ci('uma')}\\s+${ci('vez')}))?`;
const SEP = `(?:\\s*(?:[!.,;:…-]+|${EMOJI}))*\\s*`;
const COMECA_COM_SAUDACAO = new RegExp(`^\\s*${SAUDACOES}`, 'u');

// Regex do cumprimento, com o primeiro nome do lead quando a gente sabe (aí ele sai mesmo sem vírgula depois)
function reCumprimento(nome) {
  const nomes = [NOME];
  if (nome) nomes.unshift(ci(String(nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const n = `(?:${SEP}(?:${nomes.join('|')}))?`;
  return new RegExp(`^\\s*${SAUDACOES}${DE_NOVO}(?:${SEP}${SAUDACOES})?${n}(?:${SEP}${SAUDACOES}${DE_NOVO})?${SEP}`, 'u');
}

/** Texto de uma mensagem para comparar: minúsculas, sem acento, sem pontuação nem emoji. */
export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const dataNoFuso = (ms, fuso) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
};

/**
 * Já houve cumprimento nesta conversa hoje? Considera qualquer mensagem nossa (Alice, equipe, saudação automática,
 * follow-up, lembrete) mandada hoje (no fuso) ou nas últimas horas.
 *  nossas: [{ timestamp }] — só as mensagens enviadas por nós
 */
export function jaCumprimentouHoje(nossas, { fuso = 'America/Sao_Paulo', agoraMs = Date.now() } = {}) {
  const hoje = dataNoFuso(agoraMs, fuso);
  return nossas.some((m) => {
    const t = new Date(m.timestamp).getTime();
    if (!Number.isFinite(t) || t > agoraMs + 60000) return false;
    return agoraMs - t < HORAS_EM_ANDAMENTO * HORA || dataNoFuso(t, fuso) === hoje;
  });
}

/** Frases das nossas últimas mensagens (para o modelo não repetir). */
export function frasesUsadas(nossas, max = 12) {
  const frases = [];
  const vistas = new Set();
  for (const m of [...nossas].reverse()) {
    for (const f of String(m.texto || '').split(/(?<=[.!?…])\s+|\n+/)) {
      const limpa = f.replace(/\s+/g, ' ').trim();
      const chave = normalizar(limpa);
      if (chave.split(' ').length < 3 || vistas.has(chave)) continue;
      vistas.add(chave);
      frases.push(limpa.length > 160 ? `${limpa.slice(0, 160)}…` : limpa);
      if (frases.length >= max) return frases;
    }
  }
  return frases;
}

/** Linhas de contexto para o pedido ao modelo. */
export function contextoDeRepeticao({ jaCumprimentou, saudacao, frases }) {
  const linhas = [];
  if (jaCumprimentou) {
    linhas.push(
      `O lead JÁ foi cumprimentado hoje e a conversa está em andamento: NÃO comece com "${saudacao.toLowerCase()}", "bom dia", "boa tarde", "boa noite", "olá" ou "oi", e não se apresente de novo. Vá direto ao assunto.`
    );
  } else {
    linhas.push(`Se for cumprimentar, use "${saudacao}" uma única vez, só no primeiro balão.`);
  }
  if (frases?.length) {
    linhas.push(
      'Frases que já foram ditas nesta conversa — NÃO repita nenhuma delas, nem com as mesmas palavras de abertura ou encerramento; escreva diferente:\n' +
        frases.map((f) => `- "${f}"`).join('\n')
    );
  }
  return linhas;
}

/** Abertura do 1º contato quando o lead já foi cumprimentado hoje: "João, aqui é a Alice, da Impera." (sem "boa tarde") */
export function aberturaSemCumprimento(apresentacao, nome) {
  const a = String(apresentacao || '').trim();
  if (!nome || !a) return a;
  const inicio = /^\p{Lu}\p{Ll}/u.test(a) ? a.charAt(0).toLocaleLowerCase('pt-BR') + a.slice(1) : a;
  return `${nome}, ${inicio}`;
}

const maiuscula = (s) => (s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s);

/** Tira o cumprimento do começo do balão. Devolve '' se o balão era só o cumprimento. */
export function semCumprimento(texto, nome = null) {
  const t = String(texto || '');
  if (!COMECA_COM_SAUDACAO.test(t)) return t;
  const resto = t.replace(reCumprimento(nome), '').trim();
  // "Oi, tudo bem?" sozinho também é cumprimento
  if (/^(tudo\s+(bem|certo|bom)|como\s+vai|como\s+(voce|você)\s+est[áa])\s*\??\s*[\p{Extended_Pictographic}]*$/iu.test(resto)) return '';
  return maiuscula(resto);
}

// Dois textos são "a mesma mensagem"? (iguais, ou um contém o outro sendo os dois longos)
function repete(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [curto, longo] = a.length < b.length ? [a, b] : [b, a];
  return curto.length >= 25 && longo.includes(curto);
}

/**
 * Rede de segurança depois da resposta do modelo.
 *  - jaCumprimentou: tira o cumprimento do começo de todos os balões;
 *  - mesmo sem isso, só o 1º balão da resposta pode começar com cumprimento;
 *  - descarta balões iguais a uma mensagem nossa anterior (ou repetidos na própria resposta).
 * Se tudo fosse descartado, devolve os balões originais sem cumprimento (melhor responder do que ficar mudo).
 * Devolve { mensagens, alterou }.
 */
export function tirarRepeticoes(mensagens, { jaCumprimentou = false, anteriores = [], nome = null } = {}) {
  const originais = (mensagens || []).map((m) => String(m ?? '').trim()).filter(Boolean);
  const vistos = anteriores.map(normalizar).filter(Boolean);
  const saida = [];
  let cumprimentou = jaCumprimentou;
  for (const m of originais) {
    let texto = m;
    if (cumprimentou) texto = semCumprimento(texto, nome);
    else if (COMECA_COM_SAUDACAO.test(texto)) cumprimentou = true;
    if (!texto) continue;
    const chave = normalizar(texto);
    if (!chave || vistos.some((v) => repete(v, chave))) continue;
    vistos.push(chave);
    saida.push(texto);
  }
  if (!saida.length) {
    const sem = originais.map((m) => (jaCumprimentou ? semCumprimento(m, nome) : m)).filter(Boolean);
    const final = sem.length ? sem : originais;
    return { mensagens: final, alterou: JSON.stringify(final) !== JSON.stringify(originais) };
  }
  return { mensagens: saida, alterou: JSON.stringify(saida) !== JSON.stringify(originais) };
}
