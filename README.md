# Impera CRM

CRM da agência: leads do Yay! Forms caindo direto num kanban, alerta de follow-up e login da equipe.
Roda direto no Mac, a partir do SSD externo, sem Docker e sem instalar nada no sistema.
A mesma pasta funciona depois na VPS da Contabo.

**Versão atual: 0.30.0** — o número fica no arquivo `VERSAO` e é o que aparece em **Equipe e integrações → Atualização do CRM**.

**Versão 0.30.0:** **Modo Live, para compartilhar a tela.** Em **Equipe e integrações → Modo Live** (ou no menu da sua foto, ou com o atalho **Alt + Shift + L** / Option + Shift + L no Mac), o CRM cobre parcialmente os dados dos leads em **todas as telas**: nomes (`João Silva` → `Jo•• Si•••`), telefones (`(11) •••••-••21`), e-mails (`jo••@gmail.com`), @ do Instagram, nome da empresa respondido no formulário — também quando aparecem dentro das mensagens, nas dicas ao passar o mouse e nas notificações do sistema. Campos de digitação com dado de lead ficam embaçados. Opções: desfocar as fotos de perfil (ligado por padrão) e desfocar o texto e a mídia das mensagens. Com o modo ligado, chaves de API, tokens e IDs não podem ser revelados (o olho fica travado). Aparece o selo vermelho **AO VIVO** no topo (clique para desligar). Só a tela muda: os dados de verdade continuam iguais, então mandar mensagem, mover card e salvar a ficha funcionam normalmente. Fica salvo no navegador (cada computador liga o seu) e vale para todas as abas abertas. Etapas do kanban, nomes da equipe, datas e valores não são cobertos.

**Versão 0.29.0:** **A Alice espera o lead agendar antes da 1ª mensagem.** Quem chega pelo Yay! Forms entra no CRM no 1º aviso do formulário (às vezes ainda parcial), termina as perguntas e só depois agenda no Calendly — e o CRM só via a reunião na sincronização seguinte (a cada 5 min). Como a IA chamava 1 a 2 min depois do cadastro, ela dizia "você preencheu e não agendou" para quem estava agendando. Agora, em **IA → Primeiro contato → Quem é lead novo**: **espera configurável** (padrão 10 min; 0 volta ao comportamento antigo) que **recomeça quando o formulário é atualizado** (parcial → completo); **se o lead agendar durante a espera, a IA chama em 1 a 2 min** já sabendo da reunião (opção); **logo antes de enviar, o CRM confere o Calendly na hora**; e enquanto algum lead está na espera o Calendly é olhado **a cada minuto**. Se o lead escrever no WhatsApp durante a espera, a IA responde na hora. O botão **Estudar os tempos** lê os leads reais dos últimos 60 dias (início → fim do formulário, fim → agendou, agendou → reunião no CRM) e **sugere a espera** (90% de quem agenda + 2 min de folga), com um clique para usar. A lista "IA irá atender" mostra até que horas cada lead está esperando. Resposta parcial sem telefone que depois ganha o telefone agora também entra na IA.

