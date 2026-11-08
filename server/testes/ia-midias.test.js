// IA de primeiro contato (Alice SDR) entendendo o que não é texto: áudio e vídeo transcritos pelo Whisper da VPS,
// imagem e PDF anexados para o modelo ver, documentos em texto. O modelo, o Whisper e o WhatsApp são falsos.
import { prepararBanco, limparBanco, PASTA } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const { salvarConfig } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const { textoDaMensagem } = await import('../src/modules/ia/prompt.js');
const midias = await import('../src/modules/ia/midias.js');
const motor = await import('../src/modules/ia/motor.js');
const protecao = await import('../src/modules/ia/protecao.js');
const transcricao = await import('../src/modules/agente/transcricao.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { inicio: '00:00', fim: '23:59' }]));

let enviadas = [];
let pedidos = [];
let respostaModelo = null;
let transcricoes = 0;
let falaDoAudio = 'oi, eu queria entender como funciona o tráfego para rifa';

motor.definirDependencias({
  esperar: async () => {},
  aleatorio: () => 0,
  digitando: async () => {},
  numeroDisponivel: async () => 1,
  virarLead: async () => ({ leadId: null }),
  enviar: async (numeroId, destino, dados) => {
    enviadas.push({ destino, ...dados });
    run(`INSERT INTO wa_messages (instance_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
         VALUES (1, ?, ?, 1, 'texto', ?, ?, ?)`, [destino.jid || 'x@s.whatsapp.net', `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: dados.origem })]);
  },
});
definirChamadaFalsa(async (corpo) => {
  pedidos.push(corpo);
  return { texto: JSON.stringify(respostaModelo), uso: { input_tokens: 100, output_tokens: 20 } };
});

let seq = 0;
function arquivo(nome, conteudo) {
  const rel = path.join('whatsapp', '1', `${++seq}-${nome}`);
  fs.mkdirSync(path.join(PASTA, 'arquivos', 'whatsapp', '1'), { recursive: true });
  fs.writeFileSync(path.join(PASTA, 'arquivos', rel), conteudo);
  return rel;
}

function mensagem(jid, { tipo = 'texto', texto = null, legenda = null, mime = null, nome = null, rel = null, segundos = null } = {}) {
  seq++;
  const r = run(`INSERT INTO wa_messages (instance_id, chat_jid, wa_id, from_me, type, body, legenda, timestamp, media_path, media_mime, media_name, media_seconds, media_status)
                 VALUES (1, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [jid, `M${seq}`, tipo, texto, legenda, new Date().toISOString(), rel, mime, nome, segundos, rel ? 'ok' : null]);
  return Number(r.lastInsertRowid);
}

async function preparar({ transcricaoLigada = true, extra = {} } = {}) {
  await limparBanco();
  exec('DELETE FROM ia_sugestoes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: true, modo: 'automatico', horario: SEMPRE, automatico_fora_horario: true, espera_agrupar_seg: 3, intervalo_leads_min_seg: 0, intervalo_leads_max_seg: 0, ...extra });
  protecao.zerarProtecao();
  transcricao.definirTranscritorFalso(async () => { transcricoes++; return falaDoAudio; });
  transcricao.salvarConfig({ ativo: transcricaoLigada });
  enviadas = [];
  pedidos = [];
  transcricoes = 0;
  falaDoAudio = 'oi, eu queria entender como funciona o tráfego para rifa';
  respostaModelo = { mensagens: ['Oi! Aqui é a Alice, da Impera Services. Te explico sim!'], acao: 'responder', resumo: 'lead novo' };
}

function chegou(jid, opcoes) {
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?) ON CONFLICT(jid) DO NOTHING', [jid, jid.split('@')[0], 'João Silva']);
  const id = mensagem(jid, opcoes);
  return { id, conversa: motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid }) };
}

const textoDoPedido = (corpo) => {
  const c = corpo.messages[0].content;
  return typeof c === 'string' ? c : c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
};
const blocosVisuais = (corpo) => {
  const c = corpo.messages[0].content;
  return typeof c === 'string' ? [] : c.filter((b) => b.type === 'image' || b.type === 'document');
};

test('áudio do lead: o Whisper transcreve, a Alice responde ao que foi falado (sem passar para humano) e não transcreve de novo', async () => {
  await preparar();
  const jid = '5511922220001@s.whatsapp.net';
  const { id, conversa } = chegou(jid, { tipo: 'audio', texto: '🎤 Áudio', mime: 'audio/ogg; codecs=opus', rel: arquivo('a.ogg', 'OggS'), segundos: 9 });
  const r = await motor.processarConversa(conversa.id);
  assert.equal(r.feito, 'enviada');
  assert.equal(r.acao, 'responder');
  assert.equal(transcricoes, 1);
  assert.match(textoDoPedido(pedidos[0]), /LEAD: \[o lead mandou um áudio\] O que foi falado: "oi, eu queria entender como funciona o tráfego para rifa"/);
  assert.equal(get('SELECT transcricao FROM wa_messages WHERE id = ?', [id]).transcricao, falaDoAudio);
  assert.match(get("SELECT detalhe FROM ia_registro WHERE conversa_id = ? AND tipo = 'midias'", [conversa.id]).detalhe, /1 áudio\(s\) transcrito/);

  // Próxima mensagem: o áudio antigo vai com a transcrição guardada, sem rodar o Whisper de novo
  mensagem(jid, { texto: 'e quanto custa?' });
  motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid });
  await motor.processarConversa(conversa.id);
  assert.equal(transcricoes, 1);
  assert.match(textoDoPedido(pedidos.at(-1)), /O que foi falado: "oi, eu queria/);
});

test('áudio pedindo uma pessoa: passa para humano pela regra fixa, sem chamar o modelo', async () => {
  await preparar();
  falaDoAudio = 'quero falar com um atendente';
  const { conversa } = chegou('5511922220002@s.whatsapp.net', { tipo: 'audio', mime: 'audio/ogg', rel: arquivo('b.ogg', 'OggS') });
  const r = await motor.processarConversa(conversa.id);
  assert.equal(r.acao, 'passar_humano');
  assert.equal(pedidos.length, 0);
});

test('vídeo curto tem a fala transcrita; vídeo longo não', async () => {
  await preparar();
  const jid = '5511922220003@s.whatsapp.net';
  const { conversa } = chegou(jid, { tipo: 'video', mime: 'video/mp4', rel: arquivo('v.mp4', 'x'), segundos: 40 });
  await motor.processarConversa(conversa.id);
  assert.match(textoDoPedido(pedidos[0]), /\[o lead mandou um vídeo\] O que foi falado:/);

  mensagem(jid, { tipo: 'video', mime: 'video/mp4', rel: arquivo('v2.mp4', 'x'), segundos: 600 });
  motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid });
  await motor.processarConversa(conversa.id);
  assert.equal(transcricoes, 1);
  assert.match(textoDoPedido(pedidos.at(-1)), /você NÃO conseguiu abrir: vídeo de 10 min/);
});

