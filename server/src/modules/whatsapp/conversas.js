// Caixa de entrada do WhatsApp: agrupa as mensagens em conversas (como a lista do WhatsApp Web).
// Cada conversa tem uma "chave":
//   l:<id>       → conversa de um lead (junta todos os identificadores e números do lead)
//   t:<telefone> → contato que ainda não é lead (telefone conhecido)
//   j:<jid>      → contato que ainda não é lead (só o identificador do WhatsApp)
//   g:<jid>      → grupo (nunca vira lead)
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { criarLead, encontrarExistente, vincularConversasExistentes } from '../leads/service.js';
import { ErroHttp, idValido, variantesTelefone } from '../../util.js';
import { lerJson } from '../../events.js';
import { confirmarLeitura, refletirNoCelular } from './envio.js';
import { digitandoAgora } from './presenca.js';
import { telefoneDoJid } from './ligacao.js';
import { avisar } from './instancias.js';

export function interpretarChave(chave) {
  const [tipo, ...resto] = String(chave || '').split(':');
  const valor = resto.join(':');
  if (tipo === 'l' && idValido(valor)) return { tipo: 'lead', leadId: idValido(valor) };
  if (tipo === 't' && /^\d{8,15}$/.test(valor)) return { tipo: 'telefone', phone: valor };
  if (tipo === 'j' && /^[\w.:-]+@(s\.whatsapp\.net|lid)$/.test(valor)) return { tipo: 'jid', jid: valor };
  if (tipo === 'g' && /^[\w.:-]+@g\.us$/.test(valor)) return { tipo: 'grupo', jid: valor };
  throw new ErroHttp(400, 'Conversa inválida');
}

// Filtro SQL das mensagens de uma conversa
function filtroMensagens(c) {
  if (c.tipo === 'lead') return { where: 'm.lead_id = ?', params: [c.leadId] };
  if (c.tipo === 'telefone') {
    return { where: 'm.lead_id IS NULL AND m.chat_jid IN (SELECT jid FROM wa_contacts WHERE phone = ?)', params: [c.phone] };
  }
  if (c.tipo === 'grupo') return { where: 'm.chat_jid = ?', params: [c.jid] };
  return { where: 'm.lead_id IS NULL AND m.chat_jid = ?', params: [c.jid] };
}

const ehGrupoJid = (jid) => /@g\.us$/.test(jid);
const FUTURO = (iso) => Boolean(iso) && iso > new Date().toISOString();

function chaveDe(jid, leadId, phone) {
  if (ehGrupoJid(jid)) return `g:${jid}`;
  if (leadId) return `l:${leadId}`;
  if (phone) return `t:${phone}`;
  return `j:${jid}`;
}

/**
 * Lista de conversas.
 *  filtro: todas | nao_lidas | favoritas | grupos | arquivadas | leads | contatos | aguardando | etiqueta:<id>
 *  numero: só conversas deste número conectado (id) — vazio = todos
 * Devolve { conversas, arquivadas: quantidade, mensagens: [resultados da busca no texto] }
 */
