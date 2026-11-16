// Envio de notificações para os aparelhos (Web Push, o mesmo padrão do iPhone, Android e computador).
// Funciona com o CRM instalado como app (PWA). As chaves VAPID que assinam os envios são criadas sozinhas na 1ª vez
// e ficam só no servidor. Aparelho que o serviço de push diz que não existe mais (404/410) é removido da lista.
import webpush from 'web-push';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { temPermissao } from '../auth/permissoes.js';
import { nichoDoLead } from '../reunioes/nicho.js';

const ESTADO_CHAVES = 'push_vapid';
const ESTADO_HISTORICO = 'push_historico';
const MAX_HISTORICO = 40;
const FUSO = process.env.IA_FUSO || process.env.DISPAROS_FUSO || 'America/Sao_Paulo';

// Só serviços de push conhecidos (Apple, Google/Android, Mozilla, Microsoft): o servidor nunca manda pedidos para outro lugar
const RE_SERVICO_PUSH = /^https:\/\/(?:fcm\.googleapis\.com|android\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com|(?:[a-z0-9-]+\.)*wns\.windows\.com)\//i;
const RE_CHAVE = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

let chaves = null;
let envioFalso = null; // testes trocam o envio real por um falso

export function _definirEnvioFalso(fn) { envioFalso = fn; }
export function _esquecerChaves() { chaves = null; }

/** Chaves VAPID do CRM (criadas na primeira vez) */
export function chavesVapid() {
  if (chaves) return chaves;
  let e = lerEstado(ESTADO_CHAVES) || {};
  if (!e.publica || !e.privada) {
    const k = webpush.generateVAPIDKeys();
    e = salvarEstado(ESTADO_CHAVES, { publica: k.publicKey, privada: k.privateKey, criada_em: agora() });
  }
  chaves = { publica: e.publica, privada: e.privada };
  return chaves;
}

// Contato que vai junto na assinatura (a Apple exige https:// ou mailto: válidos)
function assunto() {
  const proprio = String(process.env.PUSH_CONTATO || '').trim();
  if (/^(mailto:|https:\/\/)/.test(proprio)) return proprio;
  if (config.publicOrigin?.startsWith('https://')) return config.publicOrigin;
  return 'mailto:contato@imperaservices.com';
}

/** Confere a inscrição que veio do navegador. Devolve { endpoint, p256dh, auth } ou lança erro. */
export function validarInscricao(entrada) {
  const endpoint = String(entrada?.endpoint || '').trim();
  const p256dh = String(entrada?.keys?.p256dh || '').trim();
  const auth = String(entrada?.keys?.auth || '').trim();
  if (!endpoint || endpoint.length > 1200 || !RE_SERVICO_PUSH.test(endpoint)) {
    const e = new Error('Este navegador não informou um serviço de notificações conhecido.');
    e.status = 400;
    throw e;
  }
  if (!RE_CHAVE.test(p256dh) || !RE_CHAVE.test(auth)) {
    const e = new Error('As chaves de notificação do aparelho vieram inválidas. Tente ligar de novo.');
    e.status = 400;
    throw e;
  }
  return { endpoint, p256dh, auth };
}

/** Aparelhos que recebem os avisos: pessoas ativas que podem ver o kanban (ou só os ids pedidos) */
export function destinatarios({ ids = null, userId = null } = {}) {
  const linhas = all(
    `SELECT p.*, u.name AS usuario, u.role, u.permissoes, u.active
       FROM push_inscricoes p JOIN users u ON u.id = p.user_id
      WHERE u.active = 1 ORDER BY p.id`
  );
  return linhas.filter((p) => {
    if (ids && !ids.includes(p.id)) return false;
    if (userId && p.user_id !== userId) return false;
    return temPermissao({ id: p.user_id, role: p.role, permissoes: p.permissoes, active: p.active }, 'kanban');
  });
}

function formatarQuando(inicio) {
  const d = new Date(inicio);
  if (Number.isNaN(d.getTime())) return '';
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(d);
  return `${dia.replace('.', '')} às ${hora}`;
}

/**
 * Monta o aviso de reunião agendada de um lead. uri = reunião específica; sem uri, usa a próxima reunião ativa do lead
 * (ou a mais recente, se todas já passaram). Devolve null se o lead não tem reunião.
 */
