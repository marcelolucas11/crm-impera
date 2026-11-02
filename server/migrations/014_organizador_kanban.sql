-- 014: Organizador do kanban por IA — lê as conversas dos leads e avança cada um pelas etapas sozinho.
-- Só acrescenta: nova etapa "Aguardando proposta", novos papéis de etapa, colunas novas no lead e duas tabelas.

-- 1) Etapa "Aguardando proposta" logo depois da etapa de reuniões (se ainda não existir uma com esse nome)
CREATE TEMP TABLE _ancora AS
SELECT
  COALESCE(
    (SELECT position FROM stages WHERE role = 'reuniao' AND kind = 'open' ORDER BY position LIMIT 1),
    (SELECT min(position) - 1 FROM stages WHERE kind = 'open' AND lower(name) LIKE '%proposta%'),
    (SELECT max(position) FROM stages WHERE kind = 'open'),
    0
  ) AS pos,
  NOT EXISTS (SELECT 1 FROM stages WHERE lower(name) LIKE '%aguardando proposta%') AS criar;

UPDATE stages SET position = position + 1
 WHERE (SELECT criar FROM _ancora) AND position > (SELECT pos FROM _ancora);

INSERT INTO stages (name, position, color, kind)
SELECT 'Aguardando proposta', pos + 1, '#d48a6a', 'open' FROM _ancora WHERE criar;

DROP TABLE _ancora;

-- 2) Papéis que o organizador usa para saber o que cada etapa significa (editáveis em "Editar etapas")
UPDATE stages SET role = 'aguardando_proposta'
 WHERE id = (SELECT id FROM stages WHERE role IS NULL AND kind = 'open' AND lower(name) LIKE '%aguardando proposta%' ORDER BY position LIMIT 1);
UPDATE stages SET role = 'contato'
 WHERE id = (SELECT id FROM stages WHERE role IS NULL AND kind = 'open' AND lower(name) LIKE '%contato%' ORDER BY position LIMIT 1);
UPDATE stages SET role = 'qualificado'
 WHERE id = (SELECT id FROM stages WHERE role IS NULL AND kind = 'open' AND lower(name) LIKE '%qualific%' ORDER BY position LIMIT 1);
UPDATE stages SET role = 'proposta'
 WHERE id = (SELECT id FROM stages WHERE role IS NULL AND kind = 'open' AND lower(name) LIKE '%proposta%'
               AND lower(name) NOT LIKE '%aguardando%' ORDER BY position LIMIT 1);

-- 3) O que a IA concluiu do lead (aparece no cartão e na ficha)
ALTER TABLE leads ADD COLUMN ia_temperatura INTEGER;
ALTER TABLE leads ADD COLUMN ia_resumo TEXT;
ALTER TABLE leads ADD COLUMN ia_objecao TEXT;
ALTER TABLE leads ADD COLUMN ia_avaliado_em TEXT;
-- Última mensagem (wa_messages.id) que o organizador já leu deste lead
ALTER TABLE leads ADD COLUMN ia_msg_id INTEGER;
-- Lead com conversa nova esperando a próxima varredura
ALTER TABLE leads ADD COLUMN ia_pendente_desde TEXT;
-- Etapas para onde a IA não pode mais levar este lead (alguém desfez uma movimentação dela). JSON: [stage_id, ...]
ALTER TABLE leads ADD COLUMN ia_vetos TEXT;
CREATE INDEX leads_ia_pendente_idx ON leads (ia_pendente_desde);

-- 4) Toda movimentação feita pelo organizador (com o motivo e o botão de desfazer)
CREATE TABLE organizador_movimentos (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  de_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  para_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  de_nome TEXT,
  para_nome TEXT,
  -- regra (sem IA: mensagem enviada, PDF, Calendly) | ia (decidido pela leitura da conversa)
  origem TEXT NOT NULL DEFAULT 'ia',
  -- varredura (automática a cada X minutos) | organizar (botão "Organizar tudo")
  modo TEXT NOT NULL DEFAULT 'varredura',
  motivo TEXT,
  trecho TEXT,
  desfeito_em TEXT,
  desfeito_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX organizador_movimentos_idx ON organizador_movimentos (created_at);
CREATE INDEX organizador_movimentos_lead_idx ON organizador_movimentos (lead_id, created_at);

-- 5) Consumo de cada chamada ao modelo (para o limite de gasto por dia)
CREATE TABLE organizador_uso (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  modelo TEXT NOT NULL,
  modo TEXT NOT NULL DEFAULT 'varredura',
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_saida INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  custo_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX organizador_uso_idx ON organizador_uso (created_at);