export function listarConversas({ busca = '', filtro = 'todas', numero = null, horasFollowup = config.followupHours, limite = 600 } = {}) {
  const numeroId = idValido(numero);
  const porJid = all(
    `SELECT m.chat_jid, max(m.lead_id) AS lead_id, max(m.timestamp) AS ultima_em,
            sum(CASE WHEN m.from_me = 0 AND m.read_at IS NULL THEN 1 ELSE 0 END) AS nao_lidas
       FROM wa_messages m
      WHERE m.hidden_at IS NULL ${numeroId ? 'AND m.instance_id = ?' : ''}
      GROUP BY m.chat_jid`,
    numeroId ? [numeroId] : []
  );
  if (!porJid.length) return { conversas: [], arquivadas: 0, mensagens: [] };

  const contatos = new Map(all('SELECT jid, phone, lead_id, name, push_name FROM wa_contacts').map((c) => [c.jid, c]));
  const estados = new Map(all('SELECT * FROM wa_chats').map((c) => [c.jid, c]));
  const digitando = digitandoAgora();

  // Junta os identificadores da mesma conversa (o mesmo lead pode ter o número e o LID)
  const grupos = new Map();
  for (const r of porJid) {
    const c = contatos.get(r.chat_jid);
    const leadId = ehGrupoJid(r.chat_jid) ? null : r.lead_id || c?.lead_id || null;
    const phone = c?.phone || telefoneDoJid(r.chat_jid);
    const chave = chaveDe(r.chat_jid, leadId, phone);
    let g = grupos.get(chave);
    if (!g) {
      g = { chave, lead_id: leadId, jids: [], ultima_em: '', nao_lidas: 0, phone: null, nomeContato: null, jidUltima: null };
      grupos.set(chave, g);
    }
    g.jids.push(r.chat_jid);
    g.nao_lidas += r.nao_lidas || 0;
    g.phone = g.phone || phone || null;
    g.nomeContato = g.nomeContato || c?.name || c?.push_name || null;
    if (r.ultima_em > g.ultima_em) { g.ultima_em = r.ultima_em; g.jidUltima = r.chat_jid; }
  }

  // Estado da conversa (fixada, arquivada...) = o do identificador mais recente, completado pelos outros
  for (const g of grupos.values()) {
    const lista = [g.jidUltima, ...g.jids.filter((j) => j !== g.jidUltima)].map((j) => estados.get(j)).filter(Boolean);
    const de = (campo) => lista.find((s) => s[campo])?.[campo] || null;
    g.nomeGrupo = de('name');
    g.arquivada = Boolean(lista[0]?.archived);
    g.fixada = de('pinned_at');
    g.silenciada_ate = FUTURO(de('muted_until')) ? de('muted_until') : null;
    g.marcada_nao_lida = lista.some((s) => s.marked_unread);
    g.favorita = lista.some((s) => s.favorite);
    g.etiquetas = [...new Set(lista.flatMap((s) => lerJson(s.labels, [])))];
    g.temporarias = de('ephemeral_seconds');
    const ocultas = lista.length && g.jids.every((j) => estados.get(j)?.hidden_at && estados.get(j).hidden_at >= g.ultima_em);
    g.oculta = Boolean(ocultas);
    g.digitando = g.jids.map((j) => digitando[j]).find(Boolean) || null;
  }

  const ids = [...new Set([...grupos.values()].filter((g) => g.lead_id).map((g) => g.lead_id))];
  const leads = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const fatia = ids.slice(i, i + 500);
    for (const l of all(
      `SELECT l.id, l.name, l.phone, l.waiting_since, s.name AS stage_name, s.color AS stage_color, u.name AS owner_name,
              (s.kind = 'open' AND (julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?) AS atrasado
         FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id
        WHERE l.id IN (${fatia.map(() => '?').join(',')})`,
      [horasFollowup, ...fatia]
    )) leads.set(l.id, l);
  }

  // Busca: nome, telefone e texto das mensagens
  const termo = busca.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, '');
  let encontradasNoTexto = [];
  const chavesNoTexto = new Set();
  if (termo.length >= 2) {
    encontradasNoTexto = all(
      `SELECT m.id, m.chat_jid, m.lead_id, m.body, m.legenda, m.timestamp, m.from_me FROM wa_messages m
        WHERE m.hidden_at IS NULL AND m.deleted_at IS NULL AND (m.body LIKE ? ESCAPE '\\' OR m.legenda LIKE ? ESCAPE '\\')
        ${numeroId ? 'AND m.instance_id = ?' : ''}
        ORDER BY m.timestamp DESC LIMIT 60`,
      [`%${termo.replace(/[%_\\]/g, '\\$&')}%`, `%${termo.replace(/[%_\\]/g, '\\$&')}%`, ...(numeroId ? [numeroId] : [])]
    ).map((m) => {
      const c = contatos.get(m.chat_jid);
      const chave = chaveDe(m.chat_jid, ehGrupoJid(m.chat_jid) ? null : m.lead_id || c?.lead_id, c?.phone || telefoneDoJid(m.chat_jid));
      chavesNoTexto.add(chave);
      return { id: m.id, chave, texto: (m.legenda || m.body || '').slice(0, 200), timestamp: m.timestamp, from_me: Boolean(m.from_me) };
    });
  }

  let lista = [...grupos.values()].map((g) => {
    const lead = g.lead_id ? leads.get(g.lead_id) : null;
    return {
      chave: g.chave,
      lead_id: g.lead_id,
      grupo: g.chave.startsWith('g:'),
      nome: g.chave.startsWith('g:') ? g.nomeGrupo || 'Grupo' : lead?.name || g.nomeContato || null,
      telefone: lead?.phone || g.phone || null,
      ultima_em: g.ultima_em,
      jid_ultima: g.jidUltima,
      nao_lidas: g.nao_lidas,
      marcada_nao_lida: g.marcada_nao_lida,
      fixada: g.fixada,
      arquivada: g.arquivada,
      oculta: g.oculta,
      silenciada_ate: g.silenciada_ate,
      favorita: g.favorita,
      etiquetas: g.etiquetas,
      temporarias: g.temporarias,
      digitando: g.digitando,
      etapa: lead ? { nome: lead.stage_name, cor: lead.stage_color } : null,
      responsavel: lead?.owner_name || null,
      aguardando: Boolean(lead?.waiting_since),
      atrasado: Boolean(lead?.atrasado),
    };
  });

  const arquivadas = lista.filter((c) => c.arquivada && !c.oculta).length;
  lista = lista.filter((c) => {
    if (termo) {
      const casa = (c.nome || '').toLowerCase().includes(termo) || (digitos.length >= 3 && (c.telefone || '').includes(digitos)) || chavesNoTexto.has(c.chave);
      if (!casa) return false;
    } else if (c.oculta) return false;
    if (filtro === 'arquivadas') return c.arquivada;
    if (!termo && c.arquivada) return false;
    if (filtro === 'nao_lidas') return c.nao_lidas > 0 || c.marcada_nao_lida;
    if (filtro === 'favoritas') return c.favorita;
    if (filtro === 'grupos') return c.grupo;
    if (filtro === 'leads') return Boolean(c.lead_id);
    if (filtro === 'contatos') return !c.lead_id && !c.grupo;
    if (filtro === 'aguardando') return c.aguardando;
    if (filtro.startsWith('etiqueta:')) return c.etiquetas.includes(Number(filtro.slice(9)));
    return true;
  });
  lista.sort((a, b) => {
    if (Boolean(a.fixada) !== Boolean(b.fixada)) return a.fixada ? -1 : 1;
    if (a.fixada && b.fixada && a.fixada !== b.fixada) return b.fixada.localeCompare(a.fixada);
    return b.ultima_em.localeCompare(a.ultima_em);
  });
  lista = lista.slice(0, limite);

  // Última mensagem de cada conversa visível (prévia na lista)
  for (const c of lista) {
    const m = get(
      `SELECT m.body, m.type, m.from_me, m.status, m.deleted_at, m.instance_id, m.participant_name, m.participant_jid, m.extra
         FROM wa_messages m WHERE m.chat_jid = ? AND m.hidden_at IS NULL ORDER BY m.timestamp DESC, m.id DESC LIMIT 1`,
      [c.jid_ultima]
    );
    c.ultima_mensagem = m?.body ?? null;
    c.ultimo_tipo = m?.type ?? null;
    c.ultima_minha = Boolean(m?.from_me);
    c.ultimo_status = m?.status ?? null;
    c.ultima_apagada = Boolean(m?.deleted_at);
    c.ultimo_numero = m?.instance_id ?? null;
    c.ultima_autor = c.grupo && m && !m.from_me
      ? (m.participant_name || contatos.get(m.participant_jid)?.name || telefoneDoJid(m.participant_jid) || null)
      : null;
    delete c.jid_ultima;
  }

  return { conversas: lista, arquivadas, mensagens: encontradasNoTexto };
}

