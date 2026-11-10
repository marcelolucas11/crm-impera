// IA × Yay! Forms × Calendly: a 1ª mensagem espera o lead terminar o formulário e agendar; o estudo dos tempos.
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, exec } = await import('../src/db.js');
const { salvarConfig } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const motor = await import('../src/modules/ia/motor.js');
const protecao = await import('../src/modules/ia/protecao.js');
const { estudarEsperaFormulario, percentil } = await import('../src/modules/ia/estudoFormulario.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { inicio: '00:00', fim: '23:59' }]));
let enviadas = [];
let conferencias = 0;
let aoConferir = null;

motor.definirDependencias({
  esperar: async () => {},
  aleatorio: () => 0,
  digitando: async () => {},
  numeroDisponivel: async () => 1,
  virarLead: async () => ({ leadId: null }),
  conferirCalendly: async () => { conferencias++; if (aoConferir) aoConferir(); },
  enviar: async (numeroId, destino, dados) => {
    enviadas.push({ destino, ...dados });
    run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
         VALUES (1, ?, 'x@s.whatsapp.net', ?, 1, 'texto', ?, ?, ?)`, [destino.leadId || null, `IA${Math.random()}`, dados.texto, new Date().toISOString(), JSON.stringify({ origem: 'ia' })]);
  },
});
definirChamadaFalsa(async () => ({ texto: JSON.stringify({ mensagens: ['Oi!'], acao: 'responder', resumo: 'x' }), uso: { input_tokens: 1, output_tokens: 1 } }));

async function preparar(extra = {}) {
  await limparBanco();
  exec('DELETE FROM ia_sugestoes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances; DELETE FROM calendly_events;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: true, modo: 'automatico', horario: SEMPRE, espera_agrupar_seg: 3, intervalo_leads_min_seg: 0, intervalo_leads_max_seg: 0, espera_formulario_min: 10, atender_ao_agendar: true, ...extra });
  protecao.zerarProtecao();
  enviadas = [];
  conferencias = 0;
  aoConferir = null;
}
const conversa = (id) => get('SELECT * FROM ia_conversas WHERE id = ?', [id]);
const minutosAte = (iso) => (new Date(iso).getTime() - Date.now()) / 60000;
const venceAgora = (id) => run("UPDATE ia_conversas SET proxima_em = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), id]);

test('lead do formulário: a 1ª mensagem espera o tempo configurado, mesmo se outra rotina chamar antes', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Ana', telefone: '5511911112001' });
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  assert.ok(Math.abs(minutosAte(conversa(c.id).espera_formulario_ate) - 10) < 0.1);
  assert.ok(minutosAte(conversa(c.id).proxima_em) >= 9.9);
  // A revisão / travas reavaliadas puxam a hora para agora: o motor segura de novo
  venceAgora(c.id);
  const r = await motor.processarConversa(c.id);
  assert.equal(r.feito, 'aguardando_formulario');
  assert.equal(enviadas.length, 0);
  assert.ok(minutosAte(conversa(c.id).proxima_em) > 9);
});

test('formulário atualizado (parcial → completo): a espera recomeça; acabou a espera, confere o Calendly e envia', async () => {
  await preparar({ espera_formulario_min: 8 });
  const leadId = await criarLeadDireto({ nome: 'Bia', telefone: '5511911112002' });
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  run('UPDATE ia_conversas SET espera_formulario_ate = ? WHERE id = ?', [new Date(Date.now() + 2 * 60000).toISOString(), c.id]);
  motor.aoReceberLeadFormulario({ leadId, novo: false, tipo: 'form_completed' });
  assert.ok(minutosAte(conversa(c.id).espera_formulario_ate) > 7.9);
  // Passou o tempo
  run('UPDATE ia_conversas SET espera_formulario_ate = ?, proxima_em = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), new Date(Date.now() - 1000).toISOString(), c.id]);
  const r = await motor.processarConversa(c.id);
  assert.equal(r.feito, 'enviada');
  assert.equal(conferencias, 1);
});

test('agendou no Calendly durante a espera: a IA chama em 1 a 2 min (ou continua esperando, se desligado)', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Carla', telefone: '5511911112003' });
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  run("INSERT INTO calendly_events (uri, lead_id, event_name, start_time, status, booked_at) VALUES ('u1', ?, 'Reunião', ?, 'active', ?)",
    [leadId, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()]);
  motor.aoAgendarReuniao({ leadId });
  assert.equal(motor.esperandoFormulario(conversa(c.id)), 0);
  assert.ok(minutosAte(conversa(c.id).proxima_em) <= 2);
  venceAgora(c.id);
  const r = await motor.processarConversa(c.id);
  assert.equal(r.feito, 'enviada');
  // Já tinha reunião no CRM: não precisou ir ao Calendly
  assert.equal(conferencias, 0);

  await preparar({ atender_ao_agendar: false });
  const lead2 = await criarLeadDireto({ nome: 'Duda', telefone: '5511911112004' });
  const c2 = motor.aoReceberLeadFormulario({ leadId: lead2, novo: true });
  motor.aoAgendarReuniao({ leadId: lead2 });
  assert.ok(motor.esperandoFormulario(conversa(c2.id)) > Date.now());
});

test('lead escreveu no WhatsApp durante a espera: a IA responde sem esperar o resto', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Eva', telefone: '5511911112005' });
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp)
       VALUES (1, ?, '5511911112005@s.whatsapp.net', 'L1', 0, 'texto', 'oi, tenho uma dúvida', ?)`, [leadId, new Date().toISOString()]);
  venceAgora(c.id);
  const r = await motor.processarConversa(c.id);
  assert.equal(r.feito, 'enviada');
});

test('espera 0: volta ao comportamento antigo (1 a 2 min, sem segurar)', async () => {
  await preparar({ espera_formulario_min: 0 });
  const leadId = await criarLeadDireto({ nome: 'Fê', telefone: '5511911112006' });
  const c = motor.aoReceberLeadFormulario({ leadId, novo: true });
  assert.equal(conversa(c.id).espera_formulario_ate, null);
  assert.ok(minutosAte(conversa(c.id).proxima_em) <= 2);
});

test('resposta parcial sem telefone que depois ganha telefone: a IA entra com a espera', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Gabi', telefone: null });
  assert.equal(motor.aoReceberLeadFormulario({ leadId, novo: true }), null);
  run("UPDATE leads SET phone = '5511911112007' WHERE id = ?", [leadId]);
  const c = motor.aoReceberLeadFormulario({ leadId, novo: false, tipo: 'form_completed' });
  assert.equal(c.status, 'ativa');
  assert.ok(motor.esperandoFormulario(conversa(c.id)) > Date.now());
});

