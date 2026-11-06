// Agente Alice: laço de ferramentas, segurança dos dados, ações com aprovação, tetos, agendados, canal do WhatsApp,
// transcrição e leitura de documentos. O modelo é falso: nada sai da máquina.
import { prepararBanco, limparBanco, PASTA } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, all, exec } = await import('../src/db.js');
const { definirChamadaFalsaAgente } = await import('../src/modules/agente/cliente.js');
const config = await import('../src/modules/agente/config.js');
const motor = await import('../src/modules/agente/motor.js');
const acoes = await import('../src/modules/agente/acoes.js');
const ferramentas = await import('../src/modules/agente/ferramentas.js');
const agendados = await import('../src/modules/agente/agendados.js');
const transcricao = await import('../src/modules/agente/transcricao.js');
const documentos = await import('../src/modules/agente/documentos.js');
const whatsapp = await import('../src/modules/agente/whatsapp.js');
const contexto = await import('../src/modules/agente/contexto.js');
const dir = await import('../src/modules/agente/diretrizes.js');
const dados = await import('../src/modules/agente/dados.js');
const canal = await import('../src/modules/agente/canal.js');
const iaMotor = await import('../src/modules/ia/motor.js');
const { salvarConfig: salvarConfigIa } = await import('../src/modules/ia/config.js');

// ------------------------------------------------------------------ preparo

let roteiro = []; // respostas do modelo falso, em ordem
let pedidos = []; // corpos enviados ao modelo
definirChamadaFalsaAgente(async (corpo) => {
  pedidos.push(JSON.parse(JSON.stringify(corpo)));
  const proxima = roteiro.shift();
  if (typeof proxima === 'function') return proxima(corpo);
  return proxima || { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1000, output_tokens: 100 }, stop_reason: 'end_turn' };
});
const texto = (t, uso = { input_tokens: 2000, output_tokens: 200 }) => ({ content: [{ type: 'text', text: t }], usage: uso, stop_reason: 'end_turn' });
const ferramenta = (name, input, id = `tu_${Math.random().toString(36).slice(2)}`) => ({
  content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 3000, output_tokens: 50 }, stop_reason: 'tool_use',
});

function usuario(nome = 'Marcelo', papel = 'admin') {
  return Number(run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [nome, `${nome.toLowerCase()}@x.com`, 'HASH-SECRETO', papel]).lastInsertRowid);
}

