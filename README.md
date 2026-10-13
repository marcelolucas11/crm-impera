# Impera CRM

CRM da agência: leads do Yay! Forms caindo direto num kanban, alerta de follow-up e login da equipe.
Roda direto no Mac, a partir do SSD externo, sem Docker e sem instalar nada no sistema.
A mesma pasta funciona depois na VPS da Contabo.

**Versão 0.5:** chat de WhatsApp completo, igual ao do celular — fotos, áudios (com gravação pelo navegador), vídeos, documentos,
figurinhas, localização, foto de perfil dos contatos (também no kanban), ✓✓ azul, responder citando, reações, mensagens apagadas e editadas,
importação das conversas antigas e atualização em tempo real · três telas — **Kanban**, **WhatsApp** e **Estatísticas** · filtros no kanban ·
etapas editáveis · botão "aguardando minha resposta" · alerta de follow-up · Yay! Forms · Calendly · login da equipe · backup automático antes de cada atualização.

**Próximos módulos:** Google Agenda · notificações de follow-up.

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
| Conectar o Calendly | `./scripts/configurar-calendly.sh` |
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

O **"Iniciado há…"** do cartão conta a partir do horário em que a pessoa **começou a preencher o formulário** no Yay! Forms
(vem no próprio webhook). Se algum formulário não mandar esse horário, o cartão usa o horário em que o lead chegou ao CRM.

**Enquanto o CRM roda só no Mac**, o Yay! Forms não alcança a sua máquina pela internet. Use `./scripts/lead-teste.sh`
para testar. Para receber leads reais no Mac (opcional), rode `tailscale funnel --bg 3000` e coloque a URL `https://….ts.net`
em `PUBLIC_URL` no `.env`. Na Contabo isso não é necessário.

## As três telas

**Kanban**
- **Filtros** (☰): dados preenchidos (com nome, com WhatsApp, com e-mail), situação (aguardando resposta, follow-up atrasado,
  mensagem nova, reunião marcada, nunca contatado), origem, formulário, responsável e data de entrada. Ficam salvos no navegador.
- **Editar etapas** (administrador): criar, renomear, mudar cor e ordem, marcar como ganho/perdido e apagar. Ao apagar, você escolhe
  para qual etapa vão os leads — nenhum lead é apagado. Também define onde entram os leads novos e para onde o Calendly move as reuniões.
- **⏳ Aguardando minha resposta**: botão na ficha do lead, com nota opcional ("enviar proposta"). O lead vai para o topo da coluna
  com uma faixa laranja e entra no contador da aba Kanban. Só sai quando alguém clica em **Resolvido**.

**WhatsApp** — conversas à esquerda, chat no meio e, à direita, a ficha do lead (anotações, respostas do Yay! Forms, etapa,
responsável, histórico). Se o contato ainda não é lead, aparece o botão **Transformar em lead**; se já existir um lead com o mesmo
telefone, a conversa é ligada a ele.

**Estatísticas** — leads novos (com comparação ao período anterior), taxa de resposta, tempo até a primeira resposta, respondidos
em até 1 hora, follow-up em dia, aguardando resposta, nunca contatados, fechados, reuniões, mensagens, entrada por dia, por origem,
por formulário, leads por etapa e desempenho por responsável. Períodos de 7, 30 e 90 dias.

## WhatsApp (QR code, vários números)

1. Menu do avatar → **Equipe e integrações** → dê um nome ao número (ex.: Comercial) → **Conectar novo número**.
2. No celular desse número: WhatsApp → **Configurações → Aparelhos conectados → Conectar um aparelho** → leia o QR code.
3. Repita para cada número. Todos ficam conectados ao mesmo tempo.

Ao conectar, o CRM importa as conversas dos **últimos 30 dias** (`WHATSAPP_HISTORICO_DIAS`), já marcadas como lidas.
Se o número foi conectado antes da versão 0.5, **desconecte e conecte de novo** para trazer o histórico.
Dentro de uma conversa, o botão **Buscar mensagens anteriores no celular** (no topo) pede ao celular mensagens mais antigas.

### O chat

Funciona como o WhatsApp do celular:

| Recurso | Como usar |
|---|---|
| Fotos, vídeos, documentos e áudios | 📎 no canto da barra, arrastar o arquivo para a conversa ou colar (Ctrl/Cmd+V) uma imagem. Aparece uma prévia para escrever a legenda. |
| Mensagem de voz | 🎤 à direita (quando o campo está vazio). 🗑 descarta, ➤ envia. O áudio chega no celular do lead como mensagem de voz normal. |
| Responder citando, reagir, copiar, baixar, apagar para todos | Passe o mouse na mensagem e clique na setinha ⌄ |
| Emojis | 😊 na barra |
| Formatação | `*negrito*`, `_itálico_`, `~riscado~`, ` ```monoespaçado``` ` |
| Confirmações | 🕓 enviando · ✓ enviada · ✓✓ entregue · ✓✓ azul lida · ⚠ não enviada (com botão para tentar de novo) |

