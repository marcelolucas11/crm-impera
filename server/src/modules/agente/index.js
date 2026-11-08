// Módulo Agente (aba "IA → Agente Alice"): assistente pessoal de cada usuário do CRM.
// Chat com ferramentas que leem o CRM, ações com aprovação, cérebro (contexto do CRM, diretrizes e memória),
// agendados, canal do WhatsApp e transcrição de áudio na própria VPS.
// Tirar este módulo da lista não quebra nada: o resto do CRM não depende dele.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { get, all, run } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin, exigirAdmin, exigirPermissao } from '../auth/middleware.js';
import { aoAcontecer } from '../../ganchos.js';
import { receberCorpo } from '../../upload.js';
import { enviarArquivoSeguro } from '../../arquivos.js';
import { ErroHttp, idValido, criarRota } from '../../util.js';
import { ErroIA } from '../ia/cliente.js';
import { MODELOS } from '../ia/config.js';
import { estado as estadoNumero } from '../whatsapp/instancias.js';
import { configPublica, salvarConfig, lerCerebro, salvarContexto, versoesDoContexto, versaoDoContexto, LIMITE_CONTEXTO } from './config.js';
import { resumoUso } from './uso.js';
import * as motor from './motor.js';
import * as acoes from './acoes.js';
import * as dir from './diretrizes.js';
import * as contexto from './contexto.js';
import * as agendados from './agendados.js';
import * as transcricao from './transcricao.js';
import * as canal from './canal.js';

const MAX_ANEXO = 25 * 1024 * 1024;
let relogioContexto = null;

const rota = criarRota('agente', [ErroIA]);

const id = (req, nome = 'id') => {
  const v = idValido(req.params[nome]);
  if (!v) throw new ErroHttp(400, 'Identificador inválido');
  return v;
};

function resumo(user) {
  const cerebro = lerCerebro(user.id);
  return {
    config: configPublica(user.id),
    uso: resumoUso(user.id),
    modelos: MODELOS,
    cerebro: { tamanho: cerebro.contexto.length, atualizado_em: cerebro.contexto_atualizado_em, origem: cerebro.contexto_origem },
    contexto_tarefa: contexto.estadoTarefa(user.id),
    pendentes: acoes.pendentesDoUsuario(user.id),
    agendados_ativos: get('SELECT count(*) AS n FROM agente_agendados WHERE user_id = ? AND ativo = 1', [user.id]).n,
    transcricao: { pronta: transcricao.lerConfig().ativo && transcricao.instalada(), instalada: transcricao.instalada() },
    numeros: all('SELECT id, name, phone FROM wa_instances ORDER BY id').map((n) => ({ ...n, status: estadoNumero(n.id).status })),
    admin: user.role === 'admin',
  };
}

async function receberAnexo(req, userId) {
  const nome = String(req.query.nome || 'arquivo').slice(0, 200);
  const mime = String(req.query.mime || 'application/octet-stream').slice(0, 100);
  const pasta = path.join(motor.PASTA_ANEXOS, String(userId));
  fs.mkdirSync(pasta, { recursive: true });
  const ext = (path.extname(nome).slice(0, 10).replace(/[^.\w]/g, '')) || '';
  const destino = path.join(pasta, `a${Date.now()}${crypto.randomBytes(4).toString('hex')}${ext}`);
  const total = await receberCorpo(req, destino, { max: MAX_ANEXO, mensagem: 'Arquivo grande demais (máximo 25 MB)' });
  const rel = path.relative(config.filesDir, destino);
  const novo = Number(run('INSERT INTO agente_anexos (user_id, nome, mime, caminho, tamanho) VALUES (?, ?, ?, ?, ?)', [userId, nome, mime, rel, total]).lastInsertRowid);
  return { id: novo, nome, mime, tamanho: total };
}

