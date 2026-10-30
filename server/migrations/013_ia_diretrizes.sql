-- 013: Diretrizes da IA — textos (prompts) que dão o norte para a IA de primeiro contato.
-- Ficam na tela "IA", onde podem ser criadas, coladas, subidas de arquivo, lidas e editadas.
-- Só acrescenta tabelas novas: nada existente é alterado.

CREATE TABLE ia_diretrizes (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL DEFAULT '',
  -- 1 = entra no prompt da IA | 0 = guardada, mas a IA não usa
  ativa INTEGER NOT NULL DEFAULT 1,
  -- Ordem em que entram no prompt (menor primeiro)
  ordem INTEGER NOT NULL DEFAULT 0,
  -- Nome do arquivo de origem, quando veio de upload
  arquivo TEXT,
  criada_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  atualizada_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ia_diretrizes_ordem_idx ON ia_diretrizes (ativa, ordem, id);

-- Versões anteriores de cada diretriz (guardadas a cada edição, para poder voltar atrás)
CREATE TABLE ia_diretrizes_versoes (
  id INTEGER PRIMARY KEY,
  diretriz_id INTEGER NOT NULL REFERENCES ia_diretrizes(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  salva_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  salva_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ia_diretrizes_versoes_idx ON ia_diretrizes_versoes (diretriz_id, id);
