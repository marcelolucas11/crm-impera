-- 016: Permissões por funcionário (Equipe e integrações → Permissões).
-- JSON com as telas e funções liberadas para cada pessoa da equipe ({"instagram": true, "disparos": false, ...}).
-- Vazio = padrão do CRM (o que a equipe já usava continua liberado; as telas novas, como o Instagram, nascem fechadas).
-- Administrador sempre tem acesso a tudo. Só acrescenta uma coluna: nada existente é alterado ou apagado.

ALTER TABLE users ADD COLUMN permissoes TEXT NOT NULL DEFAULT '{}';
