-- 023: Follow-up da Alice SDR e lembretes de reunião. Só acrescenta tabelas novas: nada existente é alterado.

-- Follow-up: uma linha por vez que o lead entrou na lista. Só uma pode estar 'ativo' por lead.
-- status: ativo | respondeu (o lead respondeu: quebra) | removido (tirado à mão) | concluido (recebeu o último toque)
--         | pulado (a IA leu a conversa e encerrou: lead pediu para parar, já fechou...) | erro
CREATE TABLE ia_followups (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ativo',
  -- Quantos toques já saíram (0 a 11) e o horário marcado para o próximo
  etapa INTEGER NOT NULL DEFAULT 0,
  proximo_em TEXT,
  -- Os prazos dos toques contam a partir daqui
  base_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultimo_envio_em TEXT,
  ultima_mensagem TEXT,
  falhas INTEGER NOT NULL DEFAULT 0,
  motivo TEXT,
  instance_id INTEGER REFERENCES wa_instances(id) ON DELETE SET NULL,
  iniciado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  iniciado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  encerrado_em TEXT,
  encerrado_por INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX ia_followups_lead_idx ON ia_followups (lead_id, status);
CREATE INDEX ia_followups_proximo_idx ON ia_followups (status, proximo_em);
CREATE UNIQUE INDEX ia_followups_um_ativo ON ia_followups (lead_id) WHERE status = 'ativo';

-- Lembretes de reunião enviados: um por reunião + horário da reunião + marco (3d, 24h, 12h, 3h, 30m).
-- Reagendou: o horário muda e os lembretes valem de novo para o novo horário.
-- status: enviado | pulado (fora da janela, agendou depois do marco...) | erro
CREATE TABLE ia_lembretes (
  id INTEGER PRIMARY KEY,
  evento_uri TEXT NOT NULL,
  inicio TEXT NOT NULL,
  marco TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'enviado',
  detalhe TEXT,
  texto TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (evento_uri, inicio, marco)
);
CREATE INDEX ia_lembretes_lead_idx ON ia_lembretes (lead_id, created_at);
