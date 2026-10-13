// Módulo WhatsApp (QR code, vários números): conectar números, caixa de entrada no estilo do WhatsApp Web,
// conversa no lead, envio pelo CRM, histórico de 90 dias, figurinhas e chamadas.
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
  listarNumeros, conectar, desconectar, removerNumero, criarNumero, iniciarTodos, pararTodos, numeroExiste,
  consultarFotos, arquivoDaFoto,
} from './gerenciador.js';
import {
  enviar, enviarMensagem, reagir, apagarParaTodos, ocultarParaMim, editar, estrela, encaminhar, votar, informacoes,
  enviarFigurinha, enviarEnquete, enviarContato, enviarLocalizacao, avisarDigitando, assinarPresenca, definirTemporarias,
} from './envio.js';
import { arquivoDaMidia } from './midia.js';
import { importarHistorico, buscarMaisAntigas, progressoDe } from './historico.js';
import {
  listarConversas, mensagensDaConversa, destinoDaConversa, transformarEmLead, jidsDaChave, jidPrincipal, definirEstado,
  buscarNaConversa, listarFavoritas, listarEtiquetas, criarEtiqueta, editarEtiqueta, marcarConversaLida, dadosDoContato,
} from './conversas.js';
import { presencaDe } from './presenca.js';
import { chamadasAtivas, recusarChamada, criarLinkDeChamada } from './chamadas.js';
import {
  listarFigurinhas, favoritarNoCrm, arquivoDaFigurinha, criarFigurinha, sincronizarFavoritas, favoritarDaMensagem,
} from './figurinhas.js';
import { baixarMidia } from './midia.js';

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
  for (const c of [caminho, `${caminho}.ogg`, `${caminho}.mp4`, `${caminho}.webp`]) fs.rmSync(c, { force: true });
};

async function comQr(numeros, admin) {
  return Promise.all(
    numeros.map(async (n) => ({
      ...n,
      qr: admin && n.qr ? await QRCode.toDataURL(n.qr, { margin: 1, width: 280 }) : null,
    }))
  );
}

const numeroDoCorpo = (req) => {
  const numeroId = idValido(req.body?.numero_id ?? req.query?.numero_id);
  if (!numeroId) throw new ErroHttp(400, 'Escolha o número que vai enviar');
  return numeroId;
};

