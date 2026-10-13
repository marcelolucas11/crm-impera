// Caminho em que o CRM está aberto (vazio na raiz, "/interno" num subcaminho).
// O servidor informa isso numa <meta name="base-path"> ao entregar a página.
export const BASE = (document.querySelector('meta[name="base-path"]')?.content || '').replace(/\/+$/, '');

// Monta o endereço de algo do servidor: rota('/api/leads') → '/interno/api/leads'
export const rota = (caminho) => `${BASE}${caminho}`;
