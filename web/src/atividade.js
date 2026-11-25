// Atividade da pessoa no CRM: um único conjunto de ouvintes de mouse/teclado para a página inteira.
// Antes, o fundo 3D, a inclinação dos cartões e a economia de animações tinham cada um os seus ouvintes de
// "pointermove", e cada movimento do mouse reiniciava timers em todos eles. Agora:
//  - aoMudarAtividade(fn): avisa quando a pessoa fica ociosa (10 s sem mexer, janela sem foco ou aba escondida) e quando volta;
//  - aoMoverPonteiro(fn): entrega o último movimento do mouse no máximo uma vez por quadro (requestAnimationFrame).
// Só estético/economia: não lê nem muda dados do CRM.

const OCIOSO_MS = 10000;
const ouvintesAtividade = new Set();
const ouvintesPonteiro = new Set();
let ativo = false;
let ultimoUso = 0;
let checagem = 0;
let quadro = 0;
let ultimoEvento = null;
let ligado = false;

function definirAtivo(v) {
  if (ativo === v) return;
  ativo = v;
  for (const fn of ouvintesAtividade) { try { fn(v); } catch { /* um ouvinte com erro não derruba os outros */ } }
}

// Um timer só, rearmado só quando vence (antes era clearTimeout + setTimeout a cada movimento do mouse)
function conferirOcioso() {
  checagem = 0;
  const falta = OCIOSO_MS - (performance.now() - ultimoUso);
  if (falta <= 0) definirAtivo(false);
  else checagem = setTimeout(conferirOcioso, falta + 50);
}

function usou() {
  ultimoUso = performance.now();
  if (document.hidden || !document.hasFocus()) return;
  definirAtivo(true);
  if (!checagem) checagem = setTimeout(conferirOcioso, OCIOSO_MS + 50);
}

function entregarPonteiro() {
  quadro = 0;
  const e = ultimoEvento;
  if (!e) return;
  for (const fn of ouvintesPonteiro) { try { fn(e); } catch { /* ignora */ } }
}

function aoMover(e) {
  usou();
  if (!ouvintesPonteiro.size) return;
  ultimoEvento = e;
  if (!quadro) quadro = requestAnimationFrame(entregarPonteiro);
}

function aoSairDaPagina() {
  ultimoEvento = null;
  for (const fn of ouvintesPonteiro) { try { fn(null); } catch { /* ignora */ } }
}

function pausar() {
  clearTimeout(checagem);
  checagem = 0;
  definirAtivo(false);
}

function ligar() {
  if (ligado || typeof window === 'undefined') return;
  ligado = true;
  window.addEventListener('pointermove', aoMover, { passive: true });
  for (const tipo of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(tipo, usou, { passive: true });
  window.addEventListener('focus', usou);
  window.addEventListener('blur', () => { pausar(); aoSairDaPagina(); });
  document.addEventListener('pointerleave', aoSairDaPagina);
  document.addEventListener('visibilitychange', () => (document.hidden ? pausar() : usou()));
  if (document.hasFocus() && !document.hidden) usou();
}

export const estaAtivo = () => ativo;

// fn(ativo: boolean) — chamada quando muda. Devolve a função para parar de ouvir.
export function aoMudarAtividade(fn) {
  ligar();
  ouvintesAtividade.add(fn);
  return () => ouvintesAtividade.delete(fn);
}

// fn(evento | null) — no máximo uma vez por quadro; null quando o mouse sai da página.
export function aoMoverPonteiro(fn) {
  ligar();
  ouvintesPonteiro.add(fn);
  return () => {
    ouvintesPonteiro.delete(fn);
    if (!ouvintesPonteiro.size && quadro) { cancelAnimationFrame(quadro); quadro = 0; }
  };
}
