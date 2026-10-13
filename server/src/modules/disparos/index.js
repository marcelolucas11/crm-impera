// Módulo Disparos: saudação automática dos leads do Yay! Forms, campanhas com fluxo de mensagens e timers,
// listas de contatos (kanban + WhatsApp), modelos de fluxo, lista de bloqueio e a fila que roda no servidor.
//
// Atenção: o WhatsApp conectado por QR code não é oficial e pode banir números que mandam mensagens em massa.
// Os timers aleatórios, o descanso por lote e a janela de horário diminuem o risco, mas não o eliminam.
import { Router } from 'express';
import { get, all } from '../../db.js';
import { lerJson } from '../../events.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido, ErroHttp } from '../../util.js';
import { listarContatos, identificarTelefone } from './contatos.js';
import { variaveisDoContato, VARIAVEIS_PADRAO, FUSO } from './texto.js';
import { iniciarMotor, pararMotor } from './motor.js';
import { receberUpload, importarDeUrl, arquivoDaMidia, publica } from './midias.js';
import {
  criarCampanha, listarCampanhas, detalheCampanha, pausarCampanha, retomarCampanha, cancelarCampanha, reenviarFalhas, apagarCampanha,
  listarListas, membrosDaLista, criarLista, editarLista, apagarLista, adicionarMembros, removerMembros,
  listarBloqueio, bloquear, desbloquear, listarModelos, salvarModelo, apagarModelo,
  lerConfigYay, salvarConfigYay, campanhaYay, inspecionarUltimoPayload,
} from './servico.js';

const ABRE_NA_TELA = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/|application\/pdf)/i;

