// Atualização em tempo real da interface (Server-Sent Events em /api/eventos).
// O servidor só avisa "algo mudou em X"; a tela busca os dados de novo pela API de sempre.
// Avisos do mesmo tipo em sequência (ex.: importação do histórico) viram um só a cada 300 ms.

const clientes = new Set();
const pendentes = new Map();
const AGRUPAR_MS = 300;

export function abrirCanal(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies (nginx na VPS) não podem segurar os eventos
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clientes.add(res);
  const manter = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(manter);
    clientes.delete(res);
  });
}

export function emitir(tipo, dados = {}) {
  if (!clientes.size) return;
  const atual = pendentes.get(tipo);
  if (atual) {
    atual.dados = dados;
    return;
  }
  const item = { dados };
  pendentes.set(tipo, item);
  setTimeout(() => {
    pendentes.delete(tipo);
    const linha = `event: ${tipo}\ndata: ${JSON.stringify(item.dados)}\n\n`;
    for (const res of clientes) {
      try { res.write(linha); } catch { clientes.delete(res); }
    }
  }, AGRUPAR_MS).unref?.();
}

export function fecharCanais() {
  for (const res of clientes) {
    try { res.end(); } catch { /* ignora */ }
  }
  clientes.clear();
}