test('imagem do lead: vai anexada para o modelo ver; a descrição devolvida fica guardada e a imagem não é reenviada', async () => {
  await preparar();
  const jid = '5511922220004@s.whatsapp.net';
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const { id, conversa } = chegou(jid, { tipo: 'imagem', legenda: 'olha meu anúncio', mime: 'image/jpeg', rel: arquivo('i.jpg', png) });
  respostaModelo = {
    mensagens: ['Vi o print do seu anúncio! Ele está rodando no Instagram?'], acao: 'responder', resumo: 'mandou print',
    midias: [{ anexo: 1, descricao: 'Print de um anúncio de rifa no Instagram com prêmio de moto' }],
  };
  const r = await motor.processarConversa(conversa.id);
  assert.equal(r.feito, 'enviada');
  const visuais = blocosVisuais(pedidos[0]);
  assert.equal(visuais.length, 1);
  assert.equal(visuais[0].type, 'image');
  assert.equal(visuais[0].source.media_type, 'image/jpeg');
  assert.match(textoDoPedido(pedidos[0]), /olha meu anúncio \(veja o anexo 1 abaixo\)/);
  assert.match(textoDoPedido(pedidos[0]), /Inclua em "midias"/);
  assert.equal(get('SELECT texto_extraido FROM wa_messages WHERE id = ?', [id]).texto_extraido, 'Print de um anúncio de rifa no Instagram com prêmio de moto');

  respostaModelo = { mensagens: ['Legal!'], acao: 'responder', resumo: 'x' };
  mensagem(jid, { texto: 'sim, no instagram' });
  motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid });
  await motor.processarConversa(conversa.id);
  assert.equal(blocosVisuais(pedidos.at(-1)).length, 0);
  assert.equal(typeof pedidos.at(-1).messages[0].content, 'string');
  assert.match(textoDoPedido(pedidos.at(-1)), /O que aparece: Print de um anúncio de rifa/);
});