**Versão 0.28.0:** **Direct pelo login do Instagram** (plugin não oficial, motor [instagrapi](https://github.com/subzeroid/instagrapi)). Com o acesso padrão da Meta, o webhook e a API de conversas só entregam o Direct de quem tem função no app; sem a Análise do app, as mensagens dos leads não chegavam. Agora cada perfil pode ligar o Direct pelo login: o CRM entra no perfil com o cookie `sessionid` (como o app do celular), busca a caixa de entrada a cada ~45 s e as **solicitações de mensagem** a cada ~3 min, e responde **sem o prazo de 24 h** (texto, foto, vídeo e áudio). Tela, Alice, leads e assistente continuam iguais; **desempenho, publicações, comentários e anúncios seguem pela API oficial**. Quem já falou pela API oficial continua na mesma conversa (o CRM liga pelo @). O motor é instalado por um botão (Python numa pasta própria, que as atualizações não apagam), confere que o cookie é do mesmo @, para sozinho quando o Instagram pede verificação ou derruba a sessão e espera 30–60 min quando avisa de limite. Desligar volta o Direct para a API oficial.

**Versão 0.27.0:** Revisão de segurança e de desempenho (nenhuma tela muda de visual). **Segurança:** a consulta ao banco da **assistente pessoal** tinha um furo — um nome entre aspas duplas com uma aspa simples dentro fazia a conferência pular o resto da consulta e permitia ler chaves de API, senhas (hash) e sessões; agora a consulta é lida pedaço por pedaço como o próprio SQLite lê, e as conversas particulares da assistente de cada pessoa também ficam de fora. A assistente passa a respeitar as **permissões** de cada pessoa (quem não tem WhatsApp liberado não lê conversas por ela; enviar mensagem, mover lead e criar disparo pela assistente exigem a mesma permissão da tela), e aprovar a sugestão da IA de primeiro contato exige a permissão de enviar no WhatsApp. Pedidos que mudam algo no CRM só são aceitos se vierem da própria tela do CRM (bloqueia ataques de outros sites, inclusive de outros subdomínios). **Trocar a senha** (ou desativar alguém) encerra as sessões abertas nos outros aparelhos. O login não revela mais pelo tempo de resposta quais e-mails têm conta, tem limite também por conta e não bloqueia mais a equipe inteira de um escritório (só tentativas erradas contam). Webhooks e links públicos bloqueiam quem erra token ou assinatura muitas vezes. Arquivos que vieram de fora (mídias do WhatsApp e do Instagram, anexos da assistente, arquivos dos disparos) só abrem na tela isolados e o resto é sempre baixado. Downloads por link (disparos) passam pela mesma proteção da prévia de links contra endereços internos, conferida em cada redirecionamento. Banco, sessões do WhatsApp, mídias e backups ficam legíveis só pelo usuário que roda o CRM. Mensagens de erro do git na tela de atualização não mostram mais token. **Correção:** **excluir um lead apagava junto as conversas do WhatsApp** dele; agora só o cartão sai do kanban e a conversa continua na tela de WhatsApp como contato. **Desempenho:** o kanban, a lista de conversas do WhatsApp, os contadores do topo e as estatísticas são calculados uma vez e reaproveitados por todas as abas até algo mudar no banco (antes cada atualização automática relia todas as mensagens); a tela recebe "nada mudou" (304) em vez da lista inteira quando nada mudou. A conversa aberta só recarrega quando chega mensagem **nela** (antes recarregava a cada mensagem de qualquer conversa) e o aviso em tempo real não perde mais mensagens que chegam juntas em conversas diferentes. Sessões de login não gravam mais no disco a cada clique. Mídias do WhatsApp são baixadas direto para o disco, sem ocupar a memória. A interface abre mais leve: as telas de IA, Instagram, Disparos, Estatísticas e Equipe só são baixadas quando alguém abre, os arquivos vão compactados (~4x menores) e ficam guardados no navegador entre versões. O `crm.log` não cresce mais para sempre (passou de 20 MB, vira `crm.log.1`). Índices novos no banco para os contadores.

**Versão 0.26.0:** Nova aba **Instagram**, ao lado do WhatsApp, para os perfis da Impera conectados pela API oficial da Meta. **Direct** no estilo do WhatsApp Web (lista com busca e filtros, chat, ficha do lead à direita), com fotos, vídeos, áudios, respostas a story, menções, publicações compartilhadas e o anúncio que trouxe a pessoa; o prazo de **24 h** para responder (7 dias quando veio de anúncio) aparece em cada conversa e a caixa de resposta só abre dentro dele. A **Alice SDR** (a mesma do WhatsApp) atende o Direct de cada perfil que você ligar: cumprimenta, faz a entrevista (nicho, experiência, se anuncia, objetivo, quando começar) e, quando a pessoa passa o WhatsApp, o **lead entra no kanban** com as respostas e o @ — opcionalmente a IA do WhatsApp manda a primeira mensagem por lá. No modo copiloto ela só sugere; se alguém da equipe escrever, ela para. **Transformar em lead** pelo botão (com ou sem WhatsApp). **Comentários** (desligado de fábrica): ver, responder em público, ocultar e **chamar no Direct**. **Desempenho**: seguidores, visualizações, alcance, interações, engajamento, conversas no Direct, leads (Direct + Yay! Forms) e gasto em anúncios, com comparação ao período anterior, gráficos por dia, **funil post → Direct → lead → reunião → fechado**, formatos, melhores publicações, publicações com todos os números (e a evolução dia a dia), **anúncios** das contas da Impera ligados aos perfis (números da Meta ao lado do que virou no CRM), público (idade, gênero, cidades, países) e melhores horários. Tudo é guardado no CRM e atualizado a cada 24 h, com o histórico mais antigo que a Meta entrega. **Relatórios da IA**: semanal automático toda segunda, na hora ou por período escolhido, com o modelo à escolha e teto de gasto por dia. A **assistente pessoal** também lê o Instagram (conversas, números, publicações, anúncios e comentários) e propõe respostas no Direct com aprovação. Nova aba **Permissões** para cada pessoa da equipe em **Equipe e integrações**: o administrador escolhe as telas (Kanban, WhatsApp, Instagram: Direct, desempenho e comentários, Disparos, IA, assistente, Estatísticas) e as funções (editar e excluir leads, enviar no WhatsApp, responder no Instagram, disparar campanhas); o servidor bloqueia o que não estiver liberado. O Instagram nasce liberado só para administradores. Veja [Instagram](#instagram) e [Permissões da equipe](#permissões-da-equipe).

**Versão 0.25.0:** A **IA de primeiro contato (Alice SDR)** passa a entender o que o lead manda além de texto. **Áudios** e a fala de **vídeos curtos** (até 3 min) são transcritos na hora pelo **Whisper da VPS** (o mesmo de Agente → Ajustes → Transcrição, sem chave e sem custo por minuto) e ela responde ao que foi falado — inclusive "quero falar com uma pessoa" num áudio cai na regra de passar para a equipe. **Imagens** (prints, fotos) e **PDFs** vão para o modelo ver (até 3 por resposta, os mais recentes); ela devolve uma frase do que é cada um, que fica guardada, e nas próximas respostas vai só esse texto (a imagem não é reenviada). **Word, Excel, PowerPoint, CSV e texto** viram texto. Localização, contato e enquete chegam com a descrição do WhatsApp. Antes, qualquer mídia fazia a IA passar o lead para a equipe; agora ela só passa quando não consegue abrir (transcrição desligada, mídia expirada, arquivo grande demais) ou pelas regras de sempre. Documentos pessoais (RG, cartão, senha) não são repetidos: ela orienta a não enviar por aqui. Na aba **IA → Como ela trabalha**, o bloco **O que ela entende além de texto** mostra se a transcrição está ligada e tem a opção **Ver imagens e PDFs**. O **Organizador do kanban** e o **playbook** também passam a ler a fala transcrita dos áudios (da equipe e dos leads). Corrige o rótulo das mídias que a equipe envia (antes apareciam para a IA como "o lead mandou").

**Versão 0.24.1:** Corrige o erro 400 da Anthropic ("Invalid `signature` in `thinking` block") que aparecia no chat do Agente a partir da segunda mensagem de uma conversa. Os pensamentos de respostas anteriores não são mais reenviados (o texto fixo muda a cada mensagem, com a hora, as diretrizes e a memória, e a API recusa pensamento antigo); os da resposta em andamento continuam indo junto. Conversas que já deram esse erro voltam a funcionar depois de atualizar.

**Versão 0.24.0:** Nova aba **IA → Agente Alice**: uma assistente pessoal para cada usuário do CRM (cada um renomeia a sua). **Chat** com conversas salvas, seletor de modelo Claude em cada mensagem, anexos (print, PDF, áudio, Word, Excel, PowerPoint), ditado por voz e fontes clicáveis que abrem a conversa ou o lead. Ela lê o CRM inteiro ao vivo: conversas e **grupos** do WhatsApp (com participantes), kanban, respostas do Yay! Forms, Calendly, disparos, estatísticas e consultas de leitura no banco (nunca chaves, senhas nem sessões). **Ações com aprovação:** enviar mensagem, mover lead, trocar responsável ou anotar, criar público, criar **disparo como rascunho** (abre em Disparos → Disparo personalizado para você revisar e dar play), criar modelo de disparo, critério do Organizador, memória e agendado — tudo vira um cartão com Aprovar/Editar/Recusar, e mover lead, responsável e nota têm Desfazer. **Cérebro** no molde do playbook: **Entender o CRM** lê tudo e escreve o Contexto do CRM (com o mapa de grupos → clientes), com versões e atualização automática; **Diretrizes** e **Memória** próprias. **Agendados:** "Melhorar prompt" transforma o seu pedido no prompt executado e pergunta o que faltar antes de publicar; uma vez, diário, dias úteis, dias da semana, mensal ou a cada N horas, com fuso, modelo e teto por execução; resultado na aba, no "mensagem para mim" do número do CRM, em outro número ou num grupo — com o WhatsApp desconectado a tarefa para e fica como "não enviada". **Conversar pelo WhatsApp:** dos seus números pessoais (ou do "mensagem para mim"), com "SIM 12" para aprovar. **Tetos de gasto por dia** separados para chat e agendados. **Transcrição de áudio na própria VPS** (Whisper, sem chave): instala pelo botão em Agente → Ajustes e passa a valer para o CRM todo (a IA de primeiro contato e o Organizador também leem o que foi falado).

**Versão 0.23.0:** Formulários e perguntas aparecem **sempre pelo nome**, nunca pelo código do Yay! Forms (`6a3063b9…`), em **Formulários que mais trazem leads**, no **filtro de formulário do kanban**, em **Campos** (perguntas do formulário), nos cartões, na ficha e no histórico. Em **Equipe e integrações → Yay! Forms → Nomes dos formulários e das perguntas**, cole o **token da API do Yay! Forms** (Perfil → Integrações → Gerar token da API): o CRM busca sozinho o nome de cada formulário e o texto de cada pergunta, e repete a busca a cada 6 h. **Leads antigos também são corrigidos:** ao ligar o CRM depois de atualizar, ele passa por todos os leads e pelo histórico já gravados e troca os códigos pelos nomes — mesmo sem token, as perguntas que apareceram com texto em algum webhook guardado já são corrigidas. Formulário apagado no Yay! Forms aparece como "Formulário apagado no Yay! Forms (criado em dd/mm/aaaa)" e, sem nome em lugar nenhum, "Formulário sem nome (criado em …)". O nome dado à mão no CRM continua valendo mais que o do Yay! Forms. Perguntas que você tinha ocultado em **Campos** continuam ocultas. Os nomes longos no ranking de formulários não vazam mais do quadro.

**Versão 0.22.0:** Estatísticas renovadas. **Período**: Hoje, Ontem, Últimos 3, 7, 30 e 90 dias e **Personalizado** (de/até). **Funil de vendas**: quantos leads do período chegaram em cada coluna do kanban (usa o histórico, então lead que avançou e depois foi perdido conta até onde chegou), com % do início, % que seguiu para a etapa seguinte, quantos estão parados em cada etapa agora e a maior queda; em **Configurar funil** você marca as colunas, muda a ordem e escolhe início e fim. **UTMs**: campanha → conjunto → anúncio (clique na linha para abrir), escolha uma ou mais colunas do kanban e veja quantos leads de cada estrutura **estão agora** ou **já passaram** por elas, com taxa, barra visual e a estrutura de melhor taxa destacada (padrão do Meta: utm_campaign, utm_medium, utm_content — dá para trocar na engrenagem). **Entrada de leads** ganhou o botão **Por hora** (cada hora do período, com o nome e a hora de cada lead e os horários de pico) e o novo mapa **Dia da semana × hora**. Calendly saiu de "Leads novos por origem" (é onde o lead do formulário marca a reunião, não uma origem). As escolhas de período, funil e UTMs ficam salvas no navegador de cada pessoa.

**Versão 0.21.0:** Novo seletor de idioma do CRM (**PT-BR / ES / EN**), no menu do avatar e na tela de login. Cada pessoa escolhe o seu, e fica salvo no navegador. Nesta versão já estão traduzidos o login, as abas do topo e o menu do avatar; o resto das telas continua em português e será traduzido em lote quando o CRM estiver completo.

**Versão 0.20.3:** Trocar foto, remover foto e trocar senha saíram do menu do avatar e foram para **Equipe e integrações → Minha conta** (primeira seção da aba). Quem não é administrador entra pelo item **Minha conta** do menu do avatar e vê só essa seção.

**Versão 0.20.2:** Chaves, tokens, IDs e URLs secretas ficam **cobertos (••••)** em toda a tela de configurações — chave da Anthropic, ID do workspace, token do Calendly, URL do webhook e segredos do Yay! Forms — para não vazarem em gravação ou compartilhamento de tela. O ícone de olho revela por 15 segundos e volta a cobrir sozinho; o botão Copiar funciona sem revelar.

**Versão 0.20.1:** O organizador agora dá **termômetro também para leads que ainda não conversaram**: a IA avalia o que o lead marcou no formulário (parcial ou completo e cada resposta) e se agendou reunião no Calendly. Formulário novo ou atualizado e reunião marcada, remarcada ou cancelada colocam o lead na fila da próxima varredura. O "Organizar tudo" também lê esses leads. Lead sem conversa, sem formulário e sem Calendly continua sem leitura (custo zero).

**Versão 0.20.0:** **Criar com IA** nos critérios do Organizador do kanban. Botão em cada critério (inclusive "Lead qualificado"): você escolhe o **modelo Claude** que analisa (padrão: o mesmo do playbook) e o período (padrão 60 dias), escreve o que pesa para você — no "Lead qualificado" já vem preenchido com o funil **anúncio → Yay! Forms → Calendly → WhatsApp** e o perfil do lead muito qualificado — e a IA lê as conversas reais, o **catálogo das perguntas e respostas do formulário**, quem agendou no Calendly, quanto cada lead responde no WhatsApp e quem virou cliente ou se perdeu. Ela escreve o prompt citando as perguntas exatas do seu formulário, com regra de decisão, desqualificadores, como tratar lead parcial e uma **régua de temperatura que sobe com o engajamento**, mais as notas do que separou os leads que avançaram dos perdidos. Mostra o custo estimado antes; tudo vai anonimizado; nada muda até **Usar este prompt** + **Salvar organizador**. A leitura de cada lead pelo organizador agora recebe também o **engajamento no WhatsApp** (mensagens do lead, em quantos dias, se a última é dele, há quanto tempo respondeu) e segue a régua de temperatura do critério.

**Versão 0.19.0:** **Organizador do kanban por IA** (tela **IA → Organizador do kanban**). A IA lê as conversas dos leads do kanban e avança cada um pelas etapas sozinha. Nova etapa **"Aguardando proposta"** (reunião feita, falta a proposta), entre "Reunião agendada" e "Proposta enviada". **Sem IA (custo zero):** primeira mensagem enviada → Em contato · PDF enviado com nome começando em **"Proposta comercial"** → Proposta enviada (outros PDFs são ignorados) · reunião do Calendly → Reunião agendada; horário passou sem cancelamento → Aguardando proposta. **Com IA:** caixa **"O que é um lead qualificado"** (leva para Qualificado) e botão **+ Novo critério** para criar outros prompts escolhendo a etapa de destino; também reconhece reunião combinada fora do Calendly, reunião já feita e proposta mandada por escrito — cada movimentação guarda o motivo e o trecho da conversa. **Varredura a cada 5 min** (ajustável): só chama a IA quando um lead do kanban teve mensagem nova desde a última varredura; grupos e contatos fora do kanban são ignorados. **Nunca volta etapa, nunca mexe em Fechado/Perdido** (só você move para lá) e continua de onde você parou. **Limite de gasto por dia (US$)**: ao bater, a leitura pela IA para até a meia-noite. Escolha do **modelo Claude** (usa a chave da API já configurada). **Organizar tudo automático**: caixa "últimos X dias" e teto de gasto próprio; a IA lê os leads antigos e novos e mostra uma **prévia** (avanços marcados; voltar etapa vem desmarcado) — você aplica e depois a varredura volta a cuidar só das conversas novas. Registro das movimentações com **Desfazer** (a IA não leva mais aquele lead para a etapa desfeita). No cartão: selo **IA + temperatura (0–100)** com resumo e objeção no balão. Novo botão **"IA chamou você"** na barra do kanban: filtra os leads em que a Alice passou o atendimento e está esperando um humano. Em **Editar etapas**, a coluna de automação ganhou os papéis que o organizador usa (contactado, qualificado, aguardando proposta, proposta enviada).

**Versão 0.18.1:** **correção da chave "Zerar todo dia à meia-noite" e dos limites da IA.** Quando um lead era segurado por uma trava (ex.: limite de leads novos cheio), a IA guardava a hora calculada pela regra daquele momento. Ao ligar/desligar a chave da meia-noite, aumentar um limite ou mudar descanso/fuso/horário, a tela passava a mostrar vaga livre ("Atendendo normalmente", 0/20), mas os leads que esperavam continuavam parados até a hora antiga (até 24 h). Agora, sempre que uma trava muda, quem estava esperando é reavaliado na hora (na mesma ordem da fila) e o motor confere todas as travas de novo. A tela também passa a receber os contadores junto com a configuração salva, sem mostrar por um instante o número da regra antiga.

**Versão 0.18.0:** **novo status "IA irá atender" e correção da fila da IA que parava.** Enquanto a IA ainda não mandou nenhuma mensagem para o lead, a conversa aparece como **"IA irá atender"** (com o motivo da espera: trava de proteção, horário comercial ou posição na fila); só depois da 1ª mensagem dela vira **"IA atendendo"**. Se você escrever antes, a IA não entra. Correções: (1) um envio do WhatsApp que nunca respondia segurava o atendimento para sempre e, com "um lead por vez", congelava a fila inteira — agora cada envio tem prazo de 90 s e a revisão solta qualquer atendimento preso há mais de 10 min (antes só soltava se a conversa presa tivesse mensagem do lead sem resposta); (2) conversa na fila com a hora vencida e ninguém atendendo é destravada pela revisão; (3) a saudação automática dos Disparos fazia a IA achar que já tinha falado e a conversa ficava em "IA atendendo" sem nunca receber mensagem — agora ela abre a conversa; (4) o botão **Revisar agora** não diz mais "em dia" quando há leads esperando: mostra o que corrigiu, quantos estão em "IA irá atender"/na fila, a hora da próxima e o que está segurando.

**Versão 0.17.0:** **revisão dos atendimentos da IA** — ninguém em "IA atendendo" fica sem resposta. Mensagens que chegavam com o CRM reiniciando/atualizando ou com o WhatsApp reconectando eram gravadas, mas não acordavam a IA; e um reinício no meio de um atendimento podia deixar a conversa parada. Agora a IA confere sozinha (1,5 min depois de o servidor ligar e a cada 5 min) todas as conversas em "IA atendendo": quem tem mensagem do lead sem resposta e não está na fila é **retomado de onde parou** (a IA relê as mensagens sem resposta), sempre respeitando as travas de proteção e o horário. Se alguém da equipe já respondeu pelo celular, a IA sai da conversa; depois de 3 tentativas sem conseguir responder, ela passa o lead para você. Um atendimento preso há mais de 10 min é solto para o "um lead por vez" não travar a fila. Na tela **IA → Conversas atendidas pela IA**, uma faixa mostra quantas conversas estão em "IA atendendo", quantas têm mensagem sem resposta (e quais estão paradas), o botão **Ver quem** e o botão **Revisar agora**.

**Versão 0.16.0:** painel de status da IA (tela **IA → Limites e proteção**) mais claro. Um ícone **ⓘ** ao lado dos contadores explica o que cada número significa (passe o mouse ou clique). O contador de **leads novos** ganhou um cronômetro que mostra quando a IA volta a chamar leads novos, um botão **Zerar agora** (zera o contador na hora; quem estava esperando vaga é chamado de novo, respeitando as outras travas) e a chave **Zerar todo dia à meia-noite** (ligada por padrão): o limite de leads novos passa a valer por dia e zera à meia-noite no fuso do horário de atendimento. Desligada, volta a ser uma janela móvel de 24 h. Quando não há vaga de lead novo, o status fica amarelo avisando que a IA só responde quem já está em conversa.

**Versão 0.15.0:** fila da IA para leads que chegaram antes de ela ligar (tela **IA → Limites e proteção → Quem é lead novo**): mostra os leads abertos da janela de "lead novo" (ex.: últimas 240 h), com telefone, com quem ninguém da equipe falou e que a IA ainda não atende. Você revisa a lista, desmarca quem não quer e manda o resto para a IA. Quem nunca escreveu recebe a primeira mensagem da IA (retomando o cadastro, sem fingir que acabou de chegar); quem escreveu e ficou sem resposta recebe um pedido de desculpas curto pela demora e a resposta. A primeira mensagem só sai dentro do horário comercial, os mais novos vão primeiro e tudo segue as travas de proteção (um por vez, intervalo entre leads, limite de leads novos em 24 h). Conversas que tinham sido ignoradas com uma janela menor voltam a ser avaliadas.

**Versão 0.14.0:** contingência do número na IA (tela **IA → Limites e proteção**): atende **um lead por vez**, espera um
tempo **sorteado entre X e Y segundos** antes de ir para outro lead, faz **pausas de descanso** de X a Y minutos a cada N mensagens,
limita mensagens em **24 horas** e **leads novos abordados em 24 horas**, e **pausa sozinha por 30 min** se o envio falhar 3 vezes
seguidas. Um painel mostra ao vivo se a IA está descansando e quanto de cada limite já foi usado (com botão **Retomar agora**).
Nada se perde: a conversa segurada por uma trava só fica para depois.

**Versão 0.13.1:** botão **Continuar de onde parou** no playbook: usa o texto da tela (mesmo sem salvar) e a IA escreve só o que falta,
a partir do último caractere, sem mexer no resto. Aparece também um aviso quando o playbook parece ter parado no meio. A análise agora
também continua quando o modelo **pausa** a resposta (antes só no limite de tamanho), mostra o motivo quando não termina e não
quebra mais palavras ao juntar as partes. A melhoria automática nunca troca o playbook por um incompleto.

**Versão 0.13.0:** **escolha do modelo** da IA na aba **IA** — o que responde os leads (Haiku, Sonnet, Opus ou Fable, do mais barato
ao mais potente) e o que analisa as conversas. O playbook ganhou **Análise profunda (60 dias)**: um modelo potente (padrão Opus) lê as
conversas com o raciocínio ligado, compara as que viraram reunião/cliente com as perdidas e monta o playbook completo, em seções. Se a
resposta vier longa demais, o CRM pede para o modelo continuar de onde parou — o playbook não termina mais pela metade. **Melhorar com
conversas novas** lê só o que chegou desde a última leitura (suas conversas e as da IA) e complementa o playbook, mostrando o que mudou.
Opcional: **melhorar sozinha a cada N dias**. As 10 versões anteriores do playbook ficam guardadas para voltar. A análise roda em segundo
plano (pode levar minutos sem a VPS cortar a conexão).

**Versão 0.12.0:** a IA agora é a **Alice**, atendente virtual que **fala no feminino** (nome e gênero ajustáveis em **IA → Apresentação**).
Ela se apresenta como Alice e, ao passar o lead, diz que **alguém da equipe** continua o atendimento. Se o lead perguntar se é robô, ela diz
que é a assistente virtual. Quando a resposta tem **mais de um balão**, eles saem com **2 segundos de intervalo** e "digitando…" entre eles
(também no modo copiloto e no simulador; ajustável em **Limites e proteção**). O simulador passa a usar o que está na tela, mesmo sem salvar.

**Versão 0.11.1:** corrige o aviso **"A IA respondeu fora do formato"**: o limite de cada resposta subiu de 450 para 900 tokens (com
diretrizes longas a resposta vinha cortada), a leitura ficou mais tolerante e, se a resposta ainda vier ilegível, a IA tenta de novo uma vez
sozinha. No simulador, quando falhar, aparece o motivo e o texto que a IA escreveu.

**Versão 0.11.0:** **Diretrizes (prompts)** na aba **IA** — um lugar para guardar os textos que dão o norte para a IA (roteiro de SDR,
como tratar cada tipo de lead, respostas para dúvidas frequentes): crie do zero, cole ou **suba um arquivo .md ou .txt**, leia e edite na
própria tela, ligue/desligue, ordene, **baixe como .md** e volte versões anteriores (cada salvamento guarda a anterior). A IA agora também
recebe as **respostas do formulário** do lead (parcial, completo sem reunião ou completo com reunião marcada no Calendly), para seguir as
diretrizes de acordo com cada caso. O simulador ganhou um **formulário de exemplo**. Veja [IA de primeiro contato](#ia-de-primeiro-contato).

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

**Nomes dos formulários e das perguntas:** o webhook V2 manda só códigos. Em **Equipe e integrações → Yay! Forms →
Nomes dos formulários e das perguntas**, cole o token da API do Yay! Forms (no Yay! Forms: seu nome no canto superior direito →
**Perfil → Integrações → Gerar token da API**). O CRM confere o token, busca o nome de cada formulário e o texto de cada pergunta e
aplica em todos os leads e no histórico, inclusive os antigos. A cada vez que o CRM liga (por exemplo, depois de uma atualização)
ele refaz essa correção sozinho. Para usar outro nome no CRM, escreva na coluna **Nome no CRM** (vazio = nome do Yay! Forms).
Também dá para pôr o token no `.env` como `YAYFORMS_API_TOKEN`.

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

**Instagram** — Direct dos perfis da Impera (com a Alice), comentários, desempenho, anúncios e relatórios da IA. Detalhes na seção Instagram abaixo.

**Disparos** — saudação automática do Yay! Forms, campanhas, listas e monitor da fila. Detalhes na seção Disparos abaixo.

**Estatísticas** — leads novos (com comparação ao período anterior), taxa de resposta, tempo até a primeira resposta, respondidos
em até 1 hora, follow-up em dia, aguardando resposta, nunca contatados, fechados, reuniões, mensagens, entrada por dia, por origem,
por formulário, leads por etapa e desempenho por responsável; funil de vendas configurável, UTMs (campanha, conjunto e anúncio ×
colunas do kanban), entrada por hora e mapa dia da semana × hora. Períodos: hoje, ontem, 3, 7, 30, 90 dias ou personalizado.

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
tela — ela é conferida com a Anthropic antes de salvar e fica só no servidor (ou use `ANTHROPIC_API_KEY` no `.env`). O modelo que
responde os leads é escolhido na tela (padrão **Claude Haiku**, o mais econômico; `IA_MODELO` no `.env` muda o padrão); cada resposta do
Haiku custa uma fração de centavo, e o consumo de tokens aparece na tela.

**Quando atua:** só em conversa individual de **lead novo** — ninguém da equipe falou com ele e a conversa tem menos de 72 h (ajustável).
Contato antigo, lead fechado/perdido ou número na lista de bloqueio: a IA nunca entra. Lead novo do Yay! Forms recebe a primeira mensagem
1 a 2 minutos depois do cadastro (se a **saudação automática dos Disparos** estiver ligada, ela tem prioridade e a IA só responde quando o
lead escrever). Mensagens da saudação automática não contam como "contato da equipe".

**Quando para:** na hora em que alguém da equipe manda mensagem — pelo CRM ou pelo celular. Na conversa aparece uma faixa com
**Assumir**, **Pausar** e **Devolver para a IA**.

**Quando passa para você:** o lead pede uma pessoa; pergunta preço, contrato, resultado ou detalhes do nicho (ela sempre diz que não pode
prometer resultados); manda uma mídia que ela não conseguiu abrir; fica irritado; ou depois de 6 mensagens da IA (ajustável). O lead fica
**aguardando minha resposta** no kanban, com o motivo, um resumo na conversa e um aviso flutuante no CRM.

**Áudio, imagem e arquivos:** áudios e a fala de vídeos de até 3 min são transcritos pelo Whisper da VPS (precisa da transcrição
instalada e ligada em **Agente → Ajustes → Transcrição**; o atendimento espera até 3 min pela transcrição e, se passar disso, segue sem ela).
Imagens (JPG, PNG, WebP, GIF até 3,7 MB) e PDFs (até 10 MB) vão para o modelo ver — até 3 por resposta; depois fica guardada uma descrição
curta e o arquivo não é reenviado. Word, Excel, PowerPoint, CSV e texto viram texto. A opção **Ver imagens e PDFs** (aba IA) desliga a parte
que gasta mais tokens. O que estiver nas mídias é tratado como dado do lead: ordens escritas num print ou faladas num áudio são ignoradas.

**Horário:** segunda a sexta 7h–18h e sábado 7h–16h (ajustável, fuso de São Paulo por padrão). Fora disso e no domingo, a primeira resposta
avisa que a Impera não está com atendimento humano de prontidão e que o retorno pode levar algumas horas.

**Copiloto × automático:** no **copiloto** (padrão) a IA escreve e você aprova, edita ou descarta na conversa; fora do horário ela pode
responder sozinha (opção). No **automático** ela envia sozinha, com "digitando…" pelo tempo de uma pessoa. A tela mostra quantas sugestões
você aprovou sem mudar — quando quase todas passarem direto, é hora de ligar o automático.

**Playbook:** **Análise profunda (60 dias)** lê as conversas com leads do formulário dos últimos 60 dias (primeiro as que viraram
reunião ou cliente), tira nomes, telefones, e-mails, links e valores, e monta o playbook com o **modelo da análise** (padrão Opus,
`IA_MODELO_PLAYBOOK` no `.env` muda o padrão) e o raciocínio ligado. **Melhorar com conversas novas** lê só as conversas com mensagens
novas desde a última leitura — da equipe e da IA — e complementa o playbook se precisar. As duas rodam em segundo plano e devolvem um
rascunho para revisar e salvar; a **melhoria automática** (a cada N dias) aplica direto. **Versões anteriores** guarda as 10 últimas. O **Simulador** mostra o que a
IA responderia, sem enviar nada.

**Diretrizes (prompts):** textos que dão o norte para a IA — roteiro de SDR, tratamento por tipo de lead, dúvidas frequentes.
**Nova** cria do zero (pode colar); **Subir arquivo** aceita `.md` e `.txt` (um arquivo abre para revisar antes de salvar; vários são salvos
de uma vez, e o título vem do primeiro `# Título` do arquivo). Clique numa diretriz para ler e editar; **Histórico** mostra as versões
anteriores (guarda as 30 últimas) com **Restaurar**; **Baixar .md** exporta. Só as **ativas** entram no prompt, na ordem da lista
(setas ↑ ↓), até 80 mil caracteres somadas (40 mil por diretriz). A IA usa a versão nova já na próxima resposta. As regras de segurança e o
formato de resposta do sistema sempre valem por cima das diretrizes: se uma diretriz pedir para passar preço, mandar link ou responder em
outro formato, a IA segue as regras.

**Formulário do lead:** para leads do Yay! Forms, a IA recebe a situação (**parcial**, **completo sem reunião** ou **completo com reunião**,
com a data do Calendly) e as respostas (pergunta: resposta) — sem telefone nem e-mail. É isso que permite às diretrizes tratar cada caso
(aceitou ou não os valores, urgência, contrato em aberto, experiência). No **Simulador**, escolha a situação e escreva respostas de exemplo,
uma por linha; com a conversa vazia, ele mostra a primeira mensagem que a IA mandaria.

**Segurança:** a IA não recebe ordens do lead. Pedidos de código, senha, acesso, "ignore suas instruções" e afins recebem uma resposta
pronta sem chegar ao modelo (na segunda vez, o lead vai para você). Ela só vê a conversa e o formulário daquele lead — não tem acesso ao banco nem a dados
de outros clientes. Toda resposta passa por um filtro antes de sair: código, telefones, e-mails, links não autorizados (só o link de
agendamento configurado), assuntos de senha/sistema e promessas de resultado são barrados, e a conversa vai para você. Se o lead perguntar
se está falando com um robô, ela nunca nega.

> ⚠️ Mesmo cuidado dos Disparos: o WhatsApp por QR code não é oficial. A IA só fala com quem chegou agora, espera o lead terminar de
> digitar e respeita um limite de mensagens por hora (30, ajustável).

## Agente Alice (assistente pessoal)

Aba **IA → Agente Alice**. Cada usuário do CRM tem a sua assistente, com nome, conversas, cérebro, agendados e tetos de gasto próprios
(em **Ajustes** dá para trocar o nome). Usa a mesma chave da Anthropic da IA de primeiro contato.

**O que ela lê (livre):** conversas e grupos do WhatsApp (com quem disse o quê, participantes e telefones), leads do kanban com
filtros (etapa, respostas do Yay! Forms, reunião no Calendly, proposta enviada — PDF "Proposta comercial…" —, follow-up atrasado,
temperatura), ficha do lead, reuniões, formulários, estatísticas, disparos e qualquer consulta de **leitura** no banco. As tabelas e
colunas sigilosas (chaves de API, senhas, sessões) são recusadas antes de rodar, e cada consulta roda num processo separado que é
encerrado se passar de 8 s. Imagens e PDFs ela vê direto; Word, Excel e PowerPoint viram texto; áudios passam pela transcrição.

**O que ela faz (com aprovação):** enviar mensagem, mover lead, trocar responsável ou anotar, criar público, criar disparo **como
rascunho**, modelo de disparo, critério do Organizador (só administradores), guardar memória e criar agendado. Cada proposta vira um
cartão no chat e em **Ações**: **Aprovar** (dá para editar o texto antes), **Recusar** e, quando dá, **Desfazer**. Nada é apagado. O
rascunho de disparo aparece no topo de **Disparos → Disparo personalizado**: **Abrir no editor**, revisar e disparar.

**Cérebro:** **Entender o CRM** lê os últimos N dias (60 por padrão) com o modelo da leitura (padrão Opus) e escreve o **Contexto do
CRM** — negócio, como o CRM funciona, funil Yay! Forms → Calendly → WhatsApp, **mapa de grupos → clientes**, números, equipe, como você
trabalha e onde achar cada coisa. É editável, guarda versões e pode se atualizar sozinho a cada N dias. **Diretrizes** (mesma tela das da
IA de primeiro contato, só suas) e **Memória** (fatos curtos; ela sugere, você aprova) entram em toda conversa.

**Agendados:** escreva o pedido do seu jeito e use **Melhorar prompt**: ela escreve o prompt que será executado e pergunta o que faltar
(horário, fuso, destino, quais grupos). Frequência: uma vez, todo dia, dias úteis, dias da semana, mensal ou a cada N horas, com fuso
próprio. Destino: só na aba, "mensagem para mim" do número do CRM, outro telefone ou um grupo. Se o número que envia estiver
desconectado, a execução **para** (nem chama a IA) e fica como "não enviada", com aviso no CRM. API instável: tenta mais 2 vezes, com
5 min entre elas. **Rodar agora** testa sem mudar o horário; o **Histórico** mostra cada resposta e o custo.

**WhatsApp:** em **Ajustes → Conversar pelo WhatsApp**, cadastre seus números pessoais. Mensagens (texto, áudio, foto, documento)
desses números para um número do CRM vão para a sua assistente — a IA de primeiro contato ignora esses números. Opcional: atender
também no "mensagem para mim" do número do CRM. Comandos: `SIM 12` aprova a ação 12, `NÃO 12` recusa, `nova conversa` recomeça.

**Custos:** teto por dia do chat (inclui a leitura do CRM, o "Melhorar prompt" e o WhatsApp) e teto por dia dos agendados, separados,
zerando à meia-noite do seu fuso; nos agendados há também teto por execução. O texto fixo (regras + cérebro) vai em cache, o que
barateia as perguntas seguidas.

**Transcrição de áudio (Whisper na VPS):** em **Agente → Ajustes → Transcrição**, um administrador clica em **Instalar** (~480 MB,
na pasta `dados/transcricao`, que as atualizações não apagam; o modelo é baixado na primeira transcrição). A tela mostra CPU e RAM do
servidor e recomenda o modelo: **base** (~500 MB de RAM), **small** (~1 GB, padrão) ou **large v3 turbo** (~3 GB). Roda num processo
separado (se faltar memória, o CRM continua no ar) e cada áudio é transcrito uma vez só. Com **Transcrever sozinho os áudios novos**,
os áudios dos últimos 3 dias (leads, contatos e grupos) são transcritos em segundo plano, um por vez.

## Instagram

Só os perfis **da Impera** (contas profissionais ligadas a uma Página do Facebook do Gerenciador de Negócios da Impera). Tudo é
configurado em **Equipe e integrações → Instagram** (administrador) e o dia a dia fica na aba **Instagram**.

**Atenção ao Direct:** com o acesso padrão (sem Análise do app), a Meta só entrega pelo webhook e pela API as mensagens de contas que
têm função no app. Desempenho, publicações, comentários e anúncios funcionam normalmente; para receber o Direct de qualquer pessoa,
use o **Direct pelo login** (abaixo) ou peça o acesso avançado de `instagram_manage_messages` na Análise do app.

### Ligar (uma vez)

1. **App da Meta** — em [developers.facebook.com](https://developers.facebook.com) → Meus apps → Criar app → tipo **Empresa**, ligado ao
   Gerenciador de Negócios da Impera. Adicione os produtos **Instagram** (API do Instagram com login do Facebook), **Webhooks** e
   **Login do Facebook para Empresas**. Em **Configurações do app → Básico**: copie o **ID do app** e a **Chave secreta**, preencha a
   URL da política de privacidade (pode ser uma página simples do site da Impera) e cole o ID e a chave na tela do CRM
   (**1. App da Meta**). A chave fica só no servidor e aparece coberta (••••).
2. **Endereço de retorno do login** — em **Login do Facebook para Empresas → Configurações**, cole o endereço que a tela mostra em
   "URIs de redirecionamento do OAuth válidos" (termina em `/api/instagram/oauth/retorno`). O CRM precisa estar em **https**
   (`PUBLIC_URL` no `.env`): a Meta não aceita http.
3. **Webhook** — em **Webhooks**, escolha **Instagram**, cole a **URL de retorno** e o **token de verificação** da tela (passo 2) e
   assine: `messages`, `messaging_seen`, `message_reactions`, `messaging_referral`, `comments`, `mentions` e `story_insights`.
   Depois mude o app para o modo **Ao vivo** (a Meta só entrega mensagens de verdade a apps ao vivo).
4. **Acesso às contas** — o recomendado é um **usuário do sistema**: Gerenciador de Negócios → Configurações → **Usuários do
   sistema** → Adicionar (função administrador) → **Atribuir ativos** (as Páginas e os perfis do Instagram da Impera e as **contas de
   anúncio**) → **Gerar token** do app com as permissões `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`,
   `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `business_management` e
   `ads_read`, validade **Nunca**. Cole em **3. Acesso às contas** e clique em **Conferir e guardar**. (Para testar rápido dá para usar
   **Entrar com o Facebook**; esse acesso vence em ~60 dias.)
5. **Perfis** — **Buscar perfis disponíveis** → **Conectar** em cada perfil da Impera. O CRM inscreve a Página no app (para o
   webhook), busca o histórico do Direct, as publicações, os números da conta (até 2 anos para trás, aos poucos), o público e os
   anúncios. Em cada perfil dá para ligar a **Alice no Direct** e informar as palavras da UTM que identificam o perfil nos formulários
   do Yay! Forms (padrão: `instagram, ig`).

### Direct pelo login (não oficial)

Plugin que lê e responde o Direct entrando no perfil como o app do Instagram (biblioteca open source
[instagrapi](https://github.com/subzeroid/instagrapi), versão fixada em `server/src/modules/instagram/privado/index.js`). Liga por
perfil, no cartão do perfil em **Equipe e integrações → Instagram → 4. Perfis**:

1. **Instalar motor** (uma vez, 1 a 3 min): cria um Python próprio em `dados/instagram-login/venv` com a biblioteca. Usa o `python3`
   da VPS; se ele não tiver o `venv`, baixa o [uv](https://docs.astral.sh/uv/) e um Python para dentro da pasta (não precisa de root).
2. **Cookie `sessionid`**: no computador, abra instagram.com no Chrome **com o perfil certo**, F12 → Application → Cookies →
   `https://www.instagram.com` → copie o valor de `sessionid` e cole no CRM. Não clique em "Sair" nesse navegador depois (derruba o
   cookie). O CRM confere se o cookie é do mesmo @ do perfil.
3. **Proxy (opcional, recomendado)**: um proxy residencial do Brasil (`http://usuario:senha@host:porta`). Sem proxy, o Instagram vê o
   IP da Contabo (datacenter), o que aumenta a chance de pedido de verificação.
4. **Ligar**: o CRM importa as conversas recentes (até 60, com as 20 mensagens mais recentes de cada) e passa a buscar a cada ~45 s
   (ajustável de 30 s a 5 min, sempre com variação para parecer gente) e as solicitações de mensagem a cada ~3 min.

Como fica: sem prazo de 24 h para responder (o selo some), conversas em **Solicitações** aparecem com a etiqueta e responder pelo CRM
aceita a conversa, grupos ficam só no app, fotos/vídeos temporários aparecem como aviso. Arquivos: foto, vídeo e áudio (áudio vira
`.m4a`; PDF e outros não são aceitos pelo Direct). O cookie e o proxy ficam só no banco (`ig_credenciais`, nunca na tela); a sessão do
motor fica em `dados/instagram-login/sessoes` (só o usuário do CRM lê).

**Riscos (não é oficial):** o Instagram pode pedir verificação, bloquear ações por algumas horas ou, raramente, restringir a conta.
O CRM para sozinho quando a sessão cai ou vem verificação (aparece **Parado** no cartão: confirme no app e cole um cookie novo) e espera
30 min (limite) ou 1 h (bloqueio) quando o Instagram pede calma. Use só em perfis da Impera, com o ok do dono. **Desligar** volta o
Direct para a API oficial e apaga o cookie; as conversas guardadas continuam.

### No dia a dia

- **Direct**: como o WhatsApp. O selo de cada conversa mostra quanto falta do prazo para responder: **24 h** depois da última
  mensagem da pessoa (**7 dias** se ela veio de um anúncio de mensagem). Fora do prazo a caixa de resposta fecha — é regra do
  Instagram; quando a pessoa escreve de novo, abre de novo. Textos longos saem em mais de uma mensagem (o limite é 1.000 caracteres).
  Arquivos até 25 MB (foto, vídeo, áudio, PDF).
- **Alice**: liga por perfil (**Instagram → Ajustes** ou na conexão). Usa o nome, a apresentação, o playbook, as diretrizes, o horário
  e o modo (copiloto ou automático) da tela **IA**, e precisa da IA de primeiro contato ligada. Atende só quem escreve pela primeira
  vez e ninguém da equipe falou; para quando alguém da equipe escreve (pelo CRM ou pelo app) e passa para a equipe quando a pessoa pede
  um humano, não é lead ou chega no limite de mensagens. Pegou o WhatsApp: o lead entra no kanban como **aguardando** com a entrevista
  (e liga às conversas do WhatsApp desse número). A entrevista é editável em **Ajustes**.
- **Comentários**: vêm desligados. Ligados, o CRM busca os comentários das publicações recentes a cada poucos minutos (o webhook de
  comentários só funciona com acesso avançado da Meta, por isso a busca). **Chamar no Direct** manda uma mensagem privada (uma por
  comentário, até 7 dias depois).
- **Desempenho** e **Relatórios da IA**: período de 7 a 365 dias ou personalizado, por perfil ou somando todos. Os números da conta
  chegam com 1 a 2 dias de atraso; o público e os horários só aparecem em perfis com 100 seguidores ou mais. O relatório semanal sai
  toda segunda (dia, hora, modelo e teto em **Ajustes**).

**Limites da Meta:** do que aconteceu **antes** de conectar, a API entrega só as **20 mensagens mais recentes** de cada conversa (daí
para a frente o CRM guarda tudo); métricas diárias da conta até **2 anos** para trás; stories somem em 24 h (o CRM guarda os números a
cada hora). Mídias do Direct são baixadas na hora, porque os links da Meta expiram.

## Permissões da equipe

Em **Equipe e integrações → Equipe**, botão **Permissões** em cada pessoa. **Telas:** Kanban, WhatsApp, Instagram (Direct,
desempenho e relatórios, comentários), Disparos, IA (configuração), assistente pessoal e Estatísticas. **Funções:** editar leads,
excluir leads, enviar no WhatsApp, responder no Instagram (inclui ligar/pausar a Alice e aprovar as sugestões dela) e disparar
campanhas. O que estava liberado antes continua liberado; o Instagram e **excluir leads** nascem fechados. Administrador pode tudo. O
servidor confere cada pedido (não adianta só esconder o botão).

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
| `YAYFORMS_API_TOKEN` | Opcional: token da API do Yay! Forms, só para buscar nomes de formulários e perguntas. Prefira colar pela tela |
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
| `TRANSCRICAO_DIR` | Pasta da transcrição de áudio da assistente (biblioteca e modelos do Whisper). Padrão: `dados/transcricao`, ao lado do banco |
| `META_APP_ID` / `META_APP_SECRET` | Opcional: ID e chave secreta do app da Meta (Instagram). Prefira colar pela tela (Equipe e integrações → Instagram) |
| `META_API_VERSAO` | Versão da Graph API usada pelo Instagram (padrão `v25.0`; também dá para trocar pela tela) |
| `LOG_MAX_MB` | Tamanho máximo do `logs/crm.log` antes de virar `crm.log.1` (padrão 20) |

Depois de mudar o `.env`, rode `./parar.sh && ./iniciar.sh`.

## Migrar para a Contabo

1. Na VPS (Ubuntu): `git clone` deste repositório em `/opt/crm-impera/app` e `./instalar.sh`.
2. Copie o arquivo mais recente de `backups/` e o `.env` para a VPS.
3. `./scripts/restaurar.sh <backup>`.
4. Aponte um subdomínio da GoDaddy para o IP da VPS. O HTTPS e o início automático com o servidor entram no projeto nessa etapa.

## Para quem for mexer no código

```
server/src/modules/   ← cada integração é um módulo (auth, users, stages, leads, followup, yayforms, calendly, whatsapp...)
server/src/db.js      ← toda a conversa com o banco (SQLite embutido no Node) e as "gerações" de cada tabela
server/src/tempoReal.js ← avisos em tempo real para a tela (/api/eventos), agrupados em lote e filtrados por permissão
server/src/cache.js   ← memoizar() e responderJson(): listas pesadas reaproveitadas até a tabela mudar (ETag/304/gzip)
server/src/rede.js    ← baixarSeguro(): download de endereço digitado por alguém (nunca rede interna, nem por redirecionamento)
server/src/upload.js  ← receberCorpo(): arquivo enviado pela tela direto para o disco, com limite de tamanho
server/src/arquivos.js ← enviarArquivoSeguro(): entrega de arquivo que veio de fora (abre isolado ou baixa)
server/src/util.js    ← telefone, e-mail, iguaisSeguro() (tokens), criarRota() (erros das rotas), esperar()
server/src/modules/whatsapp/
  gerenciador.js  conexão (QR code, reconexão), eventos do WhatsApp, fotos de perfil
  recebimento.js  mensagens recebidas → banco (ao vivo e em lotes do histórico)
  historico.js    importação de 90 dias e complemento por conversa (fetchMessageHistory)
  ligacao.js      conversa ↔ lead (telefone, 9º dígito, LID, "religar tudo")
  envio.js        tudo que o CRM envia e as ações nas mensagens (editar, encaminhar, votar...)
  conversas.js    caixa de entrada (lista, filtros, estado das conversas, etiquetas)
  chamadas.js · figurinhas.js · presenca.js · previa.js · midia.js · conteudo.js · ffmpeg.js
server/src/modules/agente/      ← Agente Alice (assistente pessoal de cada usuário)
  motor.js        conversas e laço de ferramentas · ferramentas.js  o que ela lê e propõe
  acoes.js        propostas, aprovação, execução e desfazer · consulta.js  leitura segura do banco
  contexto.js     "Entender o CRM" · agendados.js  agendados · canal.js  conversar pelo WhatsApp
  transcricao.js  Whisper na VPS (processo separado) · documentos.js  Word/Excel/PowerPoint em texto
server/src/modules/ia/          ← IA de primeiro contato (Alice SDR)
  motor.js        quando atua, para e passa · prompt.js  regras e pedido ao modelo · midias.js  áudio/imagem/PDF/documento do lead
server/src/modules/instagram/   ← Instagram (perfis da Impera pela API da Meta)
  conexao.js      app, login, tokens, perfis · graph.js  chamadas à Meta · webhook.js  eventos · direct.js  Direct (gravar, enviar, leads)
  sdr.js          Alice no Direct · metricas.js  conta, publicações, stories, público · anuncios.js  anúncios ligados aos perfis
  comentarios.js · desempenho.js  números para a tela · relatorios.js  relatórios da IA · agente.js  ferramentas da assistente
server/src/modules/auth/permissoes.js ← permissões por pessoa (telas e funções)
server/migrations/    ← mudanças no banco, numeradas (001_, 002_...). Só acrescentam, nunca apagam dados.
server/testes/        ← testes automáticos (node:test) e ferramentas de teste com dados falsos
web/src/              ← interface React (WhatsApp em WhatsAppPagina.jsx, Conversa.jsx e web/src/components/chat/; Agente em web/src/components/ia/agente/;
                         Instagram em web/src/components/instagram/; permissões em web/src/permissoes.js e components/Permissoes.jsx)
```

Novo módulo: criar `server/src/modules/<nome>/index.js` exportando `{ name, register(app) }` e registrar em `modules/index.js`.

Regras de segurança (revisão 0.27): toda rota confere o login **e a permissão** no servidor (`exigirPermissao`), inclusive o que a
assistente faz em nome da pessoa (`PERMISSAO_DA_FERRAMENTA` em `agente/ferramentas.js` e `PERMISSAO_DA_ACAO` em `agente/acoes.js`);
arquivo recebido usa `receberCorpo`, arquivo de fora sai por `enviarArquivoSeguro`, link digitado por alguém passa por `baixarSeguro`;
token e assinatura se comparam com `iguaisSeguro`; erro inesperado de rota nunca vai com detalhe para a tela (`criarRota`).
Lista pesada que a tela pede sempre: `responderJson(req, res, { chave, tabelas, ttlMs }, calcular)` — liste em `tabelas`
tudo de que o resultado depende. Pedidos POST/PUT/PATCH/DELETE em `/api` só passam vindos da própria tela (proteção contra CSRF).
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
