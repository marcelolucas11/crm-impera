// Ganchos entre módulos: um módulo avisa "aconteceu X" e quem se inscreveu reage, sem um importar o outro.
// Hoje usado pela IA de primeiro contato para saber de mensagens recebidas, mensagens humanas e leads novos.
// Um ouvinte com erro nunca derruba quem avisou (o WhatsApp e o webhook continuam funcionando).

const ouvintes = new Map(); // nome → Set(funções)

export function aoAcontecer(nome, fn) {
  if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
  ouvintes.get(nome).add(fn);
  return () => ouvintes.get(nome)?.delete(fn);
}

export function avisarGancho(nome, dados = {}) {
  for (const fn of ouvintes.get(nome) || []) {
    try {
      const r = fn(dados);
      if (r && typeof r.catch === 'function') r.catch((err) => console.error(`[gancho ${nome}]`, err.message));
    } catch (err) {
      console.error(`[gancho ${nome}]`, err.message);
    }
  }
}

export function limparGanchos() {
  ouvintes.clear();
}
