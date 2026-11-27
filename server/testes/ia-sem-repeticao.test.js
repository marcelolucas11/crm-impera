// Alice sem repetição: não cumprimenta de novo ("boa tarde") no mesmo dia e não reenvia frases já ditas.
// O modelo e o WhatsApp são falsos: nada sai da máquina.
import { prepararBanco, limparBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const { salvarConfig } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const motor = await import('../src/modules/ia/motor.js');
const protecao = await import('../src/modules/ia/protecao.js');
const rep = await import('../src/modules/ia/repeticao.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { inicio: '00:00', fim: '23:59' }]));
let enviadas = [];
let pedidos = [];
let respostaModelo = null;

motor.definirDependencias({
  esperar: async () => {}, aleatorio: () => 0, digitando: async () => {}, numeroDisponivel: async () => 1, virarLead: async () => ({ leadId: null }),
  enviar: async (numeroId, destino, dados) => {
    enviadas.push(dados.texto);
    run(`INSERT INTO wa_messages (instance_id, chat_jid, wa_id, from_me, type, body, timestamp, extra) VALUES (1, ?, ?, 1, 'texto', ?, ?, ?)`,
      [destino.jid, `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: dados.origem })]);
  },
});
definirChamadaFalsa(async (corpo) => {
  pedidos.push(corpo);
  return { texto: JSON.stringify(respostaModelo), uso: { input_tokens: 10, output_tokens: 5 } };
});

let seq = 0;
function msg(jid, texto, { deMim = false, minutosAtras = 0, origem = null } = {}) {
  seq++;
  run(`INSERT INTO wa_messages (instance_id, chat_jid, wa_id, from_me, type, body, timestamp, extra) VALUES (1, ?, ?, ?, 'texto', ?, ?, ?)`,
    [jid, `R${seq}`, deMim ? 1 : 0, texto, new Date(Date.now() - minutosAtras * 60000).toISOString(), origem ? JSON.stringify({ origem }) : null]);
}

async function preparar() {
  await limparBanco();
  exec('DELETE FROM ia_sugestoes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: true, modo: 'automatico', horario: SEMPRE, espera_agrupar_seg: 3, espera_formulario_min: 0, intervalo_leads_min_seg: 0, intervalo_leads_max_seg: 0 });
  protecao.zerarProtecao();
  enviadas = [];
  pedidos = [];
}

const textoDoPedido = () => {
  const c = pedidos.at(-1).messages[0].content;
  return typeof c === 'string' ? c : c.map((p) => p.text || '').join('\n');
};

test('cumprimento: "boa tarde" sai do começo do balão; balão só de cumprimento some', () => {
  assert.equal(rep.semCumprimento('Boa tarde, João! Entendi, vou te explicar.'), 'Entendi, vou te explicar.');
  assert.equal(rep.semCumprimento('Oi, João, boa tarde! Tudo bem?'), '');
  assert.equal(rep.semCumprimento('Boa tarde de novo, Maria. Sobre o valor, a equipe explica.'), 'Sobre o valor, a equipe explica.');
  assert.equal(rep.semCumprimento('Olá 😊 Que bom que respondeu'), 'Que bom que respondeu');
  assert.equal(rep.semCumprimento('Bom dia João como posso ajudar?', 'João'), 'Como posso ajudar?');
  // Palavras que só começam parecido não são cumprimento
  assert.equal(rep.semCumprimento('Oito anos de experiência é ótimo'), 'Oito anos de experiência é ótimo');
  assert.equal(rep.semCumprimento('Obrigada pela resposta!'), 'Obrigada pela resposta!');
});

test('repetição: tira cumprimento e balões repetidos; nunca deixa a resposta vazia', () => {
  const r = rep.tirarRepeticoes(['Boa tarde, Ana!', 'Fico à disposição para qualquer dúvida que surgir.'], {
    jaCumprimentou: true, anteriores: ['Fico à disposição para qualquer dúvida que surgir.'],
  });
  assert.deepEqual(r.mensagens, ['Fico à disposição para qualquer dúvida que surgir.']);
  // Na mesma resposta, só o 1º balão pode cumprimentar
  assert.deepEqual(rep.tirarRepeticoes(['Boa tarde, Ana!', 'Boa tarde! Você trabalha com rifas?']).mensagens, ['Boa tarde, Ana!', 'Você trabalha com rifas?']);
  assert.deepEqual(rep.tirarRepeticoes(['Me conta: há quanto tempo você está no nicho?'], { anteriores: ['Me conta: há quanto tempo você está no nicho?'] }).mensagens,
    ['Me conta: há quanto tempo você está no nicho?']);
});

test('já cumprimentou hoje: mensagem nossa no mesmo dia ou nas últimas horas', () => {
  const agoraMs = Date.parse('2026-11-27T18:00:00-03:00');
  assert.equal(rep.jaCumprimentouHoje([{ timestamp: '2026-11-27T09:00:00-03:00' }], { agoraMs }), true);
  assert.equal(rep.jaCumprimentouHoje([{ timestamp: '2026-11-26T09:00:00-03:00' }], { agoraMs }), false);
  // 23h50 de ontem e agora 0h20: a conversa continua (não cumprimenta de novo)
  assert.equal(rep.jaCumprimentouHoje([{ timestamp: '2026-11-26T23:50:00-03:00' }], { agoraMs: Date.parse('2026-11-27T00:20:00-03:00') }), true);
});

test('Alice: na 2ª resposta da mesma tarde não diz "boa tarde" de novo nem repete frase', async () => {
  await preparar();
  const jid = '5511911119001@s.whatsapp.net';
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?)', [jid, '5511911119001', 'João Silva']);
  msg(jid, 'Oi, vi o anúncio', { minutosAtras: 10 });
  const c = motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid });
  respostaModelo = { mensagens: ['Boa tarde, João! Aqui é a Alice, da Impera Services.', 'Você já trabalha com rifas?'], acao: 'responder' };
  await motor.processarConversa(c.id);
  assert.equal(enviadas.length, 2);

  msg(jid, 'Sim, há 2 anos');
  run('UPDATE ia_conversas SET proxima_em = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), c.id]);
  respostaModelo = { mensagens: ['Boa tarde, João! Que legal, 2 anos é bastante experiência.', 'Você já trabalha com rifas?'], acao: 'responder' };
  enviadas = [];
  await motor.processarConversa(c.id);
  // O pedido avisa que já houve cumprimento e lista as frases já usadas
  assert.match(textoDoPedido(), /JÁ foi cumprimentado hoje/);
  assert.match(textoDoPedido(), /Você já trabalha com rifas\?/);
  assert.doesNotMatch(textoDoPedido(), /Agora: boa tarde/i);
  // E a rede de segurança tira o "boa tarde" e o balão repetido
  assert.deepEqual(enviadas, ['Que legal, 2 anos é bastante experiência.']);
  assert.ok(get("SELECT 1 AS ok FROM ia_registro WHERE tipo = 'repeticao_cortada'"));
});

test('Alice: saudação automática dos Disparos já cumprimentou — a 1ª mensagem da Alice só se apresenta', async () => {
  await preparar();
  const jid = '5511911119002@s.whatsapp.net';
  run('INSERT INTO wa_contacts (jid, phone, push_name) VALUES (?, ?, ?)', [jid, '5511911119002', 'Maria Souza']);
  msg(jid, 'Boa tarde, Maria! Tudo bem? 😊', { deMim: true, minutosAtras: 30, origem: 'disparo' });
  msg(jid, 'tudo e vc?', { minutosAtras: 5 });
  const c = motor.aoReceberMensagem({ instanciaId: 1, chatJid: jid });
  respostaModelo = { mensagens: ['Boa tarde, Maria! Aqui é a Alice, da Impera Services. Tudo ótimo!', 'Me conta do seu negócio?'], acao: 'responder' };
  await motor.processarConversa(c.id);
  assert.match(textoDoPedido(), /apresente-se sem cumprimentar de novo/);
  assert.deepEqual(enviadas, ['Aqui é a Alice, da Impera Services. Tudo ótimo!', 'Me conta do seu negócio?']);
});
