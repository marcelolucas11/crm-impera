// Caixa de entrada do WhatsApp: agrupa as mensagens em conversas.
// Cada conversa tem uma "chave":
//   l:<id>      → conversa de um lead
//   t:<telefone> → contato que ainda não é lead (telefone conhecido)
//   j:<jid>      → contato que ainda não é lead (só o identificador do WhatsApp)
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { criarLead, encontrarExistente, vincularConversasExistentes } from '../leads/service.js';
import { ErroHttp, idValido, variantesTelefone } from '../../util.js';
import { lerJson } from '../../events.js';
import { confirmarLeitura } from './gerenciador.js';

const CHAVE_SQL = `CASE WHEN m.lead_id IS NOT NULL THEN 'l:' || m.lead_id
                        WHEN c.phone IS NOT NULL THEN 't:' || c.phone
                        ELSE 'j:' || m.chat_jid END`;

export function interpretarChave(chave) {
  const [tipo, ...resto] = String(chave || '').split(':');
  const valor = resto.join(':');
  if (tipo === 'l' && idValido(valor)) return { tipo: 'lead', leadId: idValido(valor) };
  if (tipo === 't' && /^\d{8,15}$/.test(valor)) return { tipo: 'telefone', phone: valor };
  if (tipo === 'j' && /@(s\.whatsapp\.net|lid)$/.test(valor)) return { tipo: 'jid', jid: valor };
  throw new ErroHttp(400, 'Conversa inválida');
}

// Filtro SQL das mensagens de uma conversa
function filtroMensagens(c) {
  if (c.tipo === 'lead') return { where: 'm.lead_id = ?', params: [c.leadId] };
  if (c.tipo === 'telefone') {
    return { where: 'm.lead_id IS NULL AND m.chat_jid IN (SELECT jid FROM wa_contacts WHERE phone = ?)', params: [c.phone] };
  }
  return { where: 'm.lead_id IS NULL AND m.chat_jid = ?', params: [c.jid] };
}

export function listarConversas({ busca = '', filtro = 'todas', horasFollowup = config.followupHours } = {}) {
  const linhas = all(
    `WITH msgs AS (
       SELECT m.id, m.lead_id, m.chat_jid, m.body, m.type, m.from_me, m.timestamp, m.instance_id, m.read_at, m.status, m.deleted_at,
              ${CHAVE_SQL} AS chave, c.phone AS contato_phone, c.push_name, c.name AS nome_agenda
         FROM wa_messages m LEFT JOIN wa_contacts c ON c.jid = m.chat_jid
     ),
     ordenadas AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY chave ORDER BY timestamp DESC, id DESC) AS ordem,
              SUM(CASE WHEN from_me = 0 AND read_at IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY chave) AS nao_lidas,
              COALESCE(MAX(nome_agenda) OVER (PARTITION BY chave), MAX(push_name) OVER (PARTITION BY chave)) AS nome_contato,
              MAX(contato_phone) OVER (PARTITION BY chave) AS telefone_contato
         FROM msgs
     )
     SELECT chave, lead_id, chat_jid, body AS ultima_mensagem, type AS ultimo_tipo, from_me AS ultima_minha,
            status AS ultimo_status, deleted_at AS ultima_apagada,
            timestamp AS ultima_em, instance_id AS ultimo_numero, nao_lidas, nome_contato, telefone_contato
       FROM ordenadas WHERE ordem = 1
      ORDER BY ultima_em DESC
      LIMIT 500`
  );

  const ids = linhas.filter((l) => l.lead_id).map((l) => l.lead_id);
  const leads = new Map(
    (ids.length
      ? all(
          `SELECT l.id, l.name, l.phone, l.waiting_since, s.name AS stage_name, s.color AS stage_color, u.name AS owner_name,
                  (s.kind = 'open' AND (julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?) AS atrasado
             FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id
            WHERE l.id IN (${ids.map(() => '?').join(',')})`,
          [horasFollowup, ...ids]
        )
      : []
    ).map((l) => [l.id, l])
  );

  const termo = busca.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, '');
  return linhas
    .map((l) => {
      const lead = l.lead_id ? leads.get(l.lead_id) : null;
      const telefone = lead?.phone || l.telefone_contato || null;
      return {
        chave: l.chave,
        lead_id: l.lead_id,
        nome: lead?.name || l.nome_contato || null,
        telefone,
        ultima_mensagem: l.ultima_mensagem,
        ultima_minha: Boolean(l.ultima_minha),
        ultimo_tipo: l.ultimo_tipo,
        ultimo_status: l.ultimo_status,
        ultima_apagada: Boolean(l.ultima_apagada),
        ultima_em: l.ultima_em,
        ultimo_numero: l.ultimo_numero,
        nao_lidas: l.nao_lidas,
        etapa: lead ? { nome: lead.stage_name, cor: lead.stage_color } : null,
        responsavel: lead?.owner_name || null,
        aguardando: Boolean(lead?.waiting_since),
        atrasado: Boolean(lead?.atrasado),
      };
    })
    .filter((c) => {
      if (filtro === 'nao_lidas' && !c.nao_lidas) return false;
      if (filtro === 'leads' && !c.lead_id) return false;
      if (filtro === 'contatos' && c.lead_id) return false;
      if (filtro === 'aguardando' && !c.aguardando) return false;
      if (!termo) return true;
      return (c.nome || '').toLowerCase().includes(termo) || (digitos.length >= 3 && (c.telefone || '').includes(digitos));
    });
}

const POR_PAGINA = 80;