const POR_PAGINA = 80;
const COLUNAS_MENSAGEM = `m.id, m.from_me, m.type, m.body, m.legenda, m.timestamp, m.instance_id, m.chat_jid, m.status,
       m.media_mime, m.media_name, m.media_size, m.media_seconds, m.media_w, m.media_h, m.media_status, m.ptt,
       CASE WHEN m.media_path IS NULL THEN m.thumb END AS thumb, m.media_path IS NOT NULL AS media_pronta,
       m.raw IS NOT NULL AS tem_original, m.wa_id,
       m.quoted_wa_id, m.quoted_body, m.quoted_from_me, m.reactions, m.edited_at, m.deleted_at, m.extra,
       m.participant_jid, m.participant_name, m.starred_at, m.delivered_at, m.seen_at,
       (SELECT q.id FROM wa_messages q WHERE q.wa_id = m.quoted_wa_id ORDER BY q.id DESC LIMIT 1) AS quoted_id,
       i.name AS numero_nome, u.name AS enviado_por`;

function mapearMensagem(m) {
  const { wa_id: _w, ...resto } = m;
  return {
    ...resto,
    from_me: Boolean(m.from_me),
    ptt: Boolean(m.ptt),
    media_pronta: Boolean(m.media_pronta),
    tem_original: Boolean(m.tem_original),
    quoted_from_me: m.quoted_from_me === null ? null : Boolean(m.quoted_from_me),
    reactions: lerJson(m.reactions, null),
    extra: lerJson(m.extra, null),
  };
}

