// Diretrizes da IA: criar, editar (com histórico de versões), limites, e se chegam ao prompt junto com o formulário do lead.
// O modelo e o WhatsApp são falsos: nada sai da máquina.
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const { salvarConfig } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const { textoDoSistema, montarPedido } = await import('../src/modules/ia/prompt.js');
const d = await import('../src/modules/ia/diretrizes.js');
const { dadosDoFormulario } = await import('../src/modules/ia/formulario.js');
const motor = await import('../src/modules/ia/motor.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((x) => [x, { inicio: '00:00', fim: '23:59' }]));
let ultimoCorpo = null;
motor.definirDependencias({
  esperar: async () => {}, aleatorio: () => 0, digitando: async () => {}, numeroDisponivel: async () => 1,
  virarLead: async () => ({ leadId: null }),
  enviar: async (numeroId, destino, dados) => {
    run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
         VALUES (1, ?, 'x@s.whatsapp.net', ?, 1, 'texto', ?, ?, ?)`, [destino.leadId || null, `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: dados.origem })]);
  },
});
definirChamadaFalsa(async (corpo) => {
  ultimoCorpo = corpo;
  return { texto: JSON.stringify({ mensagens: ['Oi!'], acao: 'responder', resumo: 'ok' }), uso: { input_tokens: 10, output_tokens: 5 } };
});

function limparDiretrizes() {
  exec('DELETE FROM ia_diretrizes_versoes; DELETE FROM ia_diretrizes;');
}

test('cria, edita e guarda a versão anterior; restaurar não perde nada', () => {
  limparDiretrizes();
  const nova = d.criarDiretriz({ titulo: '  SDR  ', conteudo: 'Versão 1\r\ncom linha', arquivo: '/Users/x/sdr.md' }, null);
  assert.equal(nova.titulo, 'SDR');
  assert.equal(nova.conteudo, 'Versão 1\ncom linha');
  assert.equal(nova.arquivo, 'sdr.md');
  assert.equal(nova.ativa, true);

  d.atualizarDiretriz(nova.id, { conteudo: 'Versão 2' });
  d.atualizarDiretriz(nova.id, { ativa: false }); // só liga/desliga: não cria versão
  const versoes = d.versoesDaDiretriz(nova.id);
  assert.equal(versoes.length, 1);
  assert.equal(versoes[0].conteudo, 'Versão 1\ncom linha');

  const restaurada = d.restaurarVersao(nova.id, versoes[0].id);
  assert.equal(restaurada.conteudo, 'Versão 1\ncom linha');
  assert.equal(restaurada.ativa, false);
  assert.deepEqual(d.versoesDaDiretriz(nova.id).map((v) => v.conteudo), ['Versão 2', 'Versão 1\ncom linha']);
});

test('só as ativas e com texto entram no prompt, na ordem definida, abaixo do estilo e antes das regras', () => {
  limparDiretrizes();
  const a = d.criarDiretriz({ titulo: 'Primeira', conteudo: 'Texto A' });
  const b = d.criarDiretriz({ titulo: 'Segunda', conteudo: 'Texto B' });
  d.criarDiretriz({ titulo: 'Desligada', conteudo: 'Texto C', ativa: false });
  d.criarDiretriz({ titulo: 'Vazia', conteudo: '   ' });
  d.ordenarDiretrizes([b.id, a.id]);
  const ativas = d.diretrizesAtivas();
  assert.deepEqual(ativas.map((x) => x.titulo), ['Segunda', 'Primeira']);

  const sistema = textoDoSistema({ empresa: 'Impera', nome_atendente: 'Marcelo', sobre_empresa: 'x', apresentacao: 'y', aviso_fora_horario: 'z' }, ativas);
  assert.ok(sistema.includes('## Diretrizes da equipe'));
  assert.ok(sistema.indexOf('### Segunda') < sistema.indexOf('### Primeira'));
  assert.ok(sistema.indexOf('## Diretrizes da equipe') < sistema.indexOf('## Regras obrigatórias'));
  assert.ok(!sistema.includes('Texto C'));
  // Sem diretrizes, o prompt continua como antes
  assert.ok(!textoDoSistema({ empresa: 'I', nome_atendente: 'M' }, []).includes('Diretrizes da equipe'));
});

