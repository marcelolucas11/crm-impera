// Ferramentas do Instagram para a assistente pessoal de cada usuário (aba IA → Agente; ex.: Selene).
// Ela lê o Direct, os comentários, o desempenho, os anúncios e os relatórios, e PROPÕE respostas no Direct
// (cartão de aprovação — nada é enviado sem o usuário aprovar). Cada ferramenta respeita as permissões do usuário.
import { get, all } from '../../db.js';
import { lerJson } from '../../events.js';
import { temPermissao } from '../auth/permissoes.js';
import { registrarFerramenta, } from '../agente/ferramentas.js';
import { registrarExecutor } from '../agente/acoes.js';
import { interpretarData, dataHora } from '../agente/dados.js';
import { listarConversas, janelaDaConversa, enviar, conversaCompleta } from './direct.js';
import { painel, listarPosts, listarAnuncios } from './desempenho.js';
import { listarComentarios } from './comentarios.js';
import { listarRelatorios, obterRelatorio } from './relatorios.js';
import { diaNoFuso } from './metricas.js';

const json = (o) => JSON.stringify(o, null, 1);
const cortar = (t, n) => (t && t.length > n ? `${t.slice(0, n)}… (cortado)` : t || '');
const pode = (...chaves) => (ctx) => chaves.some((c) => temPermissao(ctx.userId, c));
const PERIODO = {
  desde: { type: 'string', description: 'Início: AAAA-MM-DD, "hoje", "ontem", "7d", "30d". No fuso do usuário.' },
  ate: { type: 'string', description: 'Fim (mesmos formatos). Vazio = agora.' },
};

function perfilPorTexto(texto) {
  const t = String(texto || '').replace(/^@/, '').trim().toLowerCase();
  if (!t) return null;
  const p = get('SELECT id, username FROM ig_perfis WHERE lower(username) = ? OR CAST(id AS TEXT) = ?', [t, t]);
  if (!p) throw new Error(`Perfil "${texto}" não está conectado. Perfis: ${all('SELECT username FROM ig_perfis WHERE ativo = 1').map((x) => `@${x.username}`).join(', ') || 'nenhum'}`);
  return p.id;
}

/** "ig:12", "12" ou "@fulano" → id da conversa */
function conversaPorTexto(texto) {
  const t = String(texto || '').trim();
  const m = t.match(/^(?:ig:)?(\d+)$/);
  if (m && get('SELECT 1 AS ok FROM ig_conversas WHERE id = ?', [Number(m[1])])) return Number(m[1]);
  const u = t.replace(/^@/, '').toLowerCase();
  const achadas = all(
    `SELECT c.id, k.username, p.username AS perfil FROM ig_conversas c JOIN ig_contatos k ON k.perfil_id = c.perfil_id AND k.igsid = c.igsid
       JOIN ig_perfis p ON p.id = c.perfil_id WHERE lower(k.username) = ? OR lower(k.nome) LIKE ? ORDER BY c.ultima_em DESC LIMIT 5`,
    [u, `%${u}%`]
  );
  if (achadas.length === 1) return achadas[0].id;
  if (!achadas.length) throw new Error(`Nenhuma conversa do Direct encontrada para "${texto}". Use instagram_conversas.`);
  throw new Error(`"${texto}" bate com várias conversas: ${achadas.map((a) => `@${a.username} no @${a.perfil} → ig:${a.id}`).join(' | ')}`);
}

function periodoIso(e, ctx, padrao = '7d') {
  const desde = interpretarData(e.desde || padrao, ctx.fuso);
  const ate = interpretarData(e.ate, ctx.fuso, { fimDoDia: true }) || new Date().toISOString();
  return { desde, ate };
}