/**
 * Mensagens de uma conversa.
 *  antes: id da mensagem mais antiga já carregada (página anterior)
 *  aPartirDe: id de uma mensagem — devolve dela (com 20 antes) até a mais nova (para pular até um resultado de busca)
 */
export function mensagensDaConversa(chave, { antes = null, aPartirDe = null, marcarLidas = true } = {}) {
  const c = interpretarChave(chave);
  const { where, params } = filtroMensagens(c);
  const corte = idValido(antes);
  const ancora = idValido(aPartirDe);
  let linhas;
  let temMais;
  if (ancora) {
    const ref = get('SELECT timestamp, id FROM wa_messages WHERE id = ?', [ancora]);
    if (!ref) throw new ErroHttp(404, 'Mensagem não encontrada');
    const anteriores = all(
      `SELECT m.timestamp, m.id FROM wa_messages m WHERE ${where} AND m.hidden_at IS NULL AND (m.timestamp, m.id) < (?, ?)
        ORDER BY m.timestamp DESC, m.id DESC LIMIT 21`,
      [...params, ref.timestamp, ref.id]
    );
    temMais = anteriores.length > 20;
    const inicio = anteriores.length ? anteriores[Math.min(anteriores.length, 20) - 1] : ref;
    linhas = all(
      `SELECT ${COLUNAS_MENSAGEM} FROM wa_messages m
         LEFT JOIN wa_instances i ON i.id = m.instance_id LEFT JOIN users u ON u.id = m.sent_by
        WHERE ${where} AND m.hidden_at IS NULL AND (m.timestamp, m.id) >= (?, ?)
        ORDER BY m.timestamp ASC, m.id ASC LIMIT 5000`,
      [...params, inicio.timestamp, inicio.id]
    );
  } else {
    linhas = all(
      `SELECT * FROM (
         SELECT ${COLUNAS_MENSAGEM}
           FROM wa_messages m
           LEFT JOIN wa_instances i ON i.id = m.instance_id
           LEFT JOIN users u ON u.id = m.sent_by
          WHERE ${where} AND m.hidden_at IS NULL ${corte ? 'AND (m.timestamp, m.id) < (SELECT timestamp, id FROM wa_messages WHERE id = ?)' : ''}
          ORDER BY m.timestamp DESC, m.id DESC LIMIT ${POR_PAGINA + 1}
       ) ORDER BY timestamp ASC, id ASC`,
      corte ? [...params, corte] : params
    );
    temMais = linhas.length > POR_PAGINA;
    if (temMais) linhas = linhas.slice(1);
  }
  const mensagens = linhas.map(mapearMensagem);

  // Abrir a conversa marca como lidas (no CRM e, se configurado, no WhatsApp)
  if (!corte && !ancora && marcarLidas) marcarConversaLida(chave);

  const ultimo = mensagens.at(-1);
  const jids = jidsDaChave(chave, { incluirTelefone: false });
  const estadoChat = jids.length
    ? get(`SELECT ephemeral_seconds, muted_until, archived, pinned_at, favorite, labels FROM wa_chats WHERE jid IN (${jids.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 1`, jids)
    : null;
  return {
    mensagens,
    tem_mais: temMais,
    ultimo_numero: ultimo?.instance_id || ultimoNumeroDaConversa(chave),
    temporarias: estadoChat?.ephemeral_seconds || null,
    jids,
  };
}

function ultimoNumeroDaConversa(chave) {
  try {
    const { where, params } = filtroMensagens(interpretarChave(chave));
    return get(`SELECT m.instance_id FROM wa_messages m WHERE ${where} ORDER BY m.timestamp DESC LIMIT 1`, params)?.instance_id || null;
  } catch {
    return null;
  }
}