- Fotos, figurinhas, documentos e áudios de até 25 MB (`WHATSAPP_MIDIA_AUTO_MB`) são baixados na hora; maiores e os do histórico, quando alguém abre.
- Mensagens que o contato apagar continuam visíveis no CRM com a marca **🚫 Apagada pelo contato**; editadas mostram **editada**.
- Abrir a conversa no CRM marca as mensagens como lidas também no WhatsApp (o contato vê ✓✓ azul). Para desligar: `WHATSAPP_CONFIRMAR_LEITURA=0`.
- As fotos de perfil são buscadas aos poucos, uma por vez, e renovadas a cada 3 dias.
- Gravar áudio só funciona abrindo o CRM por `http://localhost:3000` ou por `https` (regra dos navegadores para o microfone).
- Os arquivos ficam em `../arquivos/whatsapp/` e entram no backup do SSD junto com a pasta `arquivos/`.

### Leads e conversas

- Mensagem de um número desconhecido aparece na tela de WhatsApp com o botão **Transformar em lead**
  (para criar o lead sozinho, use `WHATSAPP_CRIAR_LEADS=1` no `.env`).
- Mensagem de um número que já é lead (do Yay! Forms, por exemplo) entra na conversa desse lead.
- Um lead novo do formulário puxa a conversa de WhatsApp que já existia com o mesmo telefone.
- Dá para responder pela tela de WhatsApp ou pelo painel do lead no kanban, escolhendo o número.
- Qualquer resposta para o lead, pelo CRM ou pelo celular, zera o contador de follow-up.
- O cartão mostra a foto do lead e quantas mensagens novas ele mandou. Tudo atualiza sozinho, sem recarregar a página.

As sessões ficam em `../dados/whatsapp/` (nunca vão para o GitHub). Não rode o CRM no Mac e na VPS com o mesmo número
ao mesmo tempo: o WhatsApp derruba uma das conexões.

⚠️ A conexão por QR code não é oficial (é a mesma biblioteca usada pela Evolution API). O WhatsApp pode banir números que mandam
mensagens em massa ou automáticas. O CRM só envia o que alguém da equipe digita, com intervalo mínimo entre envios.

**FFmpeg:** a conversão de áudio gravado, a onda do áudio, as miniaturas e a conversão de vídeos usam um FFmpeg portátil que o
`./atualizar.sh` baixa para dentro de `server/node_modules` (nada é instalado no Mac). Se o download falhar, o CRM funciona igual,
mas envia os arquivos sem conversão.

## Calendly

1. No Calendly: **Integrações → API e webhooks → Personal access tokens** → gere um token.
2. No Terminal, dentro de `app/`: `./scripts/configurar-calendly.sh` e cole o token (ele não aparece na tela).

O CRM consulta o Calendly a cada 5 minutos (`CALENDLY_INTERVALO_MIN`). Cada reunião é ligada ao lead pelo e-mail ou telefone
(ou cria o lead), e o lead avança para **Reunião agendada**. Cancelamentos e reagendamentos entram no histórico, e o cartão
mostra a data da próxima reunião. Funciona em qualquer plano do Calendly e não precisa de endereço público.

## Configurações (`.env`)

| Variável | Para quê |
|---|---|
| `FOLLOWUP_HORAS` | Depois de quantas horas sem contato o lead fica vermelho (padrão 24) |
| `DDI_PADRAO` | DDI colocado em telefones digitados só com DDD (padrão 55) |
| `HOST` | `127.0.0.1` = só este Mac acessa; `0.0.0.0` = libera para a rede do escritório |
| `PUBLIC_URL` | Endereço público do CRM, com o caminho se houver (ex.: `https://crm-impera.imperaservices.com/interno`) |
| `BASE_PATH` | Caminho do CRM no domínio (ex.: `/interno`). Vazio = usa o caminho do `PUBLIC_URL`. A raiz continua funcionando. |
| `YAYFORMS_WEBHOOK_SECRET` | Opcional: o "Secret" do webhook no Yay! Forms, para conferir a assinatura |
| `WHATSAPP_HISTORICO_DIAS` | Quantos dias de conversas antigas importar ao conectar um número (padrão 30; 0 = nenhum) |
| `WHATSAPP_MIDIA_AUTO_MB` | Mídias recebidas até este tamanho são baixadas na hora (padrão 25) |
| `WHATSAPP_ENVIO_MAX_MB` | Tamanho máximo de arquivo enviado pelo CRM (padrão 100) |
| `WHATSAPP_CONFIRMAR_LEITURA` | `1` = abrir a conversa marca como lida no WhatsApp (padrão); `0` = não avisa o contato |

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
server/src/tempoReal.js ← avisos em tempo real para a tela (/api/eventos)
server/src/modules/whatsapp/ ← gerenciador.js (conexão, recebimento, envio, mídia, fotos), conversas.js, conteudo.js, ffmpeg.js
server/migrations/    ← mudanças no banco, numeradas (001_, 002_...). Só acrescentam, nunca apagam dados.
web/src/              ← interface React (o chat fica em web/src/components/chat/ e Conversa.jsx)
```

Novo módulo: criar `server/src/modules/<nome>/index.js` exportando `{ name, register(app) }` e registrar em `modules/index.js`.
Mudança no banco: criar `server/migrations/00X_descricao.sql`. Ela roda sozinha na próxima atualização, dentro de uma transação.
Nunca reescreva o histórico do Git (`push --force`) no repositório: o `atualizar.sh` só avança versões.
