import { prepararBanco, criarLeadDireto } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = await prepararBanco();
const texto = await import('../src/modules/disparos/texto.js');
const blocos = await import('../src/modules/disparos/blocos.js');
const motor = await import('../src/modules/disparos/motor.js');
const servico = await import('../src/modules/disparos/servico.js');
const contatos = await import('../src/modules/disparos/contatos.js');

const numeroId = Number(db.run("INSERT INTO wa_instances (name, phone) VALUES ('Principal', '5511900000000')").lastInsertRowid);

// WhatsApp falso: guarda tudo o que seria enviado
const enviados = [];
const presencas = [];
let falharPara = null;
motor.definirDependencias({
  enviar: async (numero, destino, dados) => {
    if (falharPara && JSON.stringify(destino).includes(falharPara)) throw Object.assign(new Error('O WhatsApp não aceitou a mensagem: teste'), { status: 502 });
    enviados.push({ numero, destino, texto: dados.texto, arquivo: dados.arquivo, automatico: dados.automatico });
    return { id: enviados.length };
  },
  presenca: async (numero, jid, estado) => { presencas.push(estado); },
  numeroConectado: async (id) => id || numeroId,
  resolverJid: async (_n, { phone }) => `${phone}@s.whatsapp.net`,
  temFfmpeg: async () => false,
});

test('telefone canônico: com/sem 9º dígito e com/sem 55 viram o mesmo número', () => {
  const c = texto.chaveTelefone;
  assert.equal(c('(11) 98765-4321'), '5511987654321');
  assert.equal(c('1187654321'), '5511987654321');
  assert.equal(c('551187654321'), '5511987654321');
  assert.equal(c('+55 11 98765-4321'), '5511987654321');
  // Fixo (começa com 2-5) não ganha o 9
  assert.equal(c('1133334444'), '551133334444');
  assert.equal(c('abc'), null);
});

test('variáveis, primeiro nome, saudação e Spintax', () => {
  assert.equal(texto.primeiroNome('marcelo SILVA'), 'Marcelo');
  const v = texto.variaveisDoContato({
    nome: 'joão da silva', phone: '5511987654321', etapa: 'Novo lead',
    extra: { respostas: [{ id: 'q1', pergunta: 'Qual o seu orçamento?', resposta: 'R$ 5 mil' }], utm: { utm_source: 'meta' } },
  }, new Date('2026-10-13T14:00:00Z'));
  assert.equal(v.primeiro_nome, 'João');
  assert.equal(v.telefone, '(11) 98765-4321');
  assert.equal(v.qual_o_seu_orcamento, 'R$ 5 mil');
  assert.equal(v.campo_q1, 'R$ 5 mil');
  assert.equal(v.utm_source, 'meta');
  assert.equal(v.saudacao, 'Bom dia'); // 11:00 em São Paulo
  assert.equal(texto.saudacao(new Date('2026-10-13T18:00:00Z')), 'Boa tarde');
  assert.equal(texto.saudacao(new Date('2026-10-13T23:30:00Z')), 'Boa noite');

  assert.equal(texto.renderizar('{{saudacao}}, {{primeiro_nome}}!', v), 'Bom dia, João!');
  assert.equal(texto.renderizar('Oi {{apelido|amigo}}', v), 'Oi amigo');
  assert.equal(texto.renderizar('{Oi|Olá} {{primeiro_nome}}', v, () => 0.99), 'Olá João');
  assert.equal(texto.renderizar('{Oi|Olá} {{primeiro_nome}}', v, () => 0), 'Oi João');
  // Aninhado e chaves sem "|" ficam como estão
  assert.equal(texto.aplicarSpintax('{a|{b|c}} {x}', () => 0.99), 'c {x}');
  // O valor de uma variável nunca vira Spintax
  assert.equal(texto.renderizar('{{nome}}', { nome: '{a|b}' }), '{a|b}');
});