test('PDF vai como documento para o modelo; planilha/texto viram conteúdo', async () => {
  await preparar();
  const jid = '5511922220005@s.whatsapp.net';
  chegou(jid, { tipo: 'documento', texto: '📄 resultados.csv', mime: 'text/csv', nome: 'resultados.csv', rel: arquivo('r.csv', 'mes;vendas\njaneiro;120\nfevereiro;180') });
  const { conversa } = chegou(jid, { tipo: 'documento', texto: '📄 contrato.pdf', mime: 'application/pdf', nome: 'contrato.pdf', rel: arquivo('c.pdf', '%PDF-1.4 teste') });
  await motor.processarConversa(conversa.id);
  const visuais = blocosVisuais(pedidos[0]);
  assert.equal(visuais.length, 1);
  assert.equal(visuais[0].type, 'document');
  const texto = textoDoPedido(pedidos[0]);
  assert.match(texto, /\[o lead mandou um arquivo "resultados.csv"\] Conteúdo: mes;vendas janeiro;120/);
  assert.match(texto, /\[o lead mandou um arquivo "contrato.pdf"\] \(veja o anexo 1 abaixo\)/);
});

test('transcrição desligada ou imagens desligadas: a mídia vai marcada como "não conseguiu abrir" (a Alice passa para a equipe)', async () => {
  await preparar({ transcricaoLigada: false, extra: { ver_imagens: false } });
  const jid = '5511922220006@s.whatsapp.net';
  chegou(jid, { tipo: 'audio', mime: 'audio/ogg', rel: arquivo('d.ogg', 'OggS') });
  const { conversa } = chegou(jid, { tipo: 'imagem', mime: 'image/jpeg', rel: arquivo('e.jpg', 'x') });
  await motor.processarConversa(conversa.id);
  assert.equal(transcricoes, 0);
  assert.equal(blocosVisuais(pedidos[0]).length, 0);
  const texto = textoDoPedido(pedidos[0]);
  assert.match(texto, /você NÃO conseguiu abrir: a transcrição de áudio do CRM está desligada/);
  assert.match(texto, /você NÃO conseguiu abrir: a leitura de imagens e PDFs está desligada/);
});

test('no máximo 3 imagens por resposta (as mais recentes); as outras vão marcadas', async () => {
  await preparar();
  const jid = '5511922220007@s.whatsapp.net';
  let c;
  for (let i = 0; i < 5; i++) c = chegou(jid, { tipo: 'imagem', legenda: `foto ${i}`, mime: 'image/png', rel: arquivo(`f${i}.png`, 'x') });
  await motor.processarConversa(c.conversa.id);
  assert.equal(blocosVisuais(pedidos[0]).length, midias.MAX_VISUAIS);
  const texto = textoDoPedido(pedidos[0]);
  assert.match(texto, /foto 0 \(você NÃO conseguiu abrir: não abri/);
  assert.match(texto, /foto 2 \(veja o anexo 1 abaixo\)/);
  assert.match(texto, /foto 4 \(veja o anexo 3 abaixo\)/);
});

test('texto da mensagem: mídia da equipe não vira "o lead mandou"; localização e contato usam a descrição', () => {
  assert.equal(textoDaMensagem({ type: 'imagem', from_me: 1 }), '[imagem enviada]');
  assert.equal(textoDaMensagem({ type: 'localizacao', from_me: 0, body: '📍 Rua das Flores' }), '[localização] 📍 Rua das Flores');
  assert.equal(textoDaMensagem({ type: 'audio', from_me: 1, transcricao: 'te mandei a proposta' }), '[áudio enviado] O que foi falado: "te mandei a proposta"');
});
