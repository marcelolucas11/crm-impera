// Contatos para os disparos: leads do kanban + contatos do WhatsApp, num só lugar e sem repetir números.
// Um contato do WhatsApp cujo telefone já é de um lead (com ou sem o 9º dígito, com ou sem o 55) aparece
// uma vez só, como lead, com os dados do kanban.
import { all, get } from '../../db.js';
import { lerJson } from '../../events.js';
import { chaveTelefone } from './texto.js';

const ORIGENS = { yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', calendly: 'Calendly', manual: 'Manual' };

// Etiquetas (do WhatsApp do CRM) de cada identificador de conversa
function etiquetasPorJid() {
  const nomes = new Map(all('SELECT id, name, color FROM wa_labels').map((l) => [l.id, { id: l.id, nome: l.name, cor: l.color }]));
  const mapa = new Map();
  for (const c of all('SELECT jid, labels FROM wa_chats WHERE labels IS NOT NULL')) {
    const lista = lerJson(c.labels, []).map((id) => nomes.get(Number(id))).filter(Boolean);
    if (lista.length) mapa.set(c.jid, lista);
  }
  return mapa;
}

/**
 * Lista unificada. Cada item:
 *  { chave, tipo: 'kanban'|'whatsapp', telefone, nome, lead_id, etapa: {id,nome,cor}, etiquetas, origem, formulario, empresa, email, extras }
 */
export function listarContatos() {
  const etiquetasJid = etiquetasPorJid();
  const contatosWa = all(
    `SELECT jid, phone, lead_id, name, push_name FROM wa_contacts
      WHERE jid NOT LIKE '%@g.us' AND phone IS NOT NULL AND phone <> ''`
  );

  // Etiquetas e nome do WhatsApp por lead (um lead pode ter mais de um identificador)
  const porLead = new Map();
  for (const c of contatosWa) {
    if (!c.lead_id) continue;
    const atual = porLead.get(c.lead_id) || { etiquetas: new Map(), nomeWa: null };
    for (const e of etiquetasJid.get(c.jid) || []) atual.etiquetas.set(e.id, e);
    atual.nomeWa = atual.nomeWa || c.name || c.push_name || null;
    porLead.set(c.lead_id, atual);
  }

  const resultado = [];
  const vistos = new Map(); // telefone canônico → índice no resultado

  const leads = all(
    `SELECT l.id, l.name, l.phone, l.email, l.company, l.source, l.extra, l.created_at,
            s.id AS stage_id, s.name AS stage_name, s.color AS stage_color, s.position AS stage_pos
       FROM leads l JOIN stages s ON s.id = l.stage_id
      WHERE l.phone IS NOT NULL AND l.phone <> ''
      ORDER BY l.created_at DESC`
  );
  for (const l of leads) {
    const tel = chaveTelefone(l.phone);
    if (!tel || vistos.has(tel)) continue;
    const extra = lerJson(l.extra, {});
    const extras = [];
    if (l.company) extras.push(l.company);
    if (extra.utm?.utm_campaign) extras.push(`Campanha: ${extra.utm.utm_campaign}`);
    const ligacao = porLead.get(l.id);
    vistos.set(tel, resultado.length);
    resultado.push({
      chave: `l:${l.id}`,
      tipo: 'kanban',
      telefone: tel,
      nome: l.name || ligacao?.nomeWa || null,
      lead_id: l.id,
      email: l.email || null,
      etapa: { id: l.stage_id, nome: l.stage_name, cor: l.stage_color, posicao: l.stage_pos },
      etiquetas: ligacao ? [...ligacao.etiquetas.values()] : [],
      origem: ORIGENS[l.source] || l.source,
      formulario: extra.formulario || null,
      parcial: Boolean(extra.parcial),
      extras,
      criado_em: l.created_at,
    });
  }

  // Contatos do WhatsApp que não são leads (os que já são lead ficaram acima, enriquecidos)
  for (const c of contatosWa) {
    const tel = chaveTelefone(c.phone);
    if (!tel) continue;
    const idx = vistos.get(tel);
    if (idx !== undefined) {
      // Mesmo número de um lead: só completa o nome e as etiquetas
      const item = resultado[idx];
      if (!item.nome) item.nome = c.name || c.push_name || null;
      for (const e of etiquetasJid.get(c.jid) || []) if (!item.etiquetas.some((x) => x.id === e.id)) item.etiquetas.push(e);
      continue;
    }
    vistos.set(tel, resultado.length);
    resultado.push({
      chave: `t:${c.phone}`,
      tipo: 'whatsapp',
      telefone: tel,
      nome: c.name || c.push_name || null,
      lead_id: null,
      etapa: null,
      etiquetas: etiquetasJid.get(c.jid) || [],
      origem: null,
      formulario: null,
      extras: [],
    });
  }
  return resultado;
}

// Nome e lead de um telefone (para adicionar números digitados à mão)
export function identificarTelefone(phone) {
  const tel = chaveTelefone(phone);
  if (!tel) return null;
  const variantes = [...new Set([tel, tel.replace(/^55(\d{2})9(\d{8})$/, '55$1$2')])];
  const lead = get(
    `SELECT id, name FROM leads WHERE phone IN (${variantes.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 1`,
    variantes
  );
  const wa = !lead
    ? get(`SELECT name, push_name FROM wa_contacts WHERE phone IN (${variantes.map(() => '?').join(',')}) ORDER BY name IS NULL LIMIT 1`, variantes)
    : null;
  return { telefone: tel, lead_id: lead?.id || null, nome: lead?.name || wa?.name || wa?.push_name || null };
}
