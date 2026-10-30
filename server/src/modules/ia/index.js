// Módulo IA de primeiro contato: conversa com o lead que acabou de chegar (WhatsApp ou Yay! Forms),
// apresenta a Impera, tira dúvidas básicas e passa para um humano. Usa o modelo mais barato da Anthropic (Haiku).
// Ouve os outros módulos pelos ganchos (src/ganchos.js) — se este módulo for retirado, nada mais quebra.
import { Router } from 'express';
import { get, all, run, agora } from '../../db.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido, ErroHttp } from '../../util.js';
import { aoAcontecer } from '../../ganchos.js';
import { respostasProntas, configPublica, salvarConfig, guardarChave, guardarWorkspace, removerChave, lerConfig, chaveApi } from './config.js';
import { dentroDoHorario, saudacaoDoMomento } from './horario.js';
import { tentativaDeComando, pedeHumano, validarSaida } from './seguranca.js';
import { textoDoSistema, montarPedido } from './prompt.js';
import { perguntarModelo, perguntarNoFormato, registrar, ErroIA } from './cliente.js';
import { gerarPlaybook } from './playbook.js';
import {
  listarDiretrizes, obterDiretriz, criarDiretriz, atualizarDiretriz, apagarDiretriz, ordenarDiretrizes,
  versoesDaDiretriz, restaurarVersao, diretrizesAtivas, resumoDiretrizes,
} from './diretrizes.js';
import { emitir } from '../../tempoReal.js';
import {
  aoReceberMensagem, aoMensagemHumana, aoReceberLeadFormulario, acharConversa, aprovarSugestao, descartarSugestao,
  iniciarRelogio, pararRelogio, passarParaHumano,
} from './motor.js';

// Converte erros da IA em respostas HTTP
const rota = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err instanceof ErroHttp || err instanceof ErroIA ? err.status || 400 : 500;
    if (status === 500) console.error('[ia]', err);
    res.status(status).json({ erro: status === 500 ? 'Erro interno' : err.message });
  }
};

// Chave da tela de WhatsApp (l:<lead>, t:<telefone>, j:<jid>) → dados para achar a conversa da IA
async function contatoDaChave(chave) {
  const { interpretarChave } = await import('../whatsapp/conversas.js');
  const c = interpretarChave(chave);
  if (c.tipo === 'grupo') throw new ErroHttp(400, 'A IA não atua em grupos');
  if (c.tipo === 'lead') return { leadId: c.leadId, phone: get('SELECT phone FROM leads WHERE id = ?', [c.leadId])?.phone || null, jid: null };
  if (c.tipo === 'telefone') return { leadId: null, phone: c.phone, jid: null };
  return { leadId: null, phone: get('SELECT phone FROM wa_contacts WHERE jid = ?', [c.jid])?.phone || null, jid: c.jid };
}

function estadoDaConversa(conversa) {
  if (!conversa || conversa.status === 'ignorada') return { conversa: null, sugestao: null };
  const s = get("SELECT id, mensagens, acao, motivo, created_at FROM ia_sugestoes WHERE conversa_id = ? AND status = 'pendente' ORDER BY id DESC LIMIT 1", [conversa.id]);
  return {
    conversa: {
      id: conversa.id, status: conversa.status, motivo: conversa.motivo, resumo: conversa.resumo, origem: conversa.origem,
      mensagens_ia: conversa.mensagens_ia, iniciada_em: conversa.iniciada_em, atualizada_em: conversa.atualizada_em,
    },
    sugestao: s ? { ...s, mensagens: JSON.parse(s.mensagens) } : null,
  };
}

