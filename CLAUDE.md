# CRM Impera — regras para quem edita o código

## Idiomas (PT-BR / ES / EN)
- Os textos da interface ficam em `web/src/i18n/pt.js`, `es.js` e `en.js`. Nos componentes: `const t = useT();` e `t('chave')` (variáveis: `t('chave', { nome })` com `{nome}` no texto).
- **Texto novo na interface entra só em `pt.js`** (nunca fixo no JSX). ES e EN caem no português automaticamente até a tradução em lote.
- Telas ainda com texto fixo em português serão migradas para `t()` na tradução em lote, quando o CRM estiver completo. Não traduzir ES/EN a cada mudança.
- Chaves por tela: `login.*`, `topo.*`, `kanban.*`, `whatsapp.*`, `disparos.*`, `ia.*`, `estatisticas.*`, `equipe.*`.
- Respostas do servidor (mensagens de erro) e mensagens da IA para leads não passam por aqui.
