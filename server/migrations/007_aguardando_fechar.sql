-- 007: lead marcado como "aguardando para fechar" (vai fechar, esperando a decisão dele)
ALTER TABLE leads ADD COLUMN closing_since TEXT;
ALTER TABLE leads ADD COLUMN closing_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN closing_note TEXT;
