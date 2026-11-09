-- Versão 0.28: Direct do Instagram pelo login do perfil (motor não oficial, instagrapi), ao lado da API oficial.
-- Só acrescenta colunas. O motor de cada perfil fica em ig_perfis.config (direct_motor = 'oficial' | 'login').

-- Identificador da pessoa no Instagram (pk). Com o motor de login, liga a pessoa à conversa que já existia pela API oficial.
ALTER TABLE ig_contatos ADD COLUMN pk TEXT;
CREATE INDEX IF NOT EXISTS ig_contatos_pk_idx ON ig_contatos (perfil_id, pk) WHERE pk IS NOT NULL;

-- Conversa (thread) do Instagram usada pelo motor de login para buscar e responder
ALTER TABLE ig_conversas ADD COLUMN thread_id TEXT;
-- Conversa que ainda está em "Solicitações de mensagem" no app
ALTER TABLE ig_conversas ADD COLUMN pendente INTEGER NOT NULL DEFAULT 0;
