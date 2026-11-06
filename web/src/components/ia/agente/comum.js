// Utilidades da aba Agente
import { rota } from '../../../base.js';

export const dinheiro = (v) => `US$ ${Number(v || 0).toFixed(Number(v || 0) < 0.1 && Number(v || 0) > 0 ? 4 : 2).replace('.', ',')}`;

export const rotuloModelo = (m) => `${m.nome} — ${m.nivel}${m.preco ? ` (${m.preco})` : ''}`;

export const FUSOS = ['America/Sao_Paulo', 'America/Santiago', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco', 'America/Buenos_Aires', 'America/Bogota', 'America/Lima', 'America/Mexico_City', 'Europe/Lisbon'];
export const nomeFuso = (f) => String(f || '').replace(/^[A-Za-z]+\//, '').replace(/_/g, ' ');

export function dataHoraCurta(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Envia um arquivo (corpo = o próprio arquivo) e devolve o anexo { id, nome, mime, tamanho } */
export async function enviarAnexo(arquivo, nome = arquivo.name, mime = arquivo.type) {
  const resp = await fetch(rota(`/api/agente/anexos?nome=${encodeURIComponent(nome || 'arquivo')}&mime=${encodeURIComponent(mime || 'application/octet-stream')}`), {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: arquivo,
  });
  let dados = null;
  try { dados = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new Error(dados?.erro || `Erro ${resp.status}`);
  return dados.anexo;
}
