// Webhook do Instagram (Meta → CRM): /webhooks/instagram
//  GET  = verificação ao cadastrar a URL no painel da Meta (hub.challenge com o token de verificação)
//  POST = notificações: mensagens do Direct, ecos das nossas, lidas, reações, comentários, menções e métricas de Stories.
// Toda notificação é conferida pela assinatura (X-Hub-Signature-256 com a chave secreta do app). Sem a chave, nada é aceito.
import crypto from 'node:crypto';
import { run, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { lerConfig, segredoApp } from './config.js';
import { perfilPorIgId, perfilPorPagina, atualizarPerfil, registrar } from './perfis.js';
import { processarEventoDoWebhook } from './direct.js';

const MAX_GUARDADOS = 300;
const tratadores = { comentario: null, storyInsights: null, mencao: null };

/** Os outros arquivos do módulo registram como tratar comentários e métricas de Stories (evita importação circular) */
export function aoReceberMudanca(tipo, fn) { tratadores[tipo] = fn; }

export function assinaturaValida(corpo, cabecalho, segredo = segredoApp()) {
  if (!segredo || !corpo || !cabecalho) return false;
  const [algoritmo, recebida] = String(cabecalho).split('=');
  if (algoritmo !== 'sha256' || !recebida) return false;
  const esperada = crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
  const a = Buffer.from(recebida, 'hex');
  const b = Buffer.from(esperada, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verificar(req, res) {
  const cfg = lerConfig();
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === cfg.verify_token) {
    registrar(null, 'webhook', 'URL do webhook verificada pela Meta');
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  return res.status(403).send('Token de verificação incorreto');
}

function perfilDaEntrada(entrada, ev = null) {
  const ids = [entrada?.id, ev?.recipient?.id, ev?.sender?.id].filter(Boolean).map(String);
  for (const id of ids) {
    const p = perfilPorIgId(id) || perfilPorPagina(id);
    if (p?.ativo) return p;
  }
  return null;
}

/** Processa o corpo já conferido. Exportado para os testes. */
export async function processarCorpo(corpo) {
  if (!corpo || (corpo.object !== 'instagram' && corpo.object !== 'page')) return { ignorado: true };
  let mensagens = 0;
  let mudancas = 0;
  for (const entrada of corpo.entry || []) {
    for (const ev of entrada.messaging || []) {
      const perfil = perfilDaEntrada(entrada, ev);
      if (!perfil) continue;
      atualizarPerfil(perfil.id, { webhook_em: agora() });
      try {
        await processarEventoDoWebhook(perfil, ev);
        mensagens++;
      } catch (err) {
        registrar(perfil.id, 'erro', `Webhook (mensagem): ${err.message}`);
      }
    }
    for (const mudanca of entrada.changes || []) {
      const perfil = perfilDaEntrada(entrada);
      if (!perfil) continue;
      atualizarPerfil(perfil.id, { webhook_em: agora() });
      const valor = mudanca.value || {};
      try {
        if ((mudanca.field === 'comments' || mudanca.field === 'live_comments') && tratadores.comentario) await tratadores.comentario(perfil, valor);
        else if (mudanca.field === 'story_insights' && tratadores.storyInsights) await tratadores.storyInsights(perfil, valor);
        else if (mudanca.field === 'mentions' && tratadores.mencao) await tratadores.mencao(perfil, valor);
        mudancas++;
      } catch (err) {
        registrar(perfil.id, 'erro', `Webhook (${mudanca.field}): ${err.message}`);
      }
    }
  }
  return { mensagens, mudancas };
}

export function receber(req, res) {
  const corpo = req.rawBody;
  if (!assinaturaValida(corpo, req.get('x-hub-signature-256'))) {
    registrar(null, 'aviso', segredoApp()
      ? 'Webhook recusado: assinatura não confere (a chave secreta do app está certa?)'
      : 'Webhook recusado: cadastre a chave secreta do app para o CRM conferir as notificações');
    return res.status(401).send('assinatura inválida');
  }
  // A Meta espera resposta rápida: responde já e processa em seguida
  res.status(200).send('EVENT_RECEIVED');
  const json = req.body;
  try {
    run('INSERT INTO ig_registro (perfil_id, tipo, detalhe) VALUES (NULL, ?, ?)', ['webhook_bruto', JSON.stringify(json).slice(0, 1000)]);
    run(`DELETE FROM ig_registro WHERE tipo = 'webhook_bruto' AND id NOT IN (SELECT id FROM ig_registro WHERE tipo = 'webhook_bruto' ORDER BY id DESC LIMIT ${MAX_GUARDADOS})`);
  } catch { /* o registro é só para conferência */ }
  processarCorpo(json)
    .then(() => emitir('instagram', { webhook: true }))
    .catch((err) => console.error('[instagram] webhook:', err.message));
}