test('janela de horário: dentro, fora e virando a noite', () => {
  const j = { ativa: true, inicio: '08:00', fim: '20:00', dias: [0, 1, 2, 3, 4, 5, 6] };
  // 15:00 UTC = 12:00 em São Paulo
  assert.equal(blocos.dentroDaJanela(j, new Date('2026-10-13T15:00:00Z')).dentro, true);
  const fora = blocos.dentroDaJanela(j, new Date('2026-10-14T02:00:00Z')); // 23:00
  assert.equal(fora.dentro, false);
  assert.equal(fora.abreEm, '2026-10-14T11:00:00.000Z'); // 08:00 do dia seguinte
  const noite = { ativa: true, inicio: '20:00', fim: '02:00', dias: [2] }; // só terça
  assert.equal(blocos.dentroDaJanela(noite, new Date('2026-10-14T03:30:00Z')).dentro, true); // quarta 00:30: a janela começou na terça às 20h, ainda vale
  assert.equal(blocos.dentroDaJanela({ ...j, ativa: false }, new Date('2026-10-14T02:00:00Z')).dentro, true);
});

test('intervalo entre contatos nunca abaixo do mínimo', () => {
  const cfg = blocos.validarConfig({ intervalo: { modo: 'aleatorio', min: 0, max: 1 } });
  assert.equal(cfg.intervalo.min, blocos.INTERVALO_MINIMO_S);
  const s = blocos.sortearIntervalo({ intervalo: { modo: 'aleatorio', min: 20, max: 50 } }, () => 0.5);
  assert.equal(s, 35);
});

test('destinatários: sem números repetidos, enriquecidos pelo kanban, sem bloqueados', async () => {
  const leadId = await criarLeadDireto({ nome: 'Ana Lead', telefone: '5511981112222' });
  servico.bloquear({ telefone: '11 93333-4444' }, null);
  const r = servico.montarDestinatarios({
    contatos: [
      { telefone: '551181112222', nome: 'Ana do WhatsApp' }, // mesmo número da Ana, sem o 9
      { telefone: '(11) 98111-2222' },
      { telefone: '11933334444' }, // bloqueado
      { telefone: '123' },
    ],
  });
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].lead_id, leadId);
  assert.equal(r.itens[0].phone, '5511981112222');
  assert.equal(r.repetidos, 1);
  assert.equal(r.bloqueados, 1);
  assert.equal(r.invalidos, 1);

  // Lista unificada: contato do WhatsApp com o número da Ana (sem 9) não aparece duplicado
  db.run("INSERT INTO wa_contacts (jid, phone, push_name) VALUES ('551181112222@s.whatsapp.net', '551181112222', 'Aninha')");
  db.run("INSERT INTO wa_contacts (jid, phone, push_name) VALUES ('5521955556666@s.whatsapp.net', '5521955556666', 'Bruno')");
  const lista = contatos.listarContatos();
  const ana = lista.filter((c) => c.telefone === '5511981112222');
  assert.equal(ana.length, 1);
  assert.equal(ana[0].tipo, 'kanban');
  assert.ok(ana[0].etapa?.nome);
  assert.equal(lista.find((c) => c.telefone === '5521955556666')?.tipo, 'whatsapp');
});

