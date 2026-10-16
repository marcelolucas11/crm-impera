-- 010: foto de cada pessoa da equipe (aparece no cartão do kanban como responsável pelo lead).
-- O arquivo fica em FILES_DIR/usuarios/; aqui guardamos só o caminho e quando mudou (vira a "versão" da foto).
-- Só acrescenta colunas: nada existente é alterado.
ALTER TABLE users ADD COLUMN photo_path TEXT;
ALTER TABLE users ADD COLUMN photo_at TEXT;
