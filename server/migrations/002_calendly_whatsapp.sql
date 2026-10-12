-- 002: Calendly e WhatsApp

-- Estado de cada integração (última sincronização, erros, conta conectada)
CREATE TABLE integration_state (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Reuniões vindas do Calendly
CREATE TABLE calendly_events (
  uri TEXT PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  event_name TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  status TEXT NOT NULL,
  join_url TEXT,
  invitee_name TEXT,
  invitee_email TEXT,
  invitee_phone TEXT,
  remote_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX calendly_events_lead_idx ON calendly_events (lead_id, start_time);

-- Números de WhatsApp conectados por QR code
CREATE TABLE wa_instances (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Quem é quem no WhatsApp: identificador da conversa → lead
CREATE TABLE wa_contacts (
  jid TEXT PRIMARY KEY,
  phone TEXT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  push_name TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX wa_contacts_lead_idx ON wa_contacts (lead_id);
CREATE INDEX wa_contacts_phone_idx ON wa_contacts (phone);

-- Mensagens
CREATE TABLE wa_messages (
  id INTEGER PRIMARY KEY,
  instance_id INTEGER REFERENCES wa_instances(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  from_me INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'texto',
  body TEXT,
  sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  timestamp TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX wa_messages_unique ON wa_messages (wa_id, from_me);
CREATE INDEX wa_messages_lead_idx ON wa_messages (lead_id, timestamp);
CREATE INDEX wa_messages_unread_idx ON wa_messages (lead_id, from_me, read_at);
