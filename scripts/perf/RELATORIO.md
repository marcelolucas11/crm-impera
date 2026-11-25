# Relatório de desempenho da interface — v0.33.0 × v0.34.0

Medido com `scripts/perf/medir.mjs` contra o **servidor falso** (dados de exemplo: ~155 leads no kanban, conversas de
exemplo com figurinha animada, 2 números de WhatsApp falsos). Cada cenário dura **30 s**: *parado* (mouse quieto),
*mouse* (mouse se mexendo sobre os cartões ~20 vezes por segundo) e *rolando* (rodinha do mouse na lista).

**Como ler:** o Chrome roda sem janela (headless), então **tudo que a placa de vídeo faria no Mac é feito pelo processador**
— desfoque do vidro, composição das camadas e o 3D. Por isso os números absolutos são bem maiores que no MacBook (e a máquina
de teste tem só 2 núcleos: ~170% é o teto). O que importa é a comparação antes × depois, na mesma máquina e com o mesmo script.
Referência: o mesmo Chrome com uma página em branco gastou 0.9% (antes) e 0.8% (depois).

| Tela | Cenário | CPU do Chrome (todos os processos) | Trabalho da página (ms/s) | Quadros/s | Vidros na tela | Requisições/min |
|---|---|---|---|---|---|---|
| kanban | parado | 38.3% → **20.8%** (-46%) | 162 → **4.7** | 3 → 3.9 | 8 → 8 | 5.8 → **0** |
| kanban | mouse | 161.3% → **142.8%** (-11%) | 674.7 → **214.6** | 12.9 → 14.9 | 8 → 8 | 5 → **0** |
| kanban | rolando | 165.6% → **130.5%** (-21%) | 699.3 → **138.2** | 13.5 → 15.6 | 8 → 8 | 28.8 → **33** |
| whatsapp | parado | 27.3% → **4.8%** (-82%) | 2.5 → **3.4** | 4.7 → 15 | 9 → 3 | 9.8 → **0** |
| whatsapp | mouse | 112.2% → **57.2%** (-49%) | 82 → **117.5** | 15.6 → 50.8 | 9 → 3 | 12.7 → **1.7** |
| whatsapp | rolando | 105.6% → **18.9%** (-82%) | 24.9 → **28.4** | 15.6 → 54.6 | 9 → 3 | 11.2 → **0** |
| ia | parado | 2.4% → **1.6%** (-33%) | 7.8 → **6.6** | 0 → 0 | 6 → 0 | 4 → **0** |
| ia | mouse | 29.6% → **11.9%** (-60%) | 27.8 → **27.2** | 4.5 → 4.3 | 6 → 0 | 3.7 → **0** |
| ia | rolando | 60.5% → **54.1%** (-11%) | 32.3 → **31.2** | 8.3 → 7.6 | 6 → 0 | 3.7 → **0** |

*Quadros/s subir no WhatsApp é bom sinal:* antes o desenho do vidro não dava conta e a tela pulava quadros (a figurinha animada
e o "digitando…" travavam); agora a tela fica fluida gastando bem menos.

## O que era a causa principal

1. **Desfoque do vidro onde não havia nada para desfocar.** Na tela de WhatsApp eram 9 painéis de vidro (com vidro dentro de
   vidro: barra do chat e caixa de digitação dentro do painel do chat). Atrás deles só existe o degradê parado do fundo, então o
   desfoque não mudava nada na imagem, mas obrigava o navegador a redesenhar o fundo de cada painel a cada quadro. Prova: ligando e
   desligando só esse efeito, com a mesma conversa aberta e parada, a CPU foi de **~99% para ~5%** (experimento isolado), e na
   medição completa o WhatsApp parado caiu de 27.3% para 4.8% e rolando de 105.6% para 18.9%.
2. **Logo 3D redesenhado o tempo todo no kanban.** Enquanto o mouse se mexia, a cena 3D (ouro com verniz, ~3.260 estrelas)
   era redesenhada ~20 vezes por segundo, e cada quadro fazia o vidro de todas as colunas ser refeito. O trabalho da página no
   kanban com o mouse se mexendo caiu de 674.7 para 214.6 ms por segundo (≈3× menos), e parado de 162 para 4.7 ms/s.

