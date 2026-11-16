-- 021: No-show — o lead agendou a reunião e não apareceu.
-- Só acrescenta: nova etapa "No-show" logo depois da etapa de reuniões (antes de "Aguardando proposta"),
-- o papel 'no_show', o marcador no lead e a marca na reunião do Calendly que ele perdeu.

-- 1) Etapa "No-show" logo depois de "Reunião agendada" (se ainda não existir uma com esse nome)
CREATE TEMP TABLE _ancora AS
SELECT
  COALESCE(
    (SELECT position FROM stages WHERE role = 'reuniao' AND kind = 'open' ORDER BY position LIMIT 1),
    (SELECT min(position) - 1 FROM stages WHERE role = 'aguardando_proposta' AND kind = 'open'),
    (SELECT max(position) FROM stages WHERE kind = 'open'),
    0
  ) AS pos,
  NOT EXISTS (
    SELECT 1 FROM stages
     WHERE replace(replace(lower(name), '-', ''), ' ', '') = 'noshow' OR role = 'no_show'
  ) AS criar;

UPDATE stages SET position = position + 1
 WHERE (SELECT criar FROM _ancora) AND position > (SELECT pos FROM _ancora);

INSERT INTO stages (name, position, color, kind, role)
SELECT 'No-show', pos + 1, '#e5503d', 'open', 'no_show' FROM _ancora WHERE criar;

DROP TABLE _ancora;

-- Se já havia uma coluna "No-show" criada à mão, ela ganha o papel (sem papel ainda e em andamento)
UPDATE stages SET role = 'no_show'
 WHERE NOT EXISTS (SELECT 1 FROM stages WHERE role = 'no_show')
   AND id = (SELECT id FROM stages WHERE role IS NULL AND kind = 'open'
               AND replace(replace(lower(name), '-', ''), ' ', '') = 'noshow' ORDER BY position LIMIT 1);

-- 2) Marcador no lead: desde quando está em no-show, quem marcou e de qual etapa saiu (para o "Desfazer")
ALTER TABLE leads ADD COLUMN noshow_since TEXT;
ALTER TABLE leads ADD COLUMN noshow_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN noshow_from_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL;

-- 3) Reunião do Calendly que o lead perdeu: não conta como "reunião feita" para o organizador do kanban
ALTER TABLE calendly_events ADD COLUMN no_show INTEGER NOT NULL DEFAULT 0;