export default {
  name: 'whatsapp',
  register(app) {
    const r = Router();
    r.use(exigirLogin);

    // ------------------------------------------------------------ números
    r.get('/numeros', async (req, res) => {
      res.json({
        numeros: await comQr(listarNumeros(), req.user.role === 'admin'),
        ativo: config.whatsapp.ativo,
        historico_dias: config.whatsapp.historicoDias,
      });
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

    // "Importar 3 meses de histórico" sem desconectar (roda em segundo plano; progresso pelo evento "importacao")
    r.post('/numeros/:id/importar-historico', exigirAdmin, (req, res) => {
      const id = idValido(req.params.id);
      if (!numeroExiste(id)) return res.status(404).json({ erro: 'Número não encontrado' });
      importarHistorico(id).catch((err) => console.error(`[whatsapp #${id}] importação:`, err.message));
      // Dá tempo de recusar na hora (número desconectado etc.)
      setTimeout(() => res.json({ ok: true, historico: progressoDe(id) }), 300);
    });

    r.get('/numeros/:id/historico', (req, res) => {
      res.json({ historico: progressoDe(idValido(req.params.id)) });
    });

    r.post('/numeros/:id/figurinhas/sincronizar', exigirAdmin, async (req, res) => {
      res.json({ ok: true, sincronizacao: await sincronizarFavoritas(idValido(req.params.id)) });
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

    // ------------------------------------------------------------ caixa de entrada
    r.get('/conversas', (req, res) => {
      res.json(listarConversas({
        busca: String(req.query.q || '').slice(0, 100),
        filtro: String(req.query.filtro || 'todas'),
        numero: req.query.numero || null,
      }));
    });

    r.get('/conversas/:chave/mensagens', (req, res) => {
      res.json(mensagensDaConversa(req.params.chave, { antes: req.query.antes, aPartirDe: req.query.a_partir }));
    });

    r.get('/conversas/:chave/buscar', (req, res) => {
      res.json({ resultados: buscarNaConversa(req.params.chave, req.query.q) });
    });

    r.get('/conversas/:chave/contato', (req, res) => {
      res.json(dadosDoContato(req.params.chave));
    });

    r.get('/conversas/:chave/favoritas', (req, res) => {
      res.json({ mensagens: listarFavoritas(req.params.chave) });
    });

    // Estado: { arquivada, fixada, silenciada_ate, nao_lida, favorita, oculta, etiquetas }
    r.patch('/conversas/:chave', async (req, res) => {
      const permitidos = ['arquivada', 'fixada', 'silenciada_ate', 'nao_lida', 'favorita', 'oculta', 'etiquetas'];
      const mudanca = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
      if ('silenciada_ate' in mudanca && mudanca.silenciada_ate && Number.isNaN(Date.parse(mudanca.silenciada_ate))) {
        return res.status(400).json({ erro: 'Data inválida' });
      }
      await definirEstado(req.params.chave, mudanca);
      if (mudanca.nao_lida === false) marcarConversaLida(req.params.chave);
      res.json({ ok: true });
    });

    r.post('/conversas/:chave/lida', (req, res) => {
      res.json({ ok: true, marcadas: marcarConversaLida(req.params.chave) });
    });

    // Presença do contato (e assina para receber "digitando…")
    r.get('/conversas/:chave/presenca', async (req, res) => {
      const jids = jidsDaChave(req.params.chave, { incluirTelefone: false });
      const principal = jidPrincipal(req.params.chave);
      if (principal) assinarPresenca(principal).catch(() => {});
      res.json({ ...presencaDe(jids), jids: principal && !jids.includes(principal) ? [...jids, principal] : jids });
    });

    // Avisa o contato que alguém está digitando/gravando (estado: composing | recording | paused)
    r.post('/conversas/:chave/digitando', async (req, res) => {
      const numeroId = idValido(req.body?.numero_id);
      const estadoPresenca = ['composing', 'recording', 'paused'].includes(req.body?.estado) ? req.body.estado : 'composing';
      const jid = jidPrincipal(req.params.chave);
      if (numeroId && jid) await avisarDigitando(numeroId, jid, estadoPresenca);
      res.json({ ok: true });
    });

    r.post('/conversas/:chave/temporarias', async (req, res) => {
      const jid = jidPrincipal(req.params.chave);
      if (!jid) return res.status(400).json({ erro: 'Conversa sem identificador do WhatsApp' });
      await definirTemporarias(numeroDoCorpo(req), jid, req.body?.segundos);
      res.json({ ok: true });
    });

    // Texto (JSON: { texto, numero_id, responder_id, mencoes })
    r.post('/conversas/:chave/mensagens', async (req, res) => {
      const numeroId = numeroDoCorpo(req);
      const conteudo = texto(req.body?.texto, 65000);
      if (!conteudo) return res.status(400).json({ erro: 'Escreva a mensagem' });
      const destino = destinoDaConversa(req.params.chave);
      const mencoes = Array.isArray(req.body?.mencoes) ? req.body.mencoes.map(String) : null;
      const r2 = await enviar(numeroId, destino, { texto: conteudo, responderId: idValido(req.body?.responder_id), mencoes }, req.user.id);
      res.status(201).json({ ok: true, ...r2 });
    });

    // Arquivo (corpo = o próprio arquivo, enviado como application/octet-stream;
    // ?numero_id=&mime=&nome=&legenda=&modo=auto|documento|voz|figurinha|gif&unica=1&responder_id=)
    r.post('/conversas/:chave/arquivo', async (req, res) => {
      const numeroId = numeroDoCorpo(req);
      const destino = destinoDaConversa(req.params.chave);
      const caminho = await receberArquivo(req);
      try {
        const modo = ['documento', 'voz', 'figurinha', 'gif'].includes(req.query.modo) ? req.query.modo : 'auto';
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
              unica: req.query.unica === '1',
            },
          },
          req.user.id
        );
        res.status(201).json({ ok: true, ...r2 });
      } finally {
        apagarTemporarios(caminho);
      }
    });

    r.post('/conversas/:chave/figurinha', async (req, res) => {
      const id = idValido(req.body?.figurinha_id);
      if (!id) return res.status(400).json({ erro: 'Escolha a figurinha' });
      const r2 = await enviarFigurinha(numeroDoCorpo(req), destinoDaConversa(req.params.chave), id, req.user.id, idValido(req.body?.responder_id));
      res.status(201).json({ ok: true, ...r2 });
    });

    r.post('/conversas/:chave/enquete', async (req, res) => {
      const r2 = await enviarEnquete(numeroDoCorpo(req), destinoDaConversa(req.params.chave), {
        pergunta: texto(req.body?.pergunta, 255),
        opcoes: Array.isArray(req.body?.opcoes) ? req.body.opcoes.map((o) => texto(o, 100)) : [],
        multipla: Boolean(req.body?.multipla),
      }, req.user.id);
      res.status(201).json({ ok: true, ...r2 });
    });

    r.post('/conversas/:chave/contato', async (req, res) => {
      const contatos = Array.isArray(req.body?.contatos) ? req.body.contatos.map((c) => ({ nome: texto(c?.nome, 100), telefone: texto(c?.telefone, 30) })) : [];
      const r2 = await enviarContato(numeroDoCorpo(req), destinoDaConversa(req.params.chave), contatos, req.user.id);
      res.status(201).json({ ok: true, ...r2 });
    });

    r.post('/conversas/:chave/localizacao', async (req, res) => {
      const r2 = await enviarLocalizacao(numeroDoCorpo(req), destinoDaConversa(req.params.chave), {
        lat: req.body?.lat, lng: req.body?.lng, nome: texto(req.body?.nome, 100), endereco: texto(req.body?.endereco, 200),
      }, req.user.id);
      res.status(201).json({ ok: true, ...r2 });
    });

    // Link de chamada do WhatsApp: { numero_id, video, enviar: true } — "enviar" manda o link na conversa
    r.post('/conversas/:chave/link-chamada', async (req, res) => {
      const numeroId = numeroDoCorpo(req);
      const link = await criarLinkDeChamada(numeroId, Boolean(req.body?.video));
      let mensagem = null;
      if (req.body?.enviar) {
        const textoLink = `${link.video ? '🎥 Chamada de vídeo' : '📞 Chamada de voz'} pelo WhatsApp — toque para entrar:\n${link.link}`;
        mensagem = await enviar(numeroId, destinoDaConversa(req.params.chave), { texto: textoLink }, req.user.id);
      }
      res.status(201).json({ ...link, mensagem });
    });

    // Pede ao celular mensagens mais antigas da conversa
    r.post('/conversas/:chave/mais-antigas', async (req, res) => {
      await buscarMaisAntigas(jidsDaChave(req.params.chave, { incluirTelefone: false }), idValido(req.body?.numero_id));
      res.json({ ok: true });
    });

    r.post('/conversas/:chave/lead', (req, res) => {
      const { leadId, novo } = transformarEmLead(req.params.chave, req.user.id);
      res.status(novo ? 201 : 200).json({ lead_id: leadId, novo, chave: `l:${leadId}` });
    });

    // ------------------------------------------------------------ fotos de perfil
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

    // ------------------------------------------------------------ mídia e mensagens
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
      const emoji = typeof req.body?.emoji === 'string' ? [...req.body.emoji].slice(0, 12).join('') : '';
      await reagir(id, emoji);
      res.json({ ok: true });
    });

    // Apagar para todos
    r.delete('/mensagens/:id', async (req, res) => {
      await apagarParaTodos(idValido(req.params.id));
      res.json({ ok: true });
    });

    // Apagar para mim (só some do CRM; nada é apagado do banco). { ocultar: false } desfaz.
    r.post('/mensagens/:id/ocultar', (req, res) => {
      ocultarParaMim(idValido(req.params.id), req.body?.ocultar !== false);
      res.json({ ok: true });
    });

    r.patch('/mensagens/:id', async (req, res) => {
      await editar(idValido(req.params.id), texto(req.body?.texto, 65000));
      res.json({ ok: true });
    });

    r.post('/mensagens/:id/estrela', async (req, res) => {
      await estrela(idValido(req.params.id), req.body?.estrela !== false);
      res.json({ ok: true });
    });

    r.post('/mensagens/:id/encaminhar', async (req, res) => {
      const chaves = (Array.isArray(req.body?.chaves) ? req.body.chaves : []).map(String).slice(0, 5);
      const destinos = chaves.map((c) => destinoDaConversa(c));
      res.json({ resultados: await encaminhar(idValido(req.params.id), destinos, numeroDoCorpo(req), req.user.id) });
    });

    r.post('/mensagens/:id/voto', async (req, res) => {
      await votar(idValido(req.params.id), Array.isArray(req.body?.opcoes) ? req.body.opcoes.map(String) : []);
      res.json({ ok: true });
    });

    r.get('/mensagens/:id/info', (req, res) => {
      res.json(informacoes(idValido(req.params.id)));
    });

    r.get('/favoritas', (req, res) => {
      res.json({ mensagens: listarFavoritas() });
    });

    // ------------------------------------------------------------ etiquetas
    r.get('/etiquetas', (req, res) => res.json({ etiquetas: listarEtiquetas() }));
    r.post('/etiquetas', (req, res) => res.status(201).json({ id: criarEtiqueta(req.body?.nome, req.body?.cor) }));
    r.patch('/etiquetas/:id', (req, res) => {
      editarEtiqueta(idValido(req.params.id), { nome: req.body?.nome, cor: req.body?.cor });
      res.json({ ok: true });
    });

    // ------------------------------------------------------------ figurinhas
    r.get('/figurinhas', (req, res) => res.json(listarFigurinhas()));
    r.get('/figurinhas/:id/arquivo', (req, res) => {
      const f = arquivoDaFigurinha(idValido(req.params.id));
      res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
      res.type(f.mime).sendFile(f.caminho);
    });
    r.post('/figurinhas/:id/favorita', (req, res) => {
      favoritarNoCrm(idValido(req.params.id), req.body?.favorita !== false);
      res.json({ ok: true });
    });
    // Criar figurinha a partir de imagem/vídeo curto (corpo = arquivo; ?mime=)
    r.post('/figurinhas', async (req, res) => {
      const caminho = await receberArquivo(req);
      try {
        res.status(201).json({ id: await criarFigurinha(caminho, String(req.query.mime || '')) });
      } finally {
        apagarTemporarios(caminho);
      }
    });
    // Favoritar uma figurinha recebida numa mensagem
    r.post('/mensagens/:id/figurinha-favorita', async (req, res) => {
      res.json({ id: await favoritarDaMensagem(idValido(req.params.id), baixarMidia) });
    });

    // QR code de um link (ex.: "Ligar pelo celular": aponte a câmera do celular)
    r.get('/qr', async (req, res) => {
      const conteudo = String(req.query.texto || '').slice(0, 500);
      if (!/^https:\/\/(wa\.me|call\.whatsapp\.com|api\.whatsapp\.com|web\.whatsapp\.com)\//.test(conteudo)) return res.status(400).json({ erro: 'Link inválido' });
      res.json({ qr: await QRCode.toDataURL(conteudo, { margin: 1, width: 240 }) });
    });

    // ------------------------------------------------------------ chamadas
    r.get('/chamadas', (req, res) => res.json({ chamadas: chamadasAtivas() }));
    // Recusar ({ mensagem } opcional: manda uma mensagem ao contato logo depois)
    r.post('/chamadas/:id/recusar', async (req, res) => {
      const c = await recusarChamada(String(req.params.id));
      const msg = texto(req.body?.mensagem, 1000);
      let enviada = null;
      if (msg) enviada = await enviar(c.numero, destinoDaConversa(c.chave), { texto: msg }, req.user.id);
      res.json({ ok: true, mensagem: enviada });
    });

    app.use('/api/whatsapp', r);

    // Canal de atualização em tempo real da interface
    app.get('/api/eventos', exigirLogin, abrirCanal);

    // Conversa do lead (versão simples, mantida por compatibilidade)
    app.get('/api/leads/:id/mensagens', exigirLogin, (req, res) => {
      const id = idValido(req.params.id);
      const mensagens = all(
        `SELECT * FROM (
           SELECT m.id, m.from_me, m.type, m.body, m.timestamp, m.instance_id, m.read_at,
                  i.name AS numero_nome, u.name AS enviado_por
             FROM wa_messages m
             LEFT JOIN wa_instances i ON i.id = m.instance_id
             LEFT JOIN users u ON u.id = m.sent_by
            WHERE m.lead_id = ? AND m.hidden_at IS NULL
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
