// Módulo Instagram: perfis da Impera conectados pela API oficial da Meta.
//  - Direct dentro do CRM (como o WhatsApp), com a Alice (SDR) e a assistente pessoal de cada usuário
//  - Comentários (desligado de fábrica), desempenho do perfil e das publicações, anúncios ligados e relatórios da IA
// Rotas em /api/instagram (com login e permissões), webhook em /webhooks/instagram e arquivos públicos temporários
// (para a Meta buscar o que o CRM manda pelo Direct) em /publico/instagram. Tirar este módulo da lista não quebra nada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { get, all, agora } from '../../db.js';
import { config } from '../../config.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { aoAcontecer } from '../../ganchos.js';
import { emitir } from '../../tempoReal.js';
import { receberCorpo } from '../../upload.js';
import { enviarArquivoSeguro } from '../../arquivos.js';
import { ErroHttp, idValido, criarRota } from '../../util.js';
import { exigirLogin, exigirAdmin, exigirPermissao } from '../auth/middleware.js';
import { ErroIA } from '../ia/cliente.js';
import { MODELOS } from '../ia/config.js';
import { lerConfig, configPublica, salvarApp, salvarAjustes, removerSegredo, fuso } from './config.js';
import { ErroMeta } from './graph.js';
import {
  perfisAtivos, perfilPublico, obterPerfil, atualizarPerfil, ultimosRegistros, perfilPausado, configDoPerfil, registrar,
} from './perfis.js';
import * as conexao from './conexao.js';
import * as direct from './direct.js';
import * as sdr from './sdr.js';
import * as metricas from './metricas.js';
import * as comentarios from './comentarios.js';
import * as anuncios from './anuncios.js';
import * as desempenho from './desempenho.js';
import * as relatorios from './relatorios.js';
import { verificar, receber, aoReceberMudanca } from './webhook.js';
import { servirPublico, limparVencidos } from './publico.js';
import { registrarFerramentasInstagram, contadores } from './agente.js';

const MAX_ARQUIVO = 25 * 1024 * 1024;
let relogio = null;
const rodando = new Set();

const rota = criarRota('instagram', [ErroIA, ErroMeta], { mensagemSimples: false });

const id = (req, nome = 'id') => {
  const v = idValido(req.params[nome]);
  if (!v) throw new ErroHttp(400, 'Identificador inválido');
  return v;
};

function enviarArquivoLocal(res, caminho, mime = null, { download = false } = {}) {
  if (!caminho || !fs.existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  // Sem tipo informado (fotos e miniaturas): o navegador deduz pela extensão, sempre como imagem isolada
  const tipo = mime || ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(caminho).toLowerCase()] || null);
  return enviarArquivoSeguro(res, caminho, { mime: tipo, nome: path.basename(caminho), download, cache: 'private, max-age=86400' });
}

/** Recebe um arquivo no corpo do pedido (até 25 MB) e devolve o caminho temporário */
async function receberArquivo(req) {
  const ext = path.extname(String(req.query.nome || '')).slice(0, 6).replace(/[^.\w]/g, '');
  const destino = path.join(os.tmpdir(), `crm-ig-${process.pid}-${crypto.randomUUID()}${ext}`);
  await receberCorpo(req, destino, { max: MAX_ARQUIVO, mensagem: 'Arquivo grande demais (o Instagram aceita até 25 MB)' });
  return { caminho: destino, mime: String(req.query.mime || 'application/octet-stream').slice(0, 100), nome: String(req.query.nome || 'arquivo').slice(0, 200) };
}

// ------------------------------------------------------------------ tarefas em segundo plano

async function tarefa(chave, fn) {
  if (rodando.has(chave)) return null;
  rodando.add(chave);
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ErroMeta) && !(err instanceof ErroHttp)) console.error(`[instagram] ${chave}:`, err.message);
    return null;
  } finally {
    rodando.delete(chave);
  }
}

const passou = (iso, ms) => !iso || Date.now() - new Date(iso).getTime() >= ms;