// Mensagens de uma conversa, das mais novas para trás (antes = id da mensagem mais antiga já carregada)
export function mensagensDaConversa(chave, { antes = null } = {}) {
  const c = interpretarChave(chave);
  const { where, params } = filtroMensagens(c);
  const corte = idValido(antes);
  const linhas = all(
    `SELECT * FROM (
       SELECT m.id, m.from_me, m.type, m.body, m.legenda, m.timestamp, m.instance_id, m.chat_jid, m.status,
              m.media_mime, m.media_name, m.media_size, m.media_seconds, m.media_w, m.media_h, m.media_status, m.ptt,
              CASE WHEN m.media_path IS NULL THEN m.thumb END AS thumb, m.media_path IS NOT NULL AS media_pronta,
              m.raw IS NOT NULL AS tem_original,
              m.quoted_wa_id, m.quoted_body, m.quoted_from_me, m.reactions, m.edited_at, m.deleted_at, m.extra,
              (SELECT q.id FROM wa_messages q WHERE q.wa_id = m.quoted_wa_id ORDER BY q.id DESC LIMIT 1) AS quoted_id,
              i.name AS numero_nome, u.name AS enviado_por
         FROM wa_messages m
         LEFT JOIN wa_instances i ON i.id = m.instance_id
         LEFT JOIN users u ON u.id = m.sent_by
        WHERE ${where} ${corte ? 'AND (m.timestamp, m.id) < (SELECT timestamp, id FROM wa_messages WHERE id = ?)' : ''}
        ORDER BY m.timestamp DESC, m.id DESC LIMIT ${POR_PAGINA + 1}
     ) ORDER BY timestamp ASC, id ASC`,
    corte ? [...params, corte] : params
  );
  const temMais = linhas.length > POR_PAGINA;
  const mensagens = (temMais ? linhas.slice(1) : linhas).map((m) => ({
    ...m,
    from_me: Boolean(m.from_me),
    ptt: Boolean(m.ptt),
    media_pronta: Boolean(m.media_pronta),
    tem_original: Boolean(m.tem_original),
    quoted_from_me: m.quoted_from_me === null ? null : Boolean(m.quoted_from_me),
    reactions: lerJson(m.reactions, null),
    extra: lerJson(m.extra, null),
  }));

  // Abrir a conversa marca como lidas (no CRM e, se configurado, no WhatsApp)
  if (!corte) {
    const naoLidas = all(
      `SELECT m.id, m.wa_id, m.chat_jid, m.instance_id FROM wa_messages m WHERE ${where} AND m.from_me = 0 AND m.read_at IS NULL`,
      params
    );
    if (naoLidas.length) {
      run(`UPDATE wa_messages SET read_at = ? WHERE id IN (${naoLidas.map(() => '?').join(',')})`, [agora(), ...naoLidas.map((n) => n.id)]);
      confirmarLeitura(naoLidas);
    }
  }

  const ultimo = mensagens.at(-1);
  return { mensagens, tem_mais: temMais, ultimo_numero: ultimo?.instance_id || null };
}

// Identificadores do WhatsApp de uma conversa (para foto de perfil e para buscar mensagens antigas)
export function jidsDaChave(chave, { incluirTelefone = true } = {}) {
  const c = interpretarChave(chave);
  let jids = [];
  let telefone = null;
  if (c.tipo === 'lead') {
    jids = all(
      "SELECT jid FROM wa_contacts WHERE lead_id = ? ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC",
      [c.leadId]
    ).map((r) => r.jid);
    telefone = get('SELECT phone FROM leads WHERE id = ?', [c.leadId])?.phone || null;
  } else if (c.tipo === 'telefone') {
    jids = all("SELECT jid FROM wa_contacts WHERE phone = ? ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END", [c.phone]).map((r) => r.jid);
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

// Para onde enviar numa conversa: lead (o gerenciador descobre o número) ou o identificador do contato
export function destinoDaConversa(chave) {
  const c = interpretarChave(chave);
  if (c.tipo === 'lead') return { leadId: c.leadId };
  if (c.tipo === 'jid') return { jid: c.jid };
  const contato = get(
    "SELECT jid FROM wa_contacts WHERE phone = ? ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
    [c.phone]
  );
  return { jid: contato?.jid || `${c.phone}@s.whatsapp.net` };
}

// Transforma um contato do WhatsApp em lead (ou liga a um lead que já tenha o mesmo telefone)
export function transformarEmLead(chave, userId) {
  const c = interpretarChave(chave);
  if (c.tipo === 'lead') return { leadId: c.leadId, novo: false };

  return tx(() => {
    const jids = c.tipo === 'telefone' ? all('SELECT jid FROM wa_contacts WHERE phone = ?', [c.phone]).map((r) => r.jid) : [c.jid];
    const contato = get(
      `SELECT push_name, phone FROM wa_contacts WHERE jid IN (${jids.map(() => '?').join(',')}) ORDER BY push_name IS NULL, updated_at DESC LIMIT 1`,
      jids
    );
    const phone = c.tipo === 'telefone' ? c.phone : contato?.phone || null;

    let leadId = phone ? encontrarExistente({ phone }) : null;
    const novo = !leadId;
    if (!leadId) {
      leadId = criarLead(
        { name: contato?.push_name || null, phone, source: 'whatsapp', extra: { whatsapp: { jid: jids[0] } } },
        { userId }
      );
    }
    run(`UPDATE wa_contacts SET lead_id = ? WHERE jid IN (${jids.map(() => '?').join(',')})`, [leadId, ...jids]);
    run(`UPDATE wa_messages SET lead_id = ? WHERE lead_id IS NULL AND chat_jid IN (${jids.map(() => '?').join(',')})`, [leadId, ...jids]);
    vincularConversasExistentes(leadId, phone);
    return { leadId, novo };
  });
}
