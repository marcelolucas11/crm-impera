// Ajuda dos testes: banco temporário (nunca toca no banco real) e mensagens de exemplo no formato do Baileys.
// Precisa ser importado ANTES de qualquer arquivo de src/ (a configuração lê as variáveis na importação).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-teste-'));
process.env.DB_FILE = path.join(PASTA, 'crm.db');
process.env.FILES_DIR = path.join(PASTA, 'arquivos');
process.env.WHATSAPP_SESSOES = path.join(PASTA, 'sessoes');
process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-16';
process.env.DDI_PADRAO = '55';
process.env.WHATSAPP_HISTORICO_DIAS = process.env.WHATSAPP_HISTORICO_DIAS || '90';
process.env.WHATSAPP_CRIAR_LEADS = '0';

export const MIGRACOES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function prepararBanco() {
  const db = await import('../src/db.js');
  const { aplicarMigracoes } = await import('../src/migrar.js');
  db.abrirBanco();
  const log = console.log;
  console.log = () => {};
  try { aplicarMigracoes(MIGRACOES); } finally { console.log = log; }
  return db;
}

// Apaga as linhas das tabelas usadas nos testes (só no banco temporário)
export async function limparBanco() {
  const { exec } = await import('../src/db.js');
  exec(`DELETE FROM lead_events; DELETE FROM wa_messages; DELETE FROM wa_contacts; DELETE FROM wa_chats;
        DELETE FROM wa_stickers; DELETE FROM leads; DELETE FROM integration_state;`);
}

export const segundos = (diasAtras) => Math.floor((Date.now() - diasAtras * 86400000) / 1000);

let seq = 0;
// Mensagem no formato do Baileys (WebMessageInfo)
export function mensagem({ jid, deMim = false, texto = 'olá', diasAtras = 0, id = null, pushName = 'Fulano', participante = null, alt = null, extra = {} }) {
  seq++;
  return {
    key: { remoteJid: jid, fromMe: deMim, id: id || `TESTE${seq}${Date.now()}`, ...(participante ? { participant: participante } : {}), ...(alt ? { remoteJidAlt: alt } : {}) },
    message: { conversation: texto },
    messageTimestamp: segundos(diasAtras),
    pushName: deMim ? undefined : pushName,
    ...extra,
  };
}

// Socket falso: só o que o recebimento usa (usuário logado e mapeamento LID → telefone)
export function socketFalso({ lids = {} } = {}) {
  return {
    user: { id: '5511900000000:1@s.whatsapp.net', lid: '99999999999999@lid' },
    signalRepository: { lidMapping: { getPNForLID: async (lid) => lids[lid] || null } },
  };
}

export async function criarLeadDireto({ nome = 'Lead', telefone, criadoEm = null }) {
  const { run, get } = await import('../src/db.js');
  const etapa = get('SELECT id FROM stages ORDER BY position LIMIT 1').id;
  const r = run('INSERT INTO leads (name, phone, stage_id, created_at) VALUES (?, ?, ?, ?)', [nome, telefone, etapa, criadoEm || new Date().toISOString()]);
  return Number(r.lastInsertRowid);
}
