// Camada de leitura da Alice: conversas do WhatsApp (leads, contatos e grupos), mensagens em texto legível para o
// modelo, datas no fuso do usuário e quem disse o quê. Nada aqui altera o banco.
import { get, all } from '../../db.js';
import { lerJson } from '../../events.js';
import { ErroHttp, idValido, variantesTelefone } from '../../util.js';

// ------------------------------------------------------------------ datas no fuso do usuário

export function dataHora(iso, fuso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return iso; }
}

export function agoraPorExtenso(fuso, data = new Date()) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(data);
  } catch { return data.toISOString(); }
}

/**
 * Aceita "2026-11-05", "2026-11-05T08:00", ISO completo, "hoje", "ontem", "7d" (últimos 7 dias), "24h".
 * Data sem horário vale o começo do dia no fuso do usuário (ou o fim, com fimDoDia).
 */
export function interpretarData(valor, fuso, { fimDoDia = false } = {}) {
  if (valor === undefined || valor === null || valor === '') return null;
  const v = String(valor).trim().toLowerCase();
  const agora = Date.now();
  const rel = v.match(/^(\d{1,4})\s*(h|d)$/);
  if (rel) return new Date(agora - Number(rel[1]) * (rel[2] === 'h' ? 3600e3 : 86400e3)).toISOString();
  if (v === 'agora') return new Date(agora).toISOString();
  const diaNoFuso = (deslocaDias) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(agora + deslocaDias * 86400e3)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  let texto = v;
  if (v === 'hoje') texto = diaNoFuso(0);
  else if (v === 'ontem') texto = diaNoFuso(-1);
  const soDia = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const diaHora = texto.match(/^(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})$/);
  if (soDia || diaHora) {
    const [, a, m, d] = (soDia || diaHora).map(Number);
    const h = diaHora ? diaHora[4] : fimDoDia ? 23 : 0;
    const min = diaHora ? diaHora[5] : fimDoDia ? 59 : 0;
    return instanteNoFuso(a, m, d, Number(h), Number(min), fuso, fimDoDia && !diaHora ? 59.999 : 0);
  }
  const t = Date.parse(valor);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  throw new ErroHttp(400, `Data não entendida: "${valor}". Use AAAA-MM-DD, "hoje", "ontem" ou "7d".`);
}

/** Instante (ISO) de um horário de parede num fuso. */
export function instanteNoFuso(ano, mes, dia, hora, minuto, fuso, segundos = 0) {
  const chute = Date.UTC(ano, mes - 1, dia, hora, minuto, 0) + segundos * 1000;
  const deslocamento = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const primeiro = chute - deslocamento(chute);
  return new Date(chute - deslocamento(primeiro)).toISOString();
}

// ------------------------------------------------------------------ conversas

const ehGrupo = (jid) => /@g\.us$/.test(String(jid || ''));

export function interpretarConversa(chave) {
  const bruto = String(chave || '').trim();
  const [tipo, ...resto] = bruto.split(':');
  const valor = resto.join(':');
  if (tipo === 'l' && idValido(valor)) return { tipo: 'lead', leadId: idValido(valor), chave: bruto };
  if (tipo === 't' && /^\d{8,15}$/.test(valor)) return { tipo: 'telefone', phone: valor, chave: bruto };
  if (tipo === 'j' && /^[\w.:-]+@(s\.whatsapp\.net|lid)$/.test(valor)) return { tipo: 'jid', jid: valor, chave: bruto };
  if (tipo === 'g' && /^[\w.:-]+@g\.us$/.test(valor)) return { tipo: 'grupo', jid: valor, chave: bruto };
  if (/^\d+@g\.us$|^[\w-]+@g\.us$/.test(bruto)) return { tipo: 'grupo', jid: bruto, chave: `g:${bruto}` };
  return null;
}

export function filtroDaConversa(c) {
  if (c.tipo === 'lead') return { where: 'm.lead_id = ?', params: [c.leadId] };
  if (c.tipo === 'telefone') {
    const variantes = variantesTelefone(c.phone);
    return {
      where: `m.lead_id IS NULL AND m.chat_jid IN (SELECT jid FROM wa_contacts WHERE phone IN (${variantes.map(() => '?').join(',')}))`,
      params: variantes,
    };
  }
  if (c.tipo === 'grupo') return { where: 'm.chat_jid = ?', params: [c.jid] };
  return { where: 'm.lead_id IS NULL AND m.chat_jid = ?', params: [c.jid] };
}