A rede **não** era a causa do calor (poucas requisições por minuto), mas tinha desperdício: com a aba parada, a v0.33 fazia
5.8–9.8 requisições por minuto de "conferência" mesmo com o tempo real funcionando; agora, nenhuma nos 30 s medidos
(a conferência de segurança passou para a cada 2–5 min com o tempo real de pé).

Requisições na tela parada, antes:
- kanban: `GET /api/followup/resumo` ×1, `GET /api/instagram/resumo` ×1, `GET /api/leads` ×1
- whatsapp: `GET /api/followup/resumo` ×1, `GET /api/instagram/resumo` ×1, `GET /api/whatsapp/conversas` ×1, `GET /api/whatsapp/conversas/l%3A1/mensagens` ×2
- ia: `GET /api/followup/resumo` ×1, `GET /api/instagram/resumo` ×1

Depois:
- kanban: nenhuma
- whatsapp: nenhuma
- ia: nenhuma

## Suspeitos conferidos

| # | Suspeito | Resultado |
|---|---|---|
| 1 | Fundo 3D no kanban redesenhando ~20 quadros/s | **Confirmado.** Desligar só o 3D cortava ~metade do trabalho da página no kanban com o mouse se mexendo. Agora é desenhado uma vez (parado). |
| 2 | Desfoque (backdrop-filter) e refração SVG | **Confirmado, o maior.** O desfoque é o maior custo por quadro. A refração SVG só entrava em janelas/menus abertos (0 na tela normal) e saiu por padrão. |
| 3 | Cartões: 3D, sombras, sem virtualização | **Parcial.** Sombras e inclinação custam algo no hover, mas pouco perto do vidro (trocar a sombra do hover por uma camada com opacidade ganhou só ~6%, não compensou mexer no visual). O 3D (`preserve-3d`) agora só no cartão sob o mouse, e cartões fora da área visível da coluna não são desenhados (`content-visibility`). Virtualização não foi feita: atrapalharia o arrastar e soltar e o `content-visibility` já tira o custo dos cartões fora da tela. |
| 4 | Animações infinitas (sino, LED) | **Pequeno.** Já paravam com 10 s sem uso. Agora os sinos de cartões fora da área visível também não são desenhados. |
| 5 | Três ouvintes de `pointermove` | **Pequeno, corrigido.** Agora é um só (`web/src/atividade.js`), sem reiniciar timers a cada movimento. |
| 6 | Presença ("digitando…") recarregando a lista | **Confirmado no código, corrigido.** Cada aviso de digitando/online (inclusive de grupos) buscava a lista inteira; agora só muda o indicador na tela. (O servidor falso não gera presença, então não aparece na tabela.) |
| 7 | Favoritas recarregando a cada mensagem | **Corrigido:** só recarrega com aviso da conversa aberta. |
| 8 | Kanban recarregando a cada mensagem | **Corrigido em parte:** mensagens de grupo não recarregam mais o kanban; com a aba escondida, recarrega uma vez só ao voltar. Os cartões continuam re-renderizando 1×/min para atualizar os tempos ("há 5 min"). |
| 9 | Polling com o tempo real ligado / aba escondida | **Confirmado, corrigido.** Lista de conversas (20 s), conversa aberta (15 s), kanban (30 s), resumo do topo (30 s), Instagram (30 s), Direct/chat do Instagram e status do Calendly (30 s, até com a aba escondida) agora conferem a cada 2–5 min com o tempo real de pé e nada com a aba escondida. |

## O que ainda pesa (e é de propósito)

No kanban, o vidro das colunas por cima do logo 3D continua — é ele que deixa o logo dourado suave atrás das colunas (sem ele
o logo aparece nítido, com todos os detalhes, e muda a cara do kanban). Com o fundo agora parado, o navegador só refaz o vidro
da coluna em que o mouse está mexendo num cartão. Quem quiser ainda mais leveza pode pedir uma opção para desligar também esse
desfoque.

## Prints

`prints/antes/` e `prints/depois/`: login, kanban, WhatsApp, IA, ficha do lead e menu. Diferença média por pixel entre antes e
depois: kanban 1,5 e WhatsApp 4 (numa escala de 0 a 255) — o logo do login aparece em outra posição porque está animado.
