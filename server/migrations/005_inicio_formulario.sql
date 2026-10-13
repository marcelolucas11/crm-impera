-- 005: horário em que a pessoa começou a preencher o formulário do Yay! Forms.
-- O "Iniciado há…" do cartão passa a usar este horário (e não o horário em que o webhook chegou).
-- Os leads antigos são preenchidos a partir dos webhooks guardados quando o CRM liga.
ALTER TABLE leads ADD COLUMN form_started_at TEXT;