export function nomeDaConversa(c) {
  if (c.tipo === 'lead') return get('SELECT name FROM leads WHERE id = ?', [c.leadId])?.name || `Lead ${c.leadId}`;
  if (c.tipo === 'grupo') return get('SELECT name FROM wa_chats WHERE jid = ?', [c.jid])?.name || 'Grupo sem nome';
  if (c.tipo === 'telefone') {
    return get("SELECT COALESCE(name, push_name) AS n FROM wa_contacts WHERE phone = ? AND COALESCE(name, push_name) IS NOT NULL LIMIT 1", [c.phone])?.n || `+${c.phone}`;
  }
  return get('SELECT COALESCE(name, push_name, phone) AS n FROM wa_contacts WHERE jid = ?', [c.jid])?.n || c.jid.split('@')[0];
}

export function chaveDe(jid, leadId, phone) {
  if (ehGrupo(jid)) return `g:${jid}`;
  if (leadId) return `l:${leadId}`;
  if (phone) return `t:${phone}`;
  return `j:${jid}`;
}

/**
 * Acha conversas por nome (grupo, lead ou contato), telefone ou chave. Devolve [{ chave, nome, tipo }].
 * Usado quando o modelo passa "grupo Jaqueira" em vez da chave.
 */
export function acharConversas(termo, { limite = 8 } = {}) {
  const direto = interpretarConversa(termo);
  if (direto) return [{ chave: direto.chave, nome: nomeDaConversa(direto), tipo: direto.tipo }];
  const t = String(termo || '').trim();
  if (!t) return [];
  const like = `%${t.replace(/[%_]/g, '')}%`;
  const digitos = t.replace(/\D/g, '');
  const achados = [];
  for (const g of all("SELECT jid, name FROM wa_chats WHERE is_group = 1 AND name LIKE ? ORDER BY updated_at DESC LIMIT ?", [like, limite])) {
    achados.push({ chave: `g:${g.jid}`, nome: g.name, tipo: 'grupo' });
  }
  for (const l of all(`SELECT id, name FROM leads WHERE name LIKE ? ${digitos.length >= 6 ? 'OR phone LIKE ?' : ''} ORDER BY updated_at DESC LIMIT ?`,
    digitos.length >= 6 ? [like, `%${digitos}%`, limite] : [like, limite])) {
    achados.push({ chave: `l:${l.id}`, nome: l.name || `Lead ${l.id}`, tipo: 'lead' });
  }
  for (const c of all(
    `SELECT jid, phone, COALESCE(name, push_name) AS n FROM wa_contacts
      WHERE lead_id IS NULL AND jid NOT LIKE '%@g.us' AND (COALESCE(name, push_name) LIKE ? ${digitos.length >= 6 ? 'OR phone LIKE ?' : ''}) LIMIT ?`,
    digitos.length >= 6 ? [like, `%${digitos}%`, limite] : [like, limite]
  )) {
    achados.push({ chave: chaveDe(c.jid, null, c.phone), nome: c.n || `+${c.phone}`, tipo: 'contato' });
  }
  const vistos = new Set();
  return achados.filter((a) => (vistos.has(a.chave) ? false : vistos.add(a.chave))).slice(0, limite);
}

// ------------------------------------------------------------------ mensagens em texto

const origemDe = (extra) => lerJson(extra)?.origem || null;

const ROTULO_MIDIA = { imagem: '🖼 imagem', video: '🎥 vídeo', audio: '🎤 áudio', documento: '📄 documento', figurinha: 'figurinha', localizacao: '📍 localização', contato: '👤 contato', enquete: '📊 enquete', chamada: '📞 chamada' };

/** Quem mandou a mensagem, em português */
export function autorDaMensagem(m, { nomeContato = null, usuarioId = null } = {}) {
  if (m.from_me) {
    const origem = origemDe(m.extra);
    if (origem === 'ia') return 'IA de primeiro contato';
    if (origem === 'disparo') return 'Disparo automático';
    if (origem === 'alice') return 'Assistente (Alice)';
    if (m.sent_by) return m.sent_by === usuarioId ? `${m.enviada_por || 'Você'} (você)` : (m.enviada_por || 'Equipe');
    return 'Equipe (pelo celular)';
  }
  if (m.participant_name || m.participant_jid) return m.participant_name || `+${String(m.participant_jid).split('@')[0].split(':')[0]}`;
  return nomeContato || 'Contato';
}

function duracao(s) {
  if (!s) return '';
  const min = Math.floor(s / 60);
  return ` ${min}:${String(s % 60).padStart(2, '0')}`;
}

