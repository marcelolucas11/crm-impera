-- 001: estrutura inicial do CRM

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Etapas do kanban. kind: open (em andamento), won (ganho), lost (perdido)
CREATE TABLE stages (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL,
  color text NOT NULL DEFAULT '#d7b870',
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  created_at timestamptz NOT NULL DEFAULT now()
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
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text,
  phone text,
  email text,
  company text,
  source text NOT NULL DEFAULT 'manual',
  stage_id integer NOT NULL REFERENCES stages(id),
  owner_id integer REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_contact_at timestamptz,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_stage_idx ON leads (stage_id);
CREATE INDEX leads_phone_idx ON leads (phone);
CREATE INDEX leads_email_idx ON leads (lower(email));

-- Histórico de tudo que acontece com o lead
CREATE TABLE lead_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_events_lead_idx ON lead_events (lead_id, created_at DESC);

-- Todo webhook recebido fica guardado, mesmo se der erro ao processar
CREATE TABLE webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  payload jsonb NOT NULL,
  lead_id integer REFERENCES leads(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received',
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_received_idx ON webhook_events (received_at DESC);

-- Sessões de login
CREATE TABLE sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions (expire);
