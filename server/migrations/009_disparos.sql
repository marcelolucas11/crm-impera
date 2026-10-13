-- 009: aba "Disparos" — saudação automática dos leads do Yay! Forms, campanhas com fluxo de mensagens
-- (texto, áudio, vídeo, imagem/GIF, arquivo) e timers, listas de contatos, modelos de fluxo, lista de bloqueio
-- e a fila de envio que roda no servidor. Só acrescenta tabelas novas: nada existente é alterado.

-- Mídias enviadas pelos fluxos (o arquivo fica em FILES_DIR/disparos/...)
CREATE TABLE disparo_midias (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  tamanho INTEGER NOT NULL DEFAULT 0,
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Listas de contatos salvas
CREATE TABLE disparo_listas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Membros: o telefone (já normalizado, com o 9º dígito no Brasil) é a chave — o mesmo número não entra duas vezes
CREATE TABLE disparo_lista_membros (
  lista_id INTEGER NOT NULL REFERENCES disparo_listas(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  nome TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (lista_id, phone)
);
CREATE INDEX disparo_lista_membros_lead_idx ON disparo_lista_membros (lead_id);

-- Modelos de fluxo (blocos + timers) para carregar com 1 clique
CREATE TABLE disparo_modelos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  blocos TEXT NOT NULL DEFAULT '[]',
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Campanhas. tipo: campanha | yayforms (a saudação automática, uma linha só) | teste
-- status: executando | pausada | concluida | cancelada
CREATE TABLE disparo_campanhas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'campanha',
  status TEXT NOT NULL DEFAULT 'executando',
  numero_id INTEGER REFERENCES wa_instances(id) ON DELETE SET NULL,
  blocos TEXT NOT NULL DEFAULT '[]',
  -- { intervalo: { modo, fixo, min, max }, lote: { ativo, contatos, minutos }, janela: { ativa, inicio, fim, dias } }
  config TEXT NOT NULL DEFAULT '{}',
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Próximo envio previsto (timer entre contatos / descanso do lote): sobrevive a reinícios
  proximo_em TEXT,
  -- Contatos enviados desde o último descanso do lote
  no_lote INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX disparo_campanhas_status_idx ON disparo_campanhas (status);

-- Fila: um item por contato da campanha. status: pendente | enviando | enviado | falha | pulado | cancelado
CREATE TABLE disparo_fila (
  id INTEGER PRIMARY KEY,
  campanha_id INTEGER NOT NULL REFERENCES disparo_campanhas(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  nome TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  -- Blocos do fluxo já enviados para este contato (para continuar de onde parou depois de pausar/reiniciar)
  bloco_atual INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  -- Não envia antes deste horário (atraso inicial da saudação do Yay! Forms)
  agendado_para TEXT,
  iniciado_em TEXT,
  enviado_em TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX disparo_fila_campanha_idx ON disparo_fila (campanha_id, status, agendado_para, id);
CREATE INDEX disparo_fila_phone_idx ON disparo_fila (phone, created_at);

-- Não perturbe: números que nunca recebem disparos automáticos
CREATE TABLE disparo_bloqueio (
  phone TEXT PRIMARY KEY,
  nome TEXT,
  motivo TEXT,
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