test('limites: título obrigatório, tamanho por diretriz e soma das ativas', () => {
  limparDiretrizes();
  assert.throws(() => d.criarDiretriz({ titulo: ' ', conteudo: 'x' }), /título/);
  assert.throws(() => d.criarDiretriz({ titulo: 'Grande', conteudo: 'x'.repeat(d.LIMITES.conteudo + 5000) }), /grande demais/);
  d.criarDiretriz({ titulo: 'A', conteudo: 'x'.repeat(d.LIMITES.conteudo) });
  d.criarDiretriz({ titulo: 'C', conteudo: 'x'.repeat(d.LIMITES.totalAtivas - d.LIMITES.conteudo) }); // soma = limite exato: ok
  const b = d.criarDiretriz({ titulo: 'B', conteudo: 'x'.repeat(d.LIMITES.conteudo), ativa: false });
  assert.throws(() => d.atualizarDiretriz(b.id, { ativa: true }), /passariam/);
  assert.throws(() => d.criarDiretriz({ titulo: 'D', conteudo: 'z' }), /passariam/);
  // Desativada pode ser grande à vontade (dentro do limite por diretriz)
  assert.equal(d.atualizarDiretriz(b.id, { conteudo: 'y'.repeat(100) }).caracteres, 100);
});

test('formulário: situação, reunião e respostas sem telefone/e-mail vão para o pedido como dados', async () => {
  await limparBanco();
  const leadId = await criarLeadDireto({ nome: 'Carla', telefone: '5511922223333' });
  run("UPDATE leads SET source = 'yayforms', extra = ? WHERE id = ?", [JSON.stringify({
    parcial: false,
    respostas: [
      { titulo: 'Aceita o investimento mínimo em Meta Ads?', tipo: 'multiple_choice', valor: 'Sim' },
      { titulo: 'Quando quer começar?', tipo: 'multiple_choice', valor: 'Imediato' },
      { titulo: 'WhatsApp', tipo: 'phone_number', valor: '+55 11 92222-3333' },
      { titulo: 'E-mail', tipo: 'short_text', valor: 'carla@exemplo.com' },
    ],
  }), leadId]);
  const cfg = { fuso: 'America/Sao_Paulo' };
  let f = dadosDoFormulario(leadId, cfg);
  assert.equal(f.situacao, 'completo_sem_reuniao');
  assert.deepEqual(f.respostas.map((r) => r.valor), ['Sim', 'Imediato']);

  const amanha = new Date(Date.now() + 86400000).toISOString();
  run("INSERT INTO calendly_events (uri, lead_id, start_time, status) VALUES ('u1', ?, ?, 'active')", [leadId, amanha]);
  f = dadosDoFormulario(leadId, cfg);
  assert.equal(f.situacao, 'completo_com_reuniao');
  assert.ok(f.reuniao.includes('às'));

  const [pedido] = montarPedido({ cfg: {}, lead: {}, historico: [], foraDoHorario: false, saudacao: 'Bom dia', primeiroContato: true, origem: 'yayforms', formulario: f });
  assert.ok(pedido.content.includes('<formulario>'));
  assert.ok(pedido.content.includes('COMPLETO COM REUNIÃO'));
  assert.ok(pedido.content.includes('Quando quer começar?: Imediato'));
  assert.ok(!pedido.content.includes('carla@exemplo.com'));

  run("UPDATE leads SET extra = json_set(extra, '$.parcial', json('true')) WHERE id = ?", [leadId]);
  assert.equal(dadosDoFormulario(leadId, cfg).situacao, 'parcial');
  // Lead que não veio de formulário: nada
  const outro = await criarLeadDireto({ nome: 'Davi', telefone: '5511933334444' });
  assert.equal(dadosDoFormulario(outro, cfg), null);
});

test('na conversa real, o motor manda as diretrizes ativas e o formulário do lead ao modelo', async () => {
  await limparBanco();
  limparDiretrizes();
  exec('DELETE FROM ia_sugestoes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances; DELETE FROM calendly_events;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: true, modo: 'automatico', horario: SEMPRE, espera_agrupar_seg: 3 });
  d.criarDiretriz({ titulo: 'SDR', conteudo: 'Se o lead tiver contrato em aberto, pergunte quando termina.' });

  const leadId = await criarLeadDireto({ nome: 'Elisa', telefone: '5511944445555' });
  run("UPDATE leads SET source = 'yayforms', extra = ? WHERE id = ?", [JSON.stringify({ parcial: true, respostas: [{ titulo: 'Tem contrato em aberto?', valor: 'Sim' }] }), leadId]);
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  const r = await motor.processarConversa(c.id);
  assert.equal(r.feito, 'enviada');
  assert.ok(ultimoCorpo.system[0].text.includes('Se o lead tiver contrato em aberto'));
  assert.ok(ultimoCorpo.messages[0].content.includes('PARCIAL'));
  assert.ok(ultimoCorpo.messages[0].content.includes('Tem contrato em aberto?: Sim'));
  assert.equal(get('SELECT status FROM ia_conversas WHERE id = ?', [c.id]).status, 'ativa');
});