export function marcarConversaLida(chave) {
  const c = interpretarChave(chave);
  const { where, params } = filtroMensagens(c);
  const naoLidas = all(
    `SELECT m.id, m.wa_id, m.chat_jid, m.instance_id, m.participant_jid FROM wa_messages m WHERE ${where} AND m.from_me = 0 AND m.read_at IS NULL`,
    params
  );
  if (naoLidas.length) {
    run(`UPDATE wa_messages SET read_at = ? WHERE id IN (${naoLidas.map(() => '?').join(',')})`, [agora(), ...naoLidas.map((n) => n.id)]);
    confirmarLeitura(naoLidas);
  }
  const jids = jidsDaChave(chave, { incluirTelefone: false });
  if (jids.length) run(`UPDATE wa_chats SET marked_unread = 0 WHERE jid IN (${jids.map(() => '?').join(',')}) AND marked_unread = 1`, jids);
  return naoLidas.length;
}

// Busca dentro de uma conversa
export function buscarNaConversa(chave, q) {
  const termo = String(q || '').trim();
  if (termo.length < 2) return [];
  const { where, params } = filtroMensagens(interpretarChave(chave));
  const padrao = `%${termo.replace(/[%_\\]/g, '\\$&')}%`;
  return all(
    `SELECT m.id, m.body, m.legenda, m.timestamp, m.from_me FROM wa_messages m
      WHERE ${where} AND m.hidden_at IS NULL AND m.deleted_at IS NULL AND (m.body LIKE ? ESCAPE '\\' OR m.legenda LIKE ? ESCAPE '\\')
      ORDER BY m.timestamp DESC LIMIT 200`,
    [...params, padrao, padrao]
  ).map((m) => ({ id: m.id, texto: (m.legenda || m.body || '').slice(0, 200), timestamp: m.timestamp, from_me: Boolean(m.from_me) }));
}

// Mensagens favoritas (estrela) — de uma conversa ou de todas
export function listarFavoritas(chave = null) {
  let where = 'm.starred_at IS NOT NULL AND m.hidden_at IS NULL';
  let params = [];
  if (chave) {
    const f = filtroMensagens(interpretarChave(chave));
    where += ` AND ${f.where}`;
    params = f.params;
  }
  const contatos = new Map(all('SELECT jid, phone, lead_id FROM wa_contacts').map((c) => [c.jid, c]));
  return all(
    `SELECT ${COLUNAS_MENSAGEM}, m.lead_id FROM wa_messages m
       LEFT JOIN wa_instances i ON i.id = m.instance_id LEFT JOIN users u ON u.id = m.sent_by
      WHERE ${where} ORDER BY m.starred_at DESC LIMIT 300`,
    params
  ).map((m) => {
    const c = contatos.get(m.chat_jid);
    const r = mapearMensagem(m);
    r.chave = chaveDe(m.chat_jid, ehGrupoJid(m.chat_jid) ? null : m.lead_id || c?.lead_id, c?.phone || telefoneDoJid(m.chat_jid));
    delete r.lead_id;
    return r;
  });
}

// Identificadores do WhatsApp de uma conversa (para foto de perfil, presença e buscar mensagens antigas)
export function jidsDaChave(chave, { incluirTelefone = true } = {}) {
  const c = interpretarChave(chave);
  let jids = [];
  let telefone = null;
  if (c.tipo === 'lead') {
    jids = all(
      "SELECT jid FROM wa_contacts WHERE lead_id = ? AND jid NOT LIKE '%@g.us' ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC",
      [c.leadId]
    ).map((r) => r.jid);
    telefone = get('SELECT phone FROM leads WHERE id = ?', [c.leadId])?.phone || null;
  } else if (c.tipo === 'telefone') {
    jids = all("SELECT jid FROM wa_contacts WHERE phone = ? AND jid NOT LIKE '%@g.us' ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END", [c.phone]).map((r) => r.jid);
    telefone = c.phone;
  } else {
    jids = [c.jid];
  }
  if (incluirTelefone && telefone) {
    for (const v of variantesTelefone(telefone)) {
      const jid = `${v}@s.whatsapp.net`;
      if (!jids.includes(jid)) jids.push(jid);
    }
  }
  return jids;
}

// Para onde enviar numa conversa: lead (o envio descobre o número) ou o identificador do contato/grupo
export function destinoDaConversa(chave) {
  const c = interpretarChave(chave);
  if (c.tipo === 'lead') return { leadId: c.leadId };
  if (c.tipo === 'jid' || c.tipo === 'grupo') return { jid: c.jid };
  const contato = get(
    "SELECT jid FROM wa_contacts WHERE phone = ? AND jid NOT LIKE '%@g.us' ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
    [c.phone]
  );
  return { jid: contato?.jid || `${c.phone}@s.whatsapp.net` };
}

