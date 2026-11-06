-- 015: Agente Alice — assistente pessoal de cada usuário do CRM (aba IA → Agente Alice).
-- Chat com ferramentas que leem o CRM inteiro, ações que só acontecem com aprovação, cérebro (contexto do CRM,
-- diretrizes e memória), agendados e transcrição de áudio na própria VPS.
-- Só acrescenta tabelas e colunas novas: nada existente é alterado ou apagado.

-- Configuração e cérebro de cada usuário (uma linha por usuário; criada na primeira vez que ele abre a Alice)
CREATE TABLE agente_usuarios (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- JSON: nome, modelos, tetos, fuso, canal do WhatsApp, melhoria automática do contexto…
  config TEXT NOT NULL DEFAULT '{}',
  -- "Contexto do CRM": o prompt que a Alice monta lendo o CRM (editável)
  contexto TEXT NOT NULL DEFAULT '',
  contexto_origem TEXT,
  contexto_atualizado_em TEXT,
  -- Até quando as conversas já foram lidas para o contexto (a melhoria lê só o que veio depois)
  contexto_lido_ate TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE agente_contexto_versoes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  origem TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_contexto_versoes_idx ON agente_contexto_versoes (user_id, id);

-- Diretrizes da Alice (cada usuário tem as suas)
CREATE TABLE agente_diretrizes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL DEFAULT '',
  ativa INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0,
  arquivo TEXT,
  criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_diretrizes_idx ON agente_diretrizes (user_id, ativa, ordem, id);

CREATE TABLE agente_diretrizes_versoes (
  id INTEGER PRIMARY KEY,
  diretriz_id INTEGER NOT NULL REFERENCES agente_diretrizes(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  salva_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_diretrizes_versoes_idx ON agente_diretrizes_versoes (diretriz_id, id);

-- Memória: fatos fixos que a Alice leva em conta em tudo ("o Yuri pede relatório toda segunda")
CREATE TABLE agente_memoria (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  -- usuario (escrito à mão) | alice (sugerido pela Alice e aprovado)
  origem TEXT NOT NULL DEFAULT 'usuario',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_memoria_idx ON agente_memoria (user_id, id);

-- Conversas com a Alice. origem: chat | whatsapp | agendado
CREATE TABLE agente_conversas (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo TEXT,
  origem TEXT NOT NULL DEFAULT 'chat',
  agendado_id INTEGER,
  modelo TEXT,
  arquivada INTEGER NOT NULL DEFAULT 0,
  -- ociosa | pensando | erro
  status TEXT NOT NULL DEFAULT 'ociosa',
  -- O que ela está fazendo agora ("Lendo o grupo X…")
  etapa TEXT,
  erro TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_conversas_idx ON agente_conversas (user_id, arquivada, updated_at);

-- Mensagens. papel: usuario | alice | evento (ação aprovada, execução de agendado…)
CREATE TABLE agente_mensagens (
  id INTEGER PRIMARY KEY,
  conversa_id INTEGER NOT NULL REFERENCES agente_conversas(id) ON DELETE CASCADE,
  papel TEXT NOT NULL,
  texto TEXT,
  -- Blocos no formato da API (ferramentas chamadas e resultados), para a conversa continuar de onde parou
  conteudo TEXT,
  anexos TEXT,
  fontes TEXT,
  modelo TEXT,
  custo_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_mensagens_idx ON agente_mensagens (conversa_id, id);

-- Ações que a Alice propôs. Nada acontece sem aprovação. status: pendente | executada | recusada | falhou | desfeita
CREATE TABLE agente_acoes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversa_id INTEGER REFERENCES agente_conversas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  resumo TEXT,
  dados TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pendente',
  resultado TEXT,
  erro TEXT,
  decidida_em TEXT,
  desfeita_em TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_acoes_idx ON agente_acoes (user_id, status, id);

-- Gasto com a API. modo: chat | agendado | contexto | prompt | whatsapp
CREATE TABLE agente_uso (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  modo TEXT NOT NULL,
  modelo TEXT NOT NULL,
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_saida INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  custo_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_uso_idx ON agente_uso (user_id, modo, created_at);

-- Agendados ("todo dia às 8h resuma os grupos e me mande no WhatsApp")
CREATE TABLE agente_agendados (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  -- O pedido como o usuário escreveu e o prompt melhorado que é executado
  pedido TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  -- Perguntas que a Alice fez antes de publicar (JSON: [{ pergunta, resposta }])
  perguntas TEXT,
  -- JSON: { tipo: uma_vez|diario|dias_uteis|semanal|mensal|a_cada_horas, hora, dias, dia_mes, horas, data }
  frequencia TEXT NOT NULL DEFAULT '{}',
  fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  modelo TEXT,
  teto_execucao_usd REAL NOT NULL DEFAULT 0.5,
  -- JSON: { tipo: aba|proprio|numero|grupo, numero_id, telefone, jid, nome }
  destino TEXT NOT NULL DEFAULT '{}',
  ativo INTEGER NOT NULL DEFAULT 1,
  proxima_em TEXT,
  ultima_em TEXT,
  ultimo_status TEXT,
  conversa_id INTEGER REFERENCES agente_conversas(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX agente_agendados_proxima_idx ON agente_agendados (ativo, proxima_em);

-- Execuções. status: rodando | ok | falhou | nao_enviada | teto | aguardando_tentativa
CREATE TABLE agente_execucoes (
  id INTEGER PRIMARY KEY,
  agendado_id INTEGER NOT NULL REFERENCES agente_agendados(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'rodando',
  manual INTEGER NOT NULL DEFAULT 0,
  tentativa INTEGER NOT NULL DEFAULT 1,
  inicio TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  fim TEXT,
  resposta TEXT,
  custo_usd REAL NOT NULL DEFAULT 0,
  erro TEXT,
  enviado_para TEXT
);
CREATE INDEX agente_execucoes_idx ON agente_execucoes (agendado_id, id);

-- Arquivos que o usuário anexou no chat (print, PDF, áudio, planilha)
CREATE TABLE agente_anexos (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT,
  mime TEXT,
  caminho TEXT NOT NULL,
  tamanho INTEGER,
  texto TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Mídias do WhatsApp: transcrição do áudio e texto extraído de documentos (feitos uma vez só e guardados)
ALTER TABLE wa_messages ADD COLUMN transcricao TEXT;
ALTER TABLE wa_messages ADD COLUMN transcricao_em TEXT;
ALTER TABLE wa_messages ADD COLUMN texto_extraido TEXT;
CREATE INDEX wa_messages_audio_idx ON wa_messages (type, transcricao_em) WHERE type = 'audio';
