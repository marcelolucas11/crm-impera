// Atendente virtual: nome e gênero (Alice, feminino por padrão) e intervalo de 2 s entre balões.
// O modelo e o WhatsApp são falsos: nada sai da máquina.
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, exec } = await import('../src/db.js');
const { salvarConfig, lerConfig, respostasProntas, PADRAO } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const { textoDoSistema } = await import('../src/modules/ia/prompt.js');
const motor = await import('../src/modules/ia/motor.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((x) => [x, { inicio: '00:00', fim: '23:59' }]));
let linhaDoTempo = [];
let corpo = null;
motor.definirDependencias({
  esperar: async (ms) => { linhaDoTempo.push(`esperar:${ms}`); },
  aleatorio: () => 0,
  digitando: async () => { linhaDoTempo.push('digitando'); },
  numeroDisponivel: async () => 1,
  virarLead: async () => ({ leadId: null }),
  enviar: async (numeroId, destino, dados) => {
    linhaDoTempo.push(`enviar:${dados.texto}`);
    run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
         VALUES (1, ?, '5511955556666@s.whatsapp.net', ?, 1, 'texto', ?, ?, ?)`, [destino.leadId || null, `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: dados.origem })]);
  },
});
definirChamadaFalsa(async (c) => {
  corpo = c;
  return { texto: JSON.stringify({ mensagens: ['Oi, Bruna! Aqui é a Alice, da Impera Services.', 'Você já anuncia na Meta hoje?'], acao: 'responder', resumo: 'ok' }), uso: {} };
});

async function preparar(extra = {}) {
  await limparBanco();
  exec('DELETE FROM ia_sugestoes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: true, modo: 'automatico', horario: SEMPRE, espera_agrupar_seg: 3, ...extra });
  linhaDoTempo = [];
}

test('padrão: Alice, feminino, e o prompt manda falar no feminino e passar para a equipe', () => {
  assert.equal(PADRAO.nome_atendente, 'Alice');
  assert.equal(PADRAO.genero_atendente, 'feminino');
  const s = textoDoSistema({ ...PADRAO }, []);
  assert.match(s, /Você é a Alice, atendente da Impera Services/);
  assert.match(s, /FEMININO/);
  assert.match(s, /"obrigada"/);
  assert.match(s, /a assistente virtual do atendimento/);
  assert.ok(!s.includes('chamá-lo'));
  const m = textoDoSistema({ ...PADRAO, nome_atendente: 'Pedro', genero_atendente: 'masculino' }, []);
  assert.match(m, /Você é o Pedro/);
  assert.match(m, /"obrigado"/);
});

test('respostas prontas não falam "ele"/"o Marcelo": passam para a equipe', () => {
  for (const t of Object.values(respostasProntas(PADRAO))) {
    assert.ok(!/\bele\b|\bo Marcelo\b|\bchamá-lo\b/i.test(t), t);
  }
});

test('gênero salvo e validado na configuração', async () => {
  await preparar({ genero_atendente: 'masculino' });
  assert.equal(lerConfig().genero_atendente, 'masculino');
  salvarConfig({ genero_atendente: 'qualquer' });
  assert.equal(lerConfig().genero_atendente, 'feminino');
});

test('dois balões: o segundo sai 2 s depois do primeiro, com "digitando…" no intervalo', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Bruna', telefone: '5511955556666' });
  run("INSERT INTO wa_contacts (jid, phone, lead_id) VALUES ('5511955556666@s.whatsapp.net', '5511955556666', ?)", [leadId]);
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  linhaDoTempo = [];
  const r = await motor.processarConversa(c.id);
  assert.equal(r.feito, 'enviada');
  const i1 = linhaDoTempo.indexOf('enviar:Oi, Bruna! Aqui é a Alice, da Impera Services.');
  const i2 = linhaDoTempo.indexOf('enviar:Você já anuncia na Meta hoje?');
  assert.ok(i1 >= 0 && i2 > i1, linhaDoTempo.join(' | '));
  assert.deepEqual(linhaDoTempo.slice(i1 + 1, i2), ['digitando', 'esperar:2000']);
  assert.match(corpo.system[0].text, /Você é a Alice/);
});

test('intervalo ajustável; no copiloto (aprovação) os balões também saem espaçados', async () => {
  await preparar({ modo: 'sugestao', automatico_fora_horario: false, intervalo_blocos_seg: 3 });
  const leadId = await criarLeadDireto({ nome: 'Bruna', telefone: '5511955556666' });
  run("INSERT INTO wa_contacts (jid, phone, lead_id) VALUES ('5511955556666@s.whatsapp.net', '5511955556666', ?)", [leadId]);
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  await motor.processarConversa(c.id);
  const sugestao = (await import('../src/db.js')).get("SELECT id FROM ia_sugestoes WHERE status = 'pendente'");
  linhaDoTempo = [];
  await motor.aprovarSugestao(sugestao.id, { userId: null });
  const envios = linhaDoTempo.filter((x) => x.startsWith('enviar:'));
  assert.equal(envios.length, 2);
  const i1 = linhaDoTempo.indexOf(envios[0]);
  assert.deepEqual(linhaDoTempo.slice(i1 + 1, linhaDoTempo.indexOf(envios[1])), ['digitando', 'esperar:3000']);
});
