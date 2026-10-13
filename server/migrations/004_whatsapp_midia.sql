-- 004: WhatsApp completo — mídia, confirmações de leitura, respostas citadas, reações,
-- mensagens apagadas/editadas, nome da agenda e fotos de perfil

-- Mídia (imagem, áudio, vídeo, documento, figurinha). O arquivo fica em FILES_DIR/whatsapp/...
ALTER TABLE wa_messages ADD COLUMN legenda TEXT;
ALTER TABLE wa_messages ADD COLUMN media_mime TEXT;
ALTER TABLE wa_messages ADD COLUMN media_path TEXT;
ALTER TABLE wa_messages ADD COLUMN media_name TEXT;
ALTER TABLE wa_messages ADD COLUMN media_size INTEGER;
ALTER TABLE wa_messages ADD COLUMN media_seconds INTEGER;
ALTER TABLE wa_messages ADD COLUMN media_w INTEGER;
ALTER TABLE wa_messages ADD COLUMN media_h INTEGER;
-- pendente | ok | erro
ALTER TABLE wa_messages ADD COLUMN media_status TEXT;
-- Miniatura pequena (JPEG em base64) que o WhatsApp manda junto, mostrada até a mídia baixar
ALTER TABLE wa_messages ADD COLUMN thumb TEXT;
-- Áudio gravado na hora (mensagem de voz)
ALTER TABLE wa_messages ADD COLUMN ptt INTEGER NOT NULL DEFAULT 0;
-- Mensagem original do WhatsApp (para baixar a mídia depois e para responder citando)
ALTER TABLE wa_messages ADD COLUMN raw TEXT;
-- 0 erro · 1 enviando · 2 enviada (✓) · 3 entregue (✓✓) · 4 lida (✓✓ azul) · 5 áudio ouvido
ALTER TABLE wa_messages ADD COLUMN status INTEGER;
ALTER TABLE wa_messages ADD COLUMN quoted_wa_id TEXT;
ALTER TABLE wa_messages ADD COLUMN quoted_body TEXT;
ALTER TABLE wa_messages ADD COLUMN quoted_from_me INTEGER;
-- Reações: {"eu": "👍", "contato": "❤️"}
ALTER TABLE wa_messages ADD COLUMN reactions TEXT;
ALTER TABLE wa_messages ADD COLUMN edited_at TEXT;
ALTER TABLE wa_messages ADD COLUMN deleted_at TEXT;
-- Localização, cartão de contato etc. (JSON)
ALTER TABLE wa_messages ADD COLUMN extra TEXT;

-- As mensagens antigas (de antes desta versão) já foram entregues
UPDATE wa_messages SET status = 2 WHERE from_me = 1 AND status IS NULL;

CREATE INDEX wa_messages_chat_idx ON wa_messages (chat_jid, timestamp);

-- Nome do contato como está salvo na agenda do celular
ALTER TABLE wa_contacts ADD COLUMN name TEXT;

-- Fotos de perfil baixadas do WhatsApp (path NULL = contato sem foto). Revisadas de tempos em tempos.
CREATE TABLE wa_photos (
  jid TEXT PRIMARY KEY,
  path TEXT,
  checked_at TEXT NOT NULL
);