// Jid principal para ações da conversa (presença, mensagens temporárias)
export function jidPrincipal(chave) {
  const c = interpretarChave(chave);
  if (c.tipo === 'jid' || c.tipo === 'grupo') return c.jid;
  const ultima = (() => {
    const { where, params } = filtroMensagens(c);
    return get(`SELECT m.chat_jid FROM wa_messages m WHERE ${where} ORDER BY m.timestamp DESC LIMIT 1`, params)?.chat_jid;
  })();
  return ultima || jidsDaChave(chave)[0] || null;
}

/**
 * Muda o estado da conversa: { arquivada, fixada, silenciada_ate, nao_lida, favorita, oculta, etiquetas }
 * Nada é apagado: "ocultar" só tira da lista (volta com mensagem nova).
 */
export async function definirEstado(chave, mudanca = {}) {
  const jids = jidsDaChave(chave, { incluirTelefone: false });
  const extras = (() => {
    const { where, params } = filtroMensagens(interpretarChave(chave));
    return all(`SELECT DISTINCT m.chat_jid FROM wa_messages m WHERE ${where}`, params).map((r) => r.chat_jid);
  })();
  const todos = [...new Set([...jids, ...extras])];
  if (!todos.length) throw new ErroHttp(404, 'Conversa sem mensagens');
  const sets = [];
  const vals = [];
  if ('arquivada' in mudanca) { sets.push('archived = ?'); vals.push(mudanca.arquivada ? 1 : 0); }
  if ('fixada' in mudanca) {
    sets.push('pinned_at = ?'); vals.push(mudanca.fixada ? agora() : null);
  }
  if ('silenciada_ate' in mudanca) { sets.push('muted_until = ?'); vals.push(mudanca.silenciada_ate || null); }
  if ('nao_lida' in mudanca) { sets.push('marked_unread = ?'); vals.push(mudanca.nao_lida ? 1 : 0); }
  if ('favorita' in mudanca) { sets.push('favorite = ?'); vals.push(mudanca.favorita ? 1 : 0); }
  if ('oculta' in mudanca) { sets.push('hidden_at = ?'); vals.push(mudanca.oculta ? agora() : null); }
  if ('etiquetas' in mudanca) {
    const validas = new Set(all('SELECT id FROM wa_labels').map((r) => r.id));
    const lista = (Array.isArray(mudanca.etiquetas) ? mudanca.etiquetas : []).map(Number).filter((n) => validas.has(n));
    sets.push('labels = ?'); vals.push(lista.length ? JSON.stringify(lista) : null);
  }
  if (!sets.length) return;
  tx(() => {
    for (const jid of todos) {
      run('INSERT INTO wa_chats (jid, is_group) VALUES (?, ?) ON CONFLICT(jid) DO NOTHING', [jid, ehGrupoJid(jid) ? 1 : 0]);
      run(`UPDATE wa_chats SET ${sets.join(', ')}, updated_at = ? WHERE jid = ?`, [...vals, agora(), jid]);
    }
  });
  avisar({ chats: true });
  // Arquivar, fixar, silenciar e marcar como não lida também valem no celular (melhor esforço)
  for (const campo of ['arquivada', 'fixada', 'silenciada_ate', 'nao_lida']) {
    if (campo in mudanca) refletirNoCelular([todos[0]], { [campo]: mudanca[campo] }).catch(() => {});
  }
}

// ---------------------------------------------------------------- etiquetas

export const listarEtiquetas = () => all('SELECT id, name, color FROM wa_labels ORDER BY name');
export function criarEtiqueta(nome, cor) {
  const n = String(nome || '').trim().slice(0, 40);
  if (!n) throw new ErroHttp(400, 'Dê um nome à etiqueta');
  const c = /^#[0-9a-f]{6}$/i.test(cor || '') ? cor : '#d7b870';
  return Number(run('INSERT INTO wa_labels (name, color) VALUES (?, ?)', [n, c]).lastInsertRowid);
}
export function editarEtiqueta(id, { nome, cor }) {
  const atual = get('SELECT * FROM wa_labels WHERE id = ?', [id]);
  if (!atual) throw new ErroHttp(404, 'Etiqueta não encontrada');
  run('UPDATE wa_labels SET name = ?, color = ? WHERE id = ?', [
    String(nome || atual.name).trim().slice(0, 40), /^#[0-9a-f]{6}$/i.test(cor || '') ? cor : atual.color, id,
  ]);
}

