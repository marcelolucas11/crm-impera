// Módulo WhatsApp (QR code, vários números): conectar números, conversa no lead, envio pelo CRM.
// Mensagens enviadas para um lead (pelo CRM ou pelo celular) zeram o contador de follow-up.
import { Router } from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido, texto, ErroHttp } from '../../util.js';
import { abrirCanal, fecharCanais } from '../../tempoReal.js';
import {
  listarNumeros, conectar, desconectar, removerNumero, criarNumero, enviar, enviarMensagem,
  iniciarTodos, pararTodos, numeroExiste, arquivoDaMidia, reagir, apagarParaTodos, consultarFotos, arquivoDaFoto, buscarMaisAntigas,
} from './gerenciador.js';
import { listarConversas, mensagensDaConversa, destinoDaConversa, transformarEmLead, jidsDaChave } from './conversas.js';

// Tipos que o navegador pode abrir direto na tela; o resto é sempre baixado (evita abrir HTML/SVG de terceiros)
const ABRE_NA_TELA = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/|application\/pdf)/i;

// Recebe o arquivo enviado pelo navegador direto para o disco, com limite de tamanho
async function receberArquivo(req) {
  const max = config.whatsapp.envioMaxMb * 1024 * 1024;
  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > max) throw new ErroHttp(413, `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`);
  const pasta = path.join(config.filesDir, 'whatsapp', 'tmp');
  fs.mkdirSync(pasta, { recursive: true });
  const caminho = path.join(pasta, crypto.randomUUID());
  let total = 0;
  const limite = new Transform({
    transform(pedaco, _enc, cb) {
      total += pedaco.length;
      if (total > max) return cb(new ErroHttp(413, `Arquivo grande demais (máximo ${config.whatsapp.envioMaxMb} MB)`));
      cb(null, pedaco);
    },
  });
  try {
    await pipeline(req, limite, fs.createWriteStream(caminho));
  } catch (err) {
    fs.rmSync(caminho, { force: true });
    throw err.status ? err : new ErroHttp(400, 'O envio do arquivo foi interrompido');
  }
  if (!total) {
    fs.rmSync(caminho, { force: true });
    throw new ErroHttp(400, 'Arquivo vazio');
  }
  return caminho;
}

const apagarTemporarios = (caminho) => {
  for (const c of [caminho, `${caminho}.ogg`, `${caminho}.mp4`]) fs.rmSync(c, { force: true });
};

async function comQr(numeros, admin) {
  return Promise.all(
    numeros.map(async (n) => ({
      ...n,
      qr: admin && n.qr ? await QRCode.toDataURL(n.qr, { margin: 1, width: 280 }) : null,
    }))
  );
}