test('estudo: mede 1º aviso → agendou e sugere o p90 + 2 min', async () => {
  await limparBanco();
  exec('DELETE FROM calendly_events;');
  const base = Date.now() - 3 * 86400000;
  const iso = (min) => new Date(base + min * 60000).toISOString();
  // 10 leads que agendaram 1..10 min depois do 1º aviso; reunião no CRM 3 min depois de agendar
  for (let i = 1; i <= 10; i++) {
    const r = run("INSERT INTO leads (name, phone, source, stage_id, created_at, form_started_at) VALUES (?, ?, 'yayforms', (SELECT id FROM stages ORDER BY position LIMIT 1), ?, ?)",
      [`L${i}`, `55119000000${String(i).padStart(2, '0')}`, iso(i * 100), iso(i * 100 - 1)]);
    const id = Number(r.lastInsertRowid);
    run("INSERT INTO lead_events (lead_id, type, data, created_at) VALUES (?, 'form_completed', '{}', ?)", [id, iso(i * 100 + 0.5)]);
    run("INSERT INTO calendly_events (uri, lead_id, event_name, start_time, status, booked_at, created_at) VALUES (?, ?, 'R', ?, 'active', ?, ?)",
      [`e${i}`, id, iso(i * 100 + 1440), iso(i * 100 + i), iso(i * 100 + i + 3)]);
  }
  // Um que agendou no dia seguinte não entra na conta da espera
  const r = run("INSERT INTO leads (name, phone, source, stage_id, created_at) VALUES ('Tarde', '5511900000099', 'yayforms', (SELECT id FROM stages ORDER BY position LIMIT 1), ?)", [iso(2000)]);
  run("INSERT INTO calendly_events (uri, lead_id, event_name, start_time, status, booked_at, created_at) VALUES ('tarde', ?, 'R', ?, 'active', ?, ?)",
    [Number(r.lastInsertRowid), iso(5000), iso(2000 + 600), iso(2000 + 603)]);

  const e = estudarEsperaFormulario({ dias: 30, esperaAtualMin: 5 });
  assert.equal(e.leads_formulario, 11);
  assert.equal(e.agendaram, 11);
  assert.equal(e.agendaram_depois, 1);
  assert.equal(e.medidas.cadastro_ate_agendar.n, 10);
  assert.equal(e.medidas.cadastro_ate_agendar.mediana, 5.5);
  assert.equal(e.medidas.agendar_ate_crm.mediana, 3);
  assert.equal(e.medidas.duracao_formulario.mediana, 1.5);
  assert.equal(e.sugestao_min, Math.ceil(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) + 2));
  assert.equal(e.cobertura_atual, 50);
  assert.equal(e.cobertura_sugestao, 100);
  assert.equal(e.poucos_dados, false);
});