// ---------------------------------------------------------------- lead

// Transforma um contato do WhatsApp em lead (ou liga a um lead que já tenha o mesmo telefone)
export function transformarEmLead(chave, userId) {
  const c = interpretarChave(chave);
  if (c.tipo === 'lead') return { leadId: c.leadId, novo: false };
  if (c.tipo === 'grupo') throw new ErroHttp(400, 'Grupos não viram lead');

  return tx(() => {
    const jids = c.tipo === 'telefone' ? all("SELECT jid FROM wa_contacts WHERE phone = ? AND jid NOT LIKE '%@g.us'", [c.phone]).map((r) => r.jid) : [c.jid];
    const contato = get(
      `SELECT name, push_name, phone FROM wa_contacts WHERE jid IN (${jids.map(() => '?').join(',')}) ORDER BY push_name IS NULL, updated_at DESC LIMIT 1`,
      jids
    );
    const phone = c.tipo === 'telefone' ? c.phone : contato?.phone || telefoneDoJid(c.jid) || null;

    let leadId = phone ? encontrarExistente({ phone }) : null;
    const novo = !leadId;
    if (!leadId) {
      leadId = criarLead(
        { name: contato?.name || contato?.push_name || null, phone, source: 'whatsapp', extra: { whatsapp: { jid: jids[0] } } },
        { userId }
      );
    }
    run(`UPDATE wa_contacts SET lead_id = ? WHERE jid IN (${jids.map(() => '?').join(',')})`, [leadId, ...jids]);
    run(`UPDATE wa_messages SET lead_id = ? WHERE lead_id IS NULL AND chat_jid IN (${jids.map(() => '?').join(',')})`, [leadId, ...jids]);
    vincularConversasExistentes(leadId, phone);
    return { leadId, novo };
  });
}

// Dados para o painel "Dados do contato"
export function dadosDoContato(chave) {
  const c = interpretarChave(chave);
  const jids = jidsDaChave(chave, { incluirTelefone: false });
  const contato = jids.length
    ? get(`SELECT name, push_name, phone FROM wa_contacts WHERE jid IN (${jids.map(() => '?').join(',')}) ORDER BY name IS NULL, push_name IS NULL LIMIT 1`, jids)
    : null;
  const { where, params } = filtroMensagens(c);
  const contagem = get(
    `SELECT count(*) AS total,
            sum(CASE WHEN m.type IN ('imagem','video') THEN 1 ELSE 0 END) AS midias,
            sum(CASE WHEN m.type = 'documento' THEN 1 ELSE 0 END) AS documentos,
            sum(CASE WHEN m.starred_at IS NOT NULL THEN 1 ELSE 0 END) AS favoritas,
            min(m.timestamp) AS primeira
       FROM wa_messages m WHERE ${where} AND m.hidden_at IS NULL`,
    params
  );
  const midias = all(
    `SELECT m.id, m.type, m.timestamp, m.media_w, m.media_h, CASE WHEN m.media_path IS NULL THEN m.thumb END AS thumb
       FROM wa_messages m WHERE ${where} AND m.hidden_at IS NULL AND m.deleted_at IS NULL AND m.type IN ('imagem','video')
      ORDER BY m.timestamp DESC LIMIT 12`,
    params
  );
  let participantes = null;
  if (c.tipo === 'grupo') {
    participantes = all(
      `SELECT m.participant_jid AS jid, max(m.participant_name) AS nome, count(*) AS mensagens FROM wa_messages m
        WHERE m.chat_jid = ? AND m.participant_jid IS NOT NULL GROUP BY m.participant_jid ORDER BY mensagens DESC LIMIT 100`,
      [c.jid]
    ).map((p) => ({ ...p, telefone: telefoneDoJid(p.jid) || get('SELECT phone FROM wa_contacts WHERE jid = ?', [p.jid])?.phone || null }));
  }
  return {
    nome_agenda: contato?.name || null,
    apelido: contato?.push_name || null,
    telefone: contato?.phone || (c.tipo === 'telefone' ? c.phone : null),
    jids,
    contagem,
    midias,
    participantes,
    nome_grupo: c.tipo === 'grupo' ? get('SELECT name FROM wa_chats WHERE jid = ?', [c.jid])?.name || null : null,
  };
}
