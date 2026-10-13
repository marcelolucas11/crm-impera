-- 006: WhatsApp no nível do WhatsApp Web — histórico de 3 meses, grupos, estado das conversas
-- (fixar, arquivar, silenciar, etiquetas), mensagens favoritas, "apagar para mim", confirmações
-- com horário, figurinhas e chamadas. Só acrescenta: nenhuma linha é apagada ou alterada.

-- Mensagens de grupo: quem mandou
ALTER TABLE wa_messages ADD COLUMN participant_jid TEXT;
ALTER TABLE wa_messages ADD COLUMN participant_name TEXT;
-- Mensagem marcada com estrela (favorita)
ALTER TABLE wa_messages ADD COLUMN starred_at TEXT;
-- "Apagar para mim": some só da tela do CRM (a mensagem continua guardada)
ALTER TABLE wa_messages ADD COLUMN hidden_at TEXT;
-- Horário em que o contato recebeu / leu / ouviu uma mensagem nossa (Informações da mensagem)
ALTER TABLE wa_messages ADD COLUMN delivered_at TEXT;
ALTER TABLE wa_messages ADD COLUMN seen_at TEXT;
ALTER TABLE wa_messages ADD COLUMN played_at TEXT;

CREATE INDEX wa_messages_chat_unread_idx ON wa_messages (chat_jid, from_me, read_at);
CREATE INDEX wa_messages_starred_idx ON wa_messages (starred_at) WHERE starred_at IS NOT NULL;
CREATE INDEX wa_messages_instance_idx ON wa_messages (instance_id, chat_jid, timestamp);

-- Estado de cada conversa (por identificador do WhatsApp), como no WhatsApp Web
CREATE TABLE wa_chats (
  jid TEXT PRIMARY KEY,
  instance_id INTEGER REFERENCES wa_instances(id) ON DELETE SET NULL,
  -- Nome do grupo (assunto) ou nome da conversa vindo do celular
  name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned_at TEXT,
  muted_until TEXT,
  marked_unread INTEGER NOT NULL DEFAULT 0,
  -- Conversa favorita (filtro "Favoritas" da lista)
  favorite INTEGER NOT NULL DEFAULT 0,
  -- Conversa ocultada da lista (nada é apagado; volta a aparecer com mensagem nova)
  hidden_at TEXT,
  -- Etiquetas do CRM: lista de ids (JSON)
  labels TEXT,
  -- Mensagens temporárias: duração em segundos (0/NULL = desligado)
  ephemeral_seconds INTEGER,
  -- Importação do histórico: 1 = o celular não tem mensagens mais antigas desta conversa
  history_done INTEGER NOT NULL DEFAULT 0,
  history_checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Etiquetas (criadas no CRM)
CREATE TABLE wa_labels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#d7b870',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Figurinhas: favoritas do celular (app state), recentes (enviadas/recebidas) e favoritas do CRM
CREATE TABLE wa_stickers (
  id INTEGER PRIMARY KEY,
  -- Identificador do arquivo (SHA-256 em hex): evita guardar a mesma figurinha duas vezes
  hash TEXT NOT NULL UNIQUE,
  path TEXT,
  mime TEXT NOT NULL DEFAULT 'image/webp',
  animated INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  -- Dados para baixar do WhatsApp (favoritas do celular ainda não baixadas)
  media TEXT,
  phone_favorite INTEGER NOT NULL DEFAULT 0,
  crm_favorite INTEGER NOT NULL DEFAULT 0,
  origin TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX wa_stickers_used_idx ON wa_stickers (last_used_at);
