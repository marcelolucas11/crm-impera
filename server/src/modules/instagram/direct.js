// Direct do Instagram dentro do CRM: conversas, mensagens (texto, fotos, vídeos, áudios, respostas a Stories,
// menções), envio pela API oficial (janela de 24 h), leitura, estado da conversa e ligação com os leads do kanban.
//
// As mensagens chegam de dois jeitos: webhook (na hora, quando o app da Meta está Live) e busca periódica pela API de
// conversas (rede de segurança: funciona mesmo sem webhook). As duas gravam pelo mesmo caminho, sem duplicar (mid).
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento, lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { avisarGancho } from '../../ganchos.js';
import { ErroHttp, normalizarTelefone, esperar } from '../../util.js';
import { criarLead, encontrarExistente, registrarContatoLead } from '../leads/service.js';
import { chamar, paginar, baixarArquivo, ErroMeta } from './graph.js';
import { tokenDoPerfil, obterPerfil, atualizarPerfil, registrarErro, limparErro, registrar, perfilPausado } from './perfis.js';
import { linkPublico } from './publico.js';
import { PASTA } from './conexao.js';

export const JANELA_HORAS = 24;
export const JANELA_ANUNCIO_DIAS = 7;
const MAX_BYTES_TEXTO = 1000;
const MAX_ANEXO = 25 * 1024 * 1024;
// Mensagem que chega com até isto de atraso ainda conta como "ao vivo" (a Alice reage; o resto é histórico)
const AO_VIVO_MS = 15 * 60000;

// ------------------------------------------------------------------ datas e formatos da Meta

