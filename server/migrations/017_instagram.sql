-- 017: Instagram — perfis da Impera conectados pela API oficial da Meta.
-- Direct (conversas como no WhatsApp, com a Alice SDR), comentários, métricas da conta e de cada publicação,
-- anúncios ligados aos perfis e relatórios da IA. Só acrescenta tabelas novas: nada existente é alterado ou apagado.
-- Datas em texto ISO 8601 UTC; dias (AAAA-MM-DD) no fuso do CRM.

-- Perfis do Instagram conectados (contas profissionais ligadas a uma Página do Facebook)
CREATE TABLE ig_perfis (
  id INTEGER PRIMARY KEY,
  ig_id TEXT NOT NULL UNIQUE,
  page_id TEXT,
  page_nome TEXT,
  username TEXT,
  nome TEXT,
  foto_url TEXT,
  foto_local TEXT,
  biografia TEXT,
  site TEXT,
  seguidores INTEGER,
  seguindo INTEGER,
  publicacoes INTEGER,
  -- 0 = desconectado (os dados continuam guardados)
  ativo INTEGER NOT NULL DEFAULT 1,
  -- A Alice (SDR) atende o Direct deste perfil
  alice_ativa INTEGER NOT NULL DEFAULT 0,
  -- Página inscrita no app (para receber os webhooks)
  inscrito_em TEXT,
  inscricao_erro TEXT,
  webhook_em TEXT,
  ultimo_erro TEXT,
  ultimo_erro_em TEXT,
  -- Pausa depois de bater no limite de chamadas da Meta
  pausado_ate TEXT,
  sync_direct_em TEXT,
  sync_conta_em TEXT,
  sync_posts_em TEXT,
  sync_stories_em TEXT,
  sync_comentarios_em TEXT,
  sync_demografia_em TEXT,
  historico_direct_em TEXT,
  -- Dia mais antigo das métricas diárias da conta já buscado (o histórico vai sendo completado para trás)
  conta_desde TEXT,
  conta_backfill_ok INTEGER NOT NULL DEFAULT 0,
  -- JSON: opções do perfil (ex.: texto da UTM que identifica leads do Yay! Forms vindos deste perfil, metas)
  config TEXT NOT NULL DEFAULT '{}',
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Tokens de acesso da Meta (nunca aparecem na tela nem nas consultas da assistente)
-- chave: 'usuario' (token de usuário ou de usuário do sistema) | 'pagina:<page_id>'
CREATE TABLE ig_credenciais (
  chave TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  tipo TEXT,
  conta_meta TEXT,
  expira_em TEXT,
  dados_expiram_em TEXT,
  escopos TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Pessoas que falaram com os perfis (IGSID = identificador da pessoa para aquele perfil)
CREATE TABLE ig_contatos (
  perfil_id INTEGER NOT NULL REFERENCES ig_perfis(id) ON DELETE CASCADE,
  igsid TEXT NOT NULL,
  username TEXT,
  nome TEXT,
  foto_url TEXT,
  foto_local TEXT,
  seguidores INTEGER,
  segue_perfil INTEGER,
  perfil_segue INTEGER,
  verificado INTEGER,
  atualizado_em TEXT,
  PRIMARY KEY (perfil_id, igsid)
);
CREATE INDEX ig_contatos_username_idx ON ig_contatos (username);

-- Conversas do Direct
CREATE TABLE ig_conversas (
  id INTEGER PRIMARY KEY,
  perfil_id INTEGER NOT NULL REFERENCES ig_perfis(id) ON DELETE CASCADE,
  igsid TEXT NOT NULL,
  meta_id TEXT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  ultima_em TEXT,
  ultima_previa TEXT,
  ultima_minha INTEGER NOT NULL DEFAULT 0,
  -- Última mensagem da pessoa: abre a janela de 24 h para responder
  ultima_dele_em TEXT,
  primeira_em TEXT,
  nao_lidas INTEGER NOT NULL DEFAULT 0,
  marcada_nao_lida INTEGER NOT NULL DEFAULT 0,
  arquivada INTEGER NOT NULL DEFAULT 0,
  fixada INTEGER NOT NULL DEFAULT 0,
  aguardando_desde TEXT,
  aguardando_nota TEXT,
  -- Anúncio que trouxe a conversa (click-to-Direct) e o post de origem, quando a Meta informa
  anuncio_id TEXT,
  anuncio_titulo TEXT,
  origem TEXT,
  sync_em TEXT,
  criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (perfil_id, igsid)
);
CREATE INDEX ig_conversas_lista_idx ON ig_conversas (perfil_id, ultima_em);
CREATE INDEX ig_conversas_lead_idx ON ig_conversas (lead_id);

-- Mensagens do Direct
-- tipo: texto | imagem | video | audio | arquivo | story_resposta | story_mencao | post | reel | compartilhamento | nao_suportada
-- origem (nossas): crm (alguém pelo CRM) | ia (Alice SDR) | assistente (assistente pessoal, aprovado) | celular (app do Instagram)
-- status (nossas): 0 erro | 2 enviada | 4 vista
CREATE TABLE ig_mensagens (
  id INTEGER PRIMARY KEY,
  conversa_id INTEGER NOT NULL REFERENCES ig_conversas(id) ON DELETE CASCADE,
  mid TEXT UNIQUE,
  de_mim INTEGER NOT NULL DEFAULT 0,
  tipo TEXT NOT NULL DEFAULT 'texto',
  texto TEXT,
  -- JSON: [{ tipo, url, local, mime, tamanho, nome }]
  anexos TEXT NOT NULL DEFAULT '[]',
  story_url TEXT,
  story_id TEXT,
  story_local TEXT,
  resposta_mid TEXT,
  referral TEXT,
  reacoes TEXT,
  origem TEXT,
  enviado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status INTEGER,
  erro TEXT,
  apagada_em TEXT,
  editada_em TEXT,
  transcricao TEXT,
  transcricao_em TEXT,
  timestamp TEXT NOT NULL,
  criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_mensagens_conversa_idx ON ig_mensagens (conversa_id, timestamp);

-- Alice (SDR) no Direct: uma linha por conversa que ela avaliou
-- status: ativa | aguardando_humano | humano | pausada | ignorada | concluida | janela_fechada | erro
CREATE TABLE ig_ia (
  conversa_id INTEGER PRIMARY KEY REFERENCES ig_conversas(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ativa',
  motivo TEXT,
  resumo TEXT,
  eh_lead INTEGER,
  -- JSON: o que ela levantou na entrevista (nome, whatsapp, nicho, experiência…)
  dados TEXT NOT NULL DEFAULT '{}',
  mensagens_ia INTEGER NOT NULL DEFAULT 0,
  avisos_seguranca INTEGER NOT NULL DEFAULT 0,
  ultima_lida_id INTEGER NOT NULL DEFAULT 0,
  proxima_em TEXT,
  aviso_fora_horario_em TEXT,
  ativada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_ia_status_idx ON ig_ia (status, proxima_em);

-- Modo copiloto: respostas da Alice esperando aprovação
CREATE TABLE ig_ia_sugestoes (
  id INTEGER PRIMARY KEY,
  conversa_id INTEGER NOT NULL REFERENCES ig_conversas(id) ON DELETE CASCADE,
  mensagens TEXT NOT NULL DEFAULT '[]',
  acao TEXT NOT NULL DEFAULT 'responder',
  motivo TEXT,
  dados TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  decidida_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decidida_em TEXT,
  criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_ia_sugestoes_idx ON ig_ia_sugestoes (conversa_id, status);

-- Números do perfil por dia (uma linha por perfil e dia)
CREATE TABLE ig_conta_diaria (
  perfil_id INTEGER NOT NULL REFERENCES ig_perfis(id) ON DELETE CASCADE,
  dia TEXT NOT NULL,
  seguidores INTEGER,
  seguindo INTEGER,
  publicacoes INTEGER,
  novos_seguidores INTEGER,
  seguiram INTEGER,
  deixaram_de_seguir INTEGER,
  alcance INTEGER,
  visualizacoes INTEGER,
  contas_engajadas INTEGER,
  interacoes INTEGER,
  curtidas INTEGER,
  comentarios INTEGER,
  compartilhamentos INTEGER,
  salvamentos INTEGER,
  respostas INTEGER,
  reposts INTEGER,
  cliques_contato INTEGER,
  -- JSON com as quebras (por tipo de conteúdo, seguidores × não seguidores…)
  quebras TEXT NOT NULL DEFAULT '{}',
  coletado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (perfil_id, dia)
);

-- Publicações (feed, reels, carrossel e stories)
CREATE TABLE ig_posts (
  id TEXT PRIMARY KEY,
  perfil_id INTEGER NOT NULL REFERENCES ig_perfis(id) ON DELETE CASCADE,
  -- IMAGE | VIDEO | CAROUSEL_ALBUM
  tipo TEXT,
  -- FEED | REELS | STORY | AD
  produto TEXT,
  legenda TEXT,
  permalink TEXT,
  media_url TEXT,
  thumb_url TEXT,
  thumb_local TEXT,
  publicado_em TEXT,
  curtidas INTEGER,
  comentarios INTEGER,
  visualizacoes INTEGER,
  alcance INTEGER,
  salvamentos INTEGER,
  compartilhamentos INTEGER,
  interacoes INTEGER,
  reposts INTEGER,
  seguiram INTEGER,
  visitas_perfil INTEGER,
  respostas INTEGER,
  cliques_link INTEGER,
  tempo_medio_ms INTEGER,
  tempo_total_ms INTEGER,
  taxa_pulo REAL,
  -- Totais com anúncios e impulsionamentos (Meta)
  total_curtidas INTEGER,
  total_comentarios INTEGER,
  total_visualizacoes INTEGER,
  -- JSON: todas as métricas como a Meta devolveu
  metricas TEXT NOT NULL DEFAULT '{}',
  metricas_em TEXT,
  removido_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_posts_perfil_idx ON ig_posts (perfil_id, publicado_em);

-- Evolução diária de cada publicação (enquanto ela ainda cresce)
CREATE TABLE ig_posts_diario (
  post_id TEXT NOT NULL REFERENCES ig_posts(id) ON DELETE CASCADE,
  dia TEXT NOT NULL,
  visualizacoes INTEGER,
  alcance INTEGER,
  curtidas INTEGER,
  comentarios INTEGER,
  salvamentos INTEGER,
  compartilhamentos INTEGER,
  interacoes INTEGER,
  PRIMARY KEY (post_id, dia)
);

-- Público: seguidores e público engajado por idade, gênero, cidade e país; horários com seguidores online
CREATE TABLE ig_publico (
  perfil_id INTEGER NOT NULL REFERENCES ig_perfis(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  recorte TEXT NOT NULL,
  dados TEXT NOT NULL DEFAULT '{}',
  coletado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (perfil_id, tipo, recorte)
);

-- Comentários das publicações
CREATE TABLE ig_comentarios (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  perfil_id INTEGER NOT NULL REFERENCES ig_perfis(id) ON DELETE CASCADE,
  pai_id TEXT,
  usuario TEXT,
  usuario_id TEXT,
  texto TEXT,
  curtidas INTEGER,
  de_mim INTEGER NOT NULL DEFAULT 0,
  oculto INTEGER NOT NULL DEFAULT 0,
  lido INTEGER NOT NULL DEFAULT 0,
  respondido_em TEXT,
  respondido_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  direct_em TEXT,
  direct_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  anuncio_id TEXT,
  apagado_em TEXT,
  publicado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_comentarios_post_idx ON ig_comentarios (post_id, publicado_em);
CREATE INDEX ig_comentarios_perfil_idx ON ig_comentarios (perfil_id, publicado_em);

-- Contas de anúncio, anúncios ligados aos perfis e números diários de cada anúncio
CREATE TABLE ig_anuncios_contas (
  id TEXT PRIMARY KEY,
  nome TEXT,
  moeda TEXT,
  fuso TEXT,
  status INTEGER,
  sync_em TEXT,
  backfill_ate TEXT,
  erro TEXT
);

CREATE TABLE ig_anuncios (
  id TEXT PRIMARY KEY,
  conta_id TEXT,
  nome TEXT,
  status TEXT,
  campanha_id TEXT,
  campanha_nome TEXT,
  objetivo TEXT,
  conjunto_id TEXT,
  conjunto_nome TEXT,
  perfil_id INTEGER REFERENCES ig_perfis(id) ON DELETE SET NULL,
  post_id TEXT,
  permalink TEXT,
  thumb_url TEXT,
  criado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_anuncios_post_idx ON ig_anuncios (post_id);
CREATE INDEX ig_anuncios_perfil_idx ON ig_anuncios (perfil_id);

CREATE TABLE ig_anuncios_diario (
  anuncio_id TEXT NOT NULL,
  dia TEXT NOT NULL,
  gasto REAL,
  impressoes INTEGER,
  alcance INTEGER,
  cliques INTEGER,
  cliques_link INTEGER,
  conversas INTEGER,
  leads INTEGER,
  acoes TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (anuncio_id, dia)
);

-- Relatórios da IA (semanal automático, pedido na hora ou de um período escolhido)
CREATE TABLE ig_relatorios (
  id INTEGER PRIMARY KEY,
  perfil_id INTEGER REFERENCES ig_perfis(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'manual',
  titulo TEXT,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'gerando',
  modelo TEXT,
  texto TEXT,
  dados TEXT,
  custo_usd REAL NOT NULL DEFAULT 0,
  erro TEXT,
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  concluido_em TEXT
);
CREATE INDEX ig_relatorios_idx ON ig_relatorios (criado_em);

-- Arquivos que o CRM manda pelo Direct ficam num endereço público temporário (a Meta busca por ele)
CREATE TABLE ig_envios_publicos (
  token TEXT PRIMARY KEY,
  caminho TEXT NOT NULL,
  mime TEXT,
  expira_em TEXT NOT NULL
);

-- Registro do que aconteceu (sincronizações, erros, webhooks) para a tela de configuração
CREATE TABLE ig_registro (
  id INTEGER PRIMARY KEY,
  perfil_id INTEGER REFERENCES ig_perfis(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ig_registro_idx ON ig_registro (criado_em);