test('motor: envia o fluxo para cada contato, com variáveis, presença e falha registrada', async () => {
  enviados.length = 0;
  falharPara = '5531977778888';
  const leadId = await criarLeadDireto({ nome: 'carla mendes', telefone: '5531966667777' });
  const r = servico.criarCampanha({
    nome: 'Teste do motor',
    numero_id: numeroId,
    blocos: [
      { tipo: 'texto', texto: '{{saudacao}}, {{primeiro_nome}}!', espera: { segundos: 0, presenca: 'composing' } },
      { tipo: 'texto', texto: 'Segunda mensagem', espera: { segundos: 1, presenca: 'composing' } },
    ],
    config: { intervalo: { modo: 'fixo', fixo: 3 } },
    destinatarios: { contatos: [{ telefone: '5531966667777', lead_id: leadId }, { telefone: '5531977778888', nome: 'Falha' }] },
  }, null);
  assert.equal(r.total, 2);
  // Espera concluir (2 contatos + 3 s entre eles + 1 s de espera por contato)
  for (let i = 0; i < 120; i++) {
    if (db.get('SELECT status FROM disparo_campanhas WHERE id = ?', [r.id]).status === 'concluida') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const camp = servico.detalheCampanha(r.id);
  assert.equal(camp.campanha.status, 'concluida');
  assert.equal(camp.campanha.contagem.enviado, 1);
  assert.equal(camp.campanha.contagem.falha, 1);
  assert.match(camp.itens.find((i) => i.status === 'falha').erro, /WhatsApp recusou/);
  assert.equal(enviados.length, 2);
  assert.match(enviados[0].texto, /^(Bom dia|Boa tarde|Boa noite), Carla!$/);
  assert.deepEqual(enviados[0].destino, { leadId });
  assert.equal(enviados[0].automatico, true);
  assert.ok(presencas.includes('composing'));

  // Reenviar só as falhas
  falharPara = null;
  assert.equal(servico.reenviarFalhas(r.id), 1);
  for (let i = 0; i < 80; i++) {
    if (db.get("SELECT count(*) n FROM disparo_fila WHERE campanha_id = ? AND status = 'enviado'", [r.id]).n === 2) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(servico.detalheCampanha(r.id).campanha.contagem.enviado, 2);
  assert.equal(enviados.length, 4);
});

test('motor: pausar no meio guarda o bloco e retomar continua de onde parou', async () => {
  enviados.length = 0;
  const r = servico.criarCampanha({
    numero_id: numeroId,
    blocos: [
      { tipo: 'texto', texto: 'Bloco 1', espera: { segundos: 0, presenca: 'nenhuma' } },
      { tipo: 'texto', texto: 'Bloco 2', espera: { segundos: 2, presenca: 'composing' } },
    ],
    config: { intervalo: { modo: 'fixo', fixo: 3 } },
    destinatarios: { contatos: [{ telefone: '5541988880000' }] },
  }, null);
  for (let i = 0; i < 50 && enviados.length < 1; i++) await new Promise((res) => setTimeout(res, 50));
  servico.pausarCampanha(r.id);
  await new Promise((res) => setTimeout(res, 200));
  const item = db.get('SELECT status, bloco_atual FROM disparo_fila WHERE campanha_id = ?', [r.id]);
  assert.deepEqual({ ...item }, { status: 'pendente', bloco_atual: 1 });
  assert.equal(enviados.length, 1);
  servico.retomarCampanha(r.id);
  for (let i = 0; i < 80; i++) {
    if (db.get('SELECT status FROM disparo_campanhas WHERE id = ?', [r.id]).status === 'concluida') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.deepEqual(enviados.map((e) => e.texto), ['Bloco 1', 'Bloco 2']);
});

test('Yay! Forms: lead novo entra na fila uma vez só; bloqueado e repetido ficam registrados como pulados', async () => {
  enviados.length = 0;
  servico.salvarConfigYay({
    ativo: true, numero_id: numeroId, atraso_min: 0, atraso_max: 0, nao_repetir_horas: 24, pular_se_conversa: true,
    blocos: [{ tipo: 'texto', texto: 'Oi {{primeiro_nome}}, recebi seu formulário!', espera: { segundos: 0, presenca: 'nenhuma' } }],
  });
  const leadId = await criarLeadDireto({ nome: 'Diego Ramos', telefone: '5551984445555' });
  assert.equal(servico.aoReceberLeadYay({ leadId, novo: true }).enfileirado, true);
  // Mesmo telefone (outro lead, sem o 9): não repete
  const outro = await criarLeadDireto({ nome: 'Diego 2', telefone: '555184445555' });
  assert.equal(servico.aoReceberLeadYay({ leadId: outro, novo: true }).motivo, 'repetido');
  // Lead existente que só reenviou: nada
  assert.equal(servico.aoReceberLeadYay({ leadId, novo: false }).motivo, 'lead_existente');

  for (let i = 0; i < 60 && !enviados.length; i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].texto, 'Oi Diego, recebi seu formulário!');
  const c = servico.campanhaYay();
  const pulados = db.all("SELECT erro FROM disparo_fila WHERE campanha_id = ? AND status = 'pulado'", [c.id]);
  assert.ok(pulados.some((p) => /últimas 24 h/.test(p.erro)));

  // Desligada: não enfileira
  servico.salvarConfigYay({ ...servico.lerConfigYay(), ativo: false });
  const terceiro = await criarLeadDireto({ nome: 'Eva', telefone: '5561922223333' });
  assert.equal(servico.aoReceberLeadYay({ leadId: terceiro, novo: true }).motivo, 'desligada');
  motor.pararMotor();
  await motor.aguardarOcioso();
});
