// Organizador do kanban por IA. O modelo é falso: nada sai da máquina.
import { prepararBanco, limparBanco } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, all, exec } = await import('../src/db.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const cfgMod = await import('../src/modules/organizador/config.js');
const etapas = await import('../src/modules/organizador/etapas.js');
const motor = await import('../src/modules/organizador/motor.js');

const etapa = (papel) => get('SELECT id, name FROM stages WHERE role = ?', [papel]);
const etapaDoLead = (id) => get('SELECT s.name FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [id]).name;

let respostaIa = {};
let chamadas = 0;
definirChamadaFalsa(async () => {
  chamadas++;
  const base = {
    reuniao_agendada: { sim: false }, reuniao_realizada: { sim: false }, proposta_escrita: { sim: false },
    criterios: [{ id: 'qualificado', atende: false }], temperatura: 40, resumo: 'Lead conversando', objecao: 'nenhuma',
  };
  return { texto: JSON.stringify({ ...base, ...respostaIa }), uso: { input_tokens: 4000, output_tokens: 300 } };
});

let seq = 0;
function msg(leadId, texto, { deMim = false, tipo = 'texto', nome = null, mime = null, jid = null, origem = null } = {}) {
  seq++;
  return Number(run(
    `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, media_name, media_mime, timestamp, extra)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadId, jid || `55119${String(leadId).padStart(8, '0')}@s.whatsapp.net`, `O${seq}`, deMim ? 1 : 0, tipo, texto, nome, mime,
      new Date(Date.now() - 1000 + seq).toISOString(), origem ? JSON.stringify({ origem }) : null]
  ).lastInsertRowid);
}

function lead(nome, papel = 'entrada') {
  const st = etapa(papel) || get("SELECT id FROM stages WHERE kind = 'open' ORDER BY position LIMIT 1");
  return Number(run('INSERT INTO leads (name, phone, stage_id) VALUES (?, ?, ?)', [nome, '5511999990000', st.id]).lastInsertRowid);
}

async function preparar(cfg = {}) {
  await limparBanco();
  exec('DELETE FROM organizador_movimentos; DELETE FROM organizador_uso; DELETE FROM ia_conversas;');
  respostaIa = {};
  chamadas = 0;
  motor._zerarTarefa();
  // Liga do zero: a varredura começa a partir das mensagens que já existem
  cfgMod.salvarConfig({ ativo: true, limite_diario_usd: 2, ...cfg }, { maxMsgId: motor.maxMsgId() });
}

test('migração: "No-show" e "Aguardando proposta" entram logo depois de "Reunião agendada" e as etapas ganham papéis', () => {
  const ordem = all("SELECT name, role FROM stages WHERE kind = 'open' ORDER BY position").map((s) => s.name);
  assert.deepEqual(ordem, ['Novo lead', 'Em contato', 'Qualificado', 'Reunião agendada', 'No-show', 'Aguardando proposta', 'Proposta enviada']);
  for (const p of ['entrada', 'contato', 'qualificado', 'reuniao', 'no_show', 'aguardando_proposta', 'proposta']) assert.ok(etapa(p), `sem papel ${p}`);
});

test('nome do PDF: só "Proposta comercial…" conta como proposta', () => {
  assert.ok(etapas.ehPdfDeProposta({ type: 'documento', media_name: 'Proposta Comercial - Arena Prêmios.pdf', media_mime: 'application/pdf' }));
  assert.ok(etapas.ehPdfDeProposta({ type: 'documento', media_name: 'proposta_comercial_vf_premios.pdf', media_mime: null }));
  assert.ok(etapas.ehPdfDeProposta({ type: 'documento', body: '📄 PROPOSTA COMERCIAL Jaqueira.pdf', media_mime: 'application/pdf' }));
  assert.ok(!etapas.ehPdfDeProposta({ type: 'documento', media_name: 'Portfolio Impera.pdf', media_mime: 'application/pdf' }));
  assert.ok(!etapas.ehPdfDeProposta({ type: 'documento', media_name: 'Contrato - proposta comercial.pdf', media_mime: 'application/pdf' }));
  assert.ok(!etapas.ehPdfDeProposta({ type: 'documento', media_name: 'Proposta comercial.docx', media_mime: 'application/msword' }));
});

test('ao ligar, mensagens antigas não são lidas (são do "Organizar tudo")', async () => {
  await limparBanco();
  exec('DELETE FROM organizador_movimentos; DELETE FROM organizador_uso;');
  const id = lead('Antigo');
  msg(id, 'Quero contratar já, aceito o investimento');
  cfgMod.salvarConfig({ ativo: false }, { maxMsgId: 0 });
  cfgMod.salvarConfig({ ativo: true }, { maxMsgId: motor.maxMsgId() });
  chamadas = 0;
  await motor.varrer();
  assert.equal(chamadas, 0);
  assert.equal(etapaDoLead(id), 'Novo lead');
});

test('mensagem enviada por nós → Em contato, sem gastar IA; PDF de proposta → Proposta enviada', async () => {
  await preparar();
  const id = lead('Maria');
  msg(id, 'Oi Maria, tudo bem?', { deMim: true, origem: 'ia' });
  let r = await motor.varrer();
  assert.equal(chamadas, 0, 'mensagem só da IA não chama o modelo');
  assert.equal(etapaDoLead(id), 'Em contato');
  assert.equal(r.movidos, 1);

  msg(id, '📄 Portfolio.pdf', { deMim: true, tipo: 'documento', nome: 'Portfolio.pdf', mime: 'application/pdf' });
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Em contato', 'PDF com outro nome é ignorado');

  msg(id, '📄 Proposta comercial Maria.pdf', { deMim: true, tipo: 'documento', nome: 'Proposta comercial Maria.pdf', mime: 'application/pdf' });
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Proposta enviada');
  const mov = get('SELECT * FROM organizador_movimentos ORDER BY id DESC LIMIT 1');
  assert.equal(mov.origem, 'regra');
  assert.match(mov.motivo, /Proposta comercial/);
});

test('critério "qualificado" leva para Qualificado só com trecho que prova; grava temperatura', async () => {
  await preparar();
  const id = lead('João', 'contato');
  msg(id, 'Gostei, aceito o investimento mínimo. Como começo?');
  respostaIa = { criterios: [{ id: 'qualificado', atende: true, motivo: 'aceitou investimento', trecho: '' }], temperatura: 80 };
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Em contato', 'sem trecho não move');
  assert.equal(get('SELECT ia_temperatura FROM leads WHERE id = ?', [id]).ia_temperatura, 80);

  msg(id, 'Pode mandar o contrato');
  respostaIa = { criterios: [{ id: 'qualificado', atende: true, motivo: 'aceitou investimento', trecho: 'aceito o investimento mínimo' }], temperatura: 85 };
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Qualificado');
  assert.equal(get('SELECT ia_pendente_desde FROM leads WHERE id = ?', [id]).ia_pendente_desde, null);
});

test('reunião combinada fora do Calendly: só vai para Aguardando proposta com link do Meet ou ligação atendida', async () => {
  await preparar();
  const id = lead('Ana', 'qualificado');
  msg(id, 'Combinado, falamos amanhã às 10h pelo Meet');
  respostaIa = {
    reuniao_agendada: { sim: true, trecho: 'falamos amanhã às 10h pelo Meet' },
    reuniao_realizada: { sim: true, trecho: 'como falamos na call' },
  };
  await motor.varrer();
  assert.notEqual(etapaDoLead(id), 'Aguardando proposta', 'a IA sozinha não basta');

  msg(id, 'Segue o link: https://meet.google.com/abc-defg-hij', { deMim: true });
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Aguardando proposta');
});

function chamada(leadId, resultado, { deMim = true, duracao = null } = {}) {
  seq++;
  run(
    `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
     VALUES (NULL, ?, ?, ?, ?, 'chamada', '📞 Chamada', ?, ?)`,
    [leadId, `55119${String(leadId).padStart(8, '0')}@s.whatsapp.net`, `C${seq}`, deMim ? 1 : 0,
      new Date(Date.now() - 1000 + seq).toISOString(), JSON.stringify({ video: false, resultado, duracao })]
  );
}

function reuniaoPassada(id, uri) {
  const inicio = new Date(Date.now() - 3 * 3600000).toISOString();
  const fim = new Date(Date.now() - 2 * 3600000).toISOString();
  run("INSERT INTO calendly_events (uri, lead_id, start_time, end_time, status) VALUES (?, ?, ?, ?, 'active')", [uri, id, inicio, fim]);
}

test('reunião do Calendly encerrada sem link do Meet nem ligação → No-show automático, sem IA', async () => {
  await preparar();
  const id = lead('Carla', 'reuniao');
  reuniaoPassada(id, 'ev1');
  await motor.varrer();
  assert.equal(chamadas, 0);
  assert.equal(etapaDoLead(id), 'No-show');
  const l = get('SELECT noshow_since FROM leads WHERE id = ?', [id]);
  assert.ok(l.noshow_since);
  assert.match(get("SELECT data FROM lead_events WHERE lead_id = ? AND type = 'no_show_on'", [id]).data, /"auto":true/);
  // Varrer de novo não muda nada
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
});

test('ligação NÃO atendida não conta: continua No-show', async () => {
  await preparar();
  const id = lead('Carla', 'reuniao');
  reuniaoPassada(id, 'ev2');
  chamada(id, 'perdida');
  chamada(id, 'recusada', { deMim: false });
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
});

test('ligação atendida no WhatsApp → Aguardando proposta', async () => {
  await preparar();
  const id = lead('Carla', 'reuniao');
  reuniaoPassada(id, 'ev3');
  chamada(id, 'atendida_em_outro_aparelho', { duracao: 1500 });
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Aguardando proposta');
  assert.match(get('SELECT motivo FROM organizador_movimentos WHERE lead_id = ?', [id]).motivo, /Ligação atendida/);
});

test('ligação atendida que chega depois do no-show automático tira do No-show', async () => {
  await preparar();
  const id = lead('Carla', 'reuniao');
  reuniaoPassada(id, 'ev4');
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
  // Ligação longa: só é gravada quando termina, com o horário de início (durante a reunião)
  seq++;
  run(
    `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
     VALUES (NULL, ?, 'x@s.whatsapp.net', ?, 1, 'chamada', '📞', ?, ?)`,
    [id, `C${seq}`, new Date(Date.now() - 2.5 * 3600000).toISOString(), JSON.stringify({ resultado: 'atendida', duracao: 5400 })]
  );
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Aguardando proposta');
});

test('link do Meet ou ligação de antes do agendamento não contam como reunião feita', async () => {
  await preparar();
  const id = lead('Carla', 'contato');
  chamada(id, 'atendida', { duracao: 300 });
  run('UPDATE wa_messages SET timestamp = ? WHERE lead_id = ?', [new Date(Date.now() - 5 * 86400000).toISOString(), id]);
  run('UPDATE leads SET stage_id = ? WHERE id = ?', [etapa('reuniao').id, id]);
  reuniaoPassada(id, 'ev5');
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'No-show');
});

test('ligação atendida sem reunião marcada não leva para Aguardando proposta', async () => {
  await preparar();
  const id = lead('Bruno', 'contato');
  chamada(id, 'atendida', { duracao: 200 });
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Em contato');
});

test('no-show automático não mexe em quem já foi levado adiante à mão', async () => {
  await preparar();
  const id = lead('Carla', 'proposta');
  reuniaoPassada(id, 'ev6');
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Proposta enviada');
  assert.equal(get('SELECT noshow_since FROM leads WHERE id = ?', [id]).noshow_since, null);
});

test('varredura nunca volta etapa e nunca mexe em Fechado/Perdido', async () => {
  await preparar();
  const avancado = lead('Avançado', 'proposta');
  const fechado = Number(run("INSERT INTO leads (name, stage_id) VALUES ('Fechado', (SELECT id FROM stages WHERE kind = 'won'))").lastInsertRowid);
  msg(avancado, 'oi');
  msg(fechado, 'oi');
  respostaIa = { criterios: [{ id: 'qualificado', atende: true, trecho: 'oi' }] };
  await motor.varrer();
  assert.equal(etapaDoLead(avancado), 'Proposta enviada');
  assert.equal(etapaDoLead(fechado), 'Fechado');
  assert.equal(chamadas, 1, 'lead fechado não é lido');
});

test('grupos e conversas sem lead são ignorados', async () => {
  await preparar();
  msg(null, 'mensagem de quem não é lead');
  const id = lead('Grupo');
  msg(id, 'mensagem no grupo', { jid: '1203630@g.us' });
  await motor.varrer();
  assert.equal(chamadas, 0);
});

test('limite diário: para de chamar a IA, mas as regras continuam e o lead fica pendente', async () => {
  await preparar({ limite_diario_usd: 0.05 });
  run("INSERT INTO organizador_uso (modelo, modo, custo_usd) VALUES ('claude-haiku-5-5', 'varredura', 0.06)");
  const id = lead('Pedro');
  msg(id, 'oi, quero saber mais');
  msg(id, 'Oi Pedro!', { deMim: true });
  const r = await motor.varrer();
  assert.equal(chamadas, 0);
  assert.ok(r.limite);
  assert.equal(etapaDoLead(id), 'Em contato');
  assert.ok(get('SELECT ia_pendente_desde FROM leads WHERE id = ?', [id]).ia_pendente_desde);
  // Uso da organização não conta no limite da varredura
  assert.ok(motor.gastoHoje() < 0.07);
});

test('desfazer: lead volta e a IA não leva de novo para a mesma etapa', async () => {
  await preparar();
  const id = lead('Bia', 'contato');
  msg(id, 'aceito');
  respostaIa = { criterios: [{ id: 'qualificado', atende: true, trecho: 'aceito' }] };
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Qualificado');
  const mov = get('SELECT id FROM organizador_movimentos ORDER BY id DESC LIMIT 1').id;
  assert.ok(etapas.desfazerMovimento(mov, null).ok);
  assert.equal(etapaDoLead(id), 'Em contato');
  msg(id, 'aceito mesmo');
  await motor.varrer();
  assert.equal(etapaDoLead(id), 'Em contato');
  assert.match(etapas.desfazerMovimento(mov, null).erro, /já foi desfeita/);
});

test('Organizar tudo: prévia com avanços marcados e voltas desmarcadas; aplicar move só os escolhidos', async () => {
  await preparar();
  const a = lead('Avança', 'entrada');
  msg(a, 'Oi', { deMim: true });
  msg(a, 'quero contratar, aceito o valor');
  const v = lead('Volta', 'proposta');
  msg(v, 'só olhando');
  // "Avança" atende ao critério; "Volta" está em Proposta enviada sem nada que prove isso → a prévia sugere voltar
  definirChamadaFalsa(async (corpo) => {
    chamadas++;
    const qualificado = corpo.messages[0].content.includes('aceito o valor');
    return {
      texto: JSON.stringify({
        reuniao_agendada: { sim: false }, reuniao_realizada: { sim: false }, proposta_escrita: { sim: false },
        criterios: [{ id: 'qualificado', atende: qualificado, trecho: qualificado ? 'aceito o valor' : '' }], temperatura: qualificado ? 75 : 10, resumo: '', objecao: '',
      }),
      uso: { input_tokens: 3000, output_tokens: 200 },
    };
  });
  motor.iniciarOrganizacao({ dias: 30, limiteUsd: 5 });
  for (let i = 0; i < 50 && motor.estadoTarefa().estado === 'analisando'; i++) await new Promise((r) => setTimeout(r, 10));
  const t = motor.estadoTarefa();
  assert.equal(t.estado, 'pronta');
  assert.equal(etapaDoLead(a), 'Novo lead', 'prévia não move ninguém');
  const ia = t.itens.find((i) => i.lead_id === a);
  const iv = t.itens.find((i) => i.lead_id === v);
  assert.equal(ia.para.nome, 'Qualificado');
  assert.equal(ia.marcado, true);
  assert.equal(iv.direcao, 'volta');
  assert.equal(iv.marcado, false);
  assert.ok(t.gasto > 0);

  motor.aplicarOrganizacao();
  assert.equal(etapaDoLead(a), 'Qualificado');
  assert.equal(etapaDoLead(v), 'Proposta enviada', 'volta desmarcada não é aplicada');
  assert.equal(get("SELECT count(*) AS n FROM organizador_movimentos WHERE modo = 'organizar'").n, 1);
  assert.equal(motor.gastoHoje(), 0, 'gasto da organização não conta no limite diário');
});

test('custo: Haiku acima de 100 mil tokens cobra a faixa mais cara', () => {
  const barato = cfgMod.custoDaChamada('claude-haiku-5-5', { input_tokens: 100000, output_tokens: 1000000 });
  assert.equal(Math.round(barato * 1000) / 1000, 0.51);
  const caro = cfgMod.custoDaChamada('claude-haiku-5-5', { input_tokens: 100001, output_tokens: 0 });
  assert.ok(caro > 0.05);
  assert.equal(cfgMod.custoDaChamada('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 12);
});

test('critério personalizado precisa de etapa em andamento', () => {
  const won = get("SELECT id FROM stages WHERE kind = 'won'").id;
  assert.throws(() => cfgMod.salvarConfig({ criterios: [{ id: 'qualificado' }, { titulo: 'Fechou', prompt: 'x', etapa_id: won }] }), /final/);
  const ok = cfgMod.salvarConfig({ criterios: [{ id: 'qualificado' }, { titulo: 'Pediu proposta', prompt: 'Pediu proposta', etapa_id: etapa('aguardando_proposta').id }] });
  assert.equal(ok.criterios.length, 2);
  assert.equal(ok.criterios[0].fixo, true);
});
