# Impera CRM

CRM da agência: leads do Yay! Forms caindo direto num kanban, alerta de follow-up e login da equipe.
Roda direto no Mac, a partir do SSD externo, sem Docker e sem instalar nada no sistema.
A mesma pasta funciona depois na VPS da Contabo.

**Versão 0.2:** login e senha · kanban com arrastar e soltar · alerta de leads sem contato · webhook do Yay! Forms · histórico do lead · equipe com permissões · backup automático antes de cada atualização · volta de versão com um comando.

**Próximos módulos:** WhatsApp (vários números) · Calendly · Google Agenda · notificações de follow-up.

---

## Como fica no SSD

```
/Volumes/SEU-SSD/crm-impera/
├── app/        ← este repositório (código, vem do GitHub)
├── node/       ← Node.js portátil (o instalar.sh baixa e confere a assinatura)
├── dados/      ← crm.db: o banco inteiro num arquivo
├── backups/    ← cópia do banco antes de cada atualização (guarda as 30 últimas)
├── arquivos/   ← mídias e anexos
└── logs/       ← crm.log
```

Nada é instalado no Mac. Para "desinstalar", basta apagar a pasta `crm-impera`.

## Primeira instalação (uma vez só)

```bash
cd /Volumes/SEU-SSD/crm-impera
git clone https://github.com/marcelolucas11/crm-impera.git app
cd app
./instalar.sh
```

O `instalar.sh` baixa o Node.js portátil para `../node`, gera o `.env` com senhas aleatórias, compila a interface,
pede nome, e-mail e senha do primeiro administrador e liga o CRM. Depois, abra **http://localhost:3000**.

## Dia a dia

| Para… | Comando (dentro de `app/`) |
|---|---|
| Ligar o CRM | `./iniciar.sh` |
| Desligar (sempre antes de ejetar o SSD) | `./parar.sh` |
| Atualizar para a versão nova | `./atualizar.sh` |
| Voltar para a versão anterior | `./scripts/voltar-versao.sh` |
| Fazer backup agora | `./scripts/backup.sh` |
| Restaurar um backup | `./scripts/restaurar.sh ../backups/crm_AAAA-MM-DD_HHMMSS.db` |
| Criar usuário pelo terminal | `./scripts/criar-usuario.sh` (ou `--admin`) |
| Redefinir senha | `./scripts/redefinir-senha.sh email@exemplo.com` |
| Simular leads do Yay! Forms | `./scripts/lead-teste.sh 5` |
| Ver o log | `tail -f ../logs/crm.log` |

### O que o `./atualizar.sh` faz

1. Copia o banco para `backups/` (funciona com o CRM ligado).
2. Baixa a versão nova do GitHub.
3. Prepara a versão nova com o CRM ainda ligado.
4. Reinicia: fica fora do ar por menos de um segundo. Ninguém precisa fazer login de novo.
5. Aplica as mudanças de banco (migrações) e confere se subiu.

Se a versão nova não ligar, o banco continua intacto e `./scripts/voltar-versao.sh` volta para a anterior.

## Ligar o Yay! Forms

1. No CRM: menu do avatar → **Equipe e integrações** → copie a URL do webhook.
2. No Yay! Forms: formulário → **Integrar → Webhooks → Add webhook** → cole a URL → formato **V2**.
3. Use **Test** no Yay! Forms e confira o lead no kanban.

O CRM detecta nome, telefone e e-mail sozinho. Se errar em algum formulário, preencha no `.env` os IDs das perguntas
(`YAYFORMS_CAMPO_NOME`, `YAYFORMS_CAMPO_TELEFONE`, `YAYFORMS_CAMPO_EMAIL`) e rode `./parar.sh && ./iniciar.sh`.
Todo webhook recebido fica salvo; os que derem erro podem ser reprocessados na tela de integrações.

**Enquanto o CRM roda só no Mac**, o Yay! Forms não alcança a sua máquina pela internet. Use `./scripts/lead-teste.sh`
para testar. Para receber leads reais no Mac (opcional), rode `tailscale funnel --bg 3000` e coloque a URL `https://….ts.net`
em `PUBLIC_URL` no `.env`. Na Contabo isso não é necessário.

## Configurações (`.env`)

| Variável | Para quê |
|---|---|
| `FOLLOWUP_HORAS` | Depois de quantas horas sem contato o lead fica vermelho (padrão 24) |
| `DDI_PADRAO` | DDI colocado em telefones digitados só com DDD (padrão 55) |
| `HOST` | `127.0.0.1` = só este Mac acessa; `0.0.0.0` = libera para a rede do escritório |
| `PUBLIC_URL` | Endereço público do CRM |
| `YAYFORMS_WEBHOOK_SECRET` | Opcional: o "Secret" do webhook no Yay! Forms, para conferir a assinatura |

Depois de mudar o `.env`, rode `./parar.sh && ./iniciar.sh`.

## Migrar para a Contabo

1. Na VPS (Ubuntu): `git clone` deste repositório em `/opt/crm-impera/app` e `./instalar.sh`.
2. Copie o arquivo mais recente de `backups/` e o `.env` para a VPS.
3. `./scripts/restaurar.sh <backup>`.
4. Aponte um subdomínio da GoDaddy para o IP da VPS. O HTTPS e o início automático com o servidor entram no projeto nessa etapa.

## Para quem for mexer no código

```
server/src/modules/   ← cada integração é um módulo (auth, users, stages, leads, followup, yayforms)
server/src/db.js      ← toda a conversa com o banco (SQLite embutido no Node)
server/migrations/    ← mudanças no banco, numeradas (001_, 002_...). Só acrescentam, nunca apagam dados.
web/src/              ← interface React
```

Novo módulo: criar `server/src/modules/<nome>/index.js` exportando `{ name, register(app) }` e registrar em `modules/index.js`.
Mudança no banco: criar `server/migrations/00X_descricao.sql`. Ela roda sozinha na próxima atualização, dentro de uma transação.
Nunca reescreva o histórico do Git (`push --force`) no repositório: o `atualizar.sh` só avança versões.