function variaveisDoLead(leadId) {
  const l = leadId
    ? get('SELECT l.name, l.phone, l.email, l.extra, s.name AS etapa FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [leadId])
    : null;
  if (!l) return null;
  return variaveisDoContato({ nome: l.name, phone: l.phone, email: l.email, etapa: l.etapa, extra: lerJson(l.extra, {}) });
}

export default {
  name: 'disparos',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    // ------------------------------------------------------------ contatos
    r.get('/contatos', (req, res) => {
      res.json({
        contatos: listarContatos(),
        etapas: all('SELECT id, name AS nome, color AS cor, position FROM stages ORDER BY position, id'),
        etiquetas: all('SELECT id, name AS nome, color AS cor FROM wa_labels ORDER BY name'),
      });
    });

    r.get('/telefone/:telefone', (req, res) => {
      const achado = identificarTelefone(req.params.telefone);
      if (!achado) return res.status(400).json({ erro: 'Telefone inválido' });
      res.json(achado);
    });

    // Variáveis de um lead (para a prévia mostrar dados reais). Sem lead: o lead mais recente do Yay! Forms
    r.get('/variaveis', (req, res) => {
      let leadId = idValido(req.query.lead_id);
      if (!leadId) leadId = get("SELECT id FROM leads WHERE source = 'yayforms' ORDER BY created_at DESC LIMIT 1")?.id || get('SELECT id FROM leads ORDER BY created_at DESC LIMIT 1')?.id;
      res.json({ lead_id: leadId || null, variaveis: variaveisDoLead(leadId) || variaveisDoContato({ nome: 'Maria Souza', phone: '5511987654321', email: 'maria@exemplo.com', etapa: 'Novo lead' }), padroes: VARIAVEIS_PADRAO, fuso: FUSO });
    });

    // ------------------------------------------------------------ listas
    r.get('/listas', (req, res) => res.json({ listas: listarListas() }));
    r.post('/listas', (req, res) => {
      const id = criarLista(req.body || {}, req.user.id);
      const resultado = Array.isArray(req.body?.contatos) && req.body.contatos.length ? adicionarMembros(id, req.body.contatos) : null;
      res.status(201).json({ id, ...resultado });
    });
    r.patch('/listas/:id', (req, res) => {
      editarLista(idValido(req.params.id), req.body || {});
      res.json({ ok: true });
    });
    r.delete('/listas/:id', (req, res) => {
      apagarLista(idValido(req.params.id));
      res.json({ ok: true });
    });
    r.get('/listas/:id/membros', (req, res) => res.json({ membros: membrosDaLista(idValido(req.params.id)) }));
    r.post('/listas/:id/membros', (req, res) => res.json(adicionarMembros(idValido(req.params.id), req.body?.contatos || [])));
    r.post('/listas/:id/membros/remover', (req, res) => res.json({ removidos: removerMembros(idValido(req.params.id), req.body?.telefones || []) }));

    // ------------------------------------------------------------ modelos de fluxo
    r.get('/modelos', (req, res) => res.json({ modelos: listarModelos() }));
    r.post('/modelos', (req, res) => res.status(201).json({ id: salvarModelo(req.body || {}, req.user.id) }));
    r.delete('/modelos/:id', (req, res) => {
      apagarModelo(idValido(req.params.id));
      res.json({ ok: true });
    });

    // ------------------------------------------------------------ lista de bloqueio
    r.get('/bloqueio', (req, res) => res.json({ bloqueados: listarBloqueio() }));
    r.post('/bloqueio', (req, res) => res.status(201).json({ telefone: bloquear(req.body || {}, req.user.id) }));
    r.delete('/bloqueio/:telefone', (req, res) => {
      desbloquear(req.params.telefone);
      res.json({ ok: true });
    });

    // ------------------------------------------------------------ campanhas e fila
    r.get('/campanhas', (req, res) => res.json({ campanhas: listarCampanhas() }));
    r.get('/campanhas/:id', (req, res) => {
      res.json(detalheCampanha(idValido(req.params.id), {
        status: req.query.status ? String(req.query.status) : null,
        pagina: Math.max(0, Number(req.query.pagina) || 0),
      }));
    });
    r.post('/campanhas', (req, res) => res.status(201).json(criarCampanha({ ...(req.body || {}), tipo: 'campanha' }, req.user.id)));
    r.post('/campanhas/:id/pausar', (req, res) => { pausarCampanha(idValido(req.params.id)); res.json({ ok: true }); });
    r.post('/campanhas/:id/retomar', (req, res) => { retomarCampanha(idValido(req.params.id)); res.json({ ok: true }); });
    r.post('/campanhas/:id/cancelar', (req, res) => { cancelarCampanha(idValido(req.params.id)); res.json({ ok: true }); });
    r.post('/campanhas/:id/reenviar-falhas', (req, res) => res.json({ reenviados: reenviarFalhas(idValido(req.params.id)) }));
    r.delete('/campanhas/:id', (req, res) => { apagarCampanha(idValido(req.params.id)); res.json({ ok: true }); });

    // Envio de teste: o fluxo vai na hora (com os timers de cada bloco) para um número só
    r.post('/teste', (req, res) => {
      const telefone = String(req.body?.telefone || '');
      const achado = identificarTelefone(telefone);
      if (!achado) throw new ErroHttp(400, 'Digite um telefone válido para o teste (com DDD)');
      const resultado = criarCampanha({
        nome: `Teste para ${achado.nome || telefone}`,
        numero_id: req.body?.numero_id,
        blocos: req.body?.blocos,
        config: { intervalo: { modo: 'fixo', fixo: 3 } },
        destinatarios: { contatos: [{ telefone: achado.telefone, lead_id: achado.lead_id, nome: achado.nome }] },
        tipo: 'teste',
      }, req.user.id);
      res.status(201).json(resultado);
    });

    // ------------------------------------------------------------ mídias
    r.post('/midias', async (req, res) => res.status(201).json({ midia: await receberUpload(req, req.user.id) }));
    r.post('/midias/url', async (req, res) => res.status(201).json({ midia: await importarDeUrl(req.body?.url, req.user.id) }));
    // Dados dos arquivos usados por blocos salvos (?ids=1,2,3)
    r.get('/midias', (req, res) => {
      const ids = String(req.query.ids || '').split(',').map(idValido).filter(Boolean).slice(0, 100);
      const midias = ids.length ? all(`SELECT * FROM disparo_midias WHERE id IN (${ids.map(() => '?').join(',')})`, ids).map(publica) : [];
      res.json({ midias });
    });
    r.get('/midias/:id', (req, res) => {
      const arq = arquivoDaMidia(idValido(req.params.id));
      const mime = arq.mime.split(';')[0].trim();
      res.setHeader('Content-Type', arq.mime);
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      if (mime === 'application/pdf') res.removeHeader('Content-Security-Policy');
      else res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      if (!ABRE_NA_TELA.test(mime)) res.attachment(arq.nome);
      res.sendFile(arq.caminho);
    });

    // ------------------------------------------------------------ saudação automática do Yay! Forms
    r.get('/yayforms', (req, res) => {
      const c = campanhaYay();
      res.json({ config: lerConfigYay(), campanha_id: c.id, pode_editar: req.user.role === 'admin' });
    });
    r.put('/yayforms', exigirAdmin, (req, res) => res.json({ config: salvarConfigYay(req.body || {}) }));
    r.get('/yayforms/payload', (req, res) => res.json(inspecionarUltimoPayload()));

    app.use('/api/disparos', r);
  },

  start() {
    iniciarMotor();
  },

  stop() {
    pararMotor();
  },
};
