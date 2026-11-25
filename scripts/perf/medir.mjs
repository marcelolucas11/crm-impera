// Mede o custo de CPU/GPU da interface do CRM em cada tela e cenário (parado, mouse se mexendo, rolando).
// Só para desenvolvimento, sempre contra o servidor falso (dados de exemplo). Nunca contra o CRM de produção.
//
// Uso:
//   node scripts/perf/medir.mjs <saida.json> [--url http://127.0.0.1:3999] [--segundos 30] [--prints pasta] [--dpr 1] [--com-tela]
// Precisa do Playwright (npm i -g playwright) e do Google Chrome.
// Por padrão roda o Chrome sem janela (headless), que desenha tudo no processador: o custo de efeitos de vidro e do 3D
// aparece como CPU, e os números são estáveis entre uma rodada e outra. Os valores absolutos são maiores que num Mac com
// placa de vídeo; o que vale é a comparação antes × depois na mesma máquina.
//
// O que mede, por cenário (valores por segundo de medição):
//   cpu_chrome_pct   CPU somada de TODOS os processos do Chrome (renderizador + GPU + navegador), como no Monitor de Atividade
//   task_ms_s        tempo de trabalho da página por segundo (CDP Performance.getMetrics: TaskDuration)
//   script/layout/estilo  partes do TaskDuration
//   quadros_s        quadros desenhados para a tela por segundo (Tracing: Swap ou DirectRenderer::DrawFrame)
//   vidros           superfícies visíveis com desfoque de fundo (backdrop-filter); vidros_svg = com refração SVG
//   animacoes_infinitas  animações CSS infinitas rodando na tela
//   req_min          requisições HTTP por minuto (e por endpoint) · sse_min  avisos de tempo real recebidos por minuto
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright', `${process.env.HOME}/.npm-global/lib/node_modules/playwright`]) {
  try { playwright = require(p); break; } catch { /* tenta o próximo */ }
}
if (!playwright) { console.error('Instale o Playwright: npm i -g playwright'); process.exit(1); }

const args = process.argv.slice(2);
const saida = args.find((a) => !a.startsWith('--')) || 'scripts/perf/resultado.json';
const opc = (n, p) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : p; };
const URL_BASE = opc('url', 'http://127.0.0.1:3999');
const SEG = Number(opc('segundos', 30));
const PRINTS = opc('prints', null);
const DPR = Number(opc('dpr', 1));
const COM_TELA = args.includes('--com-tela');
const EMAIL = opc('email', 'teste@exemplo.com');
const SENHA = opc('senha', 'teste12345');
const TICK = 100; // jiffies por segundo (CLK_TCK) no Linux

// CPU de todos os processos do Chrome (Linux: /proc). No Mac, use o Monitor de Atividade em paralelo.
function cpuChrome(pidRaiz) {
  if (!fs.existsSync('/proc')) return null;
  const filhos = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const resto = st.slice(st.lastIndexOf(')') + 2).split(' ');
      filhos.set(Number(d), { ppid: Number(resto[1]), cpu: Number(resto[11]) + Number(resto[12]) });
    } catch { /* processo sumiu */ }
  }
  let total = 0;
  const visitar = (pid) => {
    const p = filhos.get(pid); if (p) total += p.cpu;
    for (const [f, info] of filhos) if (info.ppid === pid) visitar(f);
  };
  visitar(pidRaiz);
  return total / TICK; // segundos de CPU
}

const browserServer = await playwright.chromium.launchServer({
  executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
  headless: !COM_TELA,
  args: ['--window-size=1512,945', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const pidChrome = browserServer.process().pid;
const browser = await playwright.chromium.connect(browserServer.wsEndpoint());
const contexto = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: DPR });
await contexto.addInitScript(() => {
  window.__sse = 0;
  const Orig = window.EventSource;
  if (!Orig) return;
  window.EventSource = class extends Orig {
    addEventListener(tipo, fn, o) { return super.addEventListener(tipo, (e) => { window.__sse++; fn(e); }, o); }
  };
});
const page = await contexto.newPage();
const cdp = await contexto.newCDPSession(page);
await cdp.send('Performance.enable');

const requisicoes = [];
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/')) requisicoes.push({ t: Date.now(), p: `${r.method()} ${u.pathname.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[^/]*(%40|@)[^/]*/g, '/:jid')}` });
});

let referencia = null;
// Referência: o mesmo Chrome com uma página em branco (o que sobra disso é custo do CRM)
{
  const vazia = await contexto.newPage();
  await vazia.goto('about:blank');
  await vazia.bringToFront();
  const c0 = cpuChrome(pidChrome); const t0 = Date.now();
  await vazia.waitForTimeout(10000);
  referencia = c0 == null ? null : Number((((cpuChrome(pidChrome) - c0) / ((Date.now() - t0) / 1000)) * 100).toFixed(1));
  await vazia.close();
  console.log(`Referência (página em branco): ${referencia}% de CPU`);
}

// Login
await page.goto(`${URL_BASE}/`);
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', SENHA);
await page.press('input[type=password]', 'Enter');
await page.waitForTimeout(3000);

async function metricas() {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { task: m.TaskDuration, script: m.ScriptDuration, layout: m.LayoutDuration, estilo: m.RecalcStyleDuration, t: m.Timestamp };
}

async function quadros(fn) {
  await browser.startTracing(page, { categories: ['disabled-by-default-devtools.timeline.frame', 'devtools.timeline', 'viz'] });
  await fn();
  const buf = await browser.stopTracing();
  const ev = JSON.parse(buf.toString()).traceEvents || [];
  // Quadros que o compositor desenhou para a tela (inclui o trabalho da GPU). Com janela: Swap; sem janela: DrawFrame do viz
  const swap = ev.filter((e) => e.name === 'Swap').length;
  return swap || ev.filter((e) => e.name === 'DirectRenderer::DrawFrame' && e.ph === 'X').length;
}

