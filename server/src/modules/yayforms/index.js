// Módulo Yay! Forms: recebe o webhook de cada resposta e cria (ou atualiza) o lead.
// URL para colar no Yay! Forms: <PUBLIC_URL>/webhooks/yayforms/<YAYFORMS_WEBHOOK_TOKEN>  (formato V2)
import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, tx, agora } from '../../db.js';
import { config } from '../../config.js';
import { registrarEvento, lerJson } from '../../events.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { criarLead, encontrarExistente, vincularConversasExistentes } from '../leads/service.js';
import { interpretarPayload, extrairInicio, extrairSituacao } from './parser.js';
import { idValido } from '../../util.js';
import { lerEstado, salvarEstado } from '../../estado.js';

function iguaisSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---- Segredos de assinatura ----
// Cada webhook criado no Yay! Forms ganha um "Secret" próprio. O CRM guarda vários (tela Equipe e integrações)
// e aceita o webhook se a assinatura bater com QUALQUER um deles. Sem nenhum segredo cadastrado, aceita tudo
// (a URL já tem um token secreto). O YAYFORMS_WEBHOOK_SECRET do .env continua valendo, como mais um da lista.
function segredosCadastrados() {
  const lista = Array.isArray(lerEstado('yayforms').segredos) ? lerEstado('yayforms').segredos : [];
  const env = config.yayforms.secret ? [{ id: 'env', nome: 'Definido no .env', segredo: config.yayforms.secret, fixo: true }] : [];
  return [...env, ...lista];
}

