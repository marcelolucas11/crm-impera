// Nomes do Yay! Forms: leads e histórico ANTIGOS ganham o nome do formulário e o texto das perguntas ao ligar o CRM,
// sem esperar resposta nova. A API do Yay! Forms é simulada (nada sai para a internet).
import { prepararBanco, limparBanco } from './ajuda.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const db = await prepararBanco();
const cat = await import('../src/modules/yayforms/catalogo.js');
const { buscarLead } = await import('../src/modules/leads/service.js');
const { interpretarPayload } = await import('../src/modules/yayforms/parser.js');
const { calcularEstatisticas } = await import('../src/modules/estatisticas/index.js');

const FORM_A = '67a51798016b5003c40aac00'; // criado em 06/02/2025
const FORM_B = '6a3063b932779c95d0aa1111'; // criado em 15/06/2026
const FORM_APAGADO = '6791851a3fbd46d81108aaaa';
const P1 = '67a5179a016b5003c40aac29';
const P2 = '67a5179a016b5003c40aac26';
const P3 = '67aab36fdad9e2cd2f07f345';
const TOKEN = 'yay_tok_1234567890abcdefXYZ9';

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

let chamadas = [];
function simularApi(rotas) {
  chamadas = [];
  globalThis.fetch = async (url, op) => {
    const caminho = new URL(url).pathname + new URL(url).search;
    chamadas.push({ caminho, auth: op?.headers?.Authorization });
    const r = rotas[caminho] ?? rotas[new URL(url).pathname];
    if (r === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
}

function etapa() {
  return db.get('SELECT id FROM stages ORDER BY position LIMIT 1').id;
}
function leadAntigo({ nome, formId, respostas, formulario = null }) {
  const extra = { formulario, form_id: formId, respostas, utm: {} };
  const id = Number(db.run("INSERT INTO leads (name, phone, source, stage_id, extra) VALUES (?, ?, 'yayforms', ?, ?)",
    [nome, `55119${Math.floor(Math.random() * 1e8)}`, etapa(), JSON.stringify(extra)]).lastInsertRowid);
  db.run("INSERT INTO lead_events (lead_id, type, data) VALUES (?, 'form_submitted', ?)", [id, JSON.stringify(extra)]);
  return id;
}
function webhookGuardado(body) {
  db.run("INSERT INTO webhook_events (source, payload, status) VALUES ('yayforms', ?, 'processed')", [JSON.stringify(body)]);
}

beforeEach(async () => {
  await limparBanco();
  db.run('DELETE FROM webhook_events');
  cat.esquecerCache();
  globalThis.fetch = async () => { throw new Error('sem rede nos testes'); };
});

test('sem token: perguntas antigas que estavam só com código ganham o texto visto em outro webhook guardado', () => {
  const id = leadAntigo({ nome: 'Antigo', formId: FORM_A, respostas: [{ id: P1, pergunta: P1, resposta: 'Sim' }, { id: P2, pergunta: 'Qual seu site?', resposta: 'x.com' }] });
  webhookGuardado({ response: { formId: FORM_A, answers: { [P1]: { fieldTitle: 'E sabe como funciona o <b>Tráfego Pago</b>?', content: 'Sim' } } } });

  cat.aprenderDosPayloads();
  const r = cat.aplicarNomes();
  assert.equal(r.leads, 1);
  assert.equal(r.eventos, 1, 'o histórico antigo também é corrigido');

  const lead = buscarLead(id);
  assert.deepEqual(lead.respostas.map((x) => x.pergunta), ['E sabe como funciona o Tráfego Pago?', 'Qual seu site?']);
  const ev = JSON.parse(db.get('SELECT data FROM lead_events WHERE lead_id = ?', [id]).data);
  assert.equal(ev.respostas[0].pergunta, 'E sabe como funciona o Tráfego Pago?');
  assert.equal(cat.aplicarNomes().leads, 0, 'rodar de novo não regrava nada');
});

test('sem nome em lugar nenhum: nunca mostra o código, mostra rótulo com a data de criação', () => {
  const id = leadAntigo({ nome: 'Sem nome', formId: FORM_B, respostas: [{ id: P3, pergunta: P3, resposta: 'Ok' }] });
  const lead = buscarLead(id);
  assert.equal(lead.form_name, 'Formulário sem nome (criado em 15/06/2026)');
  assert.equal(lead.extra.formulario, 'Formulário sem nome (criado em 15/06/2026)');
  assert.match(lead.respostas[0].pergunta, /^Pergunta sem título \(…7f345\)$/);
  assert.ok(!JSON.stringify(lead.respostas).includes(`"pergunta":"${P3}"`));
});

test('com token: busca nomes na API e aplica em todos os leads e no histórico já gravados', async () => {
  const a = leadAntigo({ nome: 'A', formId: FORM_A, respostas: [{ id: P1, pergunta: P1, resposta: 'Sim' }, { id: P2, pergunta: P2, resposta: 'Não' }] });
  const b = leadAntigo({ nome: 'B', formId: FORM_B, respostas: [{ id: P3, pergunta: P3, resposta: 'Rifa' }] });
  const c = leadAntigo({ nome: 'C', formId: FORM_APAGADO, respostas: [] });
  simularApi({
    '/workspaces?limit=1': { data: [{ id: 'w1' }] },
    [`/forms/${FORM_A}`]: { data: { id: FORM_A, title: 'Qualificação Impera' } },
    [`/forms/${FORM_A}/fields`]: { data: [{ id: P1, title: '<p>E sabe como funciona o Tráfego Pago?</p>', plainTitle: 'E sabe como funciona o Tráfego Pago?' }, { id: 'grupo', title: 'Grupo', fields: [{ id: P2, title: 'Você já possui um site?' }] }] },
    [`/forms/${FORM_B}`]: { data: { id: FORM_B, title: 'Rifas &amp; Sorteios — Junho' } },
    [`/forms/${FORM_B}/fields`]: { data: [{ id: P3, plainTitle: 'Qual nicho você escolheu?' }] },
  });

  await cat.conectarComToken(`  Bearer ${TOKEN}\n`);
  assert.equal(chamadas[0].auth, `Bearer ${TOKEN}`, 'limpa espaços e o prefixo Bearer');
  const resumo = await cat.sincronizar({ forcar: true });
  assert.equal(resumo.formularios, 2);
  assert.equal(resumo.apagados, 1);
  cat.aplicarNomes();

  assert.equal(buscarLead(a).form_name, 'Qualificação Impera');
  assert.deepEqual(buscarLead(a).respostas.map((x) => x.pergunta), ['E sabe como funciona o Tráfego Pago?', 'Você já possui um site?']);
  assert.equal(buscarLead(b).form_name, 'Rifas & Sorteios — Junho');
  assert.equal(buscarLead(b).respostas[0].pergunta, 'Qual nicho você escolheu?');
  assert.equal(buscarLead(c).form_name, 'Formulário apagado no Yay! Forms (criado em 22/01/2025)');

  // O nome fica gravado no lead e no histórico (a IA e a busca leem do banco)
  assert.equal(JSON.parse(db.get('SELECT extra FROM leads WHERE id = ?', [a]).extra).formulario, 'Qualificação Impera');
  assert.equal(JSON.parse(db.get('SELECT data FROM lead_events WHERE lead_id = ?', [b]).data).formulario, 'Rifas & Sorteios — Junho');

  // Estatísticas: ranking por nome
  const nomes = calcularEstatisticas({ dias: 7 }).por_formulario.map((f) => f.formulario).sort();
  assert.deepEqual(nomes, ['Formulário apagado no Yay! Forms (criado em 22/01/2025)', 'Qualificação Impera', 'Rifas & Sorteios — Junho']);

  const status = cat.montarStatus();
  assert.equal(status.configurado, true);
  assert.equal(status.token_final, `••••${TOKEN.slice(-4)}`);
  assert.ok(!JSON.stringify(status).includes(TOKEN.slice(0, 12)), 'o token inteiro nunca vai para a tela');
});

test('nome dado à mão no CRM vale mais que o do Yay! Forms', async () => {
  const a = leadAntigo({ nome: 'A', formId: FORM_A, respostas: [] });
  simularApi({ '/workspaces?limit=1': { data: [] }, [`/forms/${FORM_A}`]: { data: { title: 'Nome no Yay' } }, [`/forms/${FORM_A}/fields`]: { data: [] } });
  await cat.conectarComToken(TOKEN);
  await cat.sincronizar({ forcar: true });
  const { salvarEstado } = await import('../src/estado.js');
  salvarEstado('yayforms', { nomes: { [FORM_A]: 'Meu nome' } });
  cat.esquecerCache();
  cat.aplicarNomes();
  assert.equal(buscarLead(a).form_name, 'Meu nome');
  assert.equal(cat.infoFormulario(FORM_A).nome_yay, 'Nome no Yay');
});

test('token recusado não é guardado; texto que não parece token nem chama o Yay! Forms', async () => {
  simularApi({ '/workspaces?limit=1': 401 });
  await assert.rejects(() => cat.conectarComToken(TOKEN), /recusou/);
  assert.equal(cat.tokenYay(), '');
  let chamou = false;
  globalThis.fetch = async () => { chamou = true; return { ok: true, status: 200, json: async () => ({}) }; };
  await assert.rejects(() => cat.conectarComToken('"curto"'), /não parece um token/);
  assert.equal(chamou, false);
});

test('token que passa a ser recusado: para a busca, guarda o erro e não marca formulário como apagado', async () => {
  leadAntigo({ nome: 'A', formId: FORM_A, respostas: [] });
  simularApi({ '/workspaces?limit=1': { data: [] } });
  await cat.conectarComToken(TOKEN);
  simularApi({ [`/forms/${FORM_A}`]: 401 });
  await cat.sincronizar({ forcar: true });
  assert.match(cat.montarStatus().ultimo_erro, /recusou/);
  assert.equal(cat.infoFormulario(FORM_A).removido, false);
});

test('webhook novo: o parser usa o texto da pergunta já conhecido quando o payload não traz o título', () => {
  const dados = interpretarPayload(
    { response: { id: 'r1', formId: FORM_A, answers: { [P1]: { content: 'Sim' }, [P2]: { fieldTitle: 'Qual seu site?', content: 'x.com' } } } },
    { titulosPerguntas: { [P1]: 'E sabe como funciona o Tráfego Pago?' }, nomesFormularios: { [FORM_A]: 'Qualificação Impera' } }
  );
  assert.equal(dados.formulario, 'Qualificação Impera');
  assert.deepEqual(dados.respostas.map((r) => r.pergunta), ['E sabe como funciona o Tráfego Pago?', 'Qual seu site?']);
});

test('webhook que traz o texto de uma pergunta corrige na hora os leads antigos que só tinham o código', () => {
  const id = leadAntigo({ nome: 'Antigo', formId: FORM_A, respostas: [{ id: P2, pergunta: P2, resposta: 'Não' }] });
  cat.conhecerFormulario({ response: { formId: FORM_A, answers: { [P2]: { fieldTitle: 'Você já possui um site?', content: 'Sim' } } } });
  assert.equal(buscarLead(id).respostas[0].pergunta, 'Você já possui um site?');
});
