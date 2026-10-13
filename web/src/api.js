// Cliente da API. Lança erro com a mensagem do servidor; 401 avisa o app para mostrar o login.
import { rota } from './base.js';
let aoDeslogar = () => {};
export const definirAoDeslogar = (fn) => { aoDeslogar = fn; };

export async function api(caminho, { method = 'GET', body } = {}) {
  const resp = await fetch(rota(`/api${caminho}`), {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let dados = null;
  try { dados = await resp.json(); } catch { /* sem corpo */ }
  if (resp.status === 401 && !caminho.startsWith('/auth/login')) aoDeslogar();
  if (!resp.ok) throw new Error(dados?.erro || `Erro ${resp.status}`);
  return dados;
}
