// Ligação entre conversas do WhatsApp e leads do CRM.
//
// Regras:
//  - O telefone é comparado já normalizado, com e sem o 9º dígito (variantesTelefone).
//  - Conversas que o WhatsApp identifica por LID (@lid) são ligadas assim que o telefone é conhecido
//    (mapeamento LID ↔ telefone vindo do WhatsApp).
//  - Grupos nunca viram lead e nunca são ligados a um lead.
//  - Se dois leads têm o mesmo telefone, a conversa vai para o mais recente e o caso fica registrado
//    no histórico desse lead. Nenhum lead é juntado ou apagado.
//  - Uma conversa já ligada a um lead não troca de lead sozinha (ligações feitas à mão continuam valendo).
//  - Leads só são criados automaticamente com WHATSAPP_CRIAR_LEADS=1 (decisão de quem chama).
import { get, all, run, tx, agora } from '../../db.js';
import { variantesTelefone } from '../../util.js';
import { registrarEvento, lerJson } from '../../events.js';

export const ehGrupo = (jid) => /@g\.us$/.test(String(jid || ''));
export const ehLid = (jid) => /@lid$/.test(String(jid || ''));
export const ehTelefoneJid = (jid) => /@s\.whatsapp\.net$/.test(String(jid || ''));

// Telefone (só dígitos) de um identificador do WhatsApp "5511999999999@s.whatsapp.net" (ou com ":dispositivo")
export function telefoneDoJid(jid) {
  if (!ehTelefoneJid(jid)) return null;
  const usuario = String(jid).split('@')[0].split(':')[0];
  return /^\d{8,15}$/.test(usuario) ? usuario : null;
}

/**
 * Lead para um telefone: o mais recente entre os leads com o mesmo número (com e sem o 9º dígito).
 * Devolve { leadId, duplicados: [ids dos outros leads com o mesmo telefone] }.
 */
export function leadDoTelefone(phone) {
  const v = variantesTelefone(phone);
  if (!v.length) return { leadId: null, duplicados: [] };
  const leads = all(
    `SELECT id FROM leads WHERE phone IN (${v.map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`,
    v
  ).map((r) => r.id);
  return { leadId: leads[0] || null, duplicados: leads.slice(1) };
}

// Registra no histórico do lead que existem outros leads com o mesmo telefone (uma vez por combinação)
export function registrarDuplicados(leadId, duplicados, phone) {
  if (!leadId || !duplicados?.length) return;
  const outros = [...duplicados].sort((a, b) => a - b);
  const ja = all("SELECT data FROM lead_events WHERE lead_id = ? AND type = 'whatsapp_duplicado'", [leadId]).some((e) => {
    const d = lerJson(e.data);
    return JSON.stringify(d.outros || []) === JSON.stringify(outros);
  });
  if (ja) return;
  registrarEvento({ leadId, type: 'whatsapp_duplicado', data: { outros, telefone: phone } });
}

/**
 * Liga uma conversa individual a um lead e grava/atualiza o contato.
 *  chatJid: identificador da conversa (telefone@s.whatsapp.net ou xxx@lid)
 *  phone: telefone já conhecido (pode ser null)
 *  criar: função que cria o lead quando não existe nenhum (ou null para não criar)
 * Precisa rodar dentro de uma transação. Devolve o id do lead (ou null).
 */
export function vincularConversa({ chatJid, phone = null, pushName = null, criar = null }) {
  if (!chatJid || ehGrupo(chatJid)) return null;
  phone = phone || telefoneDoJid(chatJid);
  const contato = get('SELECT lead_id, phone FROM wa_contacts WHERE jid = ?', [chatJid]);
  phone = phone || contato?.phone || null;

  let leadId = contato?.lead_id && get('SELECT 1 FROM leads WHERE id = ?', [contato.lead_id]) ? contato.lead_id : null;
  if (!leadId && phone) {
    const achado = leadDoTelefone(phone);
    leadId = achado.leadId;
    registrarDuplicados(leadId, achado.duplicados, phone);
  }
  if (!leadId && phone) {
    // Outra conversa do mesmo telefone (ex.: o LID e o número) já está ligada a um lead
    const v = variantesTelefone(phone);
    leadId = get(
      `SELECT c.lead_id FROM wa_contacts c JOIN leads l ON l.id = c.lead_id
        WHERE c.phone IN (${v.map(() => '?').join(',')}) ORDER BY l.created_at DESC LIMIT 1`,
      v
    )?.lead_id || null;
  }
  if (!leadId && criar) leadId = criar({ phone, pushName }) || null;
  if (leadId) {
    if (phone) run('UPDATE leads SET phone = COALESCE(phone, ?) WHERE id = ?', [phone, leadId]);
    if (pushName) run('UPDATE leads SET name = COALESCE(name, ?) WHERE id = ?', [pushName, leadId]);
  }

  run(
    `INSERT INTO wa_contacts (jid, phone, lead_id, push_name, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       phone = COALESCE(wa_contacts.phone, excluded.phone),
       lead_id = COALESCE(wa_contacts.lead_id, excluded.lead_id),
       push_name = COALESCE(excluded.push_name, wa_contacts.push_name),
       updated_at = excluded.updated_at`,
    [chatJid, phone, leadId, pushName || null, agora()]
  );
  if (leadId) run('UPDATE wa_messages SET lead_id = ? WHERE chat_jid = ? AND lead_id IS NULL', [leadId, chatJid]);
  return leadId;
}