/** Primeira sincronização de um perfil recém-conectado: histórico do Direct, publicações e conta */
function primeiraSincronizacao(perfilId) {
  tarefa(`${perfilId}:historico`, () => direct.sincronizarDirect(perfilId, { historico: true }));
  tarefa(`${perfilId}:coleta`, async () => {
    await metricas.coletarTudo(perfilId, { tudo: true });
    await metricas.completarHistoricoDaConta(perfilId).catch(() => {});
  }).then(() => tarefa('anuncios', () => anuncios.sincronizarAnuncios()));
}

/** Instante de hoje (no fuso do CRM) em que a coleta diária deve rodar */
function horaDaColetaHoje(cfg) {
  const hoje = metricas.diaNoFuso();
  const [h, m] = String(cfg.coleta_hora || '04:30').split(':').map(Number);
  return metricas.inicioDoDia(hoje) + (h * 60 + m) * 60000;
}

export async function ciclo() {
  const cfg = lerConfig();
  for (const p of perfisAtivos()) {
    if (perfilPausado(p)) continue;
    if (!get('SELECT 1 AS ok FROM ig_credenciais WHERE chave = ?', [`pagina:${p.page_id}`])) continue;
    // Direct: busca pela API (rede de segurança). Com webhook chegando, só a cada 10 minutos.
    if (cfg.direct_ativo) {
      if (!p.historico_direct_em) tarefa(`${p.id}:historico`, () => direct.sincronizarDirect(p.id, { historico: true }));
      else {
        const webhookVivo = p.webhook_em && Date.now() - new Date(p.webhook_em).getTime() < 15 * 60000;
        const intervalo = (webhookVivo ? 600 : cfg.intervalo_direct_seg) * 1000;
        if (passou(p.sync_direct_em, intervalo)) tarefa(`${p.id}:direct`, () => direct.sincronizarDirect(p.id));
      }
    }
    // Stories: a cada hora (somem em 24 h)
    if (p.sync_conta_em && passou(p.sync_stories_em, 60 * 60000)) tarefa(`${p.id}:stories`, () => metricas.coletarStories(p.id));
    // Comentários: a cada N minutos, se ligado
    if (cfg.comentarios_ativo && passou(p.sync_comentarios_em, cfg.comentarios_intervalo_min * 60000)) tarefa(`${p.id}:comentarios`, () => comentarios.sincronizarComentarios(p.id));
    // Coleta diária (no horário configurado) ou a primeira de todas
    const hora = horaDaColetaHoje(cfg);
    const devida = !p.sync_conta_em || (Date.now() >= hora && new Date(p.sync_conta_em).getTime() < hora);
    if (devida) tarefa(`${p.id}:coleta`, () => metricas.coletarTudo(p.id));
    // Histórico antigo da conta e números das publicações antigas: um lote por hora até completar
    else if (passou(lerEstado(`instagram_backfill_${p.id}`).em, 60 * 60000)) {
      tarefa(`${p.id}:backfill`, async () => {
        salvarEstado(`instagram_backfill_${p.id}`, { em: agora() });
        if (!p.conta_backfill_ok) await metricas.completarHistoricoDaConta(p.id);
        await metricas.completarMetricasAntigas(p.id);
      });
    }
  }
  // Anúncios: uma vez por dia, depois da coleta
  const estado = lerEstado('instagram');
  if (cfg.anuncios_ativo && Date.now() >= horaDaColetaHoje(cfg) && passou(estado.anuncios_em, 20 * 3600000) && perfisAtivos().length) {
    tarefa('anuncios', async () => {
      salvarEstado('instagram', { anuncios_em: agora() });
      await anuncios.sincronizarAnuncios();
    });
  }
  // Acessos (token perto de vencer, Página sem acesso): uma vez por dia
  if (passou(estado.acessos_em, 24 * 3600000) && perfisAtivos().length) {
    tarefa('acessos', async () => {
      salvarEstado('instagram', { acessos_em: agora() });
      await conexao.conferirAcessos();
    });
  }
  relatorios.verificarSemanal();
  if (passou(estado.limpeza_em, 60 * 60000)) {
    salvarEstado('instagram', { limpeza_em: agora() });
    try { limparVencidos(); } catch { /* tenta na próxima */ }
  }
}