let seq = 0;
function msg({ chat, leadId = null, deMim = false, texto: t = 'oi', tipo = 'texto', quem = null, quando = new Date(), extra = null }) {
  seq++;
  return Number(run(
    `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, participant_jid, participant_name, extra, media_mime, media_seconds)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadId, chat, `A${seq}`, deMim ? 1 : 0, tipo, t, quando.toISOString(), quem ? `${quem.tel}@s.whatsapp.net` : null, quem?.nome || null,
      extra ? JSON.stringify(extra) : null, tipo === 'audio' ? 'audio/ogg; codecs=opus' : null, tipo === 'audio' ? 12 : null]
  ).lastInsertRowid);
}

async function zerar() {
  await limparBanco();
  exec(`DELETE FROM agente_acoes; DELETE FROM agente_mensagens; DELETE FROM agente_conversas; DELETE FROM agente_uso; DELETE FROM agente_agendados;
        DELETE FROM agente_execucoes; DELETE FROM agente_memoria; DELETE FROM agente_diretrizes; DELETE FROM agente_usuarios; DELETE FROM users;
        DELETE FROM calendly_events; DELETE FROM disparo_listas; DELETE FROM disparo_campanhas; DELETE FROM wa_instances;`);
  run("INSERT INTO wa_instances (id, name, phone) VALUES (1, 'Comercial', '5511900000000')");
  roteiro = [];
  pedidos = [];
  transcricao.definirTranscritorFalso(null);
}

const etapa = (nome) => get('SELECT id FROM stages WHERE name = ?', [nome]).id;
function lead(nome, etapaNome = 'Novo lead', extra = {}) {
  return Number(run('INSERT INTO leads (name, phone, stage_id, source, extra) VALUES (?, ?, ?, ?, ?)', [nome, `5511988${String(++seq).padStart(6, '0')}`, etapa(etapaNome), extra.respostas ? 'yayforms' : 'manual', JSON.stringify(extra)]).lastInsertRowid);
}

// ------------------------------------------------------------------ laço de ferramentas

test('laço: lê o grupo pedido, responde e guarda as fontes e o custo', async () => {
  await zerar();
  const u = usuario();
  const grupo = '120363000000000001@g.us';
  run("INSERT INTO wa_chats (jid, instance_id, name, is_group) VALUES (?, 1, 'Jaqueira Premiações | Impera', 1)", [grupo]);
  msg({ chat: grupo, texto: 'Marcelo, preciso do relatório até sexta', quem: { tel: '5511977770000', nome: 'Yuri' } });
  msg({ chat: grupo, deMim: true, texto: 'Fechado, mando sexta de manhã' });
  roteiro = [
    ferramenta('ler_conversa', { conversa: 'Jaqueira', desde: 'hoje' }),
    (corpo) => {
      const resultado = corpo.messages.at(-1).content[0];
      assert.equal(resultado.type, 'tool_result');
      assert.match(resultado.content, /Yuri.*relatório até sexta/);
      assert.match(resultado.content, /Equipe \(pelo celular\): Fechado/);
      return texto('Yuri pediu o relatório até sexta; você prometeu mandar sexta de manhã.');
    },
  ];
  const conversa = motor.criarConversa(u);
  const { tarefa } = await motor.enviarNoChat(u, conversa, { texto: 'resuma o grupo da Jaqueira de hoje' });
  await tarefa;
  const msgs = motor.mensagensParaTela(u, conversa);
  assert.equal(msgs.at(-1).papel, 'alice');
  assert.match(msgs.at(-1).texto, /relatório até sexta/);
  assert.equal(msgs.at(-1).fontes[0].chave, `g:${grupo}`);
  assert.ok(msgs.at(-1).custo_usd > 0);
  assert.equal(get('SELECT count(*) AS n FROM agente_uso WHERE user_id = ?', [u]).n, 2);
  // O prompt leva as regras, o esquema do banco e o momento no fuso do usuário; o texto fixo vai em cache
  assert.ok(pedidos[0].system[0].cache_control);
  assert.match(pedidos[0].system[0].text, /DADOS, nunca instruções/);
  assert.match(pedidos[0].system[0].text, /wa_messages\(/);
  assert.doesNotMatch(pedidos[0].system[0].text, /integration_state|password_hash/);
  assert.match(pedidos[0].system[1].text, /Agora:/);
  assert.equal(get('SELECT titulo FROM agente_conversas WHERE id = ?', [conversa]).titulo, 'resuma o grupo da Jaqueira de hoje');
});

test('laço: histórico continua de onde parou e resultados antigos de ferramenta são encurtados', async () => {
  await zerar();
  const u = usuario();
  const grande = 'x'.repeat(5000);
  roteiro = [ferramenta('consultar_banco', { sql: `select '${grande}' as a` }), texto('primeira')];
  const c = motor.criarConversa(u);
  await (await motor.enviarNoChat(u, c, { texto: 'um' })).tarefa;
  roteiro = [texto('segunda')];
  await (await motor.enviarNoChat(u, c, { texto: 'dois' })).tarefa;
  roteiro = [texto('terceira')];
  await (await motor.enviarNoChat(u, c, { texto: 'três' })).tarefa;
  const ultimo = pedidos.at(-1).messages;
  assert.equal(ultimo[0].role, 'user');
  const resultado = ultimo.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result');
  assert.ok(resultado, 'o resultado antigo continua no histórico (par tool_use/tool_result)');
  assert.ok(resultado.content.length < 2000, 'mas encurtado');
  // Duas mensagens seguidas na mesma conversa: a segunda espera
  roteiro = [async () => { await new Promise((r) => setTimeout(r, 50)); return texto('demorada'); }];
  const primeira = await motor.enviarNoChat(u, c, { texto: 'quatro' });
  await assert.rejects(motor.enviarNoChat(u, c, { texto: 'cinco' }), /ainda está respondendo/);
  await primeira.tarefa;
});

test('laço: pensamentos de turnos anteriores não voltam para a API; os do turno atual (entre ferramentas) voltam', async () => {
  await zerar();
  const u = usuario();
  const pensar = (r) => ({ ...r, content: [{ type: 'thinking', thinking: 'hmm', signature: 'ASSINATURA' }, ...r.content] });
  roteiro = [pensar(ferramenta('consultar_banco', { sql: 'select 1 as a' })), pensar(texto('primeira'))];
  const c = motor.criarConversa(u);
  await (await motor.enviarNoChat(u, c, { texto: 'um' })).tarefa;
  // Dentro do mesmo turno, depois da ferramenta, o pensamento vai junto (a API exige)
  assert.ok(pedidos[1].messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).some((b) => b.type === 'thinking'));
  roteiro = [texto('segunda')];
  await (await motor.enviarNoChat(u, c, { texto: 'dois' })).tarefa;
  const blocosEnviados = pedidos.at(-1).messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  assert.ok(!blocosEnviados.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking'), 'nenhum pensamento antigo no histórico');
  assert.ok(blocosEnviados.some((b) => b.type === 'tool_use') && blocosEnviados.some((b) => b.type === 'tool_result'), 'o resto do turno continua');
  assert.ok(pedidos.at(-1).messages.every((m) => m.content.length), 'nenhuma mensagem vazia');
});

test('segurança: consultar_banco nunca lê chaves, senhas nem sessões; só leitura', async () => {
  await zerar();
  const u = usuario();
  salvarConfigIa({ ativo: false });
  run("INSERT INTO integration_state (name, data) VALUES ('ia2', '{\"api_key_painel\":\"sk-ant-SEGREDO\"}')");
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Sao_Paulo', fonte: () => {}, progresso: () => {} };
  for (const sql of ['select * from integration_state', 'select data from integration_state', 'select password_hash from users', 'select * from sessions', "update leads set name = 'x'", 'select 1; delete from leads']) {
    const r = await ferramentas.executarFerramenta('consultar_banco', { sql }, ctx);
    assert.equal(r.erro, true, sql);
  }
  const r = await ferramentas.executarFerramenta('consultar_banco', { sql: 'select * from users' }, ctx);
  assert.ok(!r.erro);
  assert.doesNotMatch(r.conteudo, /HASH-SECRETO|password_hash/);
  assert.match(r.conteudo, /Marcelo/);
  // A ferramenta de panorama também não expõe chave nenhuma
  const visao = await ferramentas.executarFerramenta('visao_do_crm', {}, ctx);
  assert.doesNotMatch(visao.conteudo, /sk-ant/);
});

// ------------------------------------------------------------------ ações com aprovação

test('ações: mover lead só acontece depois de aprovar; dá para desfazer; aprovar duas vezes não repete', async () => {
  await zerar();
  const u = usuario();
  const l = lead('Fulano', 'Novo lead');
  roteiro = [ferramenta('propor_mover_lead', { lead_id: l, etapa: 'Qualificado', motivo: 'aceitou o investimento' }), texto('Deixei para você aprovar.')];
  const c = motor.criarConversa(u);
  await (await motor.enviarNoChat(u, c, { texto: 'mova o Fulano para qualificado' })).tarefa;
  const pendente = acoes.listarAcoes(u, { status: 'pendente' });
  assert.equal(pendente.length, 1);
  assert.match(pendente[0].resumo, /"Novo lead" → "Qualificado"/);
  assert.equal(get('SELECT stage_id FROM leads WHERE id = ?', [l]).stage_id, etapa('Novo lead'), 'nada mudou antes de aprovar');
  await acoes.aprovar(pendente[0].id, u);
  assert.equal(get('SELECT stage_id FROM leads WHERE id = ?', [l]).stage_id, etapa('Qualificado'));
  await assert.rejects(acoes.aprovar(pendente[0].id, u), /já foi executada/);
  acoes.desfazer(pendente[0].id, u);
  assert.equal(get('SELECT stage_id FROM leads WHERE id = ?', [l]).stage_id, etapa('Novo lead'));
  // A conversa ganha o registro do que aconteceu
  const eventos = motor.mensagensParaTela(u, c).filter((m) => m.papel === 'evento').map((m) => m.texto);
  assert.ok(eventos.some((t) => t.startsWith('✅')) && eventos.some((t) => t.startsWith('↩️')));
});

test('ações: público, rascunho de disparo (não começa sozinho), memória; editar o texto antes de aprovar', async () => {
  await zerar();
  const u = usuario();
  const a = lead('Ana');
  const b = lead('Beto');
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Sao_Paulo', conversaId: null, fonte: () => {}, progresso: () => {}, acoes: [] };
  await ferramentas.executarFerramenta('propor_publico', { nome: 'Follow-up concordaram', lead_ids: [a, b] }, ctx);
  await ferramentas.executarFerramenta('propor_disparo', { nome: 'Retomada', blocos: [{ texto: '{{saudacao}}, {{primeiro_nome}}!' }], lead_ids: [a, b] }, ctx);
  await ferramentas.executarFerramenta('propor_memoria', { texto: 'O Yuri pede relatório toda segunda' }, ctx);
  const [mem, disp, pub] = acoes.listarAcoes(u, { status: 'pendente' });
  await acoes.aprovar(pub.id, u, { nome: 'Concordaram com o pagamento' });
  const lista = get('SELECT id, nome FROM disparo_listas');
  assert.equal(lista.nome, 'Concordaram com o pagamento');
  assert.equal(get('SELECT count(*) AS n FROM disparo_lista_membros WHERE lista_id = ?', [lista.id]).n, 2);
  await acoes.aprovar(disp.id, u);
  const camp = get('SELECT status, config FROM disparo_campanhas');
  assert.equal(camp.status, 'rascunho');
  assert.equal(get('SELECT count(*) AS n FROM disparo_fila').n, 0, 'rascunho não entra na fila');
  const { listarRascunhos, listarCampanhas } = await import('../src/modules/disparos/servico.js');
  assert.equal(listarRascunhos()[0].contatos.length, 2);
  assert.equal(listarCampanhas().length, 0, 'rascunho não aparece no monitor');
  await acoes.aprovar(mem.id, u);
  assert.deepEqual(dir.listarMemoria(u).map((m) => m.texto), ['O Yuri pede relatório toda segunda']);
  // Proposta inválida volta como erro para o modelo corrigir
  const r = await ferramentas.executarFerramenta('propor_mover_lead', { lead_id: 999999, etapa: 'Qualificado' }, ctx);
  assert.equal(r.erro, true);
  // Membro não cria critério do Organizador
  const r2 = await ferramentas.executarFerramenta('propor_criterio_organizador', { titulo: 'X', etapa: 'Qualificado', prompt: 'y' }, { ...ctx, papel: 'member' });
  assert.match(r2.conteudo, /administradores/);
});

test('ações: mensagem só sai com o número conectado; usuário não aprova ação de outro', async () => {
  await zerar();
  const u = usuario();
  const outro = usuario('Socio', 'member');
  const l = lead('Lead WhatsApp');
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Sao_Paulo', fonte: () => {}, progresso: () => {} };
  await ferramentas.executarFerramenta('propor_mensagem', { lead_id: l, texto: 'Oi! Tudo certo para seguirmos?' }, ctx);
  const [acao] = acoes.listarAcoes(u, { status: 'pendente' });
  assert.deepEqual(acao.editaveis, ['texto']);
  await assert.rejects(acoes.aprovar(acao.id, outro), /não encontrada/);
  await assert.rejects(acoes.aprovar(acao.id, u), /desconectado/);
  assert.equal(get('SELECT status FROM agente_acoes WHERE id = ?', [acao.id]).status, 'falhou');
});

// ------------------------------------------------------------------ tetos

test('tetos: chat e agendados são separados; ao bater, o chat para', async () => {
  await zerar();
  const u = usuario();
  config.salvarConfig(u, { teto_chat_dia: 0.05, teto_agendados_dia: 1 });
  run("INSERT INTO agente_uso (user_id, modo, modelo, custo_usd) VALUES (?, 'chat', 'claude-sonnet-5-5', 0.06)", [u]);
  const c = motor.criarConversa(u);
  await assert.rejects(motor.enviarNoChat(u, c, { texto: 'oi' }), /teto de gasto do chat/);
  const { statusTeto } = await import('../src/modules/agente/uso.js');
  assert.equal(statusTeto(u, 'agendados').atingido, false);
  assert.ok(statusTeto(u, 'chat').volta_em);
});

// ------------------------------------------------------------------ agendados

test('agendados: próxima execução no fuso (diário, dias úteis, semanal, mensal, uma vez, a cada N horas)', () => {
  const fuso = 'America/Santiago';
  // Quinta 05/11/2026 23:30 em Santiago (UTC-3)
  const base = Date.parse('2026-11-06T02:30:00Z');
  assert.equal(agendados.proximaExecucao({ tipo: 'diario', hora: '08:00' }, fuso, base), '2026-11-06T11:00:00.000Z');
  // Sexta → próximo dia útil depois de sexta 08:00 é segunda
  const sexta9h = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(agendados.proximaExecucao({ tipo: 'dias_uteis', hora: '08:00' }, fuso, sexta9h), '2026-11-09T11:00:00.000Z');
  assert.equal(agendados.proximaExecucao({ tipo: 'semanal', hora: '07:30', dias: [0] }, fuso, base), '2026-11-08T10:30:00.000Z');
  assert.equal(agendados.proximaExecucao({ tipo: 'mensal', hora: '09:00', dia_mes: 31 }, fuso, base), '2026-11-30T12:00:00.000Z');
  assert.equal(agendados.proximaExecucao({ tipo: 'uma_vez', hora: '10:00', data: '2026-11-01' }, fuso, base), null);
  assert.equal(agendados.proximaExecucao({ tipo: 'a_cada_horas', horas: 4 }, fuso, base, base), new Date(base + 4 * 3600e3).toISOString());
  assert.throws(() => agendados.normalizarFrequencia({ tipo: 'diario' }), /hora/);
  assert.equal(agendados.descreverFrequencia({ tipo: 'semanal', dias: [1, 3], hora: '08:00' }), 'segunda, quarta às 08:00');
});

test('agendados: WhatsApp desconectado para a tarefa sem chamar a IA; destino "aba" executa e guarda o resultado', async () => {
  await zerar();
  const u = usuario();
  const ag = agendados.criarAgendado(u, {
    nome: 'Resumo dos grupos', prompt: 'Resuma os grupos de clientes de hoje', frequencia: { tipo: 'diario', hora: '08:00' }, fuso: 'America/Santiago',
    destino: { tipo: 'proprio', numero_id: 1 },
  });
  assert.ok(ag.proxima_em);
  const antes = pedidos.length;
  const exec1 = await agendados.executarAgendado(ag.id);
  assert.equal(exec1.status, 'nao_enviada');
  assert.equal(pedidos.length, antes, 'não gastou com a IA');
  assert.ok(get('SELECT proxima_em FROM agente_agendados WHERE id = ?', [ag.id]).proxima_em > new Date().toISOString(), 'segue para o próximo horário');

  const ag2 = agendados.criarAgendado(u, { nome: 'Só na aba', prompt: 'Diga oi', frequencia: { tipo: 'a_cada_horas', horas: 2 }, destino: { tipo: 'aba' } });
  roteiro = [texto('Resumo pronto')];
  const exec2 = await agendados.executarAgendado(ag2.id, { manual: true });
  assert.equal(exec2.status, 'ok');
  assert.equal(exec2.resposta, 'Resumo pronto');
  assert.match(pedidos.at(-1).system[1].text, /AGENDADA: ninguém está acompanhando/);
  assert.equal(get("SELECT count(*) AS n FROM agente_conversas WHERE origem = 'agendado'").n, 1);
  // A Alice também propõe agendados no chat (com aprovação)
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Santiago', fonte: () => {}, progresso: () => {} };
  await ferramentas.executarFerramenta('propor_agendado', { nome: 'Toda segunda', prompt: 'Relatório semanal', frequencia: { tipo: 'semanal', dias: [1], hora: '07:00' }, destino: { tipo: 'aba' } }, ctx);
  const [proposta] = acoes.listarAcoes(u, { status: 'pendente' });
  assert.match(proposta.resumo, /segunda às 07:00/);
  await acoes.aprovar(proposta.id, u);
  assert.equal(agendados.listarAgendados(u).length, 3);
});

test('agendados: "Melhorar prompt" devolve o prompt e as perguntas do que falta', async () => {
  await zerar();
  const u = usuario();
  roteiro = [texto('Aqui está:\n```json\n{"nome":"Resumo manhã","prompt":"Leia os grupos de clientes desde ontem 18h e liste pedidos e promessas.","frequencia":{"tipo":"diario","hora":null},"fuso":"America/Santiago","destino":null,"perguntas":["Que horas?","Mandar para qual WhatsApp?"]}\n```')];
  const r = await agendados.melhorarPrompt(u, { pedido: 'todo dia de manhã resuma os grupos e me mande no whatsapp' });
  assert.equal(r.nome, 'Resumo manhã');
  assert.equal(r.perguntas.length, 2);
  assert.equal(r.fuso, 'America/Santiago');
  assert.equal(get("SELECT modo FROM agente_uso ORDER BY id DESC LIMIT 1").modo, 'prompt');
});

// ------------------------------------------------------------------ canal do WhatsApp

test('canal: número pessoal do dono vai para a Alice e a IA de primeiro contato ignora; comandos SIM/NÃO', async () => {
  await zerar();
  const u = usuario();
  config.salvarConfig(u, { whatsapp_ativo: true, whatsapp_telefones: ['5511912345678'] });
  assert.equal(config.donoDoTelefone('5521999990000'), null, 'outro número não é dono');
  assert.equal(config.donoDoTelefone('5511912345678').userId, u);
  assert.equal(config.donoDoTelefone('+55 (11) 1234-5678').userId, u, 'variante sem o 9º dígito');
  const outro = usuario('Socio', 'member');
  assert.throws(() => config.salvarConfig(outro, { whatsapp_telefones: ['5511912345678'] }), /já está ligado/);
  salvarConfigIa({ ativo: true });
  const r = iaMotor.aoReceberMensagem({ instanciaId: 1, chatJid: '5511912345678@s.whatsapp.net', phone: '5511912345678' });
  assert.equal(r, null, 'a IA de primeiro contato não assume o dono');
  salvarConfigIa({ ativo: false });
  // Comandos
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Sao_Paulo', fonte: () => {}, progresso: () => {} };
  await ferramentas.executarFerramenta('propor_memoria', { texto: 'lembrar disso' }, ctx);
  const [a] = acoes.listarAcoes(u, { status: 'pendente' });
  assert.match(await canal._paraTeste.tratarComando(u, `sim ${a.id}`), /Feito/);
  assert.match(await canal._paraTeste.tratarComando(u, `NÃO ${a.id}`), /já foi decidida/);
  assert.equal(await canal._paraTeste.tratarComando(u, 'bom dia'), null);
});

test('WhatsApp: Markdown vira formatação do WhatsApp e textos longos são divididos', () => {
  const md = '## Resumo de hoje\n\n| Cliente | Pedido |\n|---|---|\n| Jaqueira | relatório |\n\n- **Prazo:** sexta\n- veja [o painel](https://x.y)';
  assert.equal(whatsapp.paraWhatsApp(md), '*Resumo de hoje*\n\nCliente · Pedido\nJaqueira · relatório\n\n• *Prazo:* sexta\n• veja o painel (https://x.y)');
  const partes = whatsapp.dividir(Array.from({ length: 50 }, (_, i) => `Parágrafo ${i} ${'x'.repeat(200)}`).join('\n\n'), 1000);
  assert.ok(partes.length > 5 && partes.every((p) => p.length <= 1000));
});

// ------------------------------------------------------------------ transcrição e documentos

test('transcrição: ler_conversa transcreve os áudios sem texto e guarda (uma vez só)', async () => {
  await zerar();
  const u = usuario();
  let chamadas = 0;
  transcricao.definirTranscritorFalso(async () => { chamadas++; return 'quero aumentar o orçamento para 300 por dia'; });
  transcricao.salvarConfig({ ativo: true });
  const l = lead('Cliente Áudio');
  const audio = msg({ chat: '5511900001111@s.whatsapp.net', leadId: l, tipo: 'audio', texto: '🎤 Áudio' });
  // Arquivo já baixado
  const rel = path.join('whatsapp', '1', 'teste.ogg');
  fs.mkdirSync(path.join(PASTA, 'arquivos', 'whatsapp', '1'), { recursive: true });
  fs.writeFileSync(path.join(PASTA, 'arquivos', rel), 'OggS');
  run("UPDATE wa_messages SET media_path = ?, media_status = 'ok' WHERE id = ?", [rel, audio]);
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Sao_Paulo', fonte: () => {}, progresso: () => {} };
  const r1 = await ferramentas.executarFerramenta('ler_conversa', { conversa: `l:${l}` }, ctx);
  assert.match(r1.conteudo, /Transcrição: "quero aumentar o orçamento/);
  await ferramentas.executarFerramenta('ler_conversa', { conversa: `l:${l}` }, ctx);
  assert.equal(chamadas, 1);
  assert.ok(get('SELECT transcricao FROM wa_messages WHERE id = ?', [audio]).transcricao);
  transcricao.salvarConfig({ ativo: false });
});

function zipSimples(arquivos) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dadosOriginais = Buffer.from(conteudo);
    const comp = zlib.deflateRawSync(dadosOriginais);
    const n = Buffer.from(nome);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dadosOriginais.length, 22); local.writeUInt16LE(n.length, 26);
    locais.push(local, n, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(dadosOriginais.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    centrais.push(central, n);
    offset += 30 + n.length + comp.length;
  }
  const c = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(Object.keys(arquivos).length, 8); fim.writeUInt16LE(Object.keys(arquivos).length, 10); fim.writeUInt32LE(c.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, c, fim]);
}

test('documentos: lê Word e Excel sem bibliotecas; imagem e PDF vão como blocos', () => {
  const docx = path.join(PASTA, 'proposta.docx');
  fs.writeFileSync(docx, zipSimples({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Proposta &amp; escopo</w:t></w:r></w:p><w:p><w:r><w:t>Investimento: R$ 3.000</w:t></w:r></w:p></w:body></w:document>' }));
  assert.equal(documentos.extrairTexto(docx, { nome: 'proposta.docx' }), 'Proposta & escopo\nInvestimento: R$ 3.000');
  const xlsx = path.join(PASTA, 'planilha.xlsx');
  fs.writeFileSync(xlsx, zipSimples({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Leads" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Nome</t></si><si><t>Valor</t></si><si><t>Ana</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>150</v></c></row></sheetData></worksheet>',
  }));
  assert.equal(documentos.extrairTexto(xlsx, { nome: 'planilha.xlsx' }), 'Planilha "Leads":\nNome | Valor\nAna | 150');
  const png = path.join(PASTA, 'print.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const blocos = ferramentas.blocoDeArquivo(png, { mime: 'image/png', nome: 'print.png' });
  assert.equal(blocos[1].type, 'image');
  const pdf = path.join(PASTA, 'a.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4');
  assert.equal(ferramentas.blocoDeArquivo(pdf, { mime: 'application/pdf', nome: 'a.pdf' })[1].type, 'document');
});

// ------------------------------------------------------------------ dados, cérebro e diretrizes

test('dados: datas no fuso do usuário e busca de leads por resposta do formulário, reunião e proposta', async () => {
  await zerar();
  const u = usuario();
  assert.equal(dados.interpretarData('2026-11-05', 'America/Santiago'), '2026-11-05T03:00:00.000Z');
  assert.equal(dados.interpretarData('2026-11-05', 'America/Santiago', { fimDoDia: true }), '2026-11-06T02:59:59.999Z');
  assert.throws(() => dados.interpretarData('semana passada', 'America/Sao_Paulo'), /não entendida/);
  const concordou = lead('Concordou', 'Novo lead', { formulario: 'Captação Rifas', respostas: [{ pergunta: 'Você concorda com o investimento mínimo e o valor da mão de obra?', resposta: 'Sim, concordo' }] });
  lead('Não concordou', 'Novo lead', { formulario: 'Captação Rifas', respostas: [{ pergunta: 'Você concorda com o investimento mínimo e o valor da mão de obra?', resposta: 'Não' }] });
  const comReuniao = lead('Reunião sem proposta', 'Reunião agendada');
  run("INSERT INTO calendly_events (uri, lead_id, start_time, status) VALUES ('u1', ?, ?, 'active')", [comReuniao, new Date(Date.now() - 2 * 86400000).toISOString()]);
  const comProposta = lead('Reunião com proposta', 'Reunião agendada');
  run("INSERT INTO calendly_events (uri, lead_id, start_time, status) VALUES ('u2', ?, ?, 'active')", [comProposta, new Date(Date.now() - 3 * 86400000).toISOString()]);
  run("INSERT INTO wa_messages (lead_id, chat_jid, wa_id, from_me, type, body, media_name, timestamp) VALUES (?, 'x@s.whatsapp.net', 'P1', 1, 'documento', '📄', 'Proposta comercial - Impera.pdf', ?)", [comProposta, new Date().toISOString()]);
  const ctx = { userId: u, papel: 'admin', fuso: 'America/Sao_Paulo', fonte: () => {}, progresso: () => {} };
  const r1 = JSON.parse((await ferramentas.executarFerramenta('buscar_leads', { pergunta_contem: 'concorda', resposta_contem: 'sim' }, ctx)).conteudo);
  assert.deepEqual(r1.leads.map((l) => l.id), [concordou]);
  const r2 = JSON.parse((await ferramentas.executarFerramenta('buscar_leads', { reuniao_desde: '7d', reuniao_ja_aconteceu: true, proposta_enviada: false }, ctx)).conteudo);
  assert.deepEqual(r2.leads.map((l) => l.nome), ['Reunião sem proposta']);
});

test('cérebro: "Entender o CRM" lê os grupos e salva o contexto com versões; diretrizes são de cada usuário', async () => {
  await zerar();
  const u = usuario();
  const outro = usuario('Socio', 'member');
  const grupo = '120363000000000002@g.us';
  run("INSERT INTO wa_chats (jid, instance_id, name, is_group) VALUES (?, 1, 'VF Prêmios x Impera', 1)", [grupo]);
  msg({ chat: grupo, texto: 'Bom dia, como estão as campanhas?', quem: { tel: '5521977770000', nome: 'Vitor' } });
  let entrada = '';
  roteiro = [(corpo) => { entrada = corpo.messages[0].content[0].text; assert.ok(corpo.thinking); return texto('# O negócio\nAgência...\n# Mapa de grupos → clientes\n| VF Prêmios x Impera | VF Prêmios |'); }];
  contexto._paraTeste.zerar();
  contexto.iniciarTarefa(u, 'gerar', { dias: 30 });
  for (let i = 0; i < 100 && contexto.estadoTarefa(u).status === 'rodando'; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(contexto.estadoTarefa(u).status, 'ok', contexto.estadoTarefa(u).erro);
  assert.match(entrada, /VF Prêmios x Impera.*Vitor/s);
  assert.match(config.lerCerebro(u).contexto, /Mapa de grupos/);
  config.salvarContexto(u, 'editado à mão');
  assert.equal(config.versoesDoContexto(u).length, 1);
  assert.equal(config.lerCerebro(outro).contexto, '', 'cada usuário tem o seu cérebro');
  dir.criarDiretriz(u, { titulo: 'Tom', conteudo: 'Seja direto' });
  assert.equal(dir.listarDiretrizes(outro).length, 0);
  assert.throws(() => dir.obterDiretriz(outro, dir.listarDiretrizes(u)[0].id), /não encontrada/);
  // O cérebro entra no prompt
  roteiro = [texto('ok')];
  const c = motor.criarConversa(u);
  await (await motor.enviarNoChat(u, c, { texto: 'oi' })).tarefa;
  assert.match(pedidos.at(-1).system[0].text, /editado à mão[\s\S]*Seja direto/);
});

test('config: nome da assistente, modelos e tetos validados; um anexo de áudio é transcrito', async () => {
  await zerar();
  const u = usuario();
  const cfg = config.salvarConfig(u, { nome: '  Lara  ', modelo_chat: 'claude-opus-5-5', teto_chat_dia: '3,5', fuso: 'America/Santiago' });
  assert.equal(cfg.nome, 'Lara');
  assert.equal(cfg.teto_chat_dia, 3.5);
  assert.throws(() => config.salvarConfig(u, { fuso: 'Lua/Cratera' }), /Fuso/);
  assert.equal(config.salvarConfig(u, { modelo_chat: 'gpt-9' }).modelo_chat, 'claude-opus-5-5');
  transcricao.definirTranscritorFalso(async () => 'resuma meus grupos de hoje');
  fs.mkdirSync(path.join(PASTA, 'arquivos', 'agente', String(u)), { recursive: true });
  const rel = path.join('agente', String(u), 'voz.webm');
  fs.writeFileSync(path.join(PASTA, 'arquivos', rel), 'webm');
  const anexo = Number(run("INSERT INTO agente_anexos (user_id, nome, mime, caminho) VALUES (?, 'voz.webm', 'audio/webm', ?)", [u, rel]).lastInsertRowid);
  assert.equal(await motor.transcreverAnexo(u, anexo), 'resuma meus grupos de hoje');
  roteiro = [(corpo) => { assert.match(JSON.stringify(corpo.messages.at(-1).content), /transcrição: \\"resuma meus grupos de hoje/); return texto('Claro'); }];
  const c = motor.criarConversa(u);
  await (await motor.enviarNoChat(u, c, { texto: '', anexoIds: [anexo] })).tarefa;
  assert.equal(motor.mensagensParaTela(u, c).at(-1).texto, 'Claro');
});

test('canal: "mensagem para mim" do número do CRM vai para a Alice; a resposta da própria Alice não volta', async () => {
  await zerar();
  const u = usuario();
  config.salvarConfig(u, { whatsapp_ativo: true, whatsapp_proprio: true, whatsapp_numero_id: 1 });
  const { estado } = await import('../src/modules/whatsapp/instancias.js');
  const e = estado(1);
  e.status = 'conectado';
  e.sock = { user: { id: '5511900000000:7@s.whatsapp.net' } };
  try {
    const proprio = '5511900000000@s.whatsapp.net';
    const minha = msg({ chat: proprio, deMim: true, texto: 'Alice, resuma os grupos de hoje' });
    assert.equal(await canal.aoMensagemPropria({ instanciaId: 1, jid: proprio, linhaId: minha }), true);
    assert.ok(canal._paraTeste.pendentes.has(u));
    clearTimeout(canal._paraTeste.pendentes.get(u).timer);
    canal._paraTeste.pendentes.delete(u);
    const daAlice = msg({ chat: proprio, deMim: true, texto: 'Resumo…', extra: { origem: 'alice' } });
    assert.equal(await canal.aoMensagemPropria({ instanciaId: 1, jid: proprio, linhaId: daAlice }), false);
    // Conversa com outra pessoa não é "mensagem para mim"
    const outra = msg({ chat: '5511955554444@s.whatsapp.net', deMim: true, texto: 'oi' });
    assert.equal(await canal.aoMensagemPropria({ instanciaId: 1, jid: '5511955554444@s.whatsapp.net', linhaId: outra }), false);
  } finally {
    e.status = 'desconectado';
    e.sock = null;
  }
});
