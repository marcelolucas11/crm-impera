// Caixa de entrada do WhatsApp: agrupa as mensagens em conversas.
// Cada conversa tem uma "chave":
//   l:<id>      → conversa de um lead
//   t:<telefone> → contato que ainda não é lead (telefone conhecido)
//   j:<jid>      → contato que ainda não é lead (só o identificador do WhatsApp)
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { criarLead, encontrarExistente, vincularConversasExistentes } from '../leads/service.js';
import { ErroHttp, idValido } from '../../util.js';

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
       SELECT m.*, ${CHAVE_SQL} AS chave, c.phone AS contato_phone, c.push_name
         FROM wa_messages m LEFT JOIN wa_contacts c ON c.jid = m.chat_jid
     ),
     ordenadas AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY chave ORDER BY timestamp DESC, id DESC) AS ordem,
              SUM(CASE WHEN from_me = 0 AND read_at IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY chave) AS nao_lidas,
              MAX(push_name) OVER (PARTITION BY chave) AS nome_contato,
              MAX(contato_phone) OVER (PARTITION BY chave) AS telefone_contato
         FROM msgs
     )
     SELECT chave, lead_id, chat_jid, body AS ultima_mensagem, type AS ultimo_tipo, from_me AS ultima_minha,
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

export function mensagensDaConversa(chave) {
  const c = interpretarChave(chave);
  const { where, params } = filtroMensagens(c);
  const mensagens = all(
    `SELECT * FROM (
       SELECT m.id, m.from_me, m.type, m.body, m.timestamp, m.instance_id, m.chat_jid,
              i.name AS numero_nome, u.name AS enviado_por
         FROM wa_messages m
         LEFT JOIN wa_instances i ON i.id = m.instance_id
         LEFT JOIN users u ON u.id = m.sent_by
        WHERE ${where}
        ORDER BY m.timestamp DESC, m.id DESC LIMIT 300
     ) ORDER BY timestamp ASC, id ASC`,
    params
  ).map((m) => ({ ...m, from_me: Boolean(m.from_me) }));

  run(`UPDATE wa_messages SET read_at = ? WHERE id IN (SELECT m.id FROM wa_messages m WHERE ${where} AND m.from_me = 0 AND m.read_at IS NULL)`, [
    agora(), ...params,
  ]);

  const ultimo = mensagens.at(-1);
  return { mensagens, ultimo_numero: ultimo?.instance_id || null };
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
