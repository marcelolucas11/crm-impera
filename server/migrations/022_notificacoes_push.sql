-- 022: Notificações no celular (app instalado / PWA).
-- Só acrescenta: aparelhos inscritos para receber notificações e a marca de "já avisei" em cada reunião do Calendly.

-- Cada aparelho (celular, tablet, computador) que ligou as notificações no CRM
CREATE TABLE push_inscricoes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  aparelho TEXT,
  user_agent TEXT,
  falhas INTEGER NOT NULL DEFAULT 0,
  ultimo_envio_at TEXT,
  ultimo_ok_at TEXT,
  ultimo_erro TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX push_inscricoes_endpoint_unique ON push_inscricoes (endpoint);
CREATE INDEX push_inscricoes_user_idx ON push_inscricoes (user_id);

-- Quando o CRM avisou os celulares sobre esta reunião (evita avisar duas vezes)
ALTER TABLE calendly_events ADD COLUMN notificado_em TEXT;

-- Reuniões que já estavam no CRM antes desta versão não disparam notificação
UPDATE calendly_events SET notificado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE notificado_em IS NULL;
