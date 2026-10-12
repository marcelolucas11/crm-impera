-- 001: estrutura inicial do CRM (SQLite)
-- Datas são guardadas como texto ISO 8601 em UTC (ex.: 2026-10-12T18:30:00.000Z)

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Etapas do kanban. kind: open (em andamento), won (ganho), lost (perdido)
CREATE TABLE stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#d7b870',
  kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO stages (name, position, color, kind) VALUES
  ('Novo lead',          1, '#d7b870', 'open'),
  ('Em contato',         2, '#5b9bd5', 'open'),
  ('Qualificado',        3, '#9b7fd4', 'open'),
  ('Reunião agendada',   4, '#e0a050', 'open'),
  ('Proposta enviada',   5, '#4fb3a9', 'open'),
  ('Fechado',            6, '#5cb85c', 'won'),
  ('Perdido',            7, '#7a7a80', 'lost');

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  company TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  extra TEXT NOT NULL DEFAULT '{}',
  last_contact_at TEXT,
  stage_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX leads_stage_idx ON leads (stage_id);
CREATE INDEX leads_phone_idx ON leads (phone);
CREATE INDEX leads_email_idx ON leads (lower(email));

-- Histórico de tudo que acontece com o lead
CREATE TABLE lead_events (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX lead_events_lead_idx ON lead_events (lead_id, created_at);

-- Todo webhook recebido fica guardado, mesmo se der erro ao processar
CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX webhook_events_received_idx ON webhook_events (received_at);

-- Sessões de login (expire em milissegundos)
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions (expire);
