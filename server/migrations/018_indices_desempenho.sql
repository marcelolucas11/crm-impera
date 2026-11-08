-- Versão 0.27: índices para as consultas que as telas fazem o tempo todo (só acrescenta, não mexe em dados).

-- Contador de conversas não lidas (aba WhatsApp no topo): lê só as mensagens ainda não lidas, não a tabela inteira
CREATE INDEX IF NOT EXISTS wa_messages_nao_lidas_idx ON wa_messages (chat_jid, lead_id) WHERE from_me = 0 AND read_at IS NULL;

-- Etapa + data de contato dos leads (contadores de follow-up atrasado)
CREATE INDEX IF NOT EXISTS leads_followup_idx ON leads (stage_id, last_contact_at, created_at);