const ROTULO = {
  imagem: '[foto]', video: '[vídeo]', audio: '[áudio]', arquivo: '[arquivo]', story_resposta: '[respondeu ao story]', story_mencao: '[mencionou no story]',
  post: '[compartilhou publicação]', reel: '[compartilhou reel]', compartilhamento: '[link]', nao_suportada: '[mensagem não suportada]',
};
const autor = (m, nome) => (m.de_mim ? (m.origem === 'ia' ? 'Alice (IA)' : m.origem === 'assistente' ? 'Assistente (aprovado)' : m.enviado_por_nome ? `${m.enviado_por_nome} (CRM)` : 'Equipe (app do Instagram)') : nome);

export function registrarFerramentasInstagram() {
  registrarFerramenta({
    definicao: {
      name: 'instagram_visao',
      description: 'Panorama do Instagram: perfis conectados (seguidores, Alice ligada ou não, última coleta), números dos últimos 7 dias de cada perfil, conversas do Direct aguardando resposta ou não lidas e comentários não lidos.',
      input_schema: { type: 'object', properties: {} },
    },
    permitido: pode('instagram', 'instagram_desempenho', 'instagram_comentarios'),
    descrever: () => 'Olhando o Instagram',
    impl(e, ctx) {
      const perfis = all('SELECT * FROM ig_perfis WHERE ativo = 1 ORDER BY id').map((p) => {
        const n = painel({ perfilId: p.id, dias: 7 }).atual;
        return {
          perfil: `@${p.username}`, seguidores: p.seguidores, alice_no_direct: Boolean(p.alice_ativa), ultima_coleta: dataHora(p.sync_conta_em, ctx.fuso),
          ultimos_7_dias: { ganho_seguidores: n.ganho_seguidores, visualizacoes: n.visualizacoes, alcance: n.alcance, interacoes: n.interacoes, publicacoes: n.publicacoes, conversas_novas: n.direct.conversas_novas, leads: n.direct.leads, gasto_anuncios: n.anuncios.gasto },
          erro: p.ultimo_erro || undefined,
        };
      });
      return json({
        agora: dataHora(new Date().toISOString(), ctx.fuso), perfis,
        direct: {
          nao_lidas: get("SELECT count(*) AS n FROM ig_conversas c JOIN ig_perfis p ON p.id = c.perfil_id WHERE p.ativo = 1 AND c.arquivada = 0 AND (c.nao_lidas > 0 OR c.marcada_nao_lida = 1)").n,
          aguardando: get("SELECT count(*) AS n FROM ig_conversas c LEFT JOIN ig_ia ia ON ia.conversa_id = c.id WHERE c.aguardando_desde IS NOT NULL OR ia.status = 'aguardando_humano'").n,
          alice_atendendo: get("SELECT count(*) AS n FROM ig_ia WHERE status = 'ativa'").n,
        },
        comentarios_nao_lidos: get('SELECT count(*) AS n FROM ig_comentarios WHERE lido = 0 AND de_mim = 0 AND pai_id IS NULL').n,
        relatorios_recentes: listarRelatorios({ limite: 3 }).map((r) => ({ id: r.id, titulo: r.titulo, status: r.status })),
      });
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_conversas',
      description: 'Lista conversas do Direct do Instagram (a chave de cada uma é ig:<id>; use em instagram_ler_conversa). Mostra quem é (@), perfil, última mensagem, se a janela de 24 h para responder está aberta, lead do kanban e status da Alice.',
      input_schema: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: '@, nome ou texto das mensagens' },
          perfil: { type: 'string', description: '@ do perfil da Impera (vazio = todos)' },
          filtro: { type: 'string', enum: ['todas', 'nao_lidas', 'aguardando', 'responder', 'leads', 'nao_leads', 'alice', 'anuncios', 'arquivadas'] },
          ...PERIODO,
          limite: { type: 'integer', description: 'Padrão 40, máx. 200' },
        },
      },
    },
    permitido: pode('instagram'),
    descrever: (e) => (e.busca ? `Procurando "${e.busca}" no Direct` : 'Listando conversas do Direct'),
    impl(e, ctx) {
      const { desde, ate } = periodoIso(e, ctx, '30d');
      const { conversas } = listarConversas({ perfilId: perfilPorTexto(e.perfil), filtro: e.filtro || 'todas', busca: e.busca || '', limite: 1000 });
      const lista = conversas.filter((c) => c.ultima_em >= desde && c.ultima_em <= ate).slice(0, Math.min(200, Number(e.limite) || 40)).map((c) => {
        ctx.fonte({ tipo: 'conversa', chave: `ig:${c.id}`, nome: c.username ? `@${c.username}` : c.nome || 'Instagram' });
        return {
          chave: `ig:${c.id}`, pessoa: c.username ? `@${c.username}` : null, nome: c.nome, perfil: `@${c.perfil_username}`,
          ultima: dataHora(c.ultima_em, ctx.fuso), previa: c.ultima_previa, ultima_e_nossa: c.ultima_minha, nao_lidas: c.nao_lidas,
          pode_responder: c.janela.aberta, janela_fecha: c.janela.aberta ? dataHora(c.janela.fecha_em, ctx.fuso) : null,
          lead: c.lead_id ? { id: c.lead_id, etapa: c.etapa?.nome } : null, alice: c.ia_status, aguardando: c.aguardando, anuncio: c.anuncio_titulo || (c.anuncio_id ? 'sim' : null),
        };
      });
      return json({ total: lista.length, conversas: lista });
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_ler_conversa',
      description: 'Lê as mensagens de uma conversa do Direct (chave ig:<id> ou @ da pessoa), com quem disse o quê, áudios transcritos e o que a Alice levantou na entrevista.',
      input_schema: { type: 'object', properties: { conversa: { type: 'string' }, max_mensagens: { type: 'integer', description: 'Padrão 120, máx. 400' } }, required: ['conversa'] },
    },
    permitido: pode('instagram'),
    descrever: (e) => `Lendo a conversa ${e.conversa || ''} do Direct`.trim(),
    impl(e, ctx) {
      const id = conversaPorTexto(e.conversa);
      const c = conversaCompleta(id);
      const nome = c.username ? `@${c.username}` : c.nome || 'Pessoa';
      ctx.fonte({ tipo: 'conversa', chave: `ig:${id}`, nome });
      const limite = Math.min(400, Number(e.max_mensagens) || 120);
      const msgs = all(
        `SELECT * FROM (SELECT m.*, u.name AS enviado_por_nome FROM ig_mensagens m LEFT JOIN users u ON u.id = m.enviado_por
           WHERE m.conversa_id = ? ORDER BY m.timestamp DESC LIMIT ?) ORDER BY timestamp`,
        [id, limite]
      );
      const ia = get('SELECT status, resumo, dados FROM ig_ia WHERE conversa_id = ?', [id]);
      const linhas = msgs.map((m) => `[${dataHora(m.timestamp, ctx.fuso)}] ${autor(m, nome)}: ${m.apagada_em ? '[apagada]' : [m.tipo === 'texto' ? '' : ROTULO[m.tipo] || '', m.texto || '', m.transcricao ? `(transcrição/descrição: ${cortar(m.transcricao, 600)})` : ''].filter(Boolean).join(' ')}`);
      return [
        `Conversa ${nome} no @${c.perfil_username} (ig:${id}) · ${msgs.length} mensagem(ns)`,
        `Janela para responder: ${c.janela.aberta ? `aberta até ${dataHora(c.janela.fecha_em, ctx.fuso)}` : 'fechada (só responde quando a pessoa escrever de novo)'}`,
        c.lead_id ? `Lead ${c.lead_id} (etapa "${c.etapa?.nome}")` : 'Ainda não é lead',
        ia ? `Alice: ${ia.status}${ia.resumo ? ` — ${ia.resumo}` : ''}${ia.dados && ia.dados !== '{}' ? ` · entrevista: ${ia.dados}` : ''}` : null,
        c.anuncio_id ? `Veio de anúncio${c.anuncio_titulo ? `: ${c.anuncio_titulo}` : ''}` : null,
        '',
        linhas.join('\n') || '(sem mensagens)',
      ].filter((x) => x !== null).join('\n');
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_desempenho',
      description: 'Números do Instagram num período, comparados com o período anterior: seguidores (ganho), visualizações, alcance, interações, curtidas, comentários, salvamentos, compartilhamentos, engajamento, publicações por formato, Direct (conversas, leads, reuniões, fechados), leads do Yay! Forms vindos do Instagram e anúncios (gasto, custo por conversa/lead), mais as melhores publicações.',
      input_schema: { type: 'object', properties: { perfil: { type: 'string', description: '@ do perfil (vazio = todos)' }, ...PERIODO } },
    },
    permitido: pode('instagram_desempenho'),
    descrever: () => 'Calculando o desempenho do Instagram',
    impl(e, ctx) {
      const { desde, ate } = periodoIso(e, ctx, '7d');
      const d = painel({ perfilId: perfilPorTexto(e.perfil), inicio: desde, fim: ate });
      return cortar(json({ periodo: d.periodo, atual: d.atual, anterior: d.antes, variacoes_pct: d.variacoes, por_formato: d.por_formato, melhores: d.melhores, perfis: d.perfis }), 20000);
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_publicacoes',
      description: 'Lista publicações do Instagram com as métricas (visualizações, alcance, curtidas, comentários, salvamentos, compartilhamentos, seguidores ganhos, tempo médio e taxa de pulo dos Reels, engajamento) e o pago (gasto e resultados de anúncios com a publicação).',
      input_schema: {
        type: 'object',
        properties: {
          perfil: { type: 'string' }, ...PERIODO,
          formato: { type: 'string', enum: ['todos', 'reels', 'carrossel', 'foto', 'video', 'stories'] },
          ordenar: { type: 'string', enum: ['recentes', 'visualizacoes', 'alcance', 'interacoes', 'engajamento', 'salvamentos', 'compartilhamentos', 'seguiram'] },
          busca: { type: 'string', description: 'Texto da legenda' }, limite: { type: 'integer' },
        },
      },
    },
    permitido: pode('instagram_desempenho'),
    descrever: () => 'Lendo as publicações do Instagram',
    impl(e, ctx) {
      const { desde, ate } = periodoIso(e, ctx, '30d');
      const lista = listarPosts({ perfilId: perfilPorTexto(e.perfil), inicio: desde, fim: ate, formato: e.formato === 'todos' ? null : e.formato, ordenar: e.ordenar || 'recentes', busca: e.busca || '', limite: Math.min(200, Number(e.limite) || 40) });
      return cortar(json(lista.map((p) => ({ ...p, publicado_em: dataHora(p.publicado_em, ctx.fuso) }))), 25000);
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_anuncios',
      description: 'Anúncios do Meta Ads ligados aos perfis do Instagram no período: gasto, impressões, alcance, cliques, conversas iniciadas (Meta) e o que viraram no CRM (conversas, leads, reuniões, fechados), com custo por conversa e por lead.',
      input_schema: { type: 'object', properties: { perfil: { type: 'string' }, ...PERIODO } },
    },
    permitido: pode('instagram_desempenho'),
    descrever: () => 'Vendo os anúncios do Instagram',
    impl(e, ctx) {
      const { desde, ate } = periodoIso(e, ctx, '30d');
      return cortar(json(listarAnuncios({ perfilId: perfilPorTexto(e.perfil), inicio: desde, fim: ate })), 20000);
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_relatorios',
      description: 'Relatórios da IA sobre o Instagram (semanais e pedidos). Sem id: lista os últimos. Com id: devolve o texto do relatório.',
      input_schema: { type: 'object', properties: { id: { type: 'integer' } } },
    },
    permitido: pode('instagram_desempenho'),
    descrever: (e) => (e.id ? `Abrindo o relatório ${e.id}` : 'Vendo os relatórios do Instagram'),
    impl(e) {
      if (e.id) {
        const r = obterRelatorio(Number(e.id));
        return `${r.titulo} (${r.status})\n\n${cortar(r.texto || r.erro || '', 30000)}`;
      }
      return json(listarRelatorios({ limite: 15 }).map((r) => ({ id: r.id, titulo: r.titulo, status: r.status, criado_em: r.criado_em })));
    },
  });

  registrarFerramenta({
    definicao: {
      name: 'instagram_comentarios',
      description: 'Comentários recentes nas publicações (quem comentou, texto, publicação, se já foi respondido ou chamado no Direct).',
      input_schema: { type: 'object', properties: { perfil: { type: 'string' }, filtro: { type: 'string', enum: ['todos', 'nao_lidos', 'sem_resposta', 'anuncios'] }, busca: { type: 'string' }, limite: { type: 'integer' } } },
    },
    permitido: pode('instagram_comentarios'),
    descrever: () => 'Lendo os comentários do Instagram',
    impl(e, ctx) {
      const lista = listarComentarios({ perfilId: perfilPorTexto(e.perfil), filtro: e.filtro || 'todos', busca: e.busca || '', limite: Math.min(200, Number(e.limite) || 40) });
      return cortar(json(lista.map((c) => ({ ...c, publicado_em: dataHora(c.publicado_em, ctx.fuso) }))), 20000);
    },
  });

  // ---------------------------------------------------------------- ação: responder no Direct (com aprovação)
  registrarExecutor('enviar_instagram', {
    titulo: 'Responder no Direct do Instagram',
    validar(d, ctx) {
      if (ctx?.userId && !temPermissao(ctx.userId, 'instagram_responder')) throw new Error('Este usuário não pode responder no Direct (permissões)');
      const texto = String(d.texto ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
      if (!texto) throw new Error('Escreva o texto da mensagem');
      const id = conversaPorTexto(d.conversa);
      const c = conversaCompleta(id);
      const j = janelaDaConversa(get('SELECT * FROM ig_conversas WHERE id = ?', [id]));
      if (!j.aberta) throw new Error('A janela de 24 h desta conversa está fechada: o Instagram só deixa responder quando a pessoa escrever de novo.');
      return {
        dados: { conversa: `ig:${id}`, conversa_id: id, texto },
        resumo: `Responder ${c.username ? `@${c.username}` : c.nome || 'a pessoa'} no Direct do @${c.perfil_username} (janela até ${new Date(j.fecha_em).toLocaleString('pt-BR')})`,
        editaveis: ['texto'],
      };
    },
    async executar(d, userId) {
      const msgs = await enviar(Number(d.conversa_id), { texto: d.texto }, { userId, origem: 'assistente' });
      return { mensagens: msgs.map((m) => m.id), conversa: d.conversa };
    },
  });
  registrarFerramenta({
    definicao: {
      name: 'propor_mensagem_instagram',
      description: 'Propõe responder uma conversa do Direct do Instagram (chave ig:<id> ou @ da pessoa). Vira um cartão para o usuário aprovar ou editar. Só funciona com a janela de 24 h aberta (a pessoa escreveu nas últimas 24 h).',
      input_schema: { type: 'object', properties: { conversa: { type: 'string' }, texto: { type: 'string' } }, required: ['conversa', 'texto'] },
    },
    permitido: pode('instagram_responder'),
    acao: 'enviar_instagram',
  });
}

/** Contagem de pendências do Instagram para o topo (aba Instagram) */
export function contadores() {
  return {
    nao_lidas: get("SELECT count(*) AS n FROM ig_conversas c JOIN ig_perfis p ON p.id = c.perfil_id WHERE p.ativo = 1 AND c.arquivada = 0 AND (c.nao_lidas > 0 OR c.marcada_nao_lida = 1)").n,
    comentarios: get('SELECT count(*) AS n FROM ig_comentarios c JOIN ig_perfis p ON p.id = c.perfil_id WHERE p.ativo = 1 AND c.lido = 0 AND c.de_mim = 0 AND c.pai_id IS NULL').n,
    dia: diaNoFuso(),
  };
}

export { lerJson };