/**
 * Atualiza "último contato" e "primeiro contato" dos leads a partir das mensagens enviadas por nós.
 * Só avança datas (último contato fica com o mais recente; primeiro contato com o mais antigo).
 * leadIds: limita a esses leads (null = todos)
 */
export function atualizarContatosDosLeads(leadIds = null) {
  const filtro = leadIds ? `AND lead_id IN (${leadIds.map(() => '?').join(',')})` : '';
  const params = leadIds || [];
  if (leadIds && !leadIds.length) return 0;
  const { changes } = run(
    `UPDATE leads SET
       last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < x.ultima THEN x.ultima ELSE last_contact_at END,
       first_contact_at = CASE WHEN first_contact_at IS NULL OR first_contact_at > x.primeira THEN x.primeira ELSE first_contact_at END,
       updated_at = ?
     FROM (SELECT lead_id, max(timestamp) AS ultima, min(timestamp) AS primeira
             FROM wa_messages WHERE from_me = 1 AND lead_id IS NOT NULL ${filtro} GROUP BY lead_id) AS x
     WHERE x.lead_id = leads.id
       AND (leads.last_contact_at IS NULL OR leads.last_contact_at < x.ultima
            OR leads.first_contact_at IS NULL OR leads.first_contact_at > x.primeira)`,
    [agora(), ...params]
  );
  return changes;
}

/**
 * "Religar tudo": liga ao lead toda conversa individual ainda sem lead cujo telefone bate com algum lead.
 * Idempotente e barata (algumas consultas em lote). Roda na subida do servidor, depois de cada
 * importação de histórico e quando leads são criados ou têm o telefone alterado.
 * Devolve quantas conversas foram ligadas.
 */
export function religarTudo() {
  return tx(() => {
    // Mapa telefone (todas as variantes) → leads, do mais antigo para o mais novo
    const porTelefone = new Map();
    for (const l of all('SELECT id, phone FROM leads WHERE phone IS NOT NULL ORDER BY created_at ASC, id ASC')) {
      for (const v of variantesTelefone(l.phone)) {
        if (!porTelefone.has(v)) porTelefone.set(v, []);
        const lista = porTelefone.get(v);
        if (!lista.includes(l.id)) lista.push(l.id);
      }
    }

    const soltos = all(
      `SELECT jid, phone FROM wa_contacts
        WHERE lead_id IS NULL AND jid NOT LIKE '%@g.us'
          AND (phone IS NOT NULL OR jid LIKE '%@s.whatsapp.net')`
    );
    let ligados = 0;
    const tocados = new Set();
    for (const c of soltos) {
      const phone = c.phone || telefoneDoJid(c.jid);
      if (!phone) continue;
      const candidatos = new Set();
      for (const v of variantesTelefone(phone)) for (const id of porTelefone.get(v) || []) candidatos.add(id);
      if (!candidatos.size) continue;
      // O mais recente é o último da lista (ordenada por criação)
      const ordenados = all(
        `SELECT id FROM leads WHERE id IN (${[...candidatos].map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`,
        [...candidatos]
      ).map((r) => r.id);
      const leadId = ordenados[0];
      run('UPDATE wa_contacts SET lead_id = ?, phone = COALESCE(phone, ?) WHERE jid = ? AND lead_id IS NULL', [leadId, phone, c.jid]);
      registrarDuplicados(leadId, ordenados.slice(1), phone);
      ligados++;
      tocados.add(leadId);
    }

    // Mensagens sem lead de conversas que já têm lead
    const { changes } = run(
      `UPDATE wa_messages SET lead_id = c.lead_id
         FROM wa_contacts c
        WHERE wa_messages.lead_id IS NULL AND c.jid = wa_messages.chat_jid AND c.lead_id IS NOT NULL
          AND wa_messages.chat_jid NOT LIKE '%@g.us'`
    );
    if (changes || tocados.size) atualizarContatosDosLeads(null);
    return ligados;
  });
}

/**
 * Liga ao lead as conversas que já existiam com o telefone dele (lead novo ou telefone editado).
 * Não tira conversas de outro lead.
 */
export function ligarConversasDoLead(leadId, phone) {
  const telefones = variantesTelefone(phone);
  if (!leadId || !telefones.length) return 0;
  const lista = telefones.map(() => '?').join(',');
  // Contatos do mesmo telefone, pelo número ou pelo LID já mapeado
  const jids = all(
    `SELECT jid FROM wa_contacts WHERE lead_id IS NULL AND jid NOT LIKE '%@g.us' AND phone IN (${lista})`,
    telefones
  ).map((r) => r.jid);
  for (const t of telefones) {
    const jid = `${t}@s.whatsapp.net`;
    if (!jids.includes(jid) && get('SELECT 1 FROM wa_messages WHERE chat_jid = ? AND lead_id IS NULL LIMIT 1', [jid])) {
      run(
        `INSERT INTO wa_contacts (jid, phone, lead_id, updated_at) VALUES (?, ?, NULL, ?) ON CONFLICT(jid) DO NOTHING`,
        [jid, t, agora()]
      );
      jids.push(jid);
    }
  }
  if (!jids.length) return 0;
  const marcas = jids.map(() => '?').join(',');
  run(`UPDATE wa_contacts SET lead_id = ? WHERE lead_id IS NULL AND jid IN (${marcas})`, [leadId, ...jids]);
  const { changes } = run(`UPDATE wa_messages SET lead_id = ? WHERE lead_id IS NULL AND chat_jid IN (${marcas})`, [leadId, ...jids]);
  atualizarContatosDosLeads([leadId]);
  return changes;
}