function resumoGeral() {
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const porStatus = Object.fromEntries(all("SELECT status, count(*) AS n FROM ia_conversas WHERE status <> 'ignorada' GROUP BY status").map((r) => [r.status, r.n]));
  const uso = get('SELECT COALESCE(sum(tokens_entrada),0) AS entrada, COALESCE(sum(tokens_saida),0) AS saida, COALESCE(sum(tokens_cache),0) AS cache FROM ia_registro WHERE created_at >= ?', [desde]);
  const contar = (tipo, d) => get('SELECT count(*) AS n FROM ia_registro WHERE tipo = ? AND created_at >= ?', [tipo, d]).n;
  return {
    por_status: porStatus,
    hoje: { mensagens: contar('enviada', hoje.toISOString()), passagens: contar('passou_humano', hoje.toISOString()), bloqueios: contar('bloqueio_entrada', hoje.toISOString()) + contar('bloqueio_saida', hoje.toISOString()) },
    ultimos_30_dias: {
      conversas: get('SELECT count(*) AS n FROM ia_conversas WHERE status <> \'ignorada\' AND iniciada_em >= ?', [desde]).n,
      mensagens: contar('enviada', desde), passagens: contar('passou_humano', desde),
      sugestoes_aprovadas: contar('sugestao_aprovada', desde), sugestoes_editadas: contar('sugestao_editada', desde), sugestoes_descartadas: contar('sugestao_descartada', desde),
      tokens: uso,
    },
    dentro_do_horario: dentroDoHorario(lerConfig()),
  };
}

// Formulário de exemplo do simulador: { situacao, reuniao, respostas: "Pergunta: resposta" por linha }
function formularioDoSimulador(f) {
  if (!f || !['parcial', 'completo_sem_reuniao', 'completo_com_reuniao'].includes(f.situacao)) return null;
  const respostas = String(f.respostas || '').split('\n').slice(0, 40).map((linha) => {
    const i = linha.indexOf(':');
    return i > 0 ? { titulo: linha.slice(0, i).trim(), valor: linha.slice(i + 1).trim() } : null;
  }).filter((r) => r?.titulo && r.valor);
  return { situacao: f.situacao, reuniao: f.situacao === 'completo_com_reuniao' ? String(f.reuniao || 'amanhã às 10:00').slice(0, 80) : null, respostas };
}

const avisarDiretrizes = () => emitir('ia', { diretrizes: true });