export function montarAvisoReuniao({ leadId, uri = null, teste = false }) {
  const ev = uri
    ? get('SELECT * FROM calendly_events WHERE uri = ?', [uri])
    : get(
      `SELECT * FROM calendly_events WHERE lead_id = ? AND status = 'active'
        ORDER BY (start_time >= ?) DESC, CASE WHEN start_time >= ? THEN start_time END ASC, start_time DESC LIMIT 1`,
      [leadId, agora(), agora()]
    );
  if (!ev) return null;
  const idLead = leadId || ev.lead_id;
  const lead = idLead ? get('SELECT id, name, extra FROM leads WHERE id = ?', [idLead]) : null;
  const nome = lead?.name || ev.invitee_name || ev.invitee_email || 'Lead sem nome';
  const nicho = lead ? nichoDoLead(lead.extra) : null;
  const quando = formatarQuando(ev.start_time);
  const titulo = teste ? 'Teste · Nova reunião agendada' : 'Nova reunião agendada';
  return {
    tipo: 'reuniao',
    teste: Boolean(teste),
    titulo,
    nome,
    nicho,
    inicio: ev.start_time,
    fim: ev.end_time,
    fuso: FUSO,
    lead_id: lead?.id || null,
    uri: ev.uri,
    // Texto pronto (no fuso do servidor). O app no aparelho refaz com o fuso do próprio celular.
    corpo: `${nome} — ${quando}${nicho ? `\nNicho: ${nicho}` : ''}`,
    url: lead?.id ? `./#kanban/reuniao/${lead.id}` : './#kanban/reunioes',
    // Avisos diferentes nunca se substituem; o teste sempre aparece de novo
    tag: teste ? `teste-${Date.now()}` : `reuniao-${ev.uri.split('/').pop()}`,
    enviado_em: agora(),
  };
}

function registrarHistorico(item) {
  const atual = lerEstado(ESTADO_HISTORICO)?.itens || [];
  salvarEstado(ESTADO_HISTORICO, { itens: [item, ...atual].slice(0, MAX_HISTORICO) });
}

export function historico() {
  return lerEstado(ESTADO_HISTORICO)?.itens || [];
}

async function mandar(inscricao, corpo) {
  if (envioFalso) return envioFalso(inscricao, corpo);
  const k = chavesVapid();
  return webpush.sendNotification(
    { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
    corpo,
    {
      vapidDetails: { subject: assunto(), publicKey: k.publica, privateKey: k.privada },
      TTL: 12 * 60 * 60, // aparelho desligado recebe quando ligar (até 12 h depois)
      urgency: 'high',
      timeout: 15000,
    }
  );
}

/**
 * Manda o aviso para a lista de aparelhos. Devolve um resultado por aparelho:
 * { id, aparelho, usuario, ok, status, erro, removido }
 */
export async function enviarAviso(aviso, aparelhos, { origem = 'automatico' } = {}) {
  const corpo = JSON.stringify(aviso);
  const resultados = await Promise.all(aparelhos.map(async (p) => {
    const base = { id: p.id, aparelho: p.aparelho || 'Aparelho', usuario: p.usuario || null };
    try {
      const r = await mandar(p, corpo);
      run('UPDATE push_inscricoes SET ultimo_envio_at = ?, ultimo_ok_at = ?, ultimo_erro = NULL, falhas = 0 WHERE id = ?', [agora(), agora(), p.id]);
      return { ...base, ok: true, status: r?.statusCode ?? 201 };
    } catch (err) {
      const status = Number(err?.statusCode) || null;
      const detalhe = String(err?.body || err?.message || 'erro desconhecido').replace(/\s+/g, ' ').slice(0, 300);
      // 404/410: a inscrição não existe mais (app desinstalado, permissão retirada, navegador limpo)
      if (status === 404 || status === 410) {
        run('DELETE FROM push_inscricoes WHERE id = ?', [p.id]);
        return { ...base, ok: false, status, erro: 'Este aparelho não está mais inscrito (app removido ou notificação desligada). Foi tirado da lista.', removido: true };
      }
      run('UPDATE push_inscricoes SET ultimo_envio_at = ?, ultimo_erro = ?, falhas = falhas + 1 WHERE id = ?', [agora(), `${status || ''} ${detalhe}`.trim(), p.id]);
      return { ...base, ok: false, status, erro: detalhe };
    }
  }));
  registrarHistorico({
    em: agora(),
    origem,
    teste: Boolean(aviso.teste),
    lead_id: aviso.lead_id,
    nome: aviso.nome,
    inicio: aviso.inicio,
    aparelhos: resultados.length,
    ok: resultados.filter((r) => r.ok).length,
    erros: resultados.filter((r) => !r.ok).map((r) => `${r.aparelho}${r.usuario ? ` (${r.usuario})` : ''}: ${r.erro}`).slice(0, 10),
  });
  return resultados;
}