function mascarar(segredo) {
  const s = String(segredo);
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

// Devolve { ok, segredoId }. Aceita qualquer cabeçalho com "signature" no nome, em hex ou base64, com ou sem "sha256=".
function conferirAssinatura(req) {
  const segredos = segredosCadastrados();
  if (!segredos.length) return { ok: true, segredoId: null };
  const assinaturas = Object.entries(req.headers)
    .filter(([nome]) => nome.toLowerCase().includes('signature'))
    .map(([, valor]) => String(valor).trim().replace(/^sha256=/i, ''));
  if (!assinaturas.length) return { ok: false, segredoId: null };
  const corpo = req.rawBody || Buffer.alloc(0);
  for (const s of segredos) {
    const digest = crypto.createHmac('sha256', s.segredo).update(corpo).digest();
    const hex = digest.toString('hex');
    const base64 = digest.toString('base64');
    if (assinaturas.some((v) => iguaisSeguro(v.toLowerCase(), hex) || iguaisSeguro(v, base64))) return { ok: true, segredoId: s.id };
  }
  return { ok: false, segredoId: null };
}

function marcarUso(segredoId) {
  if (!segredoId || segredoId === 'env') return;
  const lista = (lerEstado('yayforms').segredos || []).map((s) => (s.id === segredoId ? { ...s, ultimo_uso: agora() } : s));
  salvarEstado('yayforms', { segredos: lista });
}

function lerDados(body) {
  return interpretarPayload(body, {
    campoNome: config.yayforms.fieldName,
    campoTelefone: config.yayforms.fieldPhone,
    campoEmail: config.yayforms.fieldEmail,
    nomesFormularios: lerEstado('yayforms').nomes || {},
  });
}

function detalhesDe(dados) {
  return {
    formulario: dados.formulario,
    form_id: dados.formId,
    resposta_id: dados.respostaId,
    respostas: dados.respostas,
    utm: dados.utm,
    variaveis: dados.variaveis,
    analise_ia: dados.analiseIa,
    iniciado_em: dados.iniciadoEm,
    campo_inicio: dados.campoInicio,
    parcial: !dados.completo,
    sinal_parcial: dados.sinalSituacao,
  };
}

// Respostas da mesma resposta do Yay! Forms (parcial → completa): fica a ordem da mais nova, valores novos
// substituem os antigos e perguntas que só existiam na anterior continuam no fim.
function juntarRespostas(antigas, novas) {
  const chave = (r) => r.id || r.pergunta;
  const vistas = new Set((novas || []).map(chave));
  return [...(novas || []), ...(antigas || []).filter((r) => !vistas.has(chave(r)))];
}

// A resposta nova traz algo que a anterior (mesmo ID) não tinha? (terminou o formulário ou respondeu mais perguntas)
function trouxeNovidade(antes, depois) {
  if (!antes.completo && depois.completo) return true;
  return depois.respostas.some((r) => !antes.respostas.some((a) => a.id === r.id && a.resposta === r.resposta));
}

// Grava no lead as respostas do formulário. "mesmaResposta" = parcial e completa da mesma resposta do Yay! Forms
// (junta as respostas); senão, troca os dados do formulário pelos da resposta nova. Nunca volta de completo para parcial.
function gravarFormularioNoLead(leadId, dados, { mesmaResposta }) {
  const linha = get('SELECT extra, phone FROM leads WHERE id = ?', [leadId]);
  if (!linha) return;
  const extra = lerJson(linha.extra) || {};
  const novo = {
    ...extra,
    ...detalhesDe(dados),
    respostas: mesmaResposta ? juntarRespostas(extra.respostas, dados.respostas) : dados.respostas,
    formulario: dados.formulario || extra.formulario || null,
    utm: mesmaResposta ? { ...(extra.utm || {}), ...dados.utm } : dados.utm,
    variaveis: mesmaResposta ? { ...(extra.variaveis || {}), ...dados.variaveis } : dados.variaveis,
    analise_ia: dados.analiseIa || (mesmaResposta ? extra.analise_ia : null) || null,
    iniciado_em: extra.iniciado_em || dados.iniciadoEm,
    campo_inicio: extra.campo_inicio || dados.campoInicio,
    parcial: mesmaResposta ? Boolean(extra.parcial) && !dados.completo : !dados.completo,
  };
  run(
    `UPDATE leads SET extra = ?,
       name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?),
       form_started_at = COALESCE(form_started_at, ?), updated_at = ?
     WHERE id = ?`,
    [JSON.stringify(novo), dados.name, dados.phone, dados.email, dados.iniciadoEm, agora(), leadId]
  );
  // Lead que chegou sem telefone (resposta parcial) e agora ganhou um: liga as conversas de WhatsApp
  if (!linha.phone && dados.phone) vincularConversasExistentes(leadId, dados.phone);
  return { eraParcial: Boolean(extra.parcial), ficouParcial: novo.parcial };
}

function processar(body) {
  const dados = lerDados(body);
  const detalhes = detalhesDe(dados);

  return tx(() => {
    const existente = encontrarExistente({ phone: dados.phone, email: dados.email });
    if (existente) {
      const extra = lerJson(get('SELECT extra FROM leads WHERE id = ?', [existente])?.extra) || {};
      if (extra.parcial && dados.completo) {
        // O lead tinha só uma resposta parcial e agora terminou o formulário (numa resposta nova): o cartão passa a mostrar a completa
        gravarFormularioNoLead(existente, dados, { mesmaResposta: false });
        registrarEvento({ leadId: existente, type: 'form_completed', data: detalhes });
        return { leadId: existente, novo: false, tipo: 'form_completed' };
      }
      // Mesmo lead respondeu de novo: completa dados que faltavam e registra no histórico
      run(
        `UPDATE leads SET
           name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?),
           form_started_at = COALESCE(form_started_at, ?), updated_at = ?
         WHERE id = ?`,
        [dados.name, dados.phone, dados.email, dados.iniciadoEm, agora(), existente]
      );
      registrarEvento({ leadId: existente, type: 'form_resubmitted', data: detalhes });
      return { leadId: existente, novo: false };
    }

    const leadId = criarLead({ name: dados.name, phone: dados.phone, email: dados.email, source: 'yayforms', extra: detalhes });
    if (dados.iniciadoEm) run('UPDATE leads SET form_started_at = ? WHERE id = ?', [dados.iniciadoEm, leadId]);
    registrarEvento({ leadId, type: dados.completo ? 'form_submitted' : 'form_partial', data: detalhes });
    return { leadId, novo: true };
  });
}

// A mesma resposta do Yay! Forms chegando de novo. Devolve { leadId } se atualizou o lead,
// { duplicado: leadId } se não trouxe nada novo, ou null se o lead não existe mais (processa como resposta nova).
function atualizarMesmaResposta(anterior, body) {
  const dados = lerDados(body);
  const antes = lerDados(lerJson(anterior.payload) || {});
  const leadExiste = anterior.lead_id && get('SELECT id FROM leads WHERE id = ?', [anterior.lead_id]);
  if (!trouxeNovidade(antes, dados)) return { duplicado: anterior.lead_id };
  if (!leadExiste) return null;
  return tx(() => {
    const r = gravarFormularioNoLead(anterior.lead_id, dados, { mesmaResposta: true });
    const tipo = r?.eraParcial && !r.ficouParcial ? 'form_completed' : 'form_updated';
    registrarEvento({ leadId: anterior.lead_id, type: tipo, data: detalhesDe(dados) });
    return { leadId: anterior.lead_id, tipo };
  });
}

// Processa um webhook já guardado em webhook_events e marca o status. A mesma resposta chegando de novo:
// a parcial seguida da completa (mesmo ID) atualiza o lead; reenvio sem nada novo (botão "Test" repetido,
// "Executar em respostas anteriores") vira "duplicado" e não cria registro.
function receber(eventoId, body) {
  const respostaId = body.response?.id ? String(body.response.id) : null;
  const anterior = respostaId && get(
    `SELECT id, lead_id, payload FROM webhook_events
      WHERE source = 'yayforms' AND status = 'processed' AND id != ? AND json_extract(payload, '$.response.id') = ?
      ORDER BY id DESC LIMIT 1`,
    [eventoId, respostaId]
  );
  const mesma = anterior ? atualizarMesmaResposta(anterior, body) : null;
  if (mesma && 'duplicado' in mesma) {
    run("UPDATE webhook_events SET status = 'duplicado', lead_id = ? WHERE id = ?", [mesma.duplicado || null, eventoId]);
    return { leadId: mesma.duplicado || null, novo: false, duplicado: true };
  }
  if (mesma?.leadId) {
    run("UPDATE webhook_events SET status = 'processed', lead_id = ? WHERE id = ?", [mesma.leadId, eventoId]);
    return { leadId: mesma.leadId, novo: false, atualizado: true, tipo: mesma.tipo };
  }
  const { leadId, novo, tipo } = processar(body);
  run("UPDATE webhook_events SET status = 'processed', lead_id = ? WHERE id = ?", [leadId, eventoId]);
  return { leadId, novo, tipo };
}

// Leads que vieram do Yay! Forms antes da versão com "form_started_at": lê o início do formulário
// nos webhooks guardados. Roda ao ligar o CRM e só mexe em leads que ainda estão sem o horário.
function preencherInicioDosAntigos() {
  try {
    const pendentes = all(
      `SELECT e.lead_id, e.payload FROM webhook_events e JOIN leads l ON l.id = e.lead_id
        WHERE e.source = 'yayforms' AND e.status = 'processed' AND l.form_started_at IS NULL
        ORDER BY e.id`
    );
    let preenchidos = 0;
    const feitos = new Set();
    for (const ev of pendentes) {
      if (feitos.has(ev.lead_id)) continue;
      const { iniciadoEm } = extrairInicio(lerJson(ev.payload) || {});
      if (!iniciadoEm) continue;
      run('UPDATE leads SET form_started_at = ? WHERE id = ? AND form_started_at IS NULL', [iniciadoEm, ev.lead_id]);
      feitos.add(ev.lead_id);
      preenchidos++;
    }
    if (preenchidos) console.log(`[yayforms] horário de início do formulário preenchido em ${preenchidos} lead(s) antigo(s)`);
  } catch (err) {
    console.error('[yayforms] não consegui preencher o início dos leads antigos:', err.message);
  }
}

export default {
  name: 'yayforms',
  register(app) {
    preencherInicioDosAntigos();
    const r = Router();

    r.post('/:token', (req, res) => {
      if (!config.yayforms.token || !iguaisSeguro(req.params.token, config.yayforms.token)) {
        return res.status(404).json({ erro: 'Não encontrado' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const assinatura = conferirAssinatura(req);
      if (!assinatura.ok) {
        // Guarda mesmo assim (sem processar): depois de cadastrar o segredo certo, dá para reprocessar pela tela
        run(
          "INSERT INTO webhook_events (source, payload, status, error) VALUES (?, ?, 'assinatura_invalida', ?)",
          ['yayforms', JSON.stringify(body), 'Assinatura não bate com nenhum segredo cadastrado']
        );
        console.warn('[yayforms] assinatura inválida — cabeçalhos recebidos:', Object.keys(req.headers).join(', '));
        return res.status(401).json({ erro: 'Assinatura inválida' });
      }
      marcarUso(assinatura.segredoId);

      // 1) Guarda o payload bruto antes de qualquer coisa: nenhum lead se perde
      const eventoId = Number(run('INSERT INTO webhook_events (source, payload) VALUES (?, ?)', ['yayforms', JSON.stringify(body)]).lastInsertRowid);

      // 2) Processa
      try {
        const r = receber(eventoId, body);
        if (r.duplicado) return res.json({ ok: true, lead_id: r.leadId, duplicado: true });
        console.log(`[yayforms] ${r.novo ? 'novo lead' : r.tipo === 'form_completed' ? 'terminou o formulário:' : 'lead existente atualizado'} #${r.leadId}`);
        res.json({ ok: true, lead_id: r.leadId, novo: r.novo, atualizado: Boolean(r.atualizado) });
      } catch (err) {
        run("UPDATE webhook_events SET status = 'error', error = ? WHERE id = ?", [err.message, eventoId]);
        console.error('[yayforms] erro ao processar:', err.message);
        // Responde 200 mesmo assim: o payload está salvo e pode ser reprocessado
        res.json({ ok: false, guardado: true });
      }
    });

    app.use('/webhooks/yayforms', r);

    // Administração: ver os últimos webhooks recebidos e reprocessar os que deram erro
    const adm = Router();
    adm.use(exigirLogin, exigirAdmin);

    adm.get('/eventos', (req, res) => {
      const eventos = all(
        `SELECT id, status, error, lead_id, received_at, payload FROM webhook_events
          WHERE source = 'yayforms' ORDER BY received_at DESC, id DESC LIMIT 50`
      ).map(({ payload, ...ev }) => {
        // "parcial" = a pessoa começou o formulário e não terminou (opção "Enviar respostas incompletas" do Yay! Forms)
        const { completo, sinal } = extrairSituacao(lerJson(payload) || {});
        return { ...ev, parcial: !completo, sinal_parcial: sinal };
      });
      res.json({ eventos });
    });

    adm.post('/eventos/:id/reprocessar', (req, res) => {
      const id = idValido(req.params.id);
      const evento = id ? get("SELECT payload FROM webhook_events WHERE id = ? AND source = 'yayforms'", [id]) : null;
      if (!evento) return res.status(404).json({ erro: 'Evento não encontrado' });
      run('UPDATE webhook_events SET error = NULL WHERE id = ?', [id]);
      const r = receber(id, lerJson(evento.payload) || {});
      res.json({ ok: true, lead_id: r.leadId, novo: r.novo, duplicado: Boolean(r.duplicado) });
    });

    // Formulários que já mandaram respostas (o webhook só traz o ID; aqui dá para dar um nome)
    adm.get('/formularios', (req, res) => {
      const nomes = lerEstado('yayforms').nomes || {};
      const vistos = all(
        `SELECT json_extract(payload, '$.response.formId') AS form_id, count(*) AS respostas, max(received_at) AS ultima
           FROM webhook_events
          WHERE source = 'yayforms' AND json_extract(payload, '$.response.formId') IS NOT NULL
          GROUP BY form_id ORDER BY ultima DESC`
      );
      res.json({ formularios: vistos.map((f) => ({ ...f, nome: nomes[f.form_id] || null })) });
    });

    adm.put('/formularios/:formId', (req, res) => {
      const formId = String(req.params.formId || '').slice(0, 64);
      const nome = String(req.body?.nome || '').trim().slice(0, 120);
      if (!/^[\w-]+$/.test(formId)) return res.status(400).json({ erro: 'Formulário inválido' });
      const nomes = { ...(lerEstado('yayforms').nomes || {}) };
      if (nome) nomes[formId] = nome; else delete nomes[formId];
      tx(() => {
        salvarEstado('yayforms', { nomes });
        // Atualiza os leads que já vieram desse formulário
        run(
          `UPDATE leads SET extra = json_set(extra, '$.formulario', ?) WHERE json_extract(extra, '$.form_id') = ?`,
          [nome || null, formId]
        );
      });
      res.json({ ok: true });
    });

    adm.get('/config', (req, res) => {
      res.json({
        caminho: `${config.basePath}/webhooks/yayforms/${config.yayforms.token}`,
        url: config.publicOrigin
          ? `${config.publicOrigin}${config.basePath}/webhooks/yayforms/${config.yayforms.token}`
          : null,
        assinatura_ativa: segredosCadastrados().length > 0,
      });
    });

    // Segredos dos webhooks (um por webhook criado no Yay! Forms). O valor nunca volta inteiro para a tela.
    adm.get('/segredos', (req, res) => {
      res.json({
        segredos: segredosCadastrados().map((s) => ({
          id: s.id, nome: s.nome, final: mascarar(s.segredo), fixo: Boolean(s.fixo),
          criado_em: s.criado_em || null, ultimo_uso: s.ultimo_uso || null,
        })),
      });
    });

    adm.post('/segredos', (req, res) => {
      const segredo = String(req.body?.segredo || '').trim();
      const nome = String(req.body?.nome || '').trim().slice(0, 80) || 'Webhook';
      if (segredo.length < 8 || segredo.length > 256 || /\s/.test(segredo)) {
        return res.status(400).json({ erro: 'Cole o "Secret" exatamente como aparece no Yay! Forms (sem espaços).' });
      }
      if (segredosCadastrados().some((s) => s.segredo === segredo)) {
        return res.status(409).json({ erro: 'Esse segredo já está cadastrado.' });
      }
      const lista = Array.isArray(lerEstado('yayforms').segredos) ? lerEstado('yayforms').segredos : [];
      const novo = { id: crypto.randomUUID(), nome, segredo, criado_em: agora(), ultimo_uso: null };
      salvarEstado('yayforms', { segredos: [...lista, novo] });
      res.json({ ok: true, id: novo.id });
    });

    adm.delete('/segredos/:id', (req, res) => {
      const lista = Array.isArray(lerEstado('yayforms').segredos) ? lerEstado('yayforms').segredos : [];
      const resto = lista.filter((s) => s.id !== req.params.id);
      if (resto.length === lista.length) return res.status(404).json({ erro: 'Segredo não encontrado (os do .env só saem editando o .env).' });
      salvarEstado('yayforms', { segredos: resto });
      res.json({ ok: true });
    });

    app.use('/api/yayforms', adm);
  },
};
