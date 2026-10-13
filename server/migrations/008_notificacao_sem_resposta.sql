-- 008: notificação "lead mandou mensagem e ninguém respondeu" nos cartões do kanban.
-- notif_cleared_at = quando alguém limpou o aviso à mão; mensagens do lead depois disso acendem o aviso de novo.
ALTER TABLE leads ADD COLUMN notif_cleared_at TEXT;
-- Acelera "última mensagem do lead" e "última mensagem nossa" por lead
CREATE INDEX wa_messages_lead_dir_idx ON wa_messages (lead_id, from_me, timestamp);
