# Impera CRM

CRM da agência: leads do Yay! Forms caindo direto num kanban, alerta de follow-up e login da equipe.
Roda direto no Mac, a partir do SSD externo, sem Docker e sem instalar nada no sistema.
A mesma pasta funciona depois na VPS da Contabo.

**Versão atual: 0.10.2** — o número fica no arquivo `VERSAO` e é o que aparece em **Equipe e integrações → Atualização do CRM**.

**Versão 0.10.0:** aba nova **IA** — **primeiro contato automático** com leads novos (WhatsApp e Yay! Forms): cumprimenta, apresenta a Impera,
tira dúvidas básicas e passa o lead para você (marca **aguardando minha resposta** no kanban, com um resumo). Para na hora em que alguém da
equipe escreve. Modo **copiloto** (você aprova ou edita a resposta na conversa) ou **automático** · horário comercial com aviso de "sem
atendimento humano de prontidão" · **playbook** aprendido das suas conversas · simulador · filtros de segurança na entrada e na saída ·
modelo Claude Haiku (o mais econômico da Anthropic). Veja a seção [IA de primeiro contato](#ia-de-primeiro-contato).

**Versão 0.9.0:** **responsável com foto** no canto inferior esquerdo do cartão — clique na foto para escolher ou trocar o responsável ·
campo de **foto no cadastro** da equipe (Equipe e integrações) e **"Adicionar minha foto"** no menu do avatar · chip **Responsável** na barra rápida
(abre a lista da equipe com a contagem de leads de cada um) · **seleção em massa** no kanban (botão **Selecionar**, caixinha no topo de cada etapa
ou Ctrl/⌘ + clique) com ações **Criar público**, **Responsável** e **Mover para** · **público** = lista de contatos com nome, pronta para os
disparos (botão "Usar num disparo") · chip **WhatsApp** no kanban (número que manda mensagem pela conversa do cartão) e na aba WhatsApp
(mostra as conversas do número escolhido e responde por ele) — para atuar com mais de um WhatsApp.

**Versão 0.8.0:** aba nova **Disparos** · **saudação automática** para todo lead novo do Yay! Forms (sequência de mensagens com
atraso inicial, "digitando…/gravando áudio…", variáveis do formulário e proteção contra repetição) · **disparo personalizado** com fluxo de
texto, áudio (PTT), vídeo, imagem/GIF e arquivo, Spintax, prévia estilo WhatsApp e envio de teste · timers entre contatos (fixo ou aleatório),
descanso por lote e janela de horário · **listas de contatos** juntando kanban e WhatsApp sem números repetidos (com e sem o 9º dígito) ·
**monitor da fila** em tempo real (pausar, retomar, cancelar, reenviar falhas) · modelos de fluxo · lista de bloqueio. A fila roda no servidor.

**Versão 0.7.3:** seletor **Ordenar** na barra do kanban — **Início do formulário** (leads mais novos em cima) ou
**Última interação** (última mensagem no WhatsApp mais recente em cima; quem nunca trocou mensagem fica embaixo). A ordem vale para todas
as etapas, então o cartão continua no lugar certo ao trocar de fase, e a escolha fica salva no navegador · **sino vermelho no cartão**
quando o lead mandou mensagem e ninguém respondeu, com o tempo de espera e um **✕ para limpar à mão**; some sozinho quando você responde
pelo WhatsApp (ou registra um contato) e volta se o lead escrever de novo · chip e filtro **"sem resposta"**.

**Versão 0.7.2:** fundo com a flor-de-lis da Impera em ouro 3D flutuando no espaço (mesmo visual dos relatórios) no login e no kanban —
só decoração, acompanha o mouse com um giro leve e fica apagada atrás dos cartões; nada mudou no funcionamento.

**Versão 0.7:** visual novo — logo da Impera no login e no topo, nome em fonte Cinzel, botões e cartões do kanban em vidro escuro
com cantos suaves, ícones em linha no lugar dos emojis da interface · LEDs de situação nos cartões (vermelho sem contato, âmbar aguardando
resposta, **azul nunca contatado**, **verde aguardando para fechar**) · botões na barra rápida para filtrar nunca contatados e aguardando fechar ·
botão **"Aguardando para fechar"** na ficha do lead (marca quem vai fechar e está decidindo).

**Versão 0.6:** tela de WhatsApp no estilo do WhatsApp Web (lista com busca e filtros, fixar, arquivar, silenciar, etiquetas,
rascunhos, "digitando…", temas claro e escuro, ficha do lead recolhível) · **3 meses de histórico** ao conectar um número e ligação
automática das conversas aos leads do formulário · encaminhar, favoritar, editar, apagar para mim, enquetes, contatos, localização,
menções e mensagens temporárias · seletor de emoji completo · figurinhas (favoritas do celular, recentes, criar a partir de imagem) ·
aviso de chamadas recebidas, recusar com mensagem e link de chamada · grupos · atalhos de teclado.

**Versão 0.5.3:** respostas **incompletas** do Yay! Forms (quem começou o formulário e não terminou) viram lead com o selo
◐ "Form. incompleto"; se a pessoa voltar e terminar, o mesmo cartão é completado · filtros "Formulário incompleto/completo" ·
reenvio de respostas antigas sem duplicar leads.

**Versão 0.5.2:** cartões do kanban com respostas do formulário, data e timers (entrada e última resposta no WhatsApp) · campos visíveis
configuráveis · atualização do CRM pela tela (administrador) · "Iniciado há…" a partir do início do formulário · vários segredos de webhook do Yay! Forms.

**Versão 0.5.1:** CRM funciona num subcaminho do domínio (ex.: `/interno`).

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

**O CRM se religa sozinho.** O `./iniciar.sh` liga junto um vigia: se o servidor cair ou ficar mais de ~2 min sem
responder, ele é religado em segundos (fica registrado no log com `[vigia]`). Na VPS (Linux), o `./iniciar.sh` também
deixa uma checagem a cada minuto no cron: se a VPS reiniciar ou o vigia sumir, o CRM volta sozinho.
Quem desliga com `./parar.sh` desliga de propósito: nada religa até rodar `./iniciar.sh`.

**Histórico do WhatsApp sem clique.** A importação dos 90 dias roda sozinha. Se o celular bloquear ou ficar sem internet,
ela espera (30 s, 1 min, 2 min, até 5 min entre tentativas) e continua de onde parou — na hora, se você mandar uma
mensagem pelo celular. Se o número cair, retoma quando ele reconectar, e a cada 6 h o CRM completa o que faltar.
Mensagens que chegaram com o CRM fora do ar são entregues pelo WhatsApp quando ele volta (desde que o número não tenha
sido desconectado no celular).

### O que o `./atualizar.sh` faz

1. Copia o banco para `backups/` (funciona com o CRM ligado).
2. Baixa a versão nova do GitHub.
3. Prepara a versão nova com o CRM ainda ligado.
4. Reinicia: fica fora do ar por menos de um segundo. Ninguém precisa fazer login de novo.
5. Aplica as mudanças de banco (migrações) e confere se subiu.

Se a versão nova não ligar, o banco continua intacto e `./scripts/voltar-versao.sh` volta para a anterior.

Também dá para atualizar pela tela: menu do avatar → **Equipe e integrações → Atualização do CRM** (só administrador). Ali aparecem
a versão instalada — o número do arquivo `VERSAO` e o commit, com link para a mesma página no GitHub — e as novidades da versão nova.

## Ligar o Yay! Forms

1. No CRM: menu do avatar → **Equipe e integrações** → copie a URL do webhook.
2. No Yay! Forms: formulário → **Integrar → Webhooks → Add webhook** → cole a URL → formato **V2**.
3. Use **Test** no Yay! Forms e confira o lead no kanban.

**Segredos (Secret):** cada webhook criado no Yay! Forms ganha um *Secret* próprio. Em **Equipe e integrações → Yay! Forms →
Segredos dos webhooks**, cole o Secret de cada webhook (dá para guardar vários). O CRM aceita o webhook se a assinatura bater com
qualquer um deles. Sem nenhum segredo cadastrado, aceita qualquer envio para a URL (que já tem um token secreto). Webhooks recusados
por segredo errado ficam na lista como **Recusado** — depois de cadastrar o segredo, clique em **Reprocessar**.

O CRM detecta nome, telefone e e-mail sozinho. Se errar em algum formulário, preencha no `.env` os IDs das perguntas
(`YAYFORMS_CAMPO_NOME`, `YAYFORMS_CAMPO_TELEFONE`, `YAYFORMS_CAMPO_EMAIL`) e rode `./parar.sh && ./iniciar.sh`.
Todo webhook recebido fica salvo; os que derem erro podem ser reprocessados na tela de integrações.

O **"Iniciado há…"** do cartão conta a partir do horário em que a pessoa **começou a preencher o formulário** no Yay! Forms
(vem no próprio webhook). Se algum formulário não mandar esse horário, o cartão usa o horário em que o lead chegou ao CRM.

### Receber também quem não terminou o formulário (respostas incompletas)

Por padrão o Yay! Forms só chama o webhook quando a pessoa **termina** o formulário. Uma condição como
`ISCOMPLETED() OR ISNOTCOMPLETED()` sozinha não muda isso: ela só filtra o que o Yay! Forms já vai mandar.

1. No formulário: **Configurações → Enviar respostas incompletas** (ligar) e defina o **tempo de inatividade em minutos**
   (ex.: 10). Depois desse tempo sem nenhuma resposta nova, o Yay! Forms manda o que a pessoa já preencheu.
2. Cada resposta vai **no máximo uma vez por webhook**. Para receber a parcial **e** a completa (quando a pessoa volta e termina),
   crie **dois webhooks com a mesma URL do CRM**, formato V2:
   - **CRM – completos** · Condição do gatilho: `ISCOMPLETED()`
   - **CRM – incompletos** · Condição do gatilho: `ISNOTCOMPLETED() AND ISNOTEMPTY(@Seu WhatsApp)` — no lugar de `@Seu WhatsApp`,
     digite `@` e escolha a pergunta do WhatsApp no menu. Para receber todos, mesmo sem nenhum dado: `ISNOTCOMPLETED()`.
3. Cole o *Secret* de cada um em **Segredos dos webhooks**.

No CRM, a parcial vira lead com o selo **◐ Form. incompleto** (cartão e ficha). Quando a completa chega com o mesmo ID de resposta,
o mesmo cartão recebe as respostas que faltavam, o selo sai e o histórico mostra "Terminou o formulário". Se a pessoa abrir o
formulário de novo e terminar numa resposta nova, o lead (achado pelo telefone ou e-mail) também é completado.
Em **Equipe e integrações → Últimos recebidos**, a coluna **Resposta** mostra se cada webhook veio parcial ou completo.

### Mandar as respostas antigas

Ao criar ou editar o webhook, ligue **Executar em respostas anteriores** (recursos avançados). O Yay! Forms reenvia as respostas
que já existiam. Respostas que já tinham chegado ao CRM aparecem como **Repetido (nada novo)** e não viram lead duplicado.
A ajuda do Yay! Forms não diz se esse reenvio inclui as respostas incompletas antigas; confira nos **Logs de integração** do
webhook de incompletos.

**Enquanto o CRM roda só no Mac**, o Yay! Forms não alcança a sua máquina pela internet. Use `./scripts/lead-teste.sh`
para testar. Para receber leads reais no Mac (opcional), rode `tailscale funnel --bg 3000` e coloque a URL `https://….ts.net`
em `PUBLIC_URL` no `.env`. Na Contabo isso não é necessário.

## As telas

**Kanban**
- **Filtros** (☰): dados preenchidos (com nome, com WhatsApp, com e-mail), situação (aguardando resposta, follow-up atrasado,
  mensagem nova, reunião marcada, nunca contatado, formulário incompleto/completo), origem, formulário, responsável e data de entrada. Ficam salvos no navegador.
- **Editar etapas** (administrador): criar, renomear, mudar cor e ordem, marcar como ganho/perdido e apagar. Ao apagar, você escolhe
  para qual etapa vão os leads — nenhum lead é apagado. Também define onde entram os leads novos e para onde o Calendly move as reuniões.
- **⏳ Aguardando minha resposta**: botão na ficha do lead, com nota opcional ("enviar proposta"). O lead vai para o topo da coluna
  com uma faixa laranja e entra no contador da aba Kanban. Só sai quando alguém clica em **Resolvido**.

**WhatsApp** — no estilo do WhatsApp Web: conversas à esquerda, chat no meio e, à direita, a ficha do lead (anotações, respostas do
Yay! Forms, etapa, responsável, histórico), que pode ser recolhida. Detalhes na seção WhatsApp abaixo. Se o contato ainda não é lead, aparece o botão **Transformar em lead**; se já existir um lead com o mesmo
telefone, a conversa é ligada a ele.

**Disparos** — saudação automática do Yay! Forms, campanhas, listas e monitor da fila. Detalhes na seção Disparos abaixo.

**Estatísticas** — leads novos (com comparação ao período anterior), taxa de resposta, tempo até a primeira resposta, respondidos
em até 1 hora, follow-up em dia, aguardando resposta, nunca contatados, fechados, reuniões, mensagens, entrada por dia, por origem,
por formulário, leads por etapa e desempenho por responsável. Períodos de 7, 30 e 90 dias.

## WhatsApp (QR code, vários números)

1. Menu do avatar → **Equipe e integrações** → dê um nome ao número (ex.: Comercial) → **Conectar novo número**.
2. No celular desse número: WhatsApp → **Configurações → Aparelhos conectados → Conectar um aparelho** → leia o QR code.
3. Repita para cada número. Todos ficam conectados ao mesmo tempo.

### Novidades da versão 0.6

- **Histórico de 3 meses.** Ao conectar pelo QR code, o CRM pede ao celular o histórico completo (como o WhatsApp do computador)
  e guarda os últimos **90 dias** (`WHATSAPP_HISTORICO_DIAS`). Depois que o celular termina de mandar, o CRM completa, conversa
  por conversa, o que faltar para chegar aos 90 dias — um pedido de cada vez, com intervalo. Tudo entra como lido (não gera
  "mensagem nova" nem alertas) e o progresso aparece em **Equipe e integrações**, ao vivo.
- **Conversas ligadas aos leads sozinhas.** O telefone é comparado com e sem o 9º dígito, e conversas que o WhatsApp mostra só
  pelo identificador interno (LID) são ligadas assim que o telefone aparece. Isso acontece na importação, a cada mensagem nova,
  quando chega um lead (Yay! Forms, Calendly ou manual) e quando o telefone de um lead é editado — e uma revisão geral roda ao ligar
  o CRM e depois de cada importação. Grupos nunca viram lead. Se dois leads têm o mesmo telefone, a conversa vai para o mais
  recente e o caso fica anotado no histórico do lead (nenhum lead é juntado ou apagado). Leads continuam sendo criados sozinhos
  só com `WHATSAPP_CRIAR_LEADS=1`. O último contato e o follow-up passam a refletir o histórico real (só avançam, nunca voltam).
- **Tela igual à do WhatsApp Web**, com a ficha do lead à direita (recolhível) e o resto descrito abaixo.

### Números que já estavam conectados: importar os 3 meses

Não precisa desconectar. Em **Equipe e integrações**, no número, clique em **Importar 3 meses de histórico**. O CRM pede ao
celular as mensagens que faltam em cada conversa que ele já conhece, até completar 90 dias. Deixe o celular ligado e com internet;
dá para acompanhar a barra de progresso. Se o celular parar de responder, a importação para e continua de onde parou ao clicar de novo.

Limite: esse botão só completa conversas que já aparecem no CRM. Conversas que nunca chegaram ao CRM (de antes da conexão) só vêm
**desconectando e conectando o número de novo pelo QR code** — aí o celular manda o histórico inteiro.

### A tela de WhatsApp

| Onde | O que tem |
|---|---|
| Lista de conversas | Busca por nome, número **e texto das mensagens** (com a lista "Mensagens" encontradas) · filtros **Tudo, Não lidas, Favoritas, Grupos, Leads, Não são leads, Aguardando** e por etiqueta · **Arquivadas** · escolher o número conectado · "digitando…" e **rascunho** na prévia · ícone do tipo da última mensagem |
| Menu ⌄ de cada conversa (ou botão direito) | Arquivar, silenciar (8 h, 1 semana, sempre), fixar, marcar como lida/não lida, favoritar, **etiquetas**, abrir no WhatsApp Web, **ocultar** (some da lista até chegar mensagem nova — nada é apagado) |
| Cabeçalho | Foto, nome, **online / visto por último / digitando…**, 📞 e 🎥 (ver Chamadas), 🔍 busca dentro da conversa, ficha do lead (recolher/mostrar), menu com dados do contato, favoritas, selecionar mensagens |
| Mensagens | Mensagens antigas carregam ao rolar para cima (lista otimizada para conversas longas), separadores de data, prévia de links, menções em grupos (com o nome de quem mandou colorido), enquetes com resultado e voto, contatos, localização, chamadas, visualização única, mensagens temporárias |
| Menu ⌄ da mensagem | Reagir com qualquer emoji, responder, copiar, **encaminhar** (até 5 conversas), **favoritar** ⭐, **editar** (até 15 min), dados da mensagem (entregue/lida com horário), baixar, favoritar figurinha, **selecionar várias**, **apagar para mim** (só esconde no CRM) e apagar para todos |
| Barra de digitação | 😊 emojis (busca, categorias, tom de pele, recentes), GIF (vídeo curto), figurinhas · 📎 fotos e vídeos, documento, áudio, visualização única, nova figurinha, contato, localização, enquete · 🎤 mensagem de voz · @menções em grupos · **↑** edita a última mensagem |
| Painel da direita | Ficha do lead (anotações, etapa, histórico), dados do contato/grupo (mídias, participantes, mensagens temporárias, **Transformar em lead**), busca na conversa, mensagens favoritas |
| Topo da lista | ☀/🌙 tema claro ou escuro · ⋮ mensagens favoritas, arquivadas, etiquetas e atalhos |

**Atalhos de teclado** (Ctrl + Alt + K mostra a lista): Ctrl+Alt+/ busca · Ctrl+Alt+Tab próxima conversa · Ctrl+Alt+Shift+U lida/não lida ·
Ctrl+Alt+Shift+E arquivar · Ctrl+Alt+Shift+P fixar · Ctrl+Alt+Shift+M silenciar · Ctrl+Alt+Shift+F buscar na conversa ·
Ctrl+Alt+E emojis · Ctrl+Alt+S figurinhas · Ctrl+Alt+P ficha · Esc fecha. No Mac, Cmd no lugar de Ctrl e Option no lugar de Alt.

Formatação: `*negrito*`, `_itálico_`, `~riscado~`, ` ```monoespaçado``` `. Confirmações: 🕓 enviando · ✓ enviada · ✓✓ entregue ·
✓✓ azul lida · ⚠ não enviada (com botão para tentar de novo).

- Fotos, figurinhas, documentos e áudios de até 25 MB (`WHATSAPP_MIDIA_AUTO_MB`) são baixados na hora; maiores e os do histórico, quando alguém abre.
- Abrir a conversa no CRM marca as mensagens como lidas também no WhatsApp. Para desligar: `WHATSAPP_CONFIRMAR_LEITURA=0`.
- Arquivar, fixar, silenciar e marcar como não lida também valem no celular. Etiquetas e favoritas de conversa ficam só no CRM.
- O contador da aba WhatsApp não conta conversas silenciadas nem arquivadas (como no WhatsApp).
- Gravar áudio e "usar minha localização" só funcionam abrindo o CRM por `http://localhost:3000` ou por `https` (regra dos navegadores).
- Os arquivos ficam em `../arquivos/whatsapp/` (figurinhas em `../arquivos/whatsapp/figurinhas/`) e entram no backup do SSD.
- **Abrir no WhatsApp Web** abre `web.whatsapp.com` em outra aba. Não dá para embutir o WhatsApp Web dentro do CRM: o WhatsApp
  bloqueia ser aberto dentro de outra página, e seria outra sessão do número.

### Emojis e figurinhas

- O seletor de emoji é completo e funciona sem internet (emoji-mart, licença MIT). Serve também para reagir com qualquer emoji.
- **Figurinhas favoritas do celular:** o WhatsApp sincroniza as favoritas pelo "app state". A biblioteca do WhatsApp recebe essas
  informações mas não as repassa; o CRM as lê sem modificar a biblioteca (pela linha de registro interna em que elas passam) e baixa
  as figurinhas para `../arquivos/whatsapp/figurinhas/`. Elas chegam ao conectar um número pelo QR code; para números já conectados,
  clique em **Sincronizar figurinhas** em Equipe e integrações. Se uma versão futura da biblioteca mudar esse ponto, as favoritas do
  celular param de chegar — recentes, favoritas do CRM e criar figurinhas continuam funcionando.
- **Recentes:** figurinhas enviadas e recebidas. **Favoritar no CRM:** estrela na figurinha (ou no menu de uma figurinha recebida).
- **Criar:** a partir de uma imagem (vira WEBP 512×512) ou de um vídeo/GIF curto (vira figurinha animada, até 6 s). Na aba GIF,
  um vídeo curto vai como GIF do WhatsApp (sem som, em repetição). A busca de GIFs da internet do WhatsApp não existe por QR code.

### Chamadas de voz e vídeo

A conexão por QR code (biblioteca Baileys) **não transmite áudio nem vídeo de chamadas** — ela não implementa VoIP. Então o CRM:

- **Chamada recebida:** aparece um aviso em qualquer tela (voz ou vídeo, nome e foto, tocando), com **Recusar** e **Recusar com
  mensagem** (respostas prontas ou texto livre). Para atender, use o celular.
- **Registro:** cada chamada entra na conversa e no histórico do lead — perdida, recusada, atendida no celular (com a duração) —,
  inclusive as chamadas perdidas que vierem no histórico importado.
- **Botões 📞 e 🎥:** geram um **link de chamada do WhatsApp** e, depois de você confirmar, enviam ao contato. Também mostram
  **Ligar pelo celular** (QR code / link wa.me) e **Abrir no WhatsApp Web**.
- **Alternativa oficial:** para atender chamadas no computador seria preciso a **WhatsApp Business Calling API**, que exige o número
  na API oficial da Meta (WhatsApp Business Platform). Não está implementada.

### Leads e conversas

- Mensagem de um número desconhecido aparece na tela de WhatsApp com o botão **Transformar em lead**
  (para criar o lead sozinho, use `WHATSAPP_CRIAR_LEADS=1` no `.env`).
- Mensagem de um número que já é lead (do Yay! Forms, por exemplo) entra na conversa desse lead.
- Dá para responder pela tela de WhatsApp ou pelo painel do lead no kanban, escolhendo o número.
- Qualquer resposta para o lead, pelo CRM ou pelo celular, zera o contador de follow-up.

As sessões ficam em `../dados/whatsapp/` (nunca vão para o GitHub). Não rode o CRM no Mac e na VPS com o mesmo número
ao mesmo tempo: o WhatsApp derruba uma das conexões.

⚠️ A conexão por QR code não é oficial (é a mesma biblioteca usada pela Evolution API). O WhatsApp pode banir números que mandam
mensagens em massa ou automáticas. O CRM só envia o que alguém da equipe faz na tela, com intervalo mínimo entre envios; a importação
de histórico só pede mensagens ao próprio celular, uma conversa de cada vez.

**FFmpeg:** a conversão de áudio gravado, a onda do áudio, as miniaturas, a conversão de vídeos e a criação de figurinhas usam um
FFmpeg portátil que o `./atualizar.sh` baixa para dentro de `server/node_modules` (nada é instalado no Mac). Se o download falhar,
o CRM funciona igual, mas envia os arquivos sem conversão e não cria figurinhas.

## Disparos

Quatro áreas, todas dentro da aba **Disparos**. A fila roda no servidor: dá para trocar de tela, fechar o navegador ou reiniciar o CRM —
cada contato continua do bloco em que parou.

**Automação Yay! Forms** — liga/desliga a saudação dos leads novos. Monte a sequência (Bloco 1 → espera → Bloco 2…), cada bloco com
texto, áudio, vídeo, imagem/GIF ou arquivo, e a espera com "digitando…" ou "gravando áudio…" antes dele. O **atraso inicial** (ex.: 15 a 30 s,
sorteado) faz a abordagem parecer humana. Opções: não repetir para quem recebeu nas últimas X horas, pular se já houve conversa no
WhatsApp, só quem terminou o formulário e horário permitido. **Inspecionar último payload** mostra o que o Yay! Forms mandou e qual
variável cada pergunta vira (clique para pôr na mensagem). Só administradores alteram.

**Disparo personalizado** — fluxo de mensagens + destinatários (listas salvas e/ou contatos escolhidos) + timers. Prévia no formato do
WhatsApp (com **Simular**, que toca as esperas) e **Enviar teste** para o seu número antes de disparar para a lista.

**Listas de contatos** — junta leads do kanban (etapa colorida, etiquetas, origem, formulário) e contatos do WhatsApp (nome, número e foto).
O mesmo número com ou sem 55 e com ou sem o 9º dígito entra uma vez só, sempre com os dados do kanban. Filtros por etapa e etiqueta e
"Selecionar todos desta coluna".

**Monitor, modelos e bloqueio** — progresso ao vivo ("aguardando timer entre contatos, 23 s para João…"), pausar, retomar, cancelar,
reenviar só as falhas e log por contato · modelos de fluxo salvos · **Não perturbe**: números que nunca recebem disparos.

**Variáveis:** `{{nome}}`, `{{primeiro_nome}}` ("marcelo silva" → "Marcelo"), `{{saudacao}}` (Bom dia/Boa tarde/Boa noite no fuso de
`DISPAROS_FUSO`), `{{telefone}}`, `{{email}}`, `{{etapa_kanban}}`, cada pergunta do formulário pelo título (`{{qual_o_seu_orcamento}}`) ou pelo
id (`{{campo_<id>}}`), UTMs (`{{utm_source}}`) e variáveis do formulário. `{{variavel|padrão}}` usa o padrão quando vier vazia.
**Spintax:** `{Oi|Olá|E aí}` sorteia uma opção a cada envio.

> ⚠️ O WhatsApp por QR code não é oficial e pode **bloquear números que disparam em massa**. Use intervalo aleatório, descanso por lote e
> janela de horário (vêm ligados por padrão), comece com poucos contatos por dia e fale só com quem espera sua mensagem.

Mensagens automáticas contam como contato com o lead (como as enviadas pelo celular): zeram o follow-up e entram na taxa de resposta
das Estatísticas. Elas **não** marcam como lidas as mensagens que o lead mandou — a equipe continua vendo o que precisa responder.

## IA de primeiro contato

Aba **IA** (só administradores alteram). Precisa de uma **chave da API da Anthropic** (console.anthropic.com → API keys): cole na própria
tela — ela é conferida com a Anthropic antes de salvar e fica só no servidor (ou use `ANTHROPIC_API_KEY` no `.env`). Usa o modelo
**Claude Haiku** (`IA_MODELO` no `.env` troca), o mais econômico; cada resposta custa uma fração de centavo, e o consumo de tokens aparece na tela.

**Quando atua:** só em conversa individual de **lead novo** — ninguém da equipe falou com ele e a conversa tem menos de 72 h (ajustável).
Contato antigo, lead fechado/perdido ou número na lista de bloqueio: a IA nunca entra. Lead novo do Yay! Forms recebe a primeira mensagem
1 a 2 minutos depois do cadastro (se a **saudação automática dos Disparos** estiver ligada, ela tem prioridade e a IA só responde quando o
lead escrever). Mensagens da saudação automática não contam como "contato da equipe".

**Quando para:** na hora em que alguém da equipe manda mensagem — pelo CRM ou pelo celular. Na conversa aparece uma faixa com
**Assumir**, **Pausar** e **Devolver para a IA**.

**Quando passa para você:** o lead pede uma pessoa; pergunta preço, contrato, resultado ou detalhes do nicho (ela sempre diz que não pode
prometer resultados); manda áudio, imagem ou arquivo; fica irritado; ou depois de 6 mensagens da IA (ajustável). O lead fica
**aguardando minha resposta** no kanban, com o motivo, um resumo na conversa e um aviso flutuante no CRM.

**Horário:** segunda a sexta 7h–18h e sábado 7h–16h (ajustável, fuso de São Paulo por padrão). Fora disso e no domingo, a primeira resposta
avisa que a Impera não está com atendimento humano de prontidão e que o retorno pode levar algumas horas.

**Copiloto × automático:** no **copiloto** (padrão) a IA escreve e você aprova, edita ou descarta na conversa; fora do horário ela pode
responder sozinha (opção). No **automático** ela envia sozinha, com "digitando…" pelo tempo de uma pessoa. A tela mostra quantas sugestões
você aprovou sem mudar — quando quase todas passarem direto, é hora de ligar o automático.

**Playbook:** **Aprender com minhas conversas** lê as conversas em que a equipe respondeu leads (primeiro as que viraram reunião ou
cliente), tira nomes, telefones, e-mails, links e valores, e resume seu estilo de atendimento. Revise e salve. O **Simulador** mostra o que a
IA responderia, sem enviar nada.

**Segurança:** a IA não recebe ordens do lead. Pedidos de código, senha, acesso, "ignore suas instruções" e afins recebem uma resposta
pronta sem chegar ao modelo (na segunda vez, o lead vai para você). Ela só vê a conversa daquele lead — não tem acesso ao banco nem a dados
de outros clientes. Toda resposta passa por um filtro antes de sair: código, telefones, e-mails, links não autorizados (só o link de
agendamento configurado), assuntos de senha/sistema e promessas de resultado são barrados, e a conversa vai para você. Se o lead perguntar
se está falando com um robô, ela nunca nega.

> ⚠️ Mesmo cuidado dos Disparos: o WhatsApp por QR code não é oficial. A IA só fala com quem chegou agora, espera o lead terminar de
> digitar e respeita um limite de mensagens por hora (30, ajustável).

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
| `YAYFORMS_WEBHOOK_SECRET` | Opcional: um "Secret" fixo do Yay! Forms. Prefira cadastrar os segredos pela tela (aceita vários) |
| `WHATSAPP_HISTORICO_DIAS` | Quantos dias de conversas antigas importar ao conectar um número (padrão 90; 0 = nenhum). Quem tinha o valor antigo gerado pelo instalador (30) passa para 90 sozinho na atualização (cópia do `.env` anterior em `.env.antes-0.6`) |
| `WHATSAPP_GRUPOS` | `1` = conversas de grupo aparecem na tela de WhatsApp (padrão; grupos nunca viram lead); `0` = ignora grupos |
| `WHATSAPP_PREVIA_LINKS` | `1` = ao enviar um link, manda a prévia (título e imagem) como o WhatsApp Web (padrão); `0` = sem prévia |
| `WHATSAPP_CRIAR_LEADS` | `1` = conversa nova de número desconhecido vira lead sozinha; `0` = botão "Transformar em lead" (padrão) |
| `WHATSAPP_MIDIA_AUTO_MB` | Mídias recebidas até este tamanho são baixadas na hora (padrão 25) |
| `WHATSAPP_ENVIO_MAX_MB` | Tamanho máximo de arquivo enviado pelo CRM (padrão 100) |
| `WHATSAPP_CONFIRMAR_LEITURA` | `1` = abrir a conversa marca como lida no WhatsApp (padrão); `0` = não avisa o contato |
| `DISPAROS_FUSO` | Fuso usado no `{{saudacao}}` e na janela de horário dos disparos (padrão `America/Sao_Paulo`) |
| `WHATSAPP_VERSAO` | Fixa a versão do WhatsApp Web (ex.: `2,3000,1043857760`). Em branco (padrão), o CRM consulta a versão atual sozinho, porque o WhatsApp recusa versões antigas ("Connection Terminated" em todos os números) |

Depois de mudar o `.env`, rode `./parar.sh && ./iniciar.sh`.

## Migrar para a Contabo

1. Na VPS (Ubuntu): `git clone` deste repositório em `/opt/crm-impera/app` e `./instalar.sh`.
2. Copie o arquivo mais recente de `backups/` e o `.env` para a VPS.
3. `./scripts/restaurar.sh <backup>`.
4. Aponte um subdomínio da GoDaddy para o IP da VPS. O HTTPS e o início automático com o servidor entram no projeto nessa etapa.

## Para quem for mexer no código

```
server/src/modules/   ← cada integração é um módulo (auth, users, stages, leads, followup, yayforms, calendly, whatsapp...)
server/src/db.js      ← toda a conversa com o banco (SQLite embutido no Node)
server/src/tempoReal.js ← avisos em tempo real para a tela (/api/eventos)
server/src/modules/whatsapp/
  gerenciador.js  conexão (QR code, reconexão), eventos do WhatsApp, fotos de perfil
  recebimento.js  mensagens recebidas → banco (ao vivo e em lotes do histórico)
  historico.js    importação de 90 dias e complemento por conversa (fetchMessageHistory)
  ligacao.js      conversa ↔ lead (telefone, 9º dígito, LID, "religar tudo")
  envio.js        tudo que o CRM envia e as ações nas mensagens (editar, encaminhar, votar...)
  conversas.js    caixa de entrada (lista, filtros, estado das conversas, etiquetas)
  chamadas.js · figurinhas.js · presenca.js · previa.js · midia.js · conteudo.js · ffmpeg.js
server/migrations/    ← mudanças no banco, numeradas (001_, 002_...). Só acrescentam, nunca apagam dados.
server/testes/        ← testes automáticos (node:test) e ferramentas de teste com dados falsos
web/src/              ← interface React (WhatsApp em WhatsAppPagina.jsx, Conversa.jsx e web/src/components/chat/)
```

Novo módulo: criar `server/src/modules/<nome>/index.js` exportando `{ name, register(app) }` e registrar em `modules/index.js`.
Mudança no banco: criar `server/migrations/00X_descricao.sql`. Ela roda sozinha na próxima atualização, dentro de uma transação.
Nunca reescreva o histórico do Git (`push --force`) no repositório: o `atualizar.sh` só avança versões.
Versão nova: mude o número no arquivo `VERSAO` e no topo deste README no mesmo commit, e crie a tag no GitHub
(`git tag v0.6.0 && git push origin v0.6.0`). É esse número que a tela de atualização mostra.

**Testes:** `cd server && npm test` — usam um banco temporário (nunca o real) e mensagens de exemplo no formato da biblioteca do
WhatsApp: telefone e 9º dígito, LID, janela de 90 dias, sem duplicar, ligação com leads, banco da versão 0.5 atualizando sem perder
nada, enquetes, figurinhas, chamadas e um fluxo completo com um "WhatsApp falso".

**Ver a tela sem conectar número nenhum** (dados falsos, banco temporário):

```bash
cd server
export DB_FILE=/tmp/crm-demo/crm.db FILES_DIR=/tmp/crm-demo/arquivos WHATSAPP_SESSOES=/tmp/crm-demo/sessoes SESSION_SECRET=demo-demo-demo-demo APP_PORT=3999
node src/cli.js criar-usuario --admin --nome Teste --email teste@exemplo.com --senha teste12345
node testes/semear.js          # conversas, grupo, enquete, chamadas e figurinhas de exemplo
node testes/servidor-falso.js  # CRM com dois números falsos (nada sai para o WhatsApp)
```

Créditos: ícones [Lucide](https://lucide.dev) (ISC), seletor de emoji [emoji-mart](https://github.com/missive/emoji-mart) (MIT),
lista virtual [react-virtuoso](https://virtuoso.dev) (MIT), WhatsApp por [Baileys](https://github.com/WhiskeySockets/Baileys) (MIT).
A interface é própria (layout inspirado no WhatsApp Web); nenhum logo, ícone ou papel de parede do WhatsApp é usado.