async function telas(tela) {
  await page.evaluate((t) => { window.location.hash = t; }, tela);
  await page.reload();
  await page.waitForTimeout(4000);
  if (tela === 'whatsapp') {
    const item = page.locator('.item-conversa').first();
    if (await item.count()) { await item.click(); await page.waitForTimeout(2000); }
  }
}

// Superfícies de vidro visíveis (backdrop-filter) e quantas usam o filtro SVG de refração
const vidros = () => page.evaluate(() => {
  let total = 0, svg = 0, animando = 0;
  const vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none') { total++; if (bf.includes('url(')) svg++; }
    if (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite' && cs.animationPlayState === 'running') animando++;
  }
  return { total, svg, animando };
});

async function cenario(nome, acao) {
  const req0 = requisicoes.length;
  const sse0 = await page.evaluate(() => window.__sse);
  const m0 = await metricas();
  const c0 = cpuChrome(pidChrome);
  const t0 = Date.now();
  const nQuadros = await quadros(acao);
  const dur = (Date.now() - t0) / 1000;
  const m1 = await metricas();
  const c1 = cpuChrome(pidChrome);
  const sse1 = await page.evaluate(() => window.__sse);
  const reqs = requisicoes.slice(req0);
  const porEndpoint = {};
  reqs.forEach((r) => { porEndpoint[r.p] = (porEndpoint[r.p] || 0) + 1; });
  const dt = m1.t - m0.t;
  const r = {
    cenario: nome,
    segundos: Number(dur.toFixed(1)),
    cpu_chrome_pct: c0 == null ? null : Number((((c1 - c0) / dur) * 100).toFixed(1)),
    task_ms_s: Number((((m1.task - m0.task) / dt) * 1000).toFixed(1)),
    script_ms_s: Number((((m1.script - m0.script) / dt) * 1000).toFixed(1)),
    layout_ms_s: Number((((m1.layout - m0.layout) / dt) * 1000).toFixed(1)),
    estilo_ms_s: Number((((m1.estilo - m0.estilo) / dt) * 1000).toFixed(1)),
    quadros_s: Number((nQuadros / dur).toFixed(1)),
    ...(await vidros().then((v) => ({ vidros: v.total, vidros_svg: v.svg, animacoes_infinitas: v.animando }))),
    req_min: Number(((reqs.length / dur) * 60).toFixed(1)),
    sse_min: Number((((sse1 - sse0) / dur) * 60).toFixed(1)),
    endpoints: porEndpoint,
  };
  console.log(`  ${nome.padEnd(8)} cpu ${String(r.cpu_chrome_pct).padStart(6)}%  task ${String(r.task_ms_s).padStart(6)} ms/s  quadros ${String(r.quadros_s).padStart(5)}/s  vidros ${String(r.vidros).padStart(3)} (svg ${r.vidros_svg})  anim ${r.animacoes_infinitas}  req ${r.req_min}/min`);
  return r;
}

const ms = SEG * 1000;
const parado = () => page.waitForTimeout(ms);
const mouse = async () => {
  const fim = Date.now() + ms;
  let i = 0;
  while (Date.now() < fim) {
    const x = 200 + ((i * 37) % 1100), y = 250 + ((i * 53) % 600);
    await page.mouse.move(x, y);
    await page.waitForTimeout(50); // ~20 movimentos por segundo, como uma pessoa mexendo o mouse
    i++;
  }
};
const rolar = (seletor) => async () => {
  const fim = Date.now() + ms;
  const alvo = page.locator(seletor).first();
  const box = (await alvo.count()) ? await alvo.boundingBox() : null;
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
  let d = 1;
  while (Date.now() < fim) {
    await page.mouse.wheel(0, 120 * d);
    await page.waitForTimeout(60);
    if (Math.random() < 0.05) d = -d;
  }
};

const resultado = { data: new Date().toISOString(), url: URL_BASE, segundos_por_cenario: SEG, dpr: DPR, headless: !COM_TELA, referencia_cpu_chrome_pct: referencia, telas: {} };
const ROLAGEM = { kanban: '.coluna-cartoes', whatsapp: '.lista-conversas', ia: 'main, .conteudo, body' };
for (const tela of ['kanban', 'whatsapp', 'ia']) {
  console.log(`Tela: ${tela}`);
  await telas(tela);
  if (PRINTS) { fs.mkdirSync(PRINTS, { recursive: true }); await page.screenshot({ path: `${PRINTS}/${tela}.png` }); }
  resultado.telas[tela] = [
    await cenario('parado', parado),
    await cenario('mouse', mouse),
    await cenario('rolando', rolar(ROLAGEM[tela])),
  ];
}

if (PRINTS) {
  // Ficha do lead (modal/painel) e um menu aberto, para conferir o visual
  await telas('kanban');
  const cartao = page.locator('.cartao').first();
  if (await cartao.count()) { await cartao.click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${PRINTS}/ficha.png` }); await page.keyboard.press('Escape'); }
  await page.waitForTimeout(800);
  const avatar = page.locator('.topo .avatar, .topo button.usuario, .topo-usuario').first();
  if (await avatar.count()) { await avatar.click(); await page.waitForTimeout(800); await page.screenshot({ path: `${PRINTS}/menu.png` }); }
  await page.goto(`${URL_BASE}/`);
  await contexto.clearCookies();
  await page.reload(); await page.waitForTimeout(3500);
  await page.screenshot({ path: `${PRINTS}/login.png` });
}

fs.writeFileSync(saida, `${JSON.stringify(resultado, null, 2)}\n`);
console.log(`Salvo em ${saida}`);
await browser.close();
await browserServer.close();