export default {
  name: 'whatsapp',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    r.get('/numeros', async (req, res) => {
      res.json({ numeros: await comQr(listarNumeros(), req.user.role === 'admin'), ativo: config.whatsapp.ativo });
    });

    r.post('/numeros', exigirAdmin, async (req, res) => {
      const nome = texto(req.body?.nome, 60) || 'WhatsApp';
      const id = criarNumero(nome);
      await conectar(id);
      res.status(201).json({ id });
    });

    r.post('/numeros/:id/conectar', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      await conectar(id);
      res.json({ ok: true });
    });

    r.post('/numeros/:id/desconectar', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      await desconectar(id);
      res.json({ ok: true });
    });

    r.patch('/numeros/:id', exigirAdmin, (req, res) => {
      const id = idValido(req.params.id);
      const nome = texto(req.body?.nome, 60);
      if (!nome) return res.status(400).json({ erro: 'Informe o nome' });
      run('UPDATE wa_instances SET name = ? WHERE id = ?', [nome, id]);
      res.json({ ok: true });
    });

    r.delete('/numeros/:id', exigirAdmin, async (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      await removerNumero(id);
      res.json({ ok: true });
    });

    // Caixa de entrada (tela de WhatsApp)
    r.get('/conversas', (req, res) => {
      res.json({ conversas: listarConversas({ busca: String(req.query.q || ''), filtro: String(req.query.filtro || 'todas') }) });
    });

    r.get('/conversas/:chave/mensagens', (req, res) => {
      res.json(mensagensDaConversa(req.params.chave, { antes: req.query.antes }));
    });

    // Texto (JSON: { texto, numero_id, responder_id })
    r.post('/conversas/:chave/mensagens', async (req, res) => {
      const numeroId = idValido(req.body?.numero_id);
      const conteudo = texto(req.body?.texto, 4000);
      if (!conteudo) return res.status(400).json({ erro: 'Escreva a mensagem' });
      if (!numeroId) return res.status(400).json({ erro: 'Escolha o número que vai enviar' });
      const destino = destinoDaConversa(req.params.chave);
      const r2 = await enviar(numeroId, destino, { texto: conteudo, responderId: idValido(req.body?.responder_id) }, req.user.id);
      res.status(201).json({ ok: true, ...r2 });
    });

    // Arquivo (corpo = o próprio arquivo, enviado como application/octet-stream;
    // ?numero_id=&mime=&nome=&legenda=&modo=auto|documento|voz&responder_id=)
    r.post('/conversas/:chave/arquivo', async (req, res) => {
      const numeroId = idValido(req.query.numero_id);
      if (!numeroId) return res.status(400).json({ erro: 'Escolha o número que vai enviar' });
      const destino = destinoDaConversa(req.params.chave);
      const caminho = await receberArquivo(req);
      try {
        const modo = ['documento', 'voz'].includes(req.query.modo) ? req.query.modo : 'auto';
        const r2 = await enviar(
          numeroId,
          destino,
          {
            texto: texto(req.query.legenda, 1000),
            responderId: idValido(req.query.responder_id),
            arquivo: {
              caminho,
              mime: texto(req.query.mime, 120) || 'application/octet-stream',
              nome: texto(req.query.nome, 200) || (modo === 'voz' ? 'audio' : 'arquivo'),
              modo,
            },
          },
          req.user.id
        );
        res.status(201).json({ ok: true, ...r2 });
      } finally {
        apagarTemporarios(caminho);
      }
    });

    // Pede ao celular mensagens mais antigas da conversa
    r.post('/conversas/:chave/mais-antigas', async (req, res) => {
      await buscarMaisAntigas(jidsDaChave(req.params.chave, { incluirTelefone: false }));
      res.json({ ok: true });
    });

    // Quais contatos têm foto de perfil: { chaves: ["l:12", "t:5511..."] } → { fotos: { "l:12": "versão" | null } }
    r.post('/fotos/consultar', (req, res) => {
      const chaves = (Array.isArray(req.body?.chaves) ? req.body.chaves : []).slice(0, 500).map(String);
      const validas = [];
      const jids = [];
      for (const chave of chaves) {
        try { jids.push(jidsDaChave(chave)); validas.push(chave); } catch { /* chave inválida */ }
      }
      const versoes = consultarFotos(jids);
      res.json({ fotos: Object.fromEntries(validas.map((c, i) => [c, versoes[i]])) });
    });

    // Foto de perfil (só a que já foi baixada; ?v= muda quando a foto muda)
    r.get('/fotos/:chave', (req, res) => {
      const caminho = arquivoDaFoto(jidsDaChave(req.params.chave));
      if (!caminho) return res.status(404).json({ erro: 'Sem foto' });
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      res.sendFile(caminho);
    });

    // Mídia de uma mensagem (baixa do WhatsApp na primeira vez)
    r.get('/midia/:id', async (req, res) => {
      const id = idValido(req.params.id);
      if (!id) return res.status(404).json({ erro: 'Mídia não encontrada' });
      const arq = await arquivoDaMidia(id, { compat: req.query.compat === '1' });
      const mime = arq.mime.split(';')[0].trim();
      const nome = arq.nome || `whatsapp-${id}${path.extname(arq.caminho)}`;
      res.setHeader('Content-Type', arq.mime);
      res.setHeader('Cache-Control', 'private, max-age=604800');
      // PDF precisa do leitor do navegador (que a política restrita bloquearia); o resto abre isolado
      if (mime === 'application/pdf') res.removeHeader('Content-Security-Policy');
      else res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      if (req.query.download === '1' || !ABRE_NA_TELA.test(mime)) res.attachment(nome);
      res.sendFile(arq.caminho);
    });

    r.post('/mensagens/:id/reacao', async (req, res) => {
      const id = idValido(req.params.id);
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.slice(0, 16) : '';
      await reagir(id, emoji);
      res.json({ ok: true });
    });

    r.delete('/mensagens/:id', async (req, res) => {
      await apagarParaTodos(idValido(req.params.id));
      res.json({ ok: true });
    });

    r.post('/conversas/:chave/lead', (req, res) => {
      const { leadId, novo } = transformarEmLead(req.params.chave, req.user.id);
      res.status(novo ? 201 : 200).json({ lead_id: leadId, novo, chave: `l:${leadId}` });
    });

    app.use('/api/whatsapp', r);

    // Canal de atualização em tempo real da interface
    app.get('/api/eventos', exigirLogin, abrirCanal);

    // Conversa do lead
    app.get('/api/leads/:id/mensagens', exigirLogin, (req, res) => {
      const id = idValido(req.params.id);
      const mensagens = all(
        `SELECT * FROM (
           SELECT m.id, m.from_me, m.type, m.body, m.timestamp, m.instance_id, m.read_at,
                  i.name AS numero_nome, u.name AS enviado_por
             FROM wa_messages m
             LEFT JOIN wa_instances i ON i.id = m.instance_id
             LEFT JOIN users u ON u.id = m.sent_by
            WHERE m.lead_id = ?
            ORDER BY m.timestamp DESC, m.id DESC LIMIT 300
         ) ORDER BY timestamp ASC, id ASC`,
        [id]
      ).map((m) => ({ ...m, from_me: Boolean(m.from_me) }));
      // Abrir a conversa marca as mensagens recebidas como lidas
      run('UPDATE wa_messages SET read_at = ? WHERE lead_id = ? AND from_me = 0 AND read_at IS NULL', [agora(), id]);
      const ultimoNumero = mensagens.length ? mensagens[mensagens.length - 1].instance_id : null;
      res.json({ mensagens, ultimo_numero: ultimoNumero });
    });

    app.post('/api/leads/:id/mensagens', exigirLogin, async (req, res) => {
      const leadId = idValido(req.params.id);
      const numeroId = idValido(req.body?.numero_id);
      const conteudo = texto(req.body?.texto, 4000);
      if (!conteudo) return res.status(400).json({ erro: 'Escreva a mensagem' });
      if (!numeroId) return res.status(400).json({ erro: 'Escolha o número que vai enviar' });
      const r = await enviarMensagem(numeroId, leadId, conteudo, req.user.id);
      res.status(201).json({ ok: true, ...r });
    });
  },

  start() {
    if (!config.whatsapp.ativo) {
      console.log('[whatsapp] desligado (WHATSAPP_ATIVO=0)');
      return;
    }
    iniciarTodos().catch((err) => console.error('[whatsapp] erro ao iniciar:', err.message));
  },

  stop() {
    pararTodos();
    fecharCanais();
  },
};
