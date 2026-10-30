// Playbook: análise profunda (modelo de análise, raciocínio, continuação quando corta), melhoria só com conversas novas,
// melhoria automática, versões anteriores e escolha do modelo que responde os leads. O modelo é falso: nada sai da máquina.
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, exec } = await import('../src/db.js');
const config = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa, perguntarModelo } = await import('../src/modules/ia/cliente.js');
const pb = await import('../src/modules/ia/playbook.js');

let pedidos = [];
let respostas = [];
definirChamadaFalsa(async (corpo) => {
  pedidos.push(corpo);
  const r = respostas.shift() || { texto: 'ok' };
  return { texto: r.texto, uso: { input_tokens: 10, output_tokens: 5 }, parada: r.parada || 'end_turn' };
});

let seq = 0;
function msg(leadId, texto, { deMim = false, diasAtras = 0, origem = null } = {}) {
  seq++;
  run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra) VALUES (1, ?, ?, ?, ?, 'texto', ?, ?, ?)`, [
    leadId, `55119${leadId}@s.whatsapp.net`, `P${seq}`, deMim ? 1 : 0, texto, new Date(Date.now() - diasAtras * 86400000).toISOString(), origem ? JSON.stringify({ origem }) : null,
  ]);
}

async function leadComConversa(nome, diasAtras, { ia = false } = {}) {
  const id = await criarLeadDireto({ nome, telefone: `5511900000${++seq}` });
  run("UPDATE leads SET source = 'yayforms' WHERE id = ?", [id]);
  msg(id, `Oi, aqui é o ${nome}, quero saber do tráfego`, { diasAtras });
  msg(id, 'Oi! Tudo bem? Qual é o seu nicho?', { deMim: true, diasAtras, origem: ia ? 'ia' : null });
  msg(id, 'Sorteios, já invisto um pouco', { diasAtras });
  msg(id, 'Show! Bora marcar uma call rápida?', { deMim: true, diasAtras, origem: ia ? 'ia' : null });
  msg(id, 'Mensagem automática da saudação', { deMim: true, diasAtras, origem: 'disparo' });
  return id;
}

async function preparar() {
  await limparBanco();
  exec('DELETE FROM ia_registro; DELETE FROM wa_instances;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  pb._paraTeste.reiniciar();
  pedidos = [];
  respostas = [];
}

const esperarTarefa = async () => {
  for (let i = 0; i < 100 && pb.estadoTarefa().status === 'rodando'; i++) await new Promise((r) => setTimeout(r, 5));
  return pb.estadoTarefa();
};

test('análise profunda: usa o modelo de análise com raciocínio, anonimiza e ignora disparos', async () => {
  await preparar();
  for (const n of ['Joaquim', 'Severino', 'Clodoaldo']) await leadComConversa(n, 5);
  config.salvarConfig({ modelo_playbook: 'claude-fable-5-1' });
  respostas = [{ texto: '## Tom e estilo\n- Mensagens curtas' }];
  const r = await pb.gerarPlaybook();
  assert.equal(r.conversas_analisadas, 3);
  assert.equal(r.completo, true);
  assert.equal(pedidos[0].model, 'claude-fable-5-1');
  assert.deepEqual(pedidos[0].thinking, { type: 'adaptive' });
  const texto = pedidos[0].messages[0].content;
  assert.ok(!texto.includes('Joaquim') && texto.includes('[nome]'), 'nomes anonimizados');
  assert.ok(!texto.includes('saudação'), 'mensagens dos disparos ficam de fora');
  assert.ok(r.lido_ate, 'devolve até quando leu');
});

test('resposta cortada pelo limite: pede para continuar e junta as partes (o playbook não termina pela metade)', async () => {
  await preparar();
  for (const n of ['Joaquim', 'Severino', 'Clodoaldo']) await leadComConversa(n, 5);
  respostas = [{ texto: '## Tom\n- Curto\n- **Dú', parada: 'max_tokens' }, { texto: 'vidas:** responda com calma' }];
  const r = await pb.gerarPlaybook();
  assert.equal(pedidos.length, 2);
  assert.match(pedidos[1].messages.at(-1).content, /Continue exatamente de onde parou/);
  assert.match(r.playbook, /Dú\nvidas:\*\* responda com calma/);
});

test('melhoria: lê só conversas com mensagens novas desde a última leitura (equipe e IA) e devolve o que mudou', async () => {
  await preparar();
  await leadComConversa('Antigo', 20);
  const lidoAte = new Date(Date.now() - 10 * 86400000).toISOString();
  config.salvarConfig({ playbook: '## Tom\n- Curto', playbook_lido_ate: lidoAte });
  await leadComConversa('Novato', 2, { ia: true });
  respostas = [{ texto: '## Tom\n- Curto\n## Objeções\n- Nova objeção\n===MUDANCAS===\n- Incluí a objeção sobre investimento' }];
  const r = await pb.melhorarPlaybook();
  assert.equal(r.conversas_analisadas, 1);
  assert.equal(r.contagem.ia, 1);
  assert.match(pedidos[0].messages[0].content, /## Playbook atual\n## Tom/);
  assert.match(pedidos[0].messages[0].content, /IA: Oi! Tudo bem\?/);
  assert.ok(!r.playbook.includes('===MUDANCAS==='));
  assert.deepEqual(r.mudancas, ['Incluí a objeção sobre investimento']);
});

test('melhoria sem conversas novas avisa; sem playbook pede a análise profunda primeiro', async () => {
  await preparar();
  await assert.rejects(pb.melhorarPlaybook(), /análise profunda/);
  config.salvarConfig({ playbook: '## Tom', playbook_lido_ate: new Date().toISOString() });
  await assert.rejects(pb.melhorarPlaybook(), /Nenhuma conversa nova/);
});

test('melhoria automática: roda depois de N dias, aplica sozinha e guarda a versão anterior', async () => {
  await preparar();
  config.salvarConfig({ playbook: 'versão 1', playbook_auto: true, playbook_auto_dias: 7, playbook_lido_ate: new Date(Date.now() - 8 * 86400000).toISOString() });
  await leadComConversa('Novato', 1);
  respostas = [{ texto: 'versão 2\n===MUDANCAS===\n- ajuste' }];
  assert.equal(pb.verificarMelhoriaAutomatica(), true);
  const t = await esperarTarefa();
  assert.equal(t.status, 'concluida');
  assert.equal(t.resultado.aplicado, true);
  const cfg = config.lerConfig();
  assert.equal(cfg.playbook, 'versão 2');
  assert.equal(cfg.playbook_origem, 'automatica');
  assert.equal(config.versaoDoPlaybook(0).texto, 'versão 1');
  assert.ok(Date.parse(cfg.playbook_lido_ate) > Date.now() - 2 * 86400000, 'marca até onde leu');
  // Acabou de ler: não roda de novo
  assert.equal(pb.verificarMelhoriaAutomatica(), false);
});

test('tarefa em segundo plano: uma por vez', async () => {
  await preparar();
  for (const n of ['Joaquim', 'Severino', 'Clodoaldo']) await leadComConversa(n, 5);
  respostas = [{ texto: 'playbook' }];
  pb.iniciarTarefa('gerar');
  assert.throws(() => pb.iniciarTarefa('melhorar'), /em andamento/);
  const t = await esperarTarefa();
  assert.equal(t.status, 'concluida');
  assert.equal(t.resultado.playbook, 'playbook');
});

test('modelo que responde os leads: o escolhido na tela; modelo desconhecido é recusado', async () => {
  await preparar();
  config.salvarConfig({ modelo_atendimento: 'claude-sonnet-5-5' });
  await perguntarModelo({ sistema: 'x', mensagens: [{ role: 'user', content: 'oi' }] });
  assert.equal(pedidos.at(-1).model, 'claude-sonnet-5-5');
  assert.equal(pedidos.at(-1).thinking, undefined);
  assert.equal(config.configPublica().modelo_nome, 'Claude Sonnet 5.5');
  assert.throws(() => config.salvarConfig({ modelo_atendimento: 'gpt-qualquer' }), /Modelo desconhecido/);
  config.salvarConfig({ modelo_atendimento: 'claude-haiku-5-5' });
});