// ------------------------------------------------------------------ rotas

export default {
  name: 'instagram',
  register(app) {
    // Ganchos: Alice no Direct, ela para quando a equipe fala, e (opcional) a IA do WhatsApp continua o lead
    aoAcontecer('instagram:recebida', (d) => sdr.aoReceber(d));
    aoAcontecer('instagram:humana', (d) => sdr.aoMensagemHumana(d));
    aoAcontecer('instagram:lead_whatsapp', async ({ leadId }) => {
      const { aoReceberLeadInstagram } = await import('../ia/motor.js');
      aoReceberLeadInstagram({ leadId });
    });
    aoReceberMudanca('comentario', (perfil, valor) => comentarios.aoReceberComentario(perfil, valor));
    aoReceberMudanca('storyInsights', (perfil, valor) => metricas.aoReceberMetricasDeStory(perfil, valor));
    aoReceberMudanca('mencao', (perfil, valor) => registrar(perfil.id, 'mencao', `Mencionaram @${perfil.username} (${valor?.media_id ? `mídia ${valor.media_id}` : 'comentário'})`));
    registrarFerramentasInstagram();

    // Webhook e arquivos públicos (sem login: a Meta acessa)
    app.get('/webhooks/instagram', verificar);
    app.post('/webhooks/instagram', receber);
    app.get('/publico/instagram/:arquivo', servirPublico);

    const r = Router();
    r.use(exigirLogin);
    const algumInstagram = exigirPermissao('instagram', 'instagram_desempenho', 'instagram_comentarios');
    const verDirect = exigirPermissao('instagram');
    const responder = exigirPermissao('instagram_responder');
    const verDesempenho = exigirPermissao('instagram_desempenho');
    const verComentarios = exigirPermissao('instagram_comentarios');

    // Login do Facebook volta para cá (o navegador traz a sessão)
    r.get('/oauth/retorno', exigirAdmin, rota(async (req, res) => {
      const base = config.basePath || '';
      try {
        if (req.query.error) throw new ErroHttp(400, String(req.query.error_description || req.query.error_reason || 'Login cancelado').slice(0, 200));
        await conexao.concluirLogin(req, { code: req.query.code, state: req.query.state });
        res.redirect(`${base}/?ig=ok#equipe`);
      } catch (err) {
        res.redirect(`${base}/?ig=erro&msg=${encodeURIComponent(err.message.slice(0, 300))}#equipe`);
      }
    }));

    // ---------------------------------------------------------------- conexão (administrador)
    r.get('/config', exigirAdmin, rota((req, res) => {
      res.json({
        config: configPublica(),
        conexao: conexao.estadoConexao(),
        urls: { webhook: conexao.urlWebhook(req), retorno: conexao.urlRetorno(req), publica: conexao.urlPublica(req) },
        publica_https: /^https:\/\//.test(config.publicUrl || ''),
        perfis: all('SELECT * FROM ig_perfis ORDER BY ativo DESC, id').map(perfilPublico),
        registro: ultimosRegistros(40).filter((x) => x.tipo !== 'webhook_bruto'),
        escopos: conexao.ESCOPOS,
      });
    }));
    r.put('/app', exigirAdmin, rota((req, res) => res.json({ config: salvarApp(req.body || {}) })));
    r.delete('/app/segredo', exigirAdmin, rota((req, res) => { removerSegredo(); res.json({ config: configPublica() }); }));
    r.get('/oauth/inicio', exigirAdmin, rota((req, res) => res.json({ url: conexao.urlLogin(req) })));
    r.post('/token', exigirAdmin, rota(async (req, res) => res.json({ conexao: await conexao.guardarTokenUsuario(req.body?.token) })));
    r.delete('/token', exigirAdmin, rota((req, res) => { conexao.removerTokenUsuario(); res.json({ conexao: conexao.estadoConexao() }); }));
    r.get('/contas', exigirAdmin, rota(async (req, res) => res.json({ contas: await conexao.contasDisponiveis() })));
    r.post('/perfis', exigirAdmin, rota(async (req, res) => {
      const perfil = await conexao.conectarPerfil(String(req.body?.ig_id || ''));
      primeiraSincronizacao(perfil.id);
      res.status(201).json({ perfil });
    }));
    r.delete('/perfis/:id', exigirAdmin, rota(async (req, res) => { await conexao.desconectarPerfil(id(req)); res.json({ ok: true }); }));
    r.patch('/perfis/:id', exigirAdmin, rota((req, res) => {
      const p = obterPerfil(id(req));
      const b = req.body || {};
      const campos = {};
      if (b.alice_ativa !== undefined) campos.alice_ativa = b.alice_ativa ? 1 : 0;
      if (b.config !== undefined) {
        const atual = configDoPerfil(p);
        const novo = { ...atual };
        if (b.config.utm_contem !== undefined) novo.utm_contem = String(b.config.utm_contem || '').slice(0, 200);
        campos.config = JSON.stringify(novo);
      }
      atualizarPerfil(p.id, campos);
      if (b.alice_ativa !== undefined) registrar(p.id, 'alice', b.alice_ativa ? 'Alice ligada no Direct' : 'Alice desligada no Direct');
      emitir('instagram', { perfis: true });
      res.json({ perfil: perfilPublico(obterPerfil(p.id)) });
    }));
    r.post('/perfis/:id/sincronizar', exigirAdmin, rota((req, res) => {
      const pid = obterPerfil(id(req)).id;
      atualizarPerfil(pid, { pausado_ate: null });
      tarefa(`${pid}:direct`, () => direct.sincronizarDirect(pid));
      tarefa(`${pid}:coleta`, () => metricas.coletarTudo(pid, { tudo: true }));
      res.status(202).json({ ok: true });
    }));
    r.post('/perfis/:id/inscrever', exigirAdmin, rota(async (req, res) => res.json({ ok: await conexao.inscreverPagina(id(req)) })));
    r.put('/ajustes', exigirAdmin, rota((req, res) => res.json({ config: salvarAjustes(req.body || {}) })));
    r.post('/anuncios/sincronizar', exigirAdmin, rota((req, res) => {
      tarefa('anuncios', () => anuncios.sincronizarAnuncios());
      res.status(202).json({ ok: true });
    }));

    // ---------------------------------------------------------------- comum
    r.get('/estado', algumInstagram, rota((req, res) => {
      const cfg = lerConfig();
      res.json({
        perfis: all('SELECT * FROM ig_perfis WHERE ativo = 1 ORDER BY id').map(perfilPublico),
        comentarios_ativo: cfg.comentarios_ativo, direct_ativo: cfg.direct_ativo, fuso: fuso(),
        relatorio_modelo: cfg.relatorio_modelo, modelos: MODELOS,
        conectado: Boolean(get("SELECT 1 AS ok FROM ig_credenciais WHERE chave = 'usuario'")) || Boolean(get('SELECT 1 AS ok FROM ig_perfis WHERE ativo = 1')),
        publica_https: /^https:\/\//.test(config.publicUrl || ''),
        ...contadores(),
      });
    }));
    r.get('/resumo', algumInstagram, rota((req, res) => res.json(contadores())));
    r.get('/perfis/:id/foto', algumInstagram, rota((req, res) => enviarArquivoLocal(res, conexao.arquivoFotoPerfil(id(req)))));

    // ---------------------------------------------------------------- Direct
    r.get('/conversas', verDirect, rota((req, res) => {
      res.json(direct.listarConversas({ perfilId: idValido(req.query.perfil), filtro: String(req.query.filtro || 'todas'), busca: String(req.query.q || '') }));
    }));
    r.get('/conversas/:id', verDirect, rota((req, res) => res.json({ conversa: direct.conversaCompleta(id(req)), ia: sdr.estadoParaTela(id(req)) })));
    r.get('/conversas/:id/mensagens', verDirect, rota((req, res) => {
      res.json(direct.mensagensDaConversa(id(req), { antes: req.query.antes ? String(req.query.antes) : null }));
    }));
    r.get('/conversas/:id/contato', verDirect, rota((req, res) => res.json(direct.dadosDoContato(id(req)))));
    r.get('/conversas/:id/foto', verDirect, rota((req, res) => enviarArquivoLocal(res, direct.arquivoFotoContato(id(req)))));
    r.patch('/conversas/:id', verDirect, rota((req, res) => res.json({ conversa: direct.definirEstado(id(req), req.body || {}, req.user.id) })));
    r.post('/conversas/:id/mensagens', verDirect, responder, rota(async (req, res) => {
      const texto = String(req.body?.texto || '').trim();
      if (!texto) throw new ErroHttp(400, 'Escreva a mensagem');
      const msgs = await direct.enviar(id(req), { texto: texto.slice(0, 8000) }, { userId: req.user.id, origem: 'crm' });
      res.status(201).json({ mensagens: msgs.map(direct.mensagemParaTela) });
    }));
    r.post('/conversas/:id/arquivo', verDirect, responder, rota(async (req, res) => {
      const arq = await receberArquivo(req);
      try {
        const msgs = await direct.enviar(id(req), { arquivo: arq }, { userId: req.user.id, origem: 'crm' });
        res.status(201).json({ mensagens: msgs.map(direct.mensagemParaTela) });
      } finally {
        fs.rmSync(arq.caminho, { force: true });
      }
    }));
    r.post('/conversas/:id/lead', verDirect, exigirPermissao('leads_editar'), rota((req, res) => {
      const r2 = direct.ligarAoLead(id(req), { telefone: req.body?.telefone || null, nome: req.body?.nome || null, userId: req.user.id });
      res.status(201).json({ lead_id: r2.leadId, novo: r2.novo, conversa: direct.conversaCompleta(id(req)) });
    }));
    r.get('/conversas/:id/ia', verDirect, rota((req, res) => res.json(sdr.estadoParaTela(id(req)))));
    r.post('/conversas/:id/ia', verDirect, responder, rota((req, res) => {
      const status = req.body?.status === 'ativa' ? 'ativa' : 'pausada';
      res.json(sdr.definirEstadoManual(id(req), status, { userId: req.user.id }));
    }));
    r.post('/sugestoes/:id/aprovar', verDirect, responder, rota(async (req, res) => res.json(await sdr.aprovarSugestao(id(req), { mensagens: req.body?.mensagens, userId: req.user.id }))));
    r.post('/sugestoes/:id/descartar', verDirect, responder, rota((req, res) => res.json({ ok: sdr.descartarSugestao(id(req), req.user.id) })));
    r.get('/midia/:msg/:indice', verDirect, rota((req, res) => {
      const indice = req.params.indice === 'story' ? 'story' : Number(req.params.indice) || 0;
      const arq = direct.arquivoDaMidia(id(req, 'msg'), indice);
      if (!arq) return res.status(404).json({ erro: 'A mídia ainda não foi baixada (ou expirou na Meta)' });
      return enviarArquivoLocal(res, arq.caminho, arq.mime, { download: req.query.download === '1' });
    }));
    r.post('/midia/:msg/baixar', verDirect, rota(async (req, res) => {
      await direct.baixarMidiasDaMensagem(id(req, 'msg'));
      res.json({ ok: true });
    }));
    r.get('/leads/:id/conversas', verDirect, rota((req, res) => res.json({ conversas: direct.conversasDoLead(id(req)) })));

    // ---------------------------------------------------------------- comentários
    r.get('/comentarios', verComentarios, rota((req, res) => {
      res.json({
        comentarios: comentarios.listarComentarios({ perfilId: idValido(req.query.perfil), postId: req.query.post ? String(req.query.post) : null, filtro: String(req.query.filtro || 'todos'), busca: String(req.query.q || '') }),
        ativo: lerConfig().comentarios_ativo,
      });
    }));
    r.post('/comentarios/lidos', verComentarios, rota((req, res) => { comentarios.marcarLidos(req.body?.ids || []); res.json({ ok: true }); }));
    r.post('/comentarios/:cid/responder', verComentarios, rota(async (req, res) => res.json(await comentarios.responder(req.params.cid, req.body?.texto, req.user.id))));
    r.post('/comentarios/:cid/direct', verComentarios, responder, rota(async (req, res) => res.json(await comentarios.chamarNoDirect(req.params.cid, req.body?.texto, req.user.id))));
    r.post('/comentarios/:cid/ocultar', verComentarios, rota(async (req, res) => { await comentarios.ocultar(req.params.cid, req.body?.oculto !== false); res.json({ ok: true }); }));
    r.post('/comentarios/sincronizar', verComentarios, rota((req, res) => {
      for (const p of perfisAtivos()) tarefa(`${p.id}:comentarios`, () => comentarios.sincronizarComentarios(p.id));
      res.status(202).json({ ok: true });
    }));

    // ---------------------------------------------------------------- desempenho, publicações, anúncios e relatórios
    const periodo = (q) => ({ perfilId: idValido(q.perfil), inicio: q.inicio || null, fim: q.fim || null, dias: Number(q.dias) || 30 });
    r.get('/desempenho', verDesempenho, rota((req, res) => res.json(desempenho.painel(periodo(req.query)))));
    r.get('/posts', verDesempenho, rota((req, res) => {
      const q = req.query;
      res.json({ posts: desempenho.listarPosts({ ...periodo(q), dias: q.dias ? Number(q.dias) : null, formato: q.formato || null, ordenar: q.ordenar || 'recentes', busca: String(q.q || ''), limite: Number(q.limite) || 200 }) });
    }));
    r.get('/posts/:pid', verDesempenho, rota((req, res) => {
      const d = desempenho.detalhePost(req.params.pid);
      if (!d) throw new ErroHttp(404, 'Publicação não encontrada');
      res.json({ post: d });
    }));
    r.get('/posts/:pid/miniatura', algumInstagram, rota(async (req, res) => enviarArquivoLocal(res, await metricas.arquivoMiniatura(req.params.pid))));
    r.get('/anuncios', verDesempenho, rota((req, res) => res.json({ anuncios: desempenho.listarAnuncios(periodo(req.query)) })));
    r.get('/relatorios', verDesempenho, rota((req, res) => res.json({ relatorios: relatorios.listarRelatorios(), gasto_hoje: relatorios.gastoHoje(), teto: lerConfig().teto_relatorios_dia })));
    r.get('/relatorios/:id', verDesempenho, rota((req, res) => res.json({ relatorio: relatorios.obterRelatorio(id(req)) })));
    r.post('/relatorios', verDesempenho, rota((req, res) => {
      const b = req.body || {};
      const novo = relatorios.pedirRelatorio({ perfilId: idValido(b.perfil_id), de: b.de || null, ate: b.ate || null, tipo: b.de || b.ate ? 'periodo' : 'manual', userId: req.user.id, modelo: b.modelo || null });
      res.status(202).json({ id: novo });
    }));

    app.use('/api/instagram', r);
  },

  start() {
    relatorios.soltarPresos();
    sdr.iniciarRelogioSdr();
    relogio = setInterval(() => { ciclo().catch((err) => console.error('[instagram] ciclo:', err.message)); }, 30000);
    relogio.unref?.();
    // Primeiro ciclo logo depois de ligar (sem atrasar a subida do CRM)
    setTimeout(() => ciclo().catch(() => {}), 15000).unref?.();
  },

  stop() {
    sdr.pararRelogioSdr();
    if (relogio) clearInterval(relogio);
    relogio = null;
  },
};
