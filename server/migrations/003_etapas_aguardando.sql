-- 003: etapas editáveis (papéis), "aguardando resposta" e data do primeiro contato

-- Papel da etapa: 'entrada' (onde leads novos entram) ou 'reuniao' (para onde o Calendly move)
ALTER TABLE stages ADD COLUMN role TEXT;
UPDATE stages SET role = 'entrada'
 WHERE id = (SELECT id FROM stages WHERE kind = 'open' ORDER BY position, id LIMIT 1);
UPDATE stages SET role = 'reuniao'
 WHERE role IS NULL
   AND id = (SELECT id FROM stages WHERE kind = 'open' AND lower(name) LIKE '%reuni%' ORDER BY position, id LIMIT 1);

-- Lead marcado como "aguardando minha resposta"
ALTER TABLE leads ADD COLUMN waiting_since TEXT;
ALTER TABLE leads ADD COLUMN waiting_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN waiting_note TEXT;

-- Primeiro contato com o lead (para medir tempo de resposta)
ALTER TABLE leads ADD COLUMN first_contact_at TEXT;
UPDATE leads SET first_contact_at =
  (SELECT min(created_at) FROM lead_events e WHERE e.lead_id = leads.id AND e.type = 'contact');
UPDATE leads SET first_contact_at =
  (SELECT min(timestamp) FROM wa_messages m WHERE m.lead_id = leads.id AND m.from_me = 1)
 WHERE (SELECT min(timestamp) FROM wa_messages m WHERE m.lead_id = leads.id AND m.from_me = 1) < COALESCE(first_contact_at, '9999');

CREATE INDEX leads_created_idx ON leads (created_at);
CREATE INDEX wa_messages_timestamp_idx ON wa_messages (timestamp);
