// Follow-up da Alice SDR (11 toques, quebra quando o lead responde, travas) e lembretes de reunião (3d, 24h, 12h, 3h, 30m).
import { prepararBanco, limparBanco, criarLeadDireto } from './ajuda.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste-00000000000000000000000000';
await prepararBanco();
const { run, get, all, exec } = await import('../src/db.js');
const { salvarConfig } = await import('../src/modules/ia/config.js');
const { definirChamadaFalsa } = await import('../src/modules/ia/cliente.js');
const fu = await import('../src/modules/ia/followup.js');
const lb = await import('../src/modules/ia/lembretes.js');
const protecao = await import('../src/modules/ia/protecao.js');
const { provaDeReuniao } = await import('../src/modules/organizador/etapas.js');
const { teveContatoHumano, contatoDaConversa } = await import('../src/modules/ia/motor.js');

const SEMPRE = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { inicio: '00:00', fim: '23:59' }]));
const TODOS_DIAS = [0, 1, 2, 3, 4, 5, 6];
const H = 3600000;
let enviadas = [];
let relogio = Date.now();
let pedidos = [];
let respostaModelo = { enviar: true, mensagens: ['Oi, Ana! Conseguiu pensar no que conversamos?'] };

const gravarEnviada = (destino, dados) => {
  enviadas.push({ destino, ...dados });
  run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp, extra)
       VALUES (1, ?, ?, ?, 1, 'texto', ?, ?, ?)`, [destino.leadId, `${destino.leadId}@s.whatsapp.net`, `X${Math.random()}`, dados.texto, new Date(relogio).toISOString(), JSON.stringify({ origem: dados.origem })]);
};
const comuns = {
  esperar: async () => {}, aleatorio: () => 0.5, digitando: async () => {}, numeroDisponivel: async () => 1,
  emAtendimentoAlice: async () => false, enviar: async (n, destino, dados) => gravarEnviada(destino, dados), agora: () => relogio,
};
fu.definirDependencias(comuns);
lb.definirDependencias(comuns);
definirChamadaFalsa(async (corpo) => { pedidos.push(corpo); return { texto: JSON.stringify(respostaModelo), uso: { input_tokens: 10, output_tokens: 5 } }; });

async function preparar(extraFu = {}) {
  await limparBanco();
  exec('DELETE FROM ia_followups; DELETE FROM ia_lembretes; DELETE FROM ia_registro; DELETE FROM ia_conversas; DELETE FROM wa_instances; DELETE FROM calendly_events;');
  run("INSERT INTO wa_instances (id, name) VALUES (1, 'Comercial')");
  salvarConfig({ ativo: false, horario: SEMPRE, intervalo_leads_min_seg: 0, intervalo_leads_max_seg: 0, descanso_ativo: false });
  fu.salvarConfigFollowup({ ativo: true, dias: TODOS_DIAS, janela_inicio: '00:00', janela_fim: '23:59', variacao_min: 0, intervalo_min_seg: 0, intervalo_max_seg: 0, espera_apos_equipe_horas: 0, toques: fu.PADRAO.toques, ...extraFu });
  protecao.zerarProtecao();
  fu.zerarRitmo();
  enviadas = [];
  pedidos = [];
  relogio = Date.now();
  respostaModelo = { enviar: true, mensagens: ['Oi, Ana! Conseguiu pensar no que conversamos?'] };
}
const linha = (leadId) => get('SELECT * FROM ia_followups WHERE lead_id = ? ORDER BY id DESC LIMIT 1', [leadId]);
const vencer = (leadId) => run("UPDATE ia_followups SET proximo_em = ? WHERE lead_id = ? AND status = 'ativo'", [new Date(relogio - 1000).toISOString(), leadId]);
const msgDoLead = (leadId, texto, quando = relogio) => run(
  `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp) VALUES (1, ?, ?, ?, 0, 'texto', ?, ?)`,
  [leadId, `${leadId}@s.whatsapp.net`, `L${Math.random()}`, texto, new Date(quando).toISOString()]
);

test('colocar no follow-up: 11 toques, o 1º em 24 h, contados da entrada na lista', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Ana Souza', telefone: '5511911113001' });
  const e = fu.colocarNoFollowup(leadId);
  assert.equal(e.total, 11);
  assert.equal(e.ativo.proximo_toque, 1);
  const horas = (Date.parse(linha(leadId).proximo_em) - relogio) / H;
  assert.ok(horas > 23.9 && horas < 24.1, `1º toque em ${horas} h`);
  assert.equal(get("SELECT count(*) AS n FROM lead_events WHERE lead_id = ? AND type = 'followup_on'", [leadId]).n, 1);
});

test('toque vencido: a IA lê a conversa e envia; o próximo fica para 48 h depois da entrada', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Ana Souza', telefone: '5511911113002' });
  msgDoLead(leadId, 'Quero anunciar minha rifa', relogio - 3 * H);
  fu.colocarNoFollowup(leadId);
  relogio += 24 * H + 60000;
  vencer(leadId);
  const r = await fu.processarFollowup(linha(leadId).id);
  assert.equal(r.feito, 'enviado');
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].origem, 'followup');
  // O modelo recebeu a conversa e a orientação do toque 1
  const pedido = JSON.stringify(pedidos[0]);
  assert.match(pedido, /Quero anunciar minha rifa/);
  assert.match(pedido, /TOQUE 1 de 11/);
  const l = linha(leadId);
  assert.equal(l.etapa, 1);
  const horas = (Date.parse(l.proximo_em) - Date.parse(l.base_em)) / H;
  assert.ok(horas >= 47.9 && horas <= 48.1, `2º toque em ${horas} h da entrada`);
  // Mensagem do follow-up não conta como "a equipe falou" para a Alice de primeiro contato
  assert.equal(teveContatoHumano(contatoDaConversa({ lead_id: leadId, phone: '5511911113002', jid: null })), false);
});

test('o lead respondeu: o follow-up quebra na hora (gancho) e acende "aguardando sua resposta"', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Bia', telefone: '5511911113003' });
  fu.colocarNoFollowup(leadId);
  msgDoLead(leadId, 'Oi, ainda tenho interesse', relogio + 1000);
  fu.aoReceberMensagem({ leadId });
  assert.equal(linha(leadId).status, 'respondeu');
  assert.match(get('SELECT waiting_note FROM leads WHERE id = ?', [leadId]).waiting_note, /follow-up/);
});

test('resposta que chegou sem passar pelo gancho (WhatsApp offline): quebra antes de enviar', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Carla', telefone: '5511911113004' });
  fu.colocarNoFollowup(leadId);
  relogio += 25 * H;
  msgDoLead(leadId, 'oi', relogio - H);
  vencer(leadId);
  const r = await fu.processarFollowup(linha(leadId).id);
  assert.equal(r.feito, 'respondeu');
  assert.equal(enviadas.length, 0);
});

test('a IA vê que o lead pediu para parar: não envia e encerra como "pulado"', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Dani', telefone: '5511911113005' });
  fu.colocarNoFollowup(leadId);
  respostaModelo = { enviar: false, mensagens: [], motivo: 'O lead disse que já contratou outra agência' };
  relogio += 25 * H;
  vencer(leadId);
  const r = await fu.processarFollowup(linha(leadId).id);
  assert.equal(r.feito, 'pulado');
  assert.equal(linha(leadId).status, 'pulado');
  assert.equal(enviadas.length, 0);
});

test('texto fixo no toque substitui a IA (com variáveis e versões "---")', async () => {
  await preparar();
  const toques = fu.PADRAO.toques.map((t, i) => (i === 0 ? { ...t, texto: 'Oi, {nome}! Tudo certo?\n---\nE aí, {nome}, conseguiu ver?' } : t));
  fu.salvarConfigFollowup({ toques });
  const leadId = await criarLeadDireto({ nome: 'Eva Lima', telefone: '5511911113006' });
  fu.colocarNoFollowup(leadId);
  relogio += 25 * H;
  vencer(leadId);
  await fu.processarFollowup(linha(leadId).id);
  assert.equal(pedidos.length, 0);
  assert.equal(enviadas[0].texto, 'E aí, Eva, conseguiu ver?');
});

test('travas: fora da janela não envia; limite do dia segura; intervalo entre follow-ups', async () => {
  await preparar();
  const a = await criarLeadDireto({ nome: 'Fê', telefone: '5511911113007' });
  const b = await criarLeadDireto({ nome: 'Gabi', telefone: '5511911113008' });
  fu.colocarNoFollowup(a);
  fu.colocarNoFollowup(b);
  relogio += 25 * H;
  // Janela de um só dia da semana que não é hoje
  const { momentoNoFuso } = await import('../src/modules/ia/horario.js');
  const hoje = momentoNoFuso(new Date(relogio), 'America/Sao_Paulo').dia;
  fu.salvarConfigFollowup({ dias: [(hoje + 3) % 7] });
  vencer(a);
  assert.equal((await fu.processarFollowup(linha(a).id)).feito, 'trava');
  assert.ok(Date.parse(linha(a).proximo_em) > relogio + 24 * H);
  // Volta a janela, intervalo de 2 a 3 min entre follow-ups
  fu.salvarConfigFollowup({ dias: TODOS_DIAS, intervalo_min_seg: 120, intervalo_max_seg: 180 });
  vencer(a); vencer(b);
  assert.equal((await fu.processarFollowup(linha(a).id)).feito, 'enviado');
  const rb = await fu.processarFollowup(linha(b).id);
  assert.equal(rb.feito, 'trava');
  assert.match(rb.motivo, /Intervalo/);
  // Limite de 1 por dia
  fu.salvarConfigFollowup({ max_por_dia: 1, intervalo_min_seg: 0, intervalo_max_seg: 0 });
  fu.zerarRitmo();
  run('UPDATE ia_registro SET created_at = ?', [new Date(relogio).toISOString()]); // o relógio do teste andou 25 h
  vencer(b);
  const rb2 = await fu.processarFollowup(linha(b).id);
  assert.equal(rb2.feito, 'trava');
  assert.match(rb2.motivo, /Limite de 1/);
});

test('a equipe falou com o lead: o próximo toque espera; tirar do follow-up encerra', async () => {
  await preparar({ espera_apos_equipe_horas: 24 });
  const leadId = await criarLeadDireto({ nome: 'Helô', telefone: '5511911113009' });
  fu.colocarNoFollowup(leadId);
  relogio += 23 * H;
  run(`INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, timestamp) VALUES (1, ?, 'h@s.whatsapp.net', 'H1', 1, 'texto', 'Fala, Helô!', ?)`, [leadId, new Date(relogio).toISOString()]);
  fu.aoMensagemHumana({ leadId });
  assert.ok(Date.parse(linha(leadId).proximo_em) >= relogio + 24 * H - 1000);
  fu.tirarDoFollowup(leadId);
  assert.equal(linha(leadId).status, 'removido');
});

test('11º toque enviado: o follow-up termina como "concluído"', async () => {
  await preparar();
  const leadId = await criarLeadDireto({ nome: 'Iris', telefone: '5511911113010' });
  fu.colocarNoFollowup(leadId);
  run('UPDATE ia_followups SET etapa = 10 WHERE lead_id = ?', [leadId]);
  relogio += 91 * 24 * H;
  vencer(leadId);
  const r = await fu.processarFollowup(linha(leadId).id);
  assert.equal(r.toque, 11);
  assert.equal(linha(leadId).status, 'concluido');
});

// ------------------------------------------------------------------ lembretes

function reuniao({ leadId, emHoras, agendouHaHoras = 100, link = 'https://meet.google.com/abc-defg-hij', uri = `u${Math.random()}` }) {
  run(`INSERT INTO calendly_events (uri, lead_id, event_name, start_time, status, join_url, booked_at, created_at) VALUES (?, ?, 'Reunião de Pré Contratação', ?, 'active', ?, ?, ?)`, [
    uri, leadId, new Date(relogio + emHoras * H).toISOString(), link, new Date(relogio - agendouHaHoras * H).toISOString(), new Date(relogio - agendouHaHoras * H).toISOString(),
  ]);
  return uri;
}

test('lembretes: sai o de 24 h na hora certa, uma vez só, mesmo com a equipe conversando', async () => {
  await preparar();
  lb.salvarConfigLembretes({ ativo: true });
  const leadId = await criarLeadDireto({ nome: 'Bruno Estefanoi', telefone: '5511911114001' });
  run("INSERT INTO ia_conversas (chave, lead_id, status) VALUES (?, ?, 'humano')", [`l:${leadId}`, leadId]);
  reuniao({ leadId, emHoras: 23.9 });
  const vencidos = lb.lembretesVencidos();
  assert.equal(vencidos.length, 1);
  assert.equal(vencidos[0].marco.id, '24h');
  const r = await lb.enviarLembrete(vencidos[0]);
  assert.equal(r.feito, 'enviado');
  assert.equal(enviadas[0].origem, 'lembrete');
  assert.match(enviadas[0].texto, /Bruno/);
  assert.equal(lb.lembretesVencidos().length, 0);
  // O de 3 dias (que passou junto) não sai depois
  assert.equal(get("SELECT status FROM ia_lembretes WHERE marco = '3d'")?.status, 'pulado');
});

test('lembretes: quem agendou em cima da hora só recebe os que vêm depois do agendamento', async () => {
  await preparar();
  lb.salvarConfigLembretes({ ativo: true });
  const leadId = await criarLeadDireto({ nome: 'Caio', telefone: '5511911114002' });
  reuniao({ leadId, emHoras: 2, agendouHaHoras: 0.1 });
  assert.equal(lb.lembretesVencidos().length, 0);
  relogio += 1.5 * H + 60000; // faltam ~29 min
  const v = lb.lembretesVencidos();
  assert.deepEqual(v.map((x) => x.marco.id), ['30m']);
});

test('lembretes: o link do Meet do lembrete não prova reunião feita; sem link, a frase do link sai', async () => {
  await preparar();
  lb.salvarConfigLembretes({ ativo: true });
  const leadId = await criarLeadDireto({ nome: 'Duda', telefone: '5511911114003' });
  reuniao({ leadId, emHoras: 0.45 });
  await lb.enviarLembrete(lb.lembretesVencidos()[0]);
  assert.match(enviadas[0].texto, /meet\.google\.com/);
  assert.equal(provaDeReuniao(leadId), null);

  const sem = lb.montarTexto('{nome}, falta meia hora para a nossa reunião ({hora}) 🙂 Link: {link}', {
    evento: { start_time: new Date(relogio + 0.5 * H).toISOString(), join_url: null }, lead: { name: 'Duda' }, ia: { fuso: 'America/Sao_Paulo', nome_atendente: 'Alice', empresa: 'Impera' },
  });
  assert.doesNotMatch(sem, /link/i);
  assert.match(sem, /^Duda, falta meia hora para a nossa reunião \(\d\d:\d\d\) 🙂$/);
});

test('lembretes: reunião cancelada ou no-show não recebe', async () => {
  await preparar();
  lb.salvarConfigLembretes({ ativo: true });
  const leadId = await criarLeadDireto({ nome: 'Elis', telefone: '5511911114004' });
  const uri = reuniao({ leadId, emHoras: 2.9 });
  run("UPDATE calendly_events SET status = 'canceled' WHERE uri = ?", [uri]);
  assert.equal(lb.lembretesVencidos().length, 0);
  run("UPDATE calendly_events SET status = 'active', no_show = 1 WHERE uri = ?", [uri]);
  assert.equal(lb.lembretesVencidos().length, 0);
  assert.equal(all('SELECT * FROM ia_lembretes').length, 0);
});