export default {
  name: 'agente',
  register(app) {
    // Canal do WhatsApp (mensagens dos números pessoais e do "mensagem para mim")
    aoAcontecer('whatsapp:recebida', (d) => canal.aoReceber(d));
    aoAcontecer('whatsapp:humana', (d) => (d?.celular ? canal.aoMensagemPropria(d) : null));

    const r = Router();
    r.use(exigirLogin);
    r.use(exigirPermissao('agente'));

    // ------------------------------------------------------------ resumo e ajustes
    r.get('/', rota((req, res) => res.json(resumo(req.user))));
    r.put('/config', rota((req, res) => {
      salvarConfig(req.user.id, req.body || {});
      res.json(resumo(req.user));
    }));
    r.get('/grupos', rota((req, res) => {
      res.json({ grupos: all("SELECT jid, name AS nome FROM wa_chats WHERE is_group = 1 AND name IS NOT NULL ORDER BY archived, updated_at DESC LIMIT 400") });
    }));

    // ------------------------------------------------------------ conversas
    r.get('/conversas', rota((req, res) => res.json({ conversas: motor.listarConversas(req.user.id, { arquivadas: req.query.arquivadas === '1' }) })));
    r.post('/conversas', rota((req, res) => {
      const novo = motor.criarConversa(req.user.id, { titulo: req.body?.titulo || null });
      res.status(201).json({ id: novo });
    }));
    r.get('/conversas/:id', rota((req, res) => {
      const c = motor.obterConversaBruta(req.user.id, id(req));
      res.json({
        conversa: { id: c.id, titulo: c.titulo, origem: c.origem, status: c.status, etapa: c.etapa, erro: c.erro, modelo: c.modelo, agendado_id: c.agendado_id, arquivada: Boolean(c.arquivada) },
        mensagens: motor.mensagensParaTela(req.user.id, c.id),
        acoes: acoes.listarAcoes(req.user.id, { conversaId: c.id, limite: 200 }),
      });
    }));
    r.put('/conversas/:id', rota((req, res) => {
      motor.atualizarConversa(req.user.id, id(req), req.body || {});
      res.json({ ok: true });
    }));
    r.post('/conversas/:id/mensagens', rota(async (req, res) => {
      const b = req.body || {};
      const { mensagem_id } = await motor.enviarNoChat(req.user.id, id(req), { texto: b.texto, anexoIds: b.anexos, modelo: b.modelo });
      res.status(202).json({ mensagem_id });
    }));

    // ------------------------------------------------------------ anexos (corpo = o arquivo; ?nome=&mime=)
    r.post('/anexos', rota(async (req, res) => res.status(201).json({ anexo: await receberAnexo(req, req.user.id) })));
    r.post('/anexos/:id/transcrever', rota(async (req, res) => res.json({ texto: await motor.transcreverAnexo(req.user.id, id(req)) })));
    r.get('/anexos/:id', rota((req, res) => {
      const a = motor.anexoDoUsuario(req.user.id, id(req));
      enviarArquivoSeguro(res, a.absoluto, { mime: a.mime, nome: a.nome || 'arquivo', cache: 'private, max-age=3600' });
    }));

    // ------------------------------------------------------------ ações (aprovar / recusar / desfazer)
    r.get('/acoes', rota((req, res) => res.json({ acoes: acoes.listarAcoes(req.user.id, { status: req.query.status || null, limite: Math.min(300, Number(req.query.limite) || 80) }) })));
    r.post('/acoes/:id/aprovar', rota(async (req, res) => res.json({ acao: await acoes.aprovar(id(req), req.user.id, req.body?.edicao || {}, { papel: req.user.role }) })));
    r.post('/acoes/:id/recusar', rota((req, res) => res.json({ acao: acoes.recusar(id(req), req.user.id) })));
    r.post('/acoes/:id/desfazer', rota((req, res) => res.json({ acao: acoes.desfazer(id(req), req.user.id) })));

    // ------------------------------------------------------------ cérebro: contexto do CRM
    r.get('/cerebro', rota((req, res) => {
      const c = lerCerebro(req.user.id);
      res.json({ ...c, limite: LIMITE_CONTEXTO, versoes: versoesDoContexto(req.user.id), tarefa: contexto.estadoTarefa(req.user.id), estimativa: contexto.estimar(req.user.id) });
    }));
    r.put('/cerebro', rota((req, res) => {
      res.json(salvarContexto(req.user.id, req.body?.contexto ?? '', { origem: 'manual' }));
    }));
    for (const tipo of ['gerar', 'melhorar']) {
      r.post(`/cerebro/${tipo}`, rota((req, res) => {
        res.json({ tarefa: contexto.iniciarTarefa(req.user.id, tipo, { dias: req.body?.dias, modelo: req.body?.modelo }) });
      }));
    }
    r.get('/cerebro/tarefa', rota((req, res) => res.json({ tarefa: contexto.estadoTarefa(req.user.id) })));
    r.delete('/cerebro/tarefa', rota((req, res) => res.json({ tarefa: contexto.dispensarTarefa(req.user.id) })));
    r.get('/cerebro/versoes/:id', rota((req, res) => res.json({ versao: versaoDoContexto(req.user.id, id(req)) })));

    // ------------------------------------------------------------ diretrizes (mesmo formato das da IA de primeiro contato)
    const u = (req) => req.user.id;
    r.get('/diretrizes', rota((req, res) => res.json({ diretrizes: dir.listarDiretrizes(u(req)), resumo: dir.resumoDiretrizes(u(req)) })));
    r.get('/diretrizes/:id', rota((req, res) => res.json({ diretriz: dir.obterDiretriz(u(req), id(req)) })));
    r.post('/diretrizes', rota((req, res) => res.status(201).json({ diretriz: dir.criarDiretriz(u(req), req.body || {}), resumo: dir.resumoDiretrizes(u(req)) })));
    r.put('/diretrizes/ordem', rota((req, res) => res.json({ diretrizes: dir.ordenarDiretrizes(u(req), req.body?.ids) })));
    r.put('/diretrizes/:id', rota((req, res) => res.json({ diretriz: dir.atualizarDiretriz(u(req), id(req), req.body || {}), resumo: dir.resumoDiretrizes(u(req)) })));
    r.delete('/diretrizes/:id', rota((req, res) => { dir.apagarDiretriz(u(req), id(req)); res.json({ ok: true, resumo: dir.resumoDiretrizes(u(req)) }); }));
    r.get('/diretrizes/:id/versoes', rota((req, res) => res.json({ versoes: dir.versoesDaDiretriz(u(req), id(req)) })));
    r.post('/diretrizes/:id/versoes/:versao/restaurar', rota((req, res) => res.json({ diretriz: dir.restaurarVersao(u(req), id(req), id(req, 'versao')), resumo: dir.resumoDiretrizes(u(req)) })));

    // ------------------------------------------------------------ memória
    r.get('/memoria', rota((req, res) => res.json({ memoria: dir.listarMemoria(u(req)) })));
    r.post('/memoria', rota((req, res) => { dir.criarMemoria(u(req), req.body?.texto); res.status(201).json({ memoria: dir.listarMemoria(u(req)) }); }));
    r.put('/memoria/:id', rota((req, res) => { dir.editarMemoria(u(req), id(req), req.body?.texto); res.json({ memoria: dir.listarMemoria(u(req)) }); }));
    r.delete('/memoria/:id', rota((req, res) => { dir.apagarMemoria(u(req), id(req)); res.json({ memoria: dir.listarMemoria(u(req)) }); }));

    // ------------------------------------------------------------ agendados
    r.get('/agendados', rota((req, res) => res.json({ agendados: agendados.listarAgendados(u(req)) })));
    r.post('/agendados/melhorar-prompt', rota(async (req, res) => res.json(await agendados.melhorarPrompt(u(req), req.body || {}))));
    r.post('/agendados', rota((req, res) => res.status(201).json({ agendado: agendados.criarAgendado(u(req), req.body || {}) })));
    r.get('/agendados/:id', rota((req, res) => res.json({ agendado: agendados.obterAgendado(u(req), id(req)), execucoes: agendados.execucoesDe(u(req), id(req)) })));
    r.put('/agendados/:id', rota((req, res) => res.json({ agendado: agendados.atualizarAgendado(u(req), id(req), req.body || {}) })));
    r.delete('/agendados/:id', rota((req, res) => { agendados.apagarAgendado(u(req), id(req)); res.json({ ok: true }); }));
    r.post('/agendados/:id/rodar', rota((req, res) => {
      const ag = agendados.obterAgendado(u(req), id(req));
      if (agendados.emExecucao(ag.id)) throw new ErroHttp(409, 'Este agendado já está rodando');
      agendados.executarAgendado(ag.id, { manual: true }).catch((err) => console.error('[agente] rodar agora:', err.message));
      res.status(202).json({ ok: true });
    }));

    // ------------------------------------------------------------ transcrição de áudio (a configuração é do CRM inteiro: só administradores)
    r.get('/transcricao', rota((req, res) => res.json(transcricao.status())));
    r.put('/transcricao', exigirAdmin, rota((req, res) => { transcricao.salvarConfig(req.body || {}); res.json(transcricao.status()); }));
    r.post('/transcricao/instalar', exigirAdmin, rota((req, res) => { transcricao.instalar(); res.status(202).json(transcricao.status()); }));

    app.use('/api/agente', r);
  },

  start() {
    motor.soltarPresas();
    transcricao.iniciarRelogioTranscricao();
    agendados.iniciarRelogioAgendados();
    relogioContexto = setInterval(() => { try { contexto.verificarMelhoriaAutomatica(); } catch { /* tenta na próxima */ } }, 60 * 60 * 1000);
    relogioContexto.unref?.();
  },

  stop() {
    transcricao.pararRelogioTranscricao();
    agendados.pararRelogioAgendados();
    if (relogioContexto) clearInterval(relogioContexto);
  },
};
