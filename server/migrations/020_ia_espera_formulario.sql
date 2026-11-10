-- 020: espera da IA depois do Yay! Forms — a 1ª mensagem só sai depois que o lead teve tempo de terminar o formulário
-- e agendar no Calendly. Só acrescenta uma coluna: nada existente é alterado.
-- Até quando a 1ª mensagem da IA fica segurando (NULL = não espera). Fica separado de proxima_em para que nenhuma outra
-- rotina (revisão, travas reavaliadas) faça a IA chamar antes da hora.
ALTER TABLE ia_conversas ADD COLUMN espera_formulario_ate TEXT;