/** Texto de uma mensagem para o modelo, com a transcrição do áudio e o texto extraído quando já existem */
export function textoDaMensagem(m) {
  if (m.deleted_at) return '[mensagem apagada]';
  if (m.type === 'texto') return m.body || '';
  const rotulo = ROTULO_MIDIA[m.type] || `[${m.type}]`;
  const partes = [`[${rotulo}${m.type === 'audio' ? duracao(m.media_seconds) : ''}${m.media_name ? ` "${m.media_name}"` : ''} · msg ${m.id}]`];
  if (m.legenda) partes.push(m.legenda);
  if (m.type === 'audio') partes.push(m.transcricao ? `Transcrição: "${m.transcricao}"` : '(áudio ainda sem transcrição: use ver_midia para ouvir)');
  else if (m.type === 'documento' && m.texto_extraido) partes.push(`Conteúdo: ${m.texto_extraido.slice(0, 1500)}${m.texto_extraido.length > 1500 ? '…' : ''}`);
  else if (m.type === 'imagem' && !m.legenda) partes.push('(use ver_midia para ver a imagem)');
  else if (!['imagem', 'figurinha', 'audio'].includes(m.type) && m.body && m.body !== m.legenda) partes.push(m.body);
  return partes.join(' ');
}

export const COLUNAS = `m.id, m.chat_jid, m.lead_id, m.from_me, m.type, m.body, m.legenda, m.timestamp, m.extra, m.sent_by, u.name AS enviada_por,
  m.participant_jid, m.participant_name, m.media_name, m.media_mime, m.media_seconds, m.deleted_at, m.transcricao, m.texto_extraido,
  m.instance_id, m.quoted_body`;

/**
 * Mensagens de uma conversa num período (ordem cronológica).
 *  soMinhas: só as que o usuário mandou (pelo CRM) e as da equipe pelo celular
 */
export function mensagensDaConversa(c, { desde = null, ate = null, limite = 300, soMinhas = false, usuarioId = null } = {}) {
  const { where, params } = filtroDaConversa(c);
  const filtros = [where, 'm.hidden_at IS NULL', "m.type <> 'chamada' OR m.body IS NOT NULL"];
  const valores = [...params];
  if (desde) { filtros.push('m.timestamp >= ?'); valores.push(desde); }
  if (ate) { filtros.push('m.timestamp <= ?'); valores.push(ate); }
  if (soMinhas) {
    filtros.push(`m.from_me = 1 AND (m.sent_by = ? OR (m.sent_by IS NULL AND COALESCE(CASE WHEN json_valid(m.extra) THEN json_extract(m.extra, '$.origem') END, '') NOT IN ('ia', 'disparo', 'alice')))`);
    valores.push(usuarioId);
  }
  const linhas = all(
    `SELECT * FROM (SELECT ${COLUNAS} FROM wa_messages m LEFT JOIN users u ON u.id = m.sent_by
        WHERE ${filtros.map((f) => `(${f})`).join(' AND ')} ORDER BY m.timestamp DESC, m.id DESC LIMIT ?)
      ORDER BY timestamp ASC, id ASC`,
    [...valores, limite + 1]
  );
  const cortada = linhas.length > limite;
  return { mensagens: cortada ? linhas.slice(1) : linhas, cortada };
}

/** Mensagens em linhas de texto: "[05/11/26 14:02] Fulano: texto" */
export function formatarMensagens(mensagens, { fuso, nomeContato = null, usuarioId = null, maxPorMensagem = 1200 } = {}) {
  return mensagens.map((m) => {
    let t = textoDaMensagem(m).replace(/\s+\n/g, '\n');
    if (t.length > maxPorMensagem) t = `${t.slice(0, maxPorMensagem)}…`;
    const citada = m.quoted_body ? ` (respondendo a: "${String(m.quoted_body).slice(0, 80)}")` : '';
    return `[${dataHora(m.timestamp, fuso)}] ${autorDaMensagem(m, { nomeContato, usuarioId })}${citada}: ${t}`;
  }).join('\n');
}

/** Participantes de um grupo (quem já mandou mensagem), com telefone e se é lead */
export function participantesDoGrupo(jid, { limite = 40 } = {}) {
  return all(
    `SELECT m.participant_jid AS jid, max(m.participant_name) AS nome, count(*) AS mensagens, max(m.timestamp) AS ultima,
            c.phone, c.lead_id, COALESCE(c.name, c.push_name) AS contato
       FROM wa_messages m LEFT JOIN wa_contacts c ON c.jid = m.participant_jid
      WHERE m.chat_jid = ? AND m.from_me = 0 AND m.participant_jid IS NOT NULL
      GROUP BY m.participant_jid ORDER BY mensagens DESC LIMIT ?`,
    [jid, limite]
  ).map((p) => ({
    nome: p.nome || p.contato || null,
    telefone: p.phone || (/@s\.whatsapp\.net$/.test(p.jid) ? p.jid.split('@')[0].split(':')[0] : null),
    lead_id: p.lead_id || null,
    mensagens: p.mensagens,
    ultima: p.ultima,
  }));
}
