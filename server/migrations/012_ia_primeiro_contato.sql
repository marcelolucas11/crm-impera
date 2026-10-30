-- 012: IA de primeiro contato — conversa com o lead que acabou de chegar e passa para um humano.
-- Só acrescenta tabelas novas: nada existente é alterado.

-- Uma linha por conversa que a IA avaliou. chave = mesma chave da tela de WhatsApp (l:<lead>, t:<telefone>, j:<jid>)
-- status: ativa (IA atendendo) | aguardando_humano (IA passou para a equipe) | humano (alguém da equipe assumiu)
--         | pausada (desligada à mão nesta conversa) | ignorada (não era lead novo: a IA nunca atua) | erro
CREATE TABLE ia_conversas (
  id INTEGER PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  phone TEXT,
  jid TEXT,
  instance_id INTEGER REFERENCES wa_instances(id) ON DELETE SET NULL,
  origem TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'ativa',
  motivo TEXT,
  -- Resumo que a IA deixa para quem assumir
  resumo TEXT,
  mensagens_ia INTEGER NOT NULL DEFAULT 0,
  avisos_seguranca INTEGER NOT NULL DEFAULT 0,
  -- Última mensagem do lead que a IA já leu (wa_messages.id)
  ultima_lida_id INTEGER NOT NULL DEFAULT 0,
  -- Quando a IA deve olhar a conversa de novo (espera o lead terminar de digitar; sobrevive a reinícios)
  proxima_em TEXT,
  aviso_fora_horario_em TEXT,
  -- Desde quando a IA está atendendo (mensagens da equipe depois disto fazem a IA parar)
  ativada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  iniciada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ia_conversas_lead_idx ON ia_conversas (lead_id);
CREATE INDEX ia_conversas_phone_idx ON ia_conversas (phone);
CREATE INDEX ia_conversas_jid_idx ON ia_conversas (jid);
CREATE INDEX ia_conversas_status_idx ON ia_conversas (status, proxima_em);

-- Modo copiloto: respostas sugeridas que esperam alguém aprovar. status: pendente | enviada | descartada | expirada
CREATE TABLE ia_sugestoes (
  id INTEGER PRIMARY KEY,
  conversa_id INTEGER NOT NULL REFERENCES ia_conversas(id) ON DELETE CASCADE,
  mensagens TEXT NOT NULL DEFAULT '[]',
  acao TEXT NOT NULL DEFAULT 'responder',
  motivo TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  editada INTEGER NOT NULL DEFAULT 0,
  decidida_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decidida_em TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ia_sugestoes_conversa_idx ON ia_sugestoes (conversa_id, status);

-- Registro de tudo que a IA fez (consumo de tokens, mensagens, passagens, bloqueios de segurança)
CREATE TABLE ia_registro (
  id INTEGER PRIMARY KEY,
  conversa_id INTEGER REFERENCES ia_conversas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  detalhe TEXT,
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_saida INTEGER NOT NULL DEFAULT 0,
  tokens_cache INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ia_registro_tipo_idx ON ia_registro (tipo, created_at);
CREATE INDEX ia_registro_conversa_idx ON ia_registro (conversa_id, created_at);