/** "2026-11-08T03:10:00+0000" ou segundos/milissegundos → ISO */
export function dataMeta(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const t = Date.parse(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const TIPO_ANEXO = {
  image: 'imagem', video: 'video', audio: 'audio', file: 'arquivo', story_mention: 'story_mencao', ig_story: 'story_mencao',
  story: 'story_mencao', share: 'compartilhamento', ig_post: 'post', media: 'post', ig_reel: 'reel', reel: 'reel',
};

/** Anexos do webhook ([{ type, payload: { url } }]) → [{ tipo, url }] */
export function anexosDoWebhook(lista) {
  return (Array.isArray(lista) ? lista : []).map((a) => ({
    tipo: TIPO_ANEXO[a?.type] || 'arquivo',
    url: a?.payload?.url || null,
    titulo: a?.payload?.title || null,
  })).filter((a) => a.url || a.tipo);
}

/** Anexos da API de conversas ({ data: [{ image_data, video_data, file_url, mime_type, name }] }) → [{ tipo, url }] */
export function anexosDaApi(attachments) {
  return (attachments?.data || []).map((a) => {
    const mime = String(a.mime_type || '');
    if (a.image_data?.url) return { tipo: mime.startsWith('image/gif') ? 'imagem' : 'imagem', url: a.image_data.url, mime, nome: a.name || null };
    if (a.video_data?.url) return { tipo: 'video', url: a.video_data.url, mime, nome: a.name || null };
    if (a.file_url) return { tipo: mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'imagem' : 'arquivo', url: a.file_url, mime, nome: a.name || null };
    if (a.payload?.url) return { tipo: TIPO_ANEXO[a.type] || 'arquivo', url: a.payload.url };
    return null;
  }).filter(Boolean);
}

function tipoDaMensagem({ texto, anexos, story, naoSuportada }) {
  if (story?.tipo === 'resposta') return 'story_resposta';
  if (story?.tipo === 'mencao') return 'story_mencao';
  if (naoSuportada) return 'nao_suportada';
  const primeiro = anexos?.[0]?.tipo;
  if (primeiro) return primeiro;
  return texto ? 'texto' : 'nao_suportada';
}

const PREVIA = {
  imagem: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', arquivo: '📄 Arquivo', story_resposta: '↩️ Respondeu seu story',
  story_mencao: '📣 Mencionou você no story', post: '🖼 Publicação', reel: '🎞 Reel', compartilhamento: '🔗 Compartilhou', nao_suportada: 'Mensagem não suportada pela API',
};
export const previaDe = (tipo, texto) => {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (tipo === 'texto') return t.slice(0, 200);
  return `${PREVIA[tipo] || tipo}${t ? ` · ${t.slice(0, 160)}` : ''}`;
};

// ------------------------------------------------------------------ conversas

export function garantirConversa(perfilId, igsid, { metaId = null } = {}) {
  run('INSERT INTO ig_conversas (perfil_id, igsid, meta_id) VALUES (?, ?, ?) ON CONFLICT(perfil_id, igsid) DO NOTHING', [perfilId, String(igsid), metaId]);
  const c = get('SELECT * FROM ig_conversas WHERE perfil_id = ? AND igsid = ?', [perfilId, String(igsid)]);
  if (metaId && !c.meta_id) run('UPDATE ig_conversas SET meta_id = ? WHERE id = ?', [metaId, c.id]);
  return c;
}

export function obterConversa(id) {
  const c = get('SELECT * FROM ig_conversas WHERE id = ?', [id]);
  if (!c) throw new ErroHttp(404, 'Conversa não encontrada');
  return c;
}

/** Janela para responder: 24 h depois da última mensagem da pessoa (7 dias quando veio de anúncio click-to-Direct) */
export function janelaDaConversa(c, agoraMs = Date.now()) {
  if (!c?.ultima_dele_em) return { aberta: false, fecha_em: null, horas_restantes: 0 };
  const limiteMs = c.anuncio_id ? JANELA_ANUNCIO_DIAS * 86400000 : JANELA_HORAS * 3600000;
  const fecha = new Date(c.ultima_dele_em).getTime() + limiteMs;
  return { aberta: fecha > agoraMs, fecha_em: new Date(fecha).toISOString(), horas_restantes: Math.max(0, (fecha - agoraMs) / 3600000) };
}

function atualizarResumoDaConversa(conversaId) {
  const ultima = get('SELECT tipo, texto, de_mim, timestamp FROM ig_mensagens WHERE conversa_id = ? AND apagada_em IS NULL ORDER BY timestamp DESC, id DESC LIMIT 1', [conversaId]);
  const dele = get('SELECT max(timestamp) AS t FROM ig_mensagens WHERE conversa_id = ? AND de_mim = 0', [conversaId])?.t || null;
  const primeira = get('SELECT min(timestamp) AS t FROM ig_mensagens WHERE conversa_id = ?', [conversaId])?.t || null;
  run('UPDATE ig_conversas SET ultima_em = ?, ultima_previa = ?, ultima_minha = ?, ultima_dele_em = ?, primeira_em = ? WHERE id = ?', [
    ultima?.timestamp || null, ultima ? previaDe(ultima.tipo, ultima.texto) : null, ultima?.de_mim ? 1 : 0, dele, primeira, conversaId,
  ]);
}

// ------------------------------------------------------------------ gravar mensagens

// Envios pelo CRM em andamento: o "eco" do webhook pode chegar antes da resposta da Meta com o id da mensagem
const enviando = new Map(); // conversaId → instante

/**
 * Grava uma mensagem (sem duplicar pelo mid). dados:
 *  { igsid, mid, deMim, timestamp, texto, anexos: [{ tipo, url, mime }], story: { tipo: 'resposta'|'mencao', url, id },
 *    respostaMid, referral, naoSuportada, origem, enviadoPor, status, metaConversaId }
 * opcoes.aoVivo: avisa a tela, a Alice e o resto do CRM (mensagem nova de verdade, não histórico)
 * Devolve { mensagem, nova }.
 */
export function registrarMensagem(perfil, dados, { aoVivo = false } = {}) {
  const conversa = garantirConversa(perfil.id, dados.igsid, { metaId: dados.metaConversaId || null });
  const existente = dados.mid ? get('SELECT * FROM ig_mensagens WHERE mid = ?', [dados.mid]) : null;
  if (existente) {
    // Atualizações que podem chegar depois (edição, mídia que faltava)
    const campos = {};
    if (dados.texto && dados.texto !== existente.texto && dados.editada) { campos.texto = dados.texto; campos.editada_em = agora(); }
    if (dados.apagada && !existente.apagada_em) campos.apagada_em = agora();
    if (Object.keys(campos).length) {
      run(`UPDATE ig_mensagens SET ${Object.keys(campos).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(campos), existente.id]);
      atualizarResumoDaConversa(conversa.id);
      emitir('instagram', { conversa: conversa.id });
    }
    return { mensagem: existente, nova: false };
  }
  const anexos = (dados.anexos || []).map((a) => ({ tipo: a.tipo, url: a.url || null, mime: a.mime || null, nome: a.nome || null, local: null }));
  const tipo = tipoDaMensagem({ texto: dados.texto, anexos, story: dados.story, naoSuportada: dados.naoSuportada });
  const timestamp = dados.timestamp || agora();
  const id = Number(run(
    `INSERT INTO ig_mensagens (conversa_id, mid, de_mim, tipo, texto, anexos, story_url, story_id, resposta_mid, referral, origem, enviado_por, status, timestamp, apagada_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conversa.id, dados.mid || null, dados.deMim ? 1 : 0, tipo, dados.texto || null, JSON.stringify(anexos),
      dados.story?.url || null, dados.story?.id || null, dados.respostaMid || null, dados.referral ? JSON.stringify(dados.referral) : null,
      dados.deMim ? dados.origem || 'celular' : null, dados.enviadoPor || null, dados.deMim ? dados.status ?? 2 : null, timestamp,
      dados.apagada ? agora() : null,
    ]
  ).lastInsertRowid);

  // Anúncio que trouxe a conversa (click-to-Direct)
  if (dados.referral?.ad_id && !conversa.anuncio_id) {
    run('UPDATE ig_conversas SET anuncio_id = ?, anuncio_titulo = ?, origem = ? WHERE id = ?', [
      String(dados.referral.ad_id), dados.referral.ads_context_data?.ad_title || null, 'anuncio', conversa.id,
    ]);
  } else if (dados.referral && !conversa.origem) {
    run('UPDATE ig_conversas SET origem = ? WHERE id = ?', [String(dados.referral.source || 'link').toLowerCase().slice(0, 40), conversa.id]);
  }

  if (!dados.deMim) {
    run('UPDATE ig_conversas SET nao_lidas = nao_lidas + 1, arquivada = 0 WHERE id = ?', [conversa.id]);
  } else if (conversa.lead_id) {
    registrarContatoLead(conversa.lead_id, timestamp);
  }
  atualizarResumoDaConversa(conversa.id);
  const mensagem = get('SELECT * FROM ig_mensagens WHERE id = ?', [id]);

  // Mídias: os links da Meta expiram, então o CRM baixa logo
  if (anexos.some((a) => a.url) || dados.story?.url) baixarMidiasDaMensagem(id).catch(() => {});
  if (aoVivo) {
    emitir('instagram', { conversa: conversa.id, nova: true, perfil: perfil.id });
    if (!dados.deMim) avisarGancho('instagram:recebida', { conversaId: conversa.id, mensagemId: id, perfilId: perfil.id });
    else if (mensagem.origem === 'celular') avisarGancho('instagram:humana', { conversaId: conversa.id, mensagemId: id });
  }
  // Nome, @ e foto de quem falou (uma vez a cada poucos dias)
  garantirContato(perfil, dados.igsid).catch(() => {});
  return { mensagem, nova: true };
}

/** Baixa as mídias de uma mensagem (anexos e o story respondido/mencionado) para a pasta do CRM */
export async function baixarMidiasDaMensagem(mensagemId) {
  const m = get('SELECT * FROM ig_mensagens WHERE id = ?', [mensagemId]);
  if (!m) return null;
  const anexos = lerJson(m.anexos, []);
  const pasta = path.join(PASTA(), 'dm', String(m.conversa_id));
  let mudou = false;
  for (const [i, a] of anexos.entries()) {
    if (a.local || !a.url || a.erro) continue;
    try {
      const r = await baixarArquivo(a.url, path.join(pasta, `m${m.id}-${i}`), { maxBytes: MAX_ANEXO });
      a.local = path.relative(config.filesDir, r.caminho);
      a.mime = a.mime || r.mime;
      a.tamanho = r.tamanho;
    } catch (err) {
      a.erro = String(err.message || err).slice(0, 120);
    }
    mudou = true;
  }
  let storyLocal = m.story_local;
  if (m.story_url && !m.story_local) {
    try {
      const r = await baixarArquivo(m.story_url, path.join(pasta, `m${m.id}-story`), { maxBytes: MAX_ANEXO });
      storyLocal = path.relative(config.filesDir, r.caminho);
      mudou = true;
    } catch { /* story pode ter expirado */ }
  }
  if (mudou) {
    run('UPDATE ig_mensagens SET anexos = ?, story_local = ? WHERE id = ?', [JSON.stringify(anexos), storyLocal || null, m.id]);
    emitir('instagram', { conversa: m.conversa_id, midia: m.id });
  }
  return get('SELECT * FROM ig_mensagens WHERE id = ?', [mensagemId]);
}

/** Arquivo local de um anexo (indice) ou do story (indice = 'story') */
export function arquivoDaMidia(mensagemId, indice) {
  const m = get('SELECT anexos, story_local FROM ig_mensagens WHERE id = ?', [mensagemId]);
  if (!m) return null;
  let rel = null;
  let mime = null;
  if (indice === 'story') rel = m.story_local;
  else {
    const a = lerJson(m.anexos, [])[Number(indice) || 0];
    rel = a?.local || null;
    mime = a?.mime || null;
  }
  if (!rel) return null;
  const caminho = path.join(config.filesDir, rel);
  return fs.existsSync(caminho) ? { caminho, mime } : null;
}

// ------------------------------------------------------------------ contatos (quem falou)

const CONTATO_VALIDO_MS = 3 * 86400000;

export async function garantirContato(perfil, igsid, { forcar = false } = {}) {
  const atual = get('SELECT * FROM ig_contatos WHERE perfil_id = ? AND igsid = ?', [perfil.id, String(igsid)]);
  if (!forcar && atual?.atualizado_em && Date.now() - new Date(atual.atualizado_em).getTime() < CONTATO_VALIDO_MS) return atual;
  if (!forcar && atual && !atual.atualizado_em) return atual; // busca em andamento
  run('INSERT INTO ig_contatos (perfil_id, igsid) VALUES (?, ?) ON CONFLICT(perfil_id, igsid) DO NOTHING', [perfil.id, String(igsid)]);
  let d;
  try {
    d = await chamar(String(igsid), {
      token: tokenDoPerfil(perfil),
      params: { fields: 'name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user' },
    });
  } catch {
    try {
      d = await chamar(String(igsid), { token: tokenDoPerfil(perfil), params: { fields: 'name,username,profile_pic' } });
    } catch {
      run('UPDATE ig_contatos SET atualizado_em = ? WHERE perfil_id = ? AND igsid = ?', [agora(), perfil.id, String(igsid)]);
      return get('SELECT * FROM ig_contatos WHERE perfil_id = ? AND igsid = ?', [perfil.id, String(igsid)]);
    }
  }
  let fotoLocal = atual?.foto_local || null;
  if (d.profile_pic && d.profile_pic !== atual?.foto_url) {
    try {
      const r = await baixarArquivo(d.profile_pic, path.join(PASTA(), 'contatos', String(perfil.id), String(igsid).replace(/\W/g, '')), { maxBytes: 3 * 1024 * 1024 });
      fotoLocal = path.relative(config.filesDir, r.caminho);
    } catch { /* sem foto */ }
  }
  run(
    `UPDATE ig_contatos SET username = ?, nome = ?, foto_url = ?, foto_local = ?, seguidores = ?, segue_perfil = ?, perfil_segue = ?, verificado = ?, atualizado_em = ?
      WHERE perfil_id = ? AND igsid = ?`,
    [
      d.username || atual?.username || null, d.name || atual?.nome || null, d.profile_pic || null, fotoLocal,
      d.follower_count ?? null, d.is_user_follow_business === undefined ? null : d.is_user_follow_business ? 1 : 0,
      d.is_business_follow_user === undefined ? null : d.is_business_follow_user ? 1 : 0, d.is_verified_user ? 1 : 0, agora(),
      perfil.id, String(igsid),
    ]
  );
  emitir('instagram', { contato: igsid });
  return get('SELECT * FROM ig_contatos WHERE perfil_id = ? AND igsid = ?', [perfil.id, String(igsid)]);
}

export function arquivoFotoContato(conversaId) {
  const c = get('SELECT k.foto_local FROM ig_conversas c JOIN ig_contatos k ON k.perfil_id = c.perfil_id AND k.igsid = c.igsid WHERE c.id = ?', [conversaId]);
  if (!c?.foto_local) return null;
  const caminho = path.join(config.filesDir, c.foto_local);
  return fs.existsSync(caminho) ? caminho : null;
}

// ------------------------------------------------------------------ webhook (messaging)

/**
 * Um evento de "messaging" do webhook do Instagram. perfil = perfil dono da conta.
 * Trata: message (texto, anexos, story, eco das nossas, apagada, não suportada), read, reaction, postback, referral, message_edit.
 */
export async function processarEventoDoWebhook(perfil, ev) {
  const nossoId = String(perfil.ig_id);
  const remetente = String(ev?.sender?.id || '');
  const destinatario = String(ev?.recipient?.id || '');
  const deMim = remetente === nossoId || Boolean(ev?.message?.is_echo);
  const igsid = deMim ? destinatario : remetente;
  if (!igsid || igsid === nossoId) return null;
  const timestamp = dataMeta(ev.timestamp) || agora();
  const aoVivo = Date.now() - new Date(timestamp).getTime() < AO_VIVO_MS;

  if (ev.message) {
    const m = ev.message;
    // Eco de uma mensagem que o próprio CRM acabou de mandar: espera a gravação do envio para não contar como "celular"
    if (deMim && m.mid && !get('SELECT 1 AS ok FROM ig_mensagens WHERE mid = ?', [m.mid])) {
      const conversa = get('SELECT id FROM ig_conversas WHERE perfil_id = ? AND igsid = ?', [perfil.id, igsid]);
      if (conversa && enviando.has(conversa.id)) await esperar(4000);
    }
    const story = m.reply_to?.story ? { tipo: 'resposta', url: m.reply_to.story.url || null, id: m.reply_to.story.id || null } : null;
    let anexos = anexosDoWebhook(m.attachments);
    let mencao = null;
    if (anexos.some((a) => a.tipo === 'story_mencao')) {
      const a = anexos.find((x) => x.tipo === 'story_mencao');
      mencao = { tipo: 'mencao', url: a.url, id: null };
      anexos = anexos.filter((x) => x !== a);
    }
    return registrarMensagem(perfil, {
      igsid, mid: m.mid, deMim, timestamp, texto: m.text || null, anexos, story: story || mencao,
      respostaMid: m.reply_to?.mid || null, referral: m.referral || ev.referral || null,
      naoSuportada: Boolean(m.is_unsupported), apagada: Boolean(m.is_deleted), origem: deMim ? 'celular' : null,
    }, { aoVivo });
  }
  if (ev.read?.mid || ev.read?.watermark) {
    const conversa = get('SELECT id FROM ig_conversas WHERE perfil_id = ? AND igsid = ?', [perfil.id, igsid]);
    if (conversa) {
      const ate = ev.read.mid ? get('SELECT timestamp FROM ig_mensagens WHERE mid = ?', [ev.read.mid])?.timestamp : dataMeta(ev.read.watermark);
      run('UPDATE ig_mensagens SET status = 4 WHERE conversa_id = ? AND de_mim = 1 AND status = 2 AND timestamp <= ?', [conversa.id, ate || timestamp]);
      emitir('instagram', { conversa: conversa.id, lida: true });
    }
    return null;
  }
  if (ev.reaction?.mid) {
    const alvo = get('SELECT id, reacoes FROM ig_mensagens WHERE mid = ?', [ev.reaction.mid]);
    if (alvo) {
      const reacoes = lerJson(alvo.reacoes, {}) || {};
      const quem = deMim ? 'eu' : 'contato';
      if (ev.reaction.action === 'unreact') delete reacoes[quem];
      else reacoes[quem] = ev.reaction.emoji || (ev.reaction.reaction === 'love' ? '❤️' : '👍');
      run('UPDATE ig_mensagens SET reacoes = ? WHERE id = ?', [JSON.stringify(reacoes), alvo.id]);
      const c = get('SELECT conversa_id FROM ig_mensagens WHERE id = ?', [alvo.id]);
      emitir('instagram', { conversa: c.conversa_id });
    }
    return null;
  }
  if (ev.postback) {
    return registrarMensagem(perfil, { igsid, mid: ev.postback.mid || null, deMim: false, timestamp, texto: ev.postback.title || ev.postback.payload || '' }, { aoVivo });
  }
  if (ev.message_edit?.mid) {
    const alvo = get('SELECT id, conversa_id FROM ig_mensagens WHERE mid = ?', [ev.message_edit.mid]);
    if (alvo) {
      run('UPDATE ig_mensagens SET texto = ?, editada_em = ? WHERE id = ?', [ev.message_edit.text ?? null, agora(), alvo.id]);
      atualizarResumoDaConversa(alvo.conversa_id);
      emitir('instagram', { conversa: alvo.conversa_id });
    }
    return null;
  }
  if (ev.referral) {
    const conversa = garantirConversa(perfil.id, igsid);
    if (ev.referral.ad_id && !conversa.anuncio_id) {
      run('UPDATE ig_conversas SET anuncio_id = ?, anuncio_titulo = ?, origem = ? WHERE id = ?', [
        String(ev.referral.ad_id), ev.referral.ads_context_data?.ad_title || null, 'anuncio', conversa.id,
      ]);
    }
    return null;
  }
  return null;
}

// ------------------------------------------------------------------ busca pela API de conversas

const CAMPOS_MSG = 'id,created_time,from,to,message,attachments,story,shares,is_unsupported';
const CAMPOS_MSG_MINIMOS = 'id,created_time,from,to,message,attachments';

async function mensagensDaConversaMeta(token, metaId) {
  try {
    const r = await chamar(metaId, { token, params: { fields: `messages.limit(20){${CAMPOS_MSG}}` } });
    return r?.messages?.data || [];
  } catch (err) {
    if (err instanceof ErroMeta && err.tipo === 'parametro') {
      const r = await chamar(metaId, { token, params: { fields: `messages.limit(20){${CAMPOS_MSG_MINIMOS}}` } });
      return r?.messages?.data || [];
    }
    throw err;
  }
}

/** Mensagem da API de conversas → dados de registrarMensagem */
function dadosDaMensagemApi(perfil, m, metaConversaId) {
  const deMim = String(m.from?.id || '') === String(perfil.ig_id);
  const outro = deMim ? (m.to?.data || []).find((x) => String(x.id) !== String(perfil.ig_id)) : m.from;
  if (!outro?.id) return null;
  let story = null;
  if (m.story?.reply_to?.link) story = { tipo: 'resposta', url: m.story.reply_to.link, id: m.story.reply_to.id || null };
  else if (m.story?.mention?.link) story = { tipo: 'mencao', url: m.story.mention.link, id: m.story.mention.id || null };
  const anexos = anexosDaApi(m.attachments);
  for (const s of m.shares?.data || []) if (s.link) anexos.push({ tipo: 'compartilhamento', url: s.link, nome: s.name || null });
  return {
    igsid: String(outro.id), username: outro.username || null, mid: m.id, deMim, timestamp: dataMeta(m.created_time),
    texto: m.message || null, anexos, story, naoSuportada: Boolean(m.is_unsupported), origem: deMim ? 'celular' : null, metaConversaId,
  };
}

/**
 * Busca conversas e mensagens pela API (a cada minuto, se o webhook não estiver chegando; e na conexão, com histórico).
 *  historico: lista todas as conversas (a Meta só entrega as 20 mensagens mais recentes de cada uma)
 */
export async function sincronizarDirect(perfilId, { historico = false } = {}) {
  const perfil = obterPerfil(perfilId);
  if (!perfil.ativo || perfilPausado(perfil)) return { conversas: 0, mensagens: 0 };
  const token = tokenDoPerfil(perfil);
  const desde = historico ? null : perfil.sync_direct_em;
  let conversas;
  try {
    conversas = await paginar(`${perfil.page_id}/conversations`, {
      token, params: { platform: 'instagram', fields: 'id,updated_time,participants', limit: historico ? 50 : 25 },
    }, {
      max: historico ? 3000 : 100,
      // Sem histórico: para na primeira conversa que não mudou desde a última busca (a lista vem da mais recente)
      parar: desde ? (c) => (dataMeta(c.updated_time) || '') < desde : null,
    });
  } catch (err) {
    registrarErro(perfilId, 'Direct', err);
    throw err;
  }
  const inicio = agora();
  let novas = 0;
  let lidas = 0;
  for (const c of conversas) {
    const atualizada = dataMeta(c.updated_time);
    if (!historico && desde && atualizada && atualizada < desde) continue;
    const outro = (c.participants?.data || []).find((p) => String(p.id) !== String(perfil.ig_id));
    if (outro?.id) {
      const local = get('SELECT id, sync_em FROM ig_conversas WHERE perfil_id = ? AND igsid = ?', [perfil.id, String(outro.id)]);
      if (local?.sync_em && atualizada && atualizada <= local.sync_em) continue;
      if (outro.username) {
        run('INSERT INTO ig_contatos (perfil_id, igsid, username) VALUES (?, ?, ?) ON CONFLICT(perfil_id, igsid) DO UPDATE SET username = COALESCE(ig_contatos.username, excluded.username)', [perfil.id, String(outro.id), outro.username]);
      }
    }
    let mensagens;
    try {
      mensagens = await mensagensDaConversaMeta(token, c.id);
    } catch (err) {
      if (err.limite) { registrarErro(perfilId, 'Direct', err); break; }
      continue;
    }
    lidas++;
    let igsidDaConversa = outro?.id ? String(outro.id) : null;
    for (const m of [...mensagens].reverse()) {
      const d = dadosDaMensagemApi(perfil, m, c.id);
      if (!d) continue;
      igsidDaConversa = igsidDaConversa || d.igsid;
      const aoVivo = !historico && Date.now() - new Date(d.timestamp).getTime() < AO_VIVO_MS;
      const r = registrarMensagem(perfil, d, { aoVivo });
      if (r.nova) novas++;
    }
    if (igsidDaConversa) run('UPDATE ig_conversas SET meta_id = COALESCE(meta_id, ?), sync_em = ? WHERE perfil_id = ? AND igsid = ?', [c.id, atualizada || inicio, perfil.id, igsidDaConversa]);
  }
  // Na importação do histórico, nada fica como "não lida"
  if (historico) run('UPDATE ig_conversas SET nao_lidas = 0 WHERE perfil_id = ?', [perfil.id]);
  atualizarPerfil(perfilId, { sync_direct_em: inicio, ...(historico ? { historico_direct_em: inicio } : {}) });
  limparErro(perfilId);
  if (novas) emitir('instagram', { perfil: perfilId, conversas: true });
  if (historico) registrar(perfilId, 'direct', `Histórico do Direct importado: ${lidas} conversa(s), ${novas} mensagem(ns)`);
  return { conversas: lidas, mensagens: novas };
}

// ------------------------------------------------------------------ envio

/** Divide um texto em partes de até 1.000 bytes (limite do Instagram), quebrando em parágrafo, frase ou espaço */
export function dividirTexto(texto, maxBytes = MAX_BYTES_TEXTO) {
  const partes = [];
  let resto = String(texto || '').trim();
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  while (resto && bytes(resto) > maxBytes) {
    let corte = resto.length;
    while (corte > 0 && bytes(resto.slice(0, corte)) > maxBytes) corte = Math.floor(corte * 0.9);
    const trecho = resto.slice(0, corte);
    const quebra = Math.max(trecho.lastIndexOf('\n\n'), trecho.lastIndexOf('\n'), trecho.lastIndexOf('. '), trecho.lastIndexOf(' '));
    const fim = quebra > corte * 0.5 ? quebra + 1 : corte;
    partes.push(resto.slice(0, fim).trim());
    resto = resto.slice(fim).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

let envioFalso = null;
/** Testes: troca o envio real por fn({ perfil, igsid, mensagem }) => { message_id } */
export function definirEnvioFalso(fn) { envioFalso = fn; }

async function postarMensagem(perfil, igsid, mensagem) {
  if (envioFalso) return envioFalso({ perfil, igsid, mensagem });
  return chamar(`${perfil.page_id}/messages`, {
    metodo: 'POST', token: tokenDoPerfil(perfil),
    corpo: { recipient: { id: igsid }, messaging_type: 'RESPONSE', message: mensagem },
  });
}

const tipoDeEnvio = (mime) => (/^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'file');
const tipoLocal = { image: 'imagem', video: 'video', audio: 'audio', file: 'arquivo' };

/**
 * Envia pelo Direct. conteudo: { texto } ou { arquivo: { caminho, mime, nome }, texto? (legenda vai como mensagem separada) }
 * opcoes: { userId, origem: 'crm' | 'ia' | 'assistente' }
 * Devolve as mensagens gravadas.
 */
export async function enviar(conversaId, conteudo, { userId = null, origem = 'crm' } = {}) {
  const conversa = obterConversa(conversaId);
  const perfil = obterPerfil(conversa.perfil_id);
  if (!perfil.ativo) throw new ErroHttp(409, 'Este perfil está desconectado');
  const janela = janelaDaConversa(conversa);
  if (!janela.aberta) {
    throw new ErroHttp(409, conversa.ultima_dele_em
      ? 'Passou o prazo do Instagram para responder (24 horas desde a última mensagem da pessoa). Só dá para responder quando ela escrever de novo.'
      : 'A pessoa ainda não mandou mensagem: pelo Instagram só dá para responder quem escreveu.');
  }
  const gravadas = [];
  enviando.set(conversa.id, Date.now());
  try {
    if (conteudo.arquivo) {
      const { caminho, mime, nome } = conteudo.arquivo;
      const tipo = tipoDeEnvio(mime);
      const url = envioFalso ? 'https://exemplo.invalid/arquivo' : linkPublico(caminho, mime);
      const r = await postarMensagem(perfil, conversa.igsid, { attachment: { type: tipo, payload: { url, is_reusable: false } } });
      // Guarda uma cópia na pasta da conversa (o arquivo enviado aparece no chat)
      const pasta = path.join(PASTA(), 'dm', String(conversa.id));
      fs.mkdirSync(pasta, { recursive: true });
      const destino = path.join(pasta, `env-${Date.now()}${path.extname(caminho).slice(0, 6)}`);
      fs.copyFileSync(caminho, destino);
      const { mensagem } = registrarMensagem(perfil, {
        igsid: conversa.igsid, mid: r?.message_id || null, deMim: true, timestamp: agora(), texto: null,
        anexos: [{ tipo: tipoLocal[tipo], url: null, mime, nome: nome || null }], origem, enviadoPor: userId, status: 2,
      }, { aoVivo: true });
      const anexos = lerJson(mensagem.anexos, []);
      if (anexos[0]) { anexos[0].local = path.relative(config.filesDir, destino); anexos[0].tamanho = fs.statSync(destino).size; }
      run('UPDATE ig_mensagens SET anexos = ? WHERE id = ?', [JSON.stringify(anexos), mensagem.id]);
      gravadas.push(mensagem);
    }
    for (const parte of dividirTexto(conteudo.texto || '')) {
      const r = await postarMensagem(perfil, conversa.igsid, { text: parte });
      const { mensagem } = registrarMensagem(perfil, {
        igsid: conversa.igsid, mid: r?.message_id || null, deMim: true, timestamp: agora(), texto: parte, origem, enviadoPor: userId, status: 2,
      }, { aoVivo: true });
      gravadas.push(mensagem);
    }
  } catch (err) {
    if (err instanceof ErroMeta) {
      registrar(perfil.id, 'erro', `Envio no Direct: ${err.message}`);
      if (err.tipo === 'janela') throw new ErroHttp(409, err.message);
      throw new ErroHttp(err.status && err.status < 500 ? err.status : 422, err.message);
    }
    throw err;
  } finally {
    setTimeout(() => enviando.delete(conversa.id), 6000).unref?.();
  }
  if (!gravadas.length) throw new ErroHttp(400, 'Nada para enviar');
  // Mensagem da equipe pelo CRM: a pessoa foi respondida (some o "aguardando" e a Alice para)
  if (origem === 'crm') {
    run('UPDATE ig_conversas SET nao_lidas = 0, marcada_nao_lida = 0, aguardando_desde = NULL, aguardando_nota = NULL WHERE id = ?', [conversa.id]);
    avisarGancho('instagram:humana', { conversaId: conversa.id, userId });
  }
  emitir('instagram', { conversa: conversa.id });
  return gravadas;
}

// ------------------------------------------------------------------ lista e mensagens para a tela

const FILTROS = {
  todas: 'c.arquivada = 0',
  nao_lidas: 'c.arquivada = 0 AND (c.nao_lidas > 0 OR c.marcada_nao_lida = 1)',
  leads: 'c.arquivada = 0 AND c.lead_id IS NOT NULL',
  nao_leads: 'c.arquivada = 0 AND c.lead_id IS NULL',
  alice: "c.arquivada = 0 AND ia.status = 'ativa'",
  aguardando: "c.arquivada = 0 AND (c.aguardando_desde IS NOT NULL OR ia.status = 'aguardando_humano' OR EXISTS (SELECT 1 FROM ig_ia_sugestoes s WHERE s.conversa_id = c.id AND s.status = 'pendente'))",
  responder: 'c.arquivada = 0 AND c.ultima_minha = 0 AND c.ultima_dele_em IS NOT NULL',
  anuncios: 'c.arquivada = 0 AND c.anuncio_id IS NOT NULL',
  arquivadas: 'c.arquivada = 1',
};

export function listarConversas({ perfilId = null, filtro = 'todas', busca = '', limite = 500 } = {}) {
  const where = [FILTROS[filtro] || FILTROS.todas, 'c.ultima_em IS NOT NULL', 'p.ativo = 1'];
  const valores = [];
  if (perfilId) { where.push('c.perfil_id = ?'); valores.push(perfilId); }
  const termo = String(busca || '').trim();
  if (termo) {
    const like = `%${termo.replace(/[%_]/g, '')}%`;
    where.push(`(k.username LIKE ? OR k.nome LIKE ? OR l.name LIKE ? OR EXISTS (SELECT 1 FROM ig_mensagens m WHERE m.conversa_id = c.id AND (m.texto LIKE ? OR m.transcricao LIKE ?)))`);
    valores.push(like, like, like, like, like);
  }
  const linhas = all(
    `SELECT c.*, p.username AS perfil_username, k.username, k.nome, k.foto_local, k.seguidores, k.segue_perfil, k.verificado,
            l.name AS lead_nome, l.phone AS lead_telefone, s.name AS etapa_nome, s.color AS etapa_cor, s.kind AS etapa_tipo,
            ia.status AS ia_status, ia.motivo AS ia_motivo,
            (SELECT count(*) FROM ig_ia_sugestoes sg WHERE sg.conversa_id = c.id AND sg.status = 'pendente') AS sugestoes
       FROM ig_conversas c
       JOIN ig_perfis p ON p.id = c.perfil_id
       LEFT JOIN ig_contatos k ON k.perfil_id = c.perfil_id AND k.igsid = c.igsid
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN stages s ON s.id = l.stage_id
       LEFT JOIN ig_ia ia ON ia.conversa_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY c.fixada DESC, c.ultima_em DESC LIMIT ?`,
    [...valores, limite]
  );
  const arquivadas = get(`SELECT count(*) AS n FROM ig_conversas c JOIN ig_perfis p ON p.id = c.perfil_id WHERE c.arquivada = 1 AND p.ativo = 1 ${perfilId ? 'AND c.perfil_id = ?' : ''}`, perfilId ? [perfilId] : []).n;
  return { conversas: linhas.map(conversaParaTela), arquivadas };
}

export function conversaParaTela(c) {
  const janela = janelaDaConversa(c);
  return {
    id: c.id, perfil_id: c.perfil_id, perfil_username: c.perfil_username, igsid: c.igsid,
    username: c.username || null, nome: c.nome || c.lead_nome || null, foto: Boolean(c.foto_local),
    seguidores: c.seguidores ?? null, segue_perfil: c.segue_perfil === null || c.segue_perfil === undefined ? null : Boolean(c.segue_perfil),
    verificado: Boolean(c.verificado),
    lead_id: c.lead_id, lead_nome: c.lead_nome || null, lead_telefone: c.lead_telefone || null,
    etapa: c.lead_id ? { nome: c.etapa_nome, cor: c.etapa_cor, tipo: c.etapa_tipo } : null,
    ultima_em: c.ultima_em, ultima_previa: c.ultima_previa, ultima_minha: Boolean(c.ultima_minha), ultima_dele_em: c.ultima_dele_em,
    nao_lidas: c.nao_lidas, marcada_nao_lida: Boolean(c.marcada_nao_lida), arquivada: Boolean(c.arquivada), fixada: Boolean(c.fixada),
    aguardando: Boolean(c.aguardando_desde) || c.ia_status === 'aguardando_humano', aguardando_nota: c.aguardando_nota,
    anuncio_id: c.anuncio_id, anuncio_titulo: c.anuncio_titulo, origem: c.origem,
    janela, ia_status: c.ia_status || null, ia_motivo: c.ia_motivo || null, sugestoes: c.sugestoes || 0,
  };
}

export function conversaCompleta(conversaId) {
  const c = get(
    `SELECT c.*, p.username AS perfil_username, k.username, k.nome, k.foto_local, k.seguidores, k.segue_perfil, k.verificado,
            l.name AS lead_nome, l.phone AS lead_telefone, s.name AS etapa_nome, s.color AS etapa_cor, s.kind AS etapa_tipo,
            ia.status AS ia_status, ia.motivo AS ia_motivo,
            (SELECT count(*) FROM ig_ia_sugestoes sg WHERE sg.conversa_id = c.id AND sg.status = 'pendente') AS sugestoes
       FROM ig_conversas c JOIN ig_perfis p ON p.id = c.perfil_id
       LEFT JOIN ig_contatos k ON k.perfil_id = c.perfil_id AND k.igsid = c.igsid
       LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN stages s ON s.id = l.stage_id
       LEFT JOIN ig_ia ia ON ia.conversa_id = c.id
      WHERE c.id = ?`,
    [conversaId]
  );
  if (!c) throw new ErroHttp(404, 'Conversa não encontrada');
  return conversaParaTela(c);
}

export function mensagemParaTela(m) {
  const anexos = lerJson(m.anexos, []).map((a, i) => ({ indice: i, tipo: a.tipo, mime: a.mime || null, nome: a.nome || null, tamanho: a.tamanho || null, pronto: Boolean(a.local), erro: a.erro || null, link: a.tipo === 'compartilhamento' ? a.url : null }));
  return {
    id: m.id, mid: m.mid, de_mim: Boolean(m.de_mim), tipo: m.tipo, texto: m.texto, anexos,
    story: m.story_url || m.story_local ? { pronto: Boolean(m.story_local), id: m.story_id } : null,
    resposta_mid: m.resposta_mid, reacoes: lerJson(m.reacoes, null), origem: m.origem, enviado_por: m.enviado_por_nome || null,
    status: m.status, erro: m.erro, apagada: Boolean(m.apagada_em), editada: Boolean(m.editada_em), transcricao: m.transcricao || null,
    referral: lerJson(m.referral, null), timestamp: m.timestamp,
  };
}

export function mensagensDaConversa(conversaId, { antes = null, limite = 80, marcarLidas = true } = {}) {
  obterConversa(conversaId);
  const linhas = all(
    `SELECT * FROM (SELECT m.*, u.name AS enviado_por_nome FROM ig_mensagens m LEFT JOIN users u ON u.id = m.enviado_por
        WHERE m.conversa_id = ? ${antes ? 'AND m.timestamp < ?' : ''} ORDER BY m.timestamp DESC, m.id DESC LIMIT ?)
      ORDER BY timestamp ASC, id ASC`,
    antes ? [conversaId, antes, limite + 1] : [conversaId, limite + 1]
  );
  const temMais = linhas.length > limite;
  if (marcarLidas) run('UPDATE ig_conversas SET nao_lidas = 0, marcada_nao_lida = 0 WHERE id = ? AND (nao_lidas > 0 OR marcada_nao_lida = 1)', [conversaId]);
  return { mensagens: (temMais ? linhas.slice(1) : linhas).map(mensagemParaTela), tem_mais: temMais };
}

/** Arquivar, fixar, marcar não lida, aguardando minha resposta */
export function definirEstado(conversaId, mudanca = {}, userId = null) {
  const c = obterConversa(conversaId);
  const sets = {};
  if (mudanca.arquivada !== undefined) sets.arquivada = mudanca.arquivada ? 1 : 0;
  if (mudanca.fixada !== undefined) sets.fixada = mudanca.fixada ? 1 : 0;
  if (mudanca.nao_lida !== undefined) {
    sets.marcada_nao_lida = mudanca.nao_lida ? 1 : 0;
    if (!mudanca.nao_lida) sets.nao_lidas = 0;
  }
  if (mudanca.aguardando !== undefined) {
    sets.aguardando_desde = mudanca.aguardando ? c.aguardando_desde || agora() : null;
    sets.aguardando_nota = mudanca.aguardando ? String(mudanca.nota || '').slice(0, 300) || null : null;
    if (!mudanca.aguardando) run("UPDATE ig_ia SET status = 'humano', motivo = 'Equipe marcou como resolvido', proxima_em = NULL WHERE conversa_id = ? AND status = 'aguardando_humano'", [conversaId]);
  }
  if (!Object.keys(sets).length) return conversaCompleta(conversaId);
  run(`UPDATE ig_conversas SET ${Object.keys(sets).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(sets), conversaId]);
  if (c.lead_id && mudanca.aguardando === false) run("UPDATE leads SET waiting_since = NULL, waiting_note = NULL, updated_at = ? WHERE id = ? AND waiting_note LIKE 'IA (Instagram)%'", [agora(), c.lead_id]);
  emitir('instagram', { conversa: conversaId });
  void userId;
  return conversaCompleta(conversaId);
}

// ------------------------------------------------------------------ leads

/** Nome para o lead: nome do perfil, senão o @ */
function nomeDoContato(c) {
  const k = get('SELECT username, nome FROM ig_contatos WHERE perfil_id = ? AND igsid = ?', [c.perfil_id, c.igsid]);
  return { nome: k?.nome || (k?.username ? `@${k.username}` : null), username: k?.username || null };
}

/**
 * Liga a conversa a um lead. Sem telefone: cria o lead (origem Instagram). Com telefone: usa o lead que já tem o mesmo
 * telefone (com e sem o 9º dígito) ou cria um novo — as conversas do WhatsApp desse telefone se ligam sozinhas.
 * dados: { telefone, nome, extra } · Devolve { leadId, novo }.
 */
export function ligarAoLead(conversaId, { telefone = null, nome = null, extra = {}, userId = null, origemEvento = 'manual' } = {}) {
  const c = obterConversa(conversaId);
  const perfil = obterPerfil(c.perfil_id);
  const contato = nomeDoContato(c);
  const phone = telefone ? normalizarTelefone(telefone) : null;
  const infoIg = { username: contato.username, igsid: c.igsid, perfil: perfil.username, perfil_id: perfil.id, conversa_id: c.id };
  return tx(() => {
    let leadId = c.lead_id || (phone ? encontrarExistente({ phone, email: null }) : null);
    let novo = false;
    if (leadId) {
      const atual = get('SELECT extra, phone, name FROM leads WHERE id = ?', [leadId]);
      const ex = lerJson(atual?.extra, {}) || {};
      const novoExtra = { ...ex, instagram: { ...(ex.instagram || {}), ...infoIg }, ...Object.fromEntries(Object.entries(extra || {}).filter(([k]) => ex[k] === undefined)) };
      run('UPDATE leads SET extra = ?, phone = COALESCE(phone, ?), name = COALESCE(name, ?), updated_at = ? WHERE id = ?', [
        JSON.stringify(novoExtra), phone, nome || contato.nome, agora(), leadId,
      ]);
      if (phone && !atual?.phone) {
        // Telefone novo no lead: liga as conversas do WhatsApp desse número
        import('../whatsapp/ligacao.js').then(({ ligarConversasDoLead }) => ligarConversasDoLead(leadId, phone)).catch(() => {});
      }
      registrarEvento({ leadId, userId, type: 'instagram_ligado', data: { perfil: perfil.username, username: contato.username, origem: origemEvento } });
    } else {
      leadId = criarLead({ name: nome || contato.nome, phone, source: 'instagram', extra: { instagram: infoIg, ...(extra || {}) } }, { userId });
      novo = true;
    }
    run('UPDATE ig_conversas SET lead_id = ? WHERE id = ?', [leadId, c.id]);
    // Mensagens nossas já trocadas contam como contato com o lead (follow-up e estatísticas)
    const ultimaNossa = get('SELECT max(timestamp) AS t FROM ig_mensagens WHERE conversa_id = ? AND de_mim = 1', [c.id])?.t;
    if (ultimaNossa) registrarContatoLead(leadId, ultimaNossa);
    emitir('instagram', { conversa: c.id });
    emitir('leads', { lead: leadId });
    return { leadId, novo };
  });
}

/** Ficha do contato para o painel lateral (dados do Instagram, lead, origem) */
export function dadosDoContato(conversaId) {
  const c = conversaCompleta(conversaId);
  const k = get('SELECT * FROM ig_contatos k JOIN ig_conversas c ON c.perfil_id = k.perfil_id AND c.igsid = k.igsid WHERE c.id = ?', [conversaId]);
  const midias = all("SELECT id, tipo, anexos, story_local, timestamp FROM ig_mensagens WHERE conversa_id = ? AND (anexos <> '[]' OR story_local IS NOT NULL) ORDER BY timestamp DESC LIMIT 30", [conversaId])
    .map((m) => ({ id: m.id, tipo: m.tipo, timestamp: m.timestamp, anexos: lerJson(m.anexos, []).map((a, i) => ({ indice: i, tipo: a.tipo, pronto: Boolean(a.local) })), story: Boolean(m.story_local) }));
  return {
    conversa: c,
    contato: k ? { username: k.username, nome: k.nome, seguidores: k.seguidores, segue_perfil: k.segue_perfil === null ? null : Boolean(k.segue_perfil), perfil_segue: k.perfil_segue === null ? null : Boolean(k.perfil_segue), verificado: Boolean(k.verificado), atualizado_em: k.atualizado_em } : null,
    midias,
    total_mensagens: get('SELECT count(*) AS n FROM ig_mensagens WHERE conversa_id = ?', [conversaId]).n,
  };
}

/** Encontra a conversa do Instagram ligada a um lead (para abrir a partir do kanban) */
export function conversasDoLead(leadId) {
  return all('SELECT c.id, c.perfil_id, p.username AS perfil_username, c.ultima_em FROM ig_conversas c JOIN ig_perfis p ON p.id = c.perfil_id WHERE c.lead_id = ? ORDER BY c.ultima_em DESC', [leadId]);
}

export const naoLidasTotal = () => get(
  'SELECT count(*) AS n FROM ig_conversas c JOIN ig_perfis p ON p.id = c.perfil_id WHERE p.ativo = 1 AND c.arquivada = 0 AND (c.nao_lidas > 0 OR c.marcada_nao_lida = 1)'
).n;

export { registrarErro };