export default {
  name: 'ia',
  register(app) {
    // Ganchos dos outros módulos
    aoAcontecer('whatsapp:recebida', (d) => aoReceberMensagem(d));
    aoAcontecer('whatsapp:humana', (d) => aoMensagemHumana(d));
    aoAcontecer('yayforms:lead', async (d) => {
      let saudacaoDisparosAtiva = false;
      try {
        const { lerConfigYay } = await import('../disparos/servico.js');
        saudacaoDisparosAtiva = Boolean(lerConfigYay().ativo);
      } catch { /* sem disparos */ }
      aoReceberLeadFormulario(d, { saudacaoDisparosAtiva });
    });

    const r = Router();
    r.use(exigirLogin);

    // ------------------------------------------------------------ configuração (tela "IA")
    r.get('/config', rota(async (req, res) => {
      let saudacaoDisparos = false;
      try { saudacaoDisparos = Boolean((await import('../disparos/servico.js')).lerConfigYay().ativo); } catch { /* ignora */ }
      const numeros = all('SELECT id, name AS nome, phone FROM wa_instances ORDER BY id');
      res.json({ config: configPublica(), resumo: resumoGeral(), numeros, saudacao_disparos_ativa: saudacaoDisparos });
    }));

    r.put('/config', exigirAdmin, rota((req, res) => {
      res.json({ config: salvarConfig(req.body || {}) });
    }));

    // Cola a chave da API e confere com uma chamada mínima antes de guardar
    r.put('/chave', exigirAdmin, rota(async (req, res) => {
      // Pode vir a chave nova, o workspace, ou os dois (trocar só o workspace mantém a chave atual)
      const temChave = typeof req.body?.chave === 'string' && req.body.chave.trim();
      if (req.body?.workspace_id !== undefined) guardarWorkspace(req.body.workspace_id);
      if (temChave) guardarChave(req.body.chave);
      else if (!chaveApi()) throw new ErroHttp(400, 'Cole a chave da API');
      try {
        await perguntarModelo({ sistema: 'Responda apenas: ok', mensagens: [{ role: 'user', content: 'ok' }], maxTokens: 5 });
      } catch (err) {
        // Chave recusada: não guarda. Outros problemas (sem créditos, rede, modelo): a chave fica salva e a tela mostra o aviso
        if (!(err instanceof ErroIA) || err.tipo === 'chave') {
          if (temChave) removerChave();
          throw err;
        }
        console.error('[ia] chave salva, mas o teste falhou:', err.message);
        return res.json({ config: configPublica(), aviso: `Chave salva, mas o teste não passou: ${err.message}` });
      }
      res.json({ config: configPublica() });
    }));

    r.delete('/chave', exigirAdmin, rota((req, res) => {
      removerChave();
      res.json({ config: configPublica() });
    }));

    r.post('/playbook/gerar', exigirAdmin, rota(async (req, res) => {
      res.json(await gerarPlaybook());
    }));

    // ------------------------------------------------------------ diretrizes (prompts que dão o norte para a IA)
    r.get('/diretrizes', rota((req, res) => {
      res.json({ diretrizes: listarDiretrizes(), resumo: resumoDiretrizes() });
    }));

    r.get('/diretrizes/:id', rota((req, res) => {
      res.json({ diretriz: obterDiretriz(idValido(req.params.id)) });
    }));

    r.post('/diretrizes', exigirAdmin, rota((req, res) => {
      const diretriz = criarDiretriz(req.body || {}, req.user.id);
      avisarDiretrizes();
      res.status(201).json({ diretriz, resumo: resumoDiretrizes() });
    }));

    r.put('/diretrizes/ordem', exigirAdmin, rota((req, res) => {
      const diretrizes = ordenarDiretrizes(req.body?.ids);
      avisarDiretrizes();
      res.json({ diretrizes });
    }));

    r.put('/diretrizes/:id', exigirAdmin, rota((req, res) => {
      const diretriz = atualizarDiretriz(idValido(req.params.id), req.body || {}, req.user.id);
      avisarDiretrizes();
      res.json({ diretriz, resumo: resumoDiretrizes() });
    }));

    r.delete('/diretrizes/:id', exigirAdmin, rota((req, res) => {
      apagarDiretriz(idValido(req.params.id));
      avisarDiretrizes();
      res.json({ ok: true, resumo: resumoDiretrizes() });
    }));

    r.get('/diretrizes/:id/versoes', rota((req, res) => {
      res.json({ versoes: versoesDaDiretriz(idValido(req.params.id)) });
    }));

    r.post('/diretrizes/:id/versoes/:versao/restaurar', exigirAdmin, rota((req, res) => {
      const diretriz = restaurarVersao(idValido(req.params.id), idValido(req.params.versao), req.user.id);
      avisarDiretrizes();
      res.json({ diretriz, resumo: resumoDiretrizes() });
    }));

    // Simulador: mostra o que a IA responderia, sem enviar nada para ninguém
    r.post('/simular', exigirAdmin, rota(async (req, res) => {
      // Usa o que está na tela, mesmo sem salvar (playbook, nome, gênero, apresentação, empresa)
      const tela = req.body?.config || {};
      const daTela = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
      const cfg = Object.fromEntries(Object.entries({
        ...lerConfig(),
        ...(typeof req.body?.playbook === 'string' ? { playbook: req.body.playbook.slice(0, 8000) } : {}),
      }).concat(Object.entries({
        nome_atendente: daTela(tela.nome_atendente, 60), apresentacao: daTela(tela.apresentacao, 300), empresa: daTela(tela.empresa, 80),
        sobre_empresa: daTela(tela.sobre_empresa, 2000),
        genero_atendente: tela.genero_atendente === 'masculino' ? 'masculino' : tela.genero_atendente === 'feminino' ? 'feminino' : undefined,
      }).filter(([, v]) => v !== undefined)));
      const lista = (Array.isArray(req.body?.mensagens) ? req.body.mensagens : []).slice(-20).map((m) => ({
        from_me: m.de === 'equipe' ? 1 : 0, type: 'texto', body: String(m.texto || '').slice(0, 1000),
      }));
      const formulario = formularioDoSimulador(req.body?.formulario);
      const ultimaDoLead = [...lista].reverse().find((m) => !m.from_me)?.body || '';
      const foraDoHorario = req.body?.fora_do_horario === undefined ? !dentroDoHorario(cfg) : Boolean(req.body.fora_do_horario);
      if (ultimaDoLead && tentativaDeComando(ultimaDoLead)) return res.json({ mensagens: [respostasProntas(cfg).soDuvidas], acao: 'responder', via: 'filtro de segurança (não chamou o modelo)' });
      if (ultimaDoLead && pedeHumano(ultimaDoLead)) return res.json({ mensagens: [respostasProntas(cfg).pediuPessoa], acao: 'passar_humano', motivo: 'Lead pediu para falar com uma pessoa', via: 'regra fixa (não chamou o modelo)' });
      const { resposta, texto, uso, parada, tentativas } = await perguntarNoFormato({
        sistema: textoDoSistema(cfg, diretrizesAtivas()),
        mensagens: montarPedido({
          cfg, lead: { primeiroNome: req.body?.nome || null }, historico: lista, foraDoHorario, saudacao: saudacaoDoMomento(cfg),
          primeiroContato: !lista.some((m) => m.from_me), origem: formulario ? 'yayforms' : req.body?.origem === 'yayforms' ? 'yayforms' : 'whatsapp',
          jaAvisouForaHorario: false, formulario,
        }),
      });
      registrar(null, 'simulacao', tentativas > 1 ? '2ª tentativa' : null, uso);
      if (!resposta) {
        return res.json({
          erro_formato: true, cortada: parada === 'max_tokens', bruto: String(texto || '').slice(0, 1500),
          motivo: parada === 'max_tokens'
            ? 'A resposta ficou longa demais e veio cortada, mesmo na 2ª tentativa. Peça respostas mais curtas na diretriz.'
            : 'A IA não respondeu no formato que o CRM lê, mesmo na 2ª tentativa. Veja abaixo o que ela escreveu.',
        });
      }
      const conferida = validarSaida(Array.isArray(resposta.mensagens) ? resposta.mensagens : [resposta.mensagens], cfg);
      res.json({ ...resposta, filtro: conferida.ok ? 'aprovada' : `barrada: ${conferida.motivo}`, uso, via: tentativas > 1 ? 'modelo (2ª tentativa: a 1ª veio fora do formato)' : 'modelo' });
    }));

    // ------------------------------------------------------------ conversas
    r.get('/conversas', rota((req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const lista = all(
        `SELECT c.id, c.chave, c.lead_id, c.phone, c.jid, c.origem, c.status, c.motivo, c.resumo, c.mensagens_ia, c.iniciada_em, c.atualizada_em,
                l.name AS lead_nome, COALESCE(wc.name, wc.push_name) AS contato_nome,
                (SELECT count(*) FROM ia_sugestoes s WHERE s.conversa_id = c.id AND s.status = 'pendente') AS sugestoes_pendentes
           FROM ia_conversas c
           LEFT JOIN leads l ON l.id = c.lead_id
           LEFT JOIN wa_contacts wc ON wc.jid = c.jid
          WHERE ${status ? 'c.status = ?' : "c.status <> 'ignorada'"}
          ORDER BY c.atualizada_em DESC LIMIT 200`,
        status ? [status] : []
      );
      res.json({ conversas: lista });
    }));

    r.get('/conversa', rota(async (req, res) => {
      const contato = await contatoDaChave(req.query.chave);
      res.json(estadoDaConversa(acharConversa(contato)));
    }));

    // Liga ("ativa"), pausa ou devolve para a equipe a IA numa conversa específica
    r.post('/conversa/estado', rota(async (req, res) => {
      const novo = req.body?.status;
      if (!['ativa', 'pausada', 'aguardando_humano'].includes(novo)) throw new ErroHttp(400, 'Estado inválido');
      const contato = await contatoDaChave(req.body?.chave);
      let conversa = acharConversa(contato);
      if (novo === 'ativa') {
        if (!lerConfig().ativo) throw new ErroHttp(400, 'Ligue a IA na tela "IA" primeiro');
        if (!conversa) {
          const chave = req.body.chave;
          run(`INSERT INTO ia_conversas (chave, lead_id, phone, jid, origem, status, motivo) VALUES (?, ?, ?, ?, 'manual', 'ativa', ?)
               ON CONFLICT(chave) DO NOTHING`, [chave, contato.leadId, contato.phone, contato.jid, `Ligada à mão por ${req.user.name}`]);
          conversa = get('SELECT * FROM ia_conversas WHERE chave = ?', [chave]);
        } else {
          run('UPDATE ia_conversas SET status = ?, motivo = ?, ativada_em = ?, atualizada_em = ? WHERE id = ?', [
            'ativa', `Ligada à mão por ${req.user.name}`, agora(), agora(), conversa.id,
          ]);
        }
        // Ligada à mão: só responde o que o lead mandar daqui para frente
        const ultima = get('SELECT max(id) AS id FROM wa_messages WHERE from_me = 0 AND (lead_id = ? OR chat_jid = ?)', [contato.leadId, contato.jid])?.id || 0;
        run('UPDATE ia_conversas SET ultima_lida_id = ?, proxima_em = NULL WHERE id = ?', [ultima, conversa.id]);
      } else if (!conversa) {
        throw new ErroHttp(404, 'A IA não está nesta conversa');
      } else if (novo === 'pausada') {
        run("UPDATE ia_conversas SET status = 'pausada', motivo = ?, proxima_em = NULL, atualizada_em = ? WHERE id = ?", [`Pausada por ${req.user.name}`, agora(), conversa.id]);
        run("UPDATE ia_sugestoes SET status = 'expirada', decidida_em = ? WHERE conversa_id = ? AND status = 'pendente'", [agora(), conversa.id]);
      } else {
        await passarParaHumano(conversa, { motivo: `Transferida à mão por ${req.user.name}`, userId: req.user.id });
      }
      registrar(conversa.id, `estado_${novo}`, req.user.name);
      res.json(estadoDaConversa(get('SELECT * FROM ia_conversas WHERE id = ?', [conversa.id])));
    }));

    // ------------------------------------------------------------ copiloto
    r.post('/sugestoes/:id/aprovar', rota(async (req, res) => {
      const id = idValido(req.params.id);
      const mensagens = Array.isArray(req.body?.mensagens) ? req.body.mensagens.map((m) => String(m).slice(0, 2000)) : null;
      res.json(await aprovarSugestao(id, { mensagens, userId: req.user.id }));
    }));

    r.post('/sugestoes/:id/descartar', rota((req, res) => {
      res.json({ ok: descartarSugestao(idValido(req.params.id), req.user.id) });
    }));

    app.use('/api/ia', r);
  },
  start() {
    iniciarRelogio();
    const cfg = lerConfig();
    console.log(`[ia] primeiro contato ${cfg.ativo ? `ligado (modo ${cfg.modo === 'automatico' ? 'automático' : 'copiloto'})` : 'desligado'}`);
  },
  stop() {
    pararRelogio();
  },
};
