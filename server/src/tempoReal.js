// Atualização em tempo real da interface (Server-Sent Events em /api/eventos).
// O servidor só avisa "algo mudou em X"; a tela busca os dados de novo pela API de sempre.
// Avisos do mesmo tipo em sequência (ex.: importação do histórico) viram um só a cada 300 ms. Quando o grupo junta
// avisos diferentes (mensagens em duas conversas, por exemplo), todos vão juntos em "lote" — antes só o último
// chegava, e a tela de uma conversa podia não saber que tinha mensagem nova nela.
// Cada aviso só vai para quem pode ver aquilo: os da assistente só para o dono, os de chamada e presença só para quem
// usa o WhatsApp, os do Instagram só para quem tem acesso ao Instagram.

const clientes = new Set(); // { res, userId, pode(chave) }
const pendentes = new Map();
const AGRUPAR_MS = 300;
const MAX_LOTE = 40;

// Quem recebe cada tipo de aviso (permissão da tela). Tipos fora da lista vão para todos os logados.
const PERMISSAO_DO_TIPO = {
  chamada: 'whatsapp',
  presenca: 'whatsapp',
  importacao: 'whatsapp',
  instagram: ['instagram', 'instagram_desempenho', 'instagram_comentarios'],
};

export function abrirCanal(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies (nginx na VPS) não podem segurar os eventos
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const user = req.user || {};
  const efetivas = user.permissoesEfetivas || {};
  const cliente = {
    res,
    userId: user.id ?? null,
    pode: (chave) => user.role === 'admin' || [].concat(chave).some((c) => efetivas[c]),
  };
  clientes.add(cliente);
  const manter = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* fechado */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(manter);
    clientes.delete(cliente);
  });
}

function recebe(cliente, tipo, dados) {
  if (tipo === 'agente' && dados?.usuario && dados.usuario !== cliente.userId) return false;
  const chave = PERMISSAO_DO_TIPO[tipo];
  return !chave || cliente.pode(chave);
}

const iguais = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

export function emitir(tipo, dados = {}) {
  if (!clientes.size) return;
  const atual = pendentes.get(tipo);
  if (atual) {
    // Rajada grande (ex.: importação): guarda só até o teto; acima disso a tela recarrega tudo ("muitos")
    if (atual.lista.length > MAX_LOTE) atual.lista[atual.lista.length - 1] = dados;
    else if (!atual.lista.some((d) => iguais(d, dados))) atual.lista.push(dados);
    return;
  }
  const item = { lista: [dados] };
  pendentes.set(tipo, item);
  setTimeout(() => {
    pendentes.delete(tipo);
    const { lista } = item;
    // O último aviso continua no formato de sempre e as marcas "true" de qualquer aviso do grupo (numeros, historico...)
    // valem para o grupo todo; os identificadores de cada aviso (conversa, chat...) vão em "lote"
    const juntar = (itens) => {
      if (itens.length === 1) return itens[0];
      const marcas = {};
      for (const d of itens) for (const [k, v] of Object.entries(d || {})) if (v === true) marcas[k] = true;
      return { ...itens[itens.length - 1], ...marcas, ...(itens.length > MAX_LOTE ? { muitos: true } : { lote: itens }) };
    };
    const corpo = juntar(lista);
    // Avisos da assistente são de um usuário só: cada um recebe só os seus
    const porUsuario = tipo === 'agente';
    const linhaGeral = porUsuario ? null : `event: ${tipo}\ndata: ${JSON.stringify(corpo)}\n\n`;
    for (const c of clientes) {
      let linha = linhaGeral;
      if (porUsuario) {
        const meus = lista.filter((d) => !d?.usuario || d.usuario === c.userId);
        if (!meus.length) continue;
        linha = `event: ${tipo}\ndata: ${JSON.stringify(juntar(meus))}\n\n`;
      } else if (!recebe(c, tipo, corpo)) continue;
      try { c.res.write(linha); } catch { clientes.delete(c); }
    }
  }, AGRUPAR_MS).unref?.();
}

export function fecharCanais() {
  for (const c of clientes) {
    try { c.res.end(); } catch { /* ignora */ }
  }
  clientes.clear();
}
