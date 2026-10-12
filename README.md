# Impera CRM

CRM da agência: leads do Yay! Forms caindo direto num kanban, alerta de follow-up, login da equipe.
Roda em Docker — o mesmo pacote funciona no Mac (SSD externo) e na VPS da Contabo.

**Versão 0.1:** login e senha · kanban com arrastar e soltar · alerta de leads sem contato · webhook do Yay! Forms · histórico do lead · equipe com permissões · backup automático antes de cada atualização.

**Próximos módulos:** WhatsApp (vários números) · Calendly · Google Agenda · notificações de follow-up.

---

## Como fica no SSD

```
/Volumes/SEU-SSD/crm-impera/
├── app/        ← este repositório (código)
├── dados/      ← banco de dados (nunca é apagado por atualizações)
├── arquivos/   ← mídias e anexos
└── backups/    ← backup automático antes de cada atualização
```

## Primeira instalação (uma vez só)

```bash
cd /Volumes/SEU-SSD/crm-impera
git clone https://github.com/ORGANIZACAO/crm-impera.git app
cd app
./instalar.sh
```

O `instalar.sh` gera o `.env` com senhas aleatórias, sobe o sistema e pede nome, e-mail e senha do primeiro administrador.
Depois acesse **http://localhost:3000**.

## Atualizar (sempre que houver versão nova)

```bash
cd /Volumes/SEU-SSD/crm-impera/app
./atualizar.sh
```

O que ele faz: backup do banco → baixa a versão nova → reconstrói só o app → confere se subiu.
O banco não é reiniciado nem apagado. A pausa é de alguns segundos.

## Comandos do dia a dia

| Para… | Comando |
|---|---|
| Atualizar | `./atualizar.sh` |
| Fazer backup agora | `./scripts/backup.sh` |
| Restaurar um backup | `./scripts/restaurar.sh ../backups/crm_AAAA-MM-DD_HHMMSS.dump` |
| Criar usuário pelo terminal | `./scripts/criar-usuario.sh` (ou `--admin`) |
| Redefinir senha | `./scripts/redefinir-senha.sh email@exemplo.com` |
| Ver o que está acontecendo | `docker compose logs app --tail 50` |
| Parar tudo (antes de ejetar o SSD) | `docker compose stop` |
| Ligar de novo | `docker compose start` |

> ⚠️ Nunca rode `docker compose down -v`. Com os dados em `../dados` eles não seriam apagados, mas o hábito é perigoso em outros projetos.

## Ligar o Yay! Forms

1. No CRM: menu do avatar → **Equipe e integrações** → copie a URL do webhook.
2. No Yay! Forms: formulário → **Integrar → Webhooks → Add webhook** → cole a URL → formato **V2**.
3. Use **Test** no Yay! Forms e confira o lead no kanban.

O CRM detecta nome, telefone e e-mail sozinho. Se errar em algum formulário, preencha no `.env` os IDs das perguntas
(`YAYFORMS_CAMPO_NOME`, `YAYFORMS_CAMPO_TELEFONE`, `YAYFORMS_CAMPO_EMAIL`) e rode `./atualizar.sh`.
Todo webhook recebido fica salvo; os que derem erro podem ser reprocessados na tela de integrações.

**Enquanto roda no Mac**, o Yay! Forms precisa de um endereço público. Com Tailscale:

```bash
tailscale funnel --bg 3000
```

Use a URL `https://….ts.net` que aparecer como `PUBLIC_URL` no `.env`. Leads só chegam com o Mac ligado e o SSD conectado.

## Configurações (`.env`)

| Variável | Para quê |
|---|---|
| `FOLLOWUP_HORAS` | Depois de quantas horas sem contato o lead fica vermelho (padrão 24) |
| `DDI_PADRAO` | DDI colocado em telefones digitados só com DDD (padrão 55) |
| `PUBLIC_URL` | Endereço público do CRM |
| `YAYFORMS_WEBHOOK_SECRET` | Opcional: o "Secret" do webhook no Yay! Forms, para conferir a assinatura |

Depois de mudar o `.env`, rode `./atualizar.sh`.

## Migrar para a Contabo

1. Na VPS: instalar Docker e clonar este repositório em `/opt/crm-impera/app`.
2. Copiar o `.env` e o último arquivo de `backups/` para a VPS.
3. `./instalar.sh` e depois `./scripts/restaurar.sh <backup>`.
4. Apontar um subdomínio da GoDaddy para o IP da VPS e colocar um proxy HTTPS na frente (será adicionado ao projeto nessa etapa).

## Para quem for mexer no código

```
server/src/modules/   ← cada integração é um módulo (auth, users, stages, leads, followup, yayforms)
server/migrations/    ← mudanças no banco, numeradas (001_, 002_...). Só acrescentam, nunca apagam dados.
web/src/              ← interface React
```

Novo módulo: criar `server/src/modules/<nome>/index.js` exportando `{ name, register(app) }` e registrar em `modules/index.js`.
Mudança no banco: criar `server/migrations/00X_descricao.sql`. Ela roda sozinha na próxima atualização, dentro de uma transação.
