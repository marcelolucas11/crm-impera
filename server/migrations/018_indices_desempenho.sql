-- Versão 0.27: índices para as consultas que as telas fazem o tempo todo (só acrescenta, não mexe em dados).

-- Contador de conversas não lidas (aba WhatsApp no topo): lê só as mensagens ainda não lidas, não a tabela inteira
CREATE INDEX IF NOT EXISTS wa_messages_nao_lidas_idx ON wa_messages (chat_jid, lead_id) WHERE from_me = 0 AND read_at IS NULL;

-- Etapa + data de contato dos leads (contadores de follow-up atrasado)
CREATE INDEX IF NOT EXISTS leads_followup_idx ON leads (stage_id, last_contact_at, created_at);

-- Webhooks do Yay! Forms pelo ID da resposta (parcial → completa, e o link do Calendly que traz o ID).
-- Antes cada busca abria o JSON de todos os webhooks guardados (o Calendly fazia isso a cada reunião, a cada 5 min).
ALTER TABLE webhook_events ADD COLUMN resposta_id TEXT;
UPDATE webhook_events SET resposta_id = json_extract(payload, '$.response.id')
 WHERE source = 'yayforms' AND json_valid(payload) AND json_extract(payload, '$.response.id') IS NOT NULL;
CREATE INDEX IF NOT EXISTS webhook_events_resposta_idx ON webhook_events (resposta_id) WHERE resposta_id IS NOT NULL;
-- Webhooks novos ganham o ID sozinhos (vale para qualquer parte do CRM que grave em webhook_events)
CREATE TRIGGER IF NOT EXISTS webhook_events_resposta_ins AFTER INSERT ON webhook_events
WHEN NEW.source = 'yayforms' AND NEW.resposta_id IS NULL AND json_valid(NEW.payload)
BEGIN
  UPDATE webhook_events SET resposta_id = json_extract(NEW.payload, '$.response.id') WHERE id = NEW.id;
END;
