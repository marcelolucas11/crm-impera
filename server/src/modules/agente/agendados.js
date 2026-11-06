// Agendados da Alice: tarefas que ela executa sozinha num horário ("todo dia às 8h resuma os grupos de clientes e
// me mande no WhatsApp").
//  - "Melhorar prompt": transforma o pedido escrito do jeito do usuário num prompt executável e PERGUNTA o que
//    faltar (horário, fuso, frequência, destino) antes de publicar.
//  - Frequências: uma vez, diário, dias úteis, dias da semana, mensal, a cada N horas, com fuso por agendado.
//  - Modelo e teto de custo por execução; teto diário dos agendados separado do chat.
//  - WhatsApp desconectado: a execução PARA (nem chama a IA) e fica marcada como "não enviada", com aviso no CRM.
//  - API instável: tenta de novo 2 vezes, com 5 minutos entre elas, e depois marca falha.
import { get, all, run, agora } from '../../db.js';
import { lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp, idValido, normalizarTelefone } from '../../util.js';
import { ErroIA } from '../ia/cliente.js';
import { MODELOS, nomeDoModelo } from '../ia/config.js';
import { socketConectado } from '../whatsapp/instancias.js';
import { lerConfig } from './config.js';
import { instanteNoFuso, dataHora, acharConversas, interpretarConversa } from './dados.js';
import { chamarModelo, textoDaResposta } from './cliente.js';
import { montarSistema } from './prompt.js';
import { registrarUso, statusTeto } from './uso.js';
import { criarConversa, gravarMensagemUsuario, executarTurno, registrarFalha } from './motor.js';
import { entregar } from './whatsapp.js';
import { registrarExecutor } from './acoes.js';

const TIPOS_FREQ = ['uma_vez', 'diario', 'dias_uteis', 'semanal', 'mensal', 'a_cada_horas'];
export const TIPOS_DESTINO = ['aba', 'proprio', 'numero', 'grupo'];
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ESPERA_TENTATIVA_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 3;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const executando = new Set();
let relogio = null;

const avisar = (userId, dados = {}) => emitir('agente', { usuario: userId, agendados: true, ...dados });

function fusoValido(f) {
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: String(f) }); return String(f); } catch { return null; }
}

// Partes da data no fuso
function partes(ms, fuso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), semana: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hora: Number(p.hour), minuto: Number(p.minute) };
}

export function normalizarFrequencia(f = {}) {
  const tipo = TIPOS_FREQ.includes(f.tipo) ? f.tipo : null;
  if (!tipo) throw new Error(`Frequência inválida. Use: ${TIPOS_FREQ.join(', ')}`);
  const saida = { tipo };
  if (tipo !== 'a_cada_horas') {
    if (!HORA.test(f.hora || '')) throw new Error('Informe a hora no formato HH:MM');
    saida.hora = f.hora;
  }
  if (tipo === 'semanal') {
    const dias = [...new Set((Array.isArray(f.dias) ? f.dias : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!dias.length) throw new Error('Escolha os dias da semana (0 = domingo … 6 = sábado)');
    saida.dias = dias;
  }
  if (tipo === 'mensal') {
    const d = Math.round(Number(f.dia_mes));
    if (!(d >= 1 && d <= 31)) throw new Error('Escolha o dia do mês (1 a 31)');
    saida.dia_mes = d;
  }
  if (tipo === 'a_cada_horas') {
    const h = Math.round(Number(f.horas));
    if (!(h >= 1 && h <= 168)) throw new Error('A cada quantas horas? (1 a 168)');
    saida.horas = h;
  }
  if (tipo === 'uma_vez') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.data || '')) throw new Error('Informe a data (AAAA-MM-DD)');
    saida.data = f.data;
  }
  return saida;
}

/** Próxima execução depois de "depoisMs" (null = não roda mais) */
export function proximaExecucao(freq, fuso, depoisMs = Date.now(), ultimaMs = null) {
  if (freq.tipo === 'a_cada_horas') {
    const base = ultimaMs ? ultimaMs + freq.horas * 3600e3 : depoisMs + 60e3;
    return new Date(Math.max(base, depoisMs + 30e3)).toISOString();
  }
  const [h, m] = freq.hora.split(':').map(Number);
  if (freq.tipo === 'uma_vez') {
    const [a, mes, d] = freq.data.split('-').map(Number);
    const t = instanteNoFuso(a, mes, d, h, m, fuso);
    return new Date(t).getTime() > depoisMs ? t : null;
  }
  for (let i = 0; i <= 62; i++) {
    const p = partes(depoisMs + i * 86400e3, fuso);
    const ok = freq.tipo === 'diario'
      || (freq.tipo === 'dias_uteis' && p.semana >= 1 && p.semana <= 5)
      || (freq.tipo === 'semanal' && freq.dias.includes(p.semana))
      || (freq.tipo === 'mensal' && p.dia === Math.min(freq.dia_mes, new Date(Date.UTC(p.ano, p.mes, 0)).getUTCDate()));
    if (!ok) continue;
    const t = instanteNoFuso(p.ano, p.mes, p.dia, h, m, fuso);
    if (new Date(t).getTime() > depoisMs) return t;
  }
  return null;
}

export function descreverFrequencia(f) {
  if (!f?.tipo) return '—';
  if (f.tipo === 'uma_vez') return `uma vez, em ${f.data.split('-').reverse().join('/')} às ${f.hora}`;
  if (f.tipo === 'diario') return `todo dia às ${f.hora}`;
  if (f.tipo === 'dias_uteis') return `de segunda a sexta às ${f.hora}`;
  if (f.tipo === 'semanal') return `${f.dias.map((d) => DIAS_SEMANA[d]).join(', ')} às ${f.hora}`;
  if (f.tipo === 'mensal') return `todo dia ${f.dia_mes} às ${f.hora}`;
  return `a cada ${f.horas} hora(s)`;
}

export function normalizarDestino(d = {}) {
  const tipo = TIPOS_DESTINO.includes(d.tipo) ? d.tipo : 'aba';
  const saida = { tipo };
  if (tipo === 'aba') return saida;
  const numeroId = idValido(d.numero_id) || get('SELECT id FROM wa_instances ORDER BY id LIMIT 1')?.id;
  if (!numeroId || !get('SELECT 1 AS ok FROM wa_instances WHERE id = ?', [numeroId])) throw new Error('Escolha o número de WhatsApp do CRM que vai enviar');
  saida.numero_id = numeroId;
  if (tipo === 'numero') {
    const t = normalizarTelefone(d.telefone);
    if (!t) throw new Error('Telefone de destino inválido');
    saida.telefone = t;
  }
  if (tipo === 'grupo') {
    let jid = /@g\.us$/.test(d.jid || '') ? d.jid : null;
    if (!jid && d.conversa) {
      const c = interpretarConversa(d.conversa);
      if (c?.tipo === 'grupo') jid = c.jid;
      else {
        const achados = acharConversas(d.conversa).filter((a) => a.tipo === 'grupo');
        if (achados.length === 1) jid = interpretarConversa(achados[0].chave).jid;
        else if (achados.length > 1) throw new Error(`Mais de um grupo bate com "${d.conversa}": ${achados.map((a) => a.nome).join(', ')}`);
      }
    }
    if (!jid) throw new Error('Grupo de destino não encontrado');
    saida.jid = jid;
    saida.nome = get('SELECT name FROM wa_chats WHERE jid = ?', [jid])?.name || null;
  }
  return saida;
}

export function descreverDestino(d) {
  if (!d || d.tipo === 'aba') return 'só na aba da assistente';
  const numero = get('SELECT name FROM wa_instances WHERE id = ?', [d.numero_id])?.name || `número ${d.numero_id}`;
  if (d.tipo === 'proprio') return `WhatsApp: "mensagem para mim" de ${numero}`;
  if (d.tipo === 'numero') return `WhatsApp: +${d.telefone} (enviado por ${numero})`;
  return `WhatsApp: grupo "${d.nome || d.jid}" (enviado por ${numero})`;
}

/** Valida tudo o que define um agendado */
export function validarAgendado(e, userId) {
  const cfg = lerConfig(userId);
  const nome = String(e.nome || '').trim().slice(0, 100);
  if (!nome) throw new Error('Dê um nome ao agendado');
  const prompt = String(e.prompt || '').trim().slice(0, 12000);
  if (!prompt) throw new Error('Escreva o que a assistente deve fazer (ou use "Melhorar prompt")');
  const fuso = fusoValido(e.fuso || cfg.fuso);
  if (!fuso) throw new Error('Fuso horário inválido');
  const frequencia = normalizarFrequencia(e.frequencia);
  const destino = normalizarDestino(e.destino);
  const modelo = MODELOS.some((m) => m.id === e.modelo) ? e.modelo : cfg.modelo_agendados;
  const teto = Math.min(50, Math.max(0.02, Number(String(e.teto_execucao_usd ?? 0.5).replace(',', '.')) || 0.5));
  const proxima = proximaExecucao(frequencia, fuso);
  if (!proxima) throw new Error('Esse horário já passou');
  return { nome, pedido: String(e.pedido || '').slice(0, 12000), prompt, fuso, frequencia, destino, modelo, teto_execucao_usd: teto, proxima_em: proxima };
}

function mapear(a) {
  if (!a) return null;
  const frequencia = lerJson(a.frequencia);
  const destino = lerJson(a.destino);
  return {
    ...a, ativo: Boolean(a.ativo), frequencia, destino, perguntas: lerJson(a.perguntas, []),
    frequencia_texto: descreverFrequencia(frequencia), destino_texto: descreverDestino(destino), modelo_nome: nomeDoModelo(a.modelo || ''),
  };
}

export function listarAgendados(userId) {
  return all('SELECT * FROM agente_agendados WHERE user_id = ? ORDER BY ativo DESC, proxima_em IS NULL, proxima_em, id DESC', [userId]).map(mapear);
}

export function obterAgendado(userId, id) {
  const a = get('SELECT * FROM agente_agendados WHERE id = ? AND user_id = ?', [id, userId]);
  if (!a) throw new ErroHttp(404, 'Agendado não encontrado');
  return mapear(a);
}

export function execucoesDe(userId, id, limite = 30) {
  obterAgendado(userId, id);
  return all('SELECT * FROM agente_execucoes WHERE agendado_id = ? ORDER BY id DESC LIMIT ?', [id, limite]);
}

export function criarAgendado(userId, entrada) {
  let v;
  try { v = validarAgendado(entrada, userId); } catch (err) { throw new ErroHttp(400, err.message); }
  const id = Number(run(
    `INSERT INTO agente_agendados (user_id, nome, pedido, prompt, perguntas, frequencia, fuso, modelo, teto_execucao_usd, destino, ativo, proxima_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [userId, v.nome, v.pedido, v.prompt, JSON.stringify(entrada.perguntas || []), JSON.stringify(v.frequencia), v.fuso, v.modelo, v.teto_execucao_usd, JSON.stringify(v.destino), v.proxima_em]
  ).lastInsertRowid);
  avisar(userId);
  return obterAgendado(userId, id);
}

export function atualizarAgendado(userId, id, entrada) {
  const atual = obterAgendado(userId, id);
  if (entrada.ativo !== undefined && Object.keys(entrada).length === 1) {
    const ativo = Boolean(entrada.ativo);
    const proxima = ativo ? proximaExecucao(atual.frequencia, atual.fuso) : atual.proxima_em;
    if (ativo && !proxima) throw new ErroHttp(400, 'Esse agendado não tem mais horário futuro: edite a data');
    run('UPDATE agente_agendados SET ativo = ?, proxima_em = ?, updated_at = ? WHERE id = ?', [ativo ? 1 : 0, proxima, agora(), id]);
    avisar(userId);
    return obterAgendado(userId, id);
  }
  let v;
  try { v = validarAgendado({ ...atual, ...entrada }, userId); } catch (err) { throw new ErroHttp(400, err.message); }
  run(
    `UPDATE agente_agendados SET nome = ?, pedido = ?, prompt = ?, perguntas = ?, frequencia = ?, fuso = ?, modelo = ?, teto_execucao_usd = ?, destino = ?,
            ativo = ?, proxima_em = ?, updated_at = ? WHERE id = ?`,
    [v.nome, v.pedido, v.prompt, JSON.stringify(entrada.perguntas ?? atual.perguntas ?? []), JSON.stringify(v.frequencia), v.fuso, v.modelo, v.teto_execucao_usd,
      JSON.stringify(v.destino), entrada.ativo === undefined ? (atual.ativo ? 1 : 0) : (entrada.ativo ? 1 : 0), v.proxima_em, agora(), id]
  );
  avisar(userId);
  return obterAgendado(userId, id);
}

export function apagarAgendado(userId, id) {
  obterAgendado(userId, id);
  run('DELETE FROM agente_agendados WHERE id = ?', [id]);
  avisar(userId);
}

// ------------------------------------------------------------------ "Melhorar prompt"

function lerJsonSolto(texto) {
  const t = String(texto || '').replace(/```(?:json)?/gi, '');
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

/**
 * Transforma o pedido do usuário no prompt que será executado e diz o que falta perguntar.
 * entrada: { pedido, nome?, respostas?: [{ pergunta, resposta }], atual?: { frequencia, fuso, destino }, modelo? }
 * Devolve { nome, prompt, frequencia, fuso, destino, perguntas: [texto] }
 */
export async function melhorarPrompt(userId, entrada = {}) {
  const pedido = String(entrada.pedido || '').trim();
  if (!pedido) throw new ErroHttp(400, 'Escreva o que você quer que a assistente faça');
  const st = statusTeto(userId, 'chat');
  if (st.atingido) throw new ErroHttp(429, 'O teto de gasto do chat de hoje foi atingido (o "Melhorar prompt" conta nele)');
  const cfg = lerConfig(userId);
  const usuario = get('SELECT id, name, role FROM users WHERE id = ?', [userId]);
  const grupos = all("SELECT jid, name FROM wa_chats WHERE is_group = 1 AND name IS NOT NULL ORDER BY updated_at DESC LIMIT 80").map((g) => `${g.name} → g:${g.jid}`).join('\n');
  const numeros = all('SELECT id, name, phone FROM wa_instances ORDER BY id').map((n) => `${n.id}: ${n.name || ''} ${n.phone ? `(+${n.phone})` : ''} — ${socketConectado(n.id) ? 'conectado' : 'desconectado'}`).join('\n');
  const respostas = (Array.isArray(entrada.respostas) ? entrada.respostas : []).filter((r) => r?.resposta).map((r) => `- ${r.pergunta}: ${r.resposta}`).join('\n');
  const instrucao = `Você vai preparar um AGENDADO (tarefa recorrente que você mesma executará sozinha, sem ninguém para responder perguntas na hora).
Pedido do usuário, do jeito dele:
"""${pedido}"""
${respostas ? `Respostas que ele já deu:\n${respostas}\n` : ''}${entrada.atual ? `Configuração atual na tela: ${JSON.stringify(entrada.atual)}\n` : ''}
Grupos do WhatsApp conhecidos (nome → chave):
${grupos || '(nenhum)'}
Números do CRM:
${numeros || '(nenhum)'}
Fuso padrão do usuário: ${cfg.fuso}.

Responda SOMENTE com um objeto JSON:
{
 "nome": "nome curto do agendado",
 "prompt": "instrução COMPLETA e autossuficiente para você executar a cada vez: o que ler (grupos/leads/filtros com nomes e chaves exatas), o período (ex.: desde 'hoje' ou 'ontem'), o que extrair, o formato da resposta final (títulos, listas, o que destacar), e o que fazer se não houver nada",
 "frequencia": { "tipo": "uma_vez|diario|dias_uteis|semanal|mensal|a_cada_horas", "hora": "HH:MM", "dias": [0-6], "dia_mes": 1-31, "horas": N, "data": "AAAA-MM-DD" },
 "fuso": "IANA, ex. America/Sao_Paulo",
 "destino": { "tipo": "aba|proprio|numero|grupo", "numero_id": N, "telefone": "só dígitos", "conversa": "chave g:... do grupo" },
 "perguntas": ["perguntas curtas sobre o que FALTA para executar bem (horário, fuso, frequência, destino, quais grupos, período) — vazio se nada faltar"]
}
Use null nos campos que ainda não dá para saber e pergunte por eles. Não invente horário nem destino que ele não disse; use o fuso padrão só se ele não falar de outro lugar.`;
  const modelo = MODELOS.some((m) => m.id === entrada.modelo) ? entrada.modelo : cfg.modelo_chat;
  const sistema = montarSistema({ userId, usuario, origem: 'chat' });
  const r = await chamarModelo({ sistema, mensagens: [{ role: 'user', content: instrucao }], modelo, maxTokens: 4000 });
  registrarUso(userId, 'prompt', modelo, r.usage);
  const obj = lerJsonSolto(textoDaResposta(r));
  if (!obj?.prompt) throw new ErroIA('A assistente não devolveu o prompt no formato esperado. Tente de novo.');
  return {
    nome: obj.nome || entrada.nome || '',
    prompt: String(obj.prompt).trim(),
    frequencia: obj.frequencia && obj.frequencia.tipo ? obj.frequencia : null,
    fuso: fusoValido(obj.fuso) || cfg.fuso,
    destino: obj.destino && obj.destino.tipo ? obj.destino : null,
    perguntas: (Array.isArray(obj.perguntas) ? obj.perguntas : []).map((p) => String(p).trim()).filter(Boolean).slice(0, 6),
  };
}

// ------------------------------------------------------------------ execução

const precisaWhatsApp = (destino) => destino && destino.tipo !== 'aba';

function concluir(ag, execId, status, campos = {}) {
  const fim = agora();
  run('UPDATE agente_execucoes SET status = ?, fim = ?, resposta = ?, custo_usd = ?, erro = ?, enviado_para = ? WHERE id = ?',
    [status, fim, campos.resposta ?? null, campos.custo ?? 0, campos.erro ?? null, campos.enviado_para ?? null, execId]);
  const proxima = campos.tentarDeNovoEm || proximaExecucao(ag.frequencia, ag.fuso, Date.now(), ag.frequencia.tipo === 'a_cada_horas' ? Date.now() : null);
  run('UPDATE agente_agendados SET ultima_em = ?, ultimo_status = ?, proxima_em = ?, ativo = CASE WHEN ? IS NULL THEN 0 ELSE ativo END, updated_at = ? WHERE id = ?',
    [fim, status, proxima, proxima, fim, ag.id]);
}

/**
 * Executa um agendado. manual = "Rodar agora" (não mexe no horário da próxima execução).
 * Devolve a execução gravada.
 */
export async function executarAgendado(agendadoId, { manual = false, tentativa = 1 } = {}) {
  const linha = get('SELECT * FROM agente_agendados WHERE id = ?', [agendadoId]);
  if (!linha) throw new ErroHttp(404, 'Agendado não encontrado');
  const ag = mapear(linha);
  const userId = ag.user_id;
  if (executando.has(ag.id)) throw new ErroHttp(409, 'Este agendado já está rodando');
  executando.add(ag.id);
  const execId = Number(run('INSERT INTO agente_execucoes (agendado_id, manual, tentativa) VALUES (?, ?, ?)', [ag.id, manual ? 1 : 0, tentativa]).lastInsertRowid);
  avisar(userId, { agendado: ag.id });
  const fecharManual = (status, campos) => {
    run('UPDATE agente_execucoes SET status = ?, fim = ?, resposta = ?, custo_usd = ?, erro = ?, enviado_para = ? WHERE id = ?',
      [status, agora(), campos.resposta ?? null, campos.custo ?? 0, campos.erro ?? null, campos.enviado_para ?? null, execId]);
    run('UPDATE agente_agendados SET ultima_em = ?, ultimo_status = ? WHERE id = ?', [agora(), status, ag.id]);
  };
  const fechar = manual ? fecharManual : (status, campos) => concluir(ag, execId, status, campos);
  let conversaId = null;
  try {
    // WhatsApp fora do ar: para aqui (nem gasta com a IA)
    if (precisaWhatsApp(ag.destino) && !socketConectado(ag.destino.numero_id)) {
      const erro = 'O WhatsApp que envia está desconectado: a tarefa parou e não foi enviada.';
      fechar('nao_enviada', { erro });
      emitir('agente', { usuario: userId, alerta: `Agendado "${ag.nome}" não rodou: WhatsApp desconectado` });
      return get('SELECT * FROM agente_execucoes WHERE id = ?', [execId]);
    }
    if (statusTeto(userId, 'agendados').atingido) {
      fechar('teto', { erro: 'O teto de gasto diário dos agendados foi atingido' });
      return get('SELECT * FROM agente_execucoes WHERE id = ?', [execId]);
    }
    conversaId = ag.conversa_id && get('SELECT id FROM agente_conversas WHERE id = ?', [ag.conversa_id])?.id;
    if (!conversaId) {
      conversaId = criarConversa(userId, { titulo: `⏰ ${ag.nome}`, origem: 'agendado', agendadoId: ag.id, modelo: ag.modelo });
      run('UPDATE agente_agendados SET conversa_id = ? WHERE id = ?', [conversaId, ag.id]);
    }
    const cfg = lerConfig(userId);
    const cabecalho = `[Execução ${manual ? 'manual' : 'agendada'} de ${dataHora(new Date().toISOString(), ag.fuso)} (${ag.fuso}) — ${ag.frequencia_texto}]`;
    const msg = await gravarMensagemUsuario(userId, conversaId, { texto: `${cabecalho}\n${ag.prompt}` });
    const r = await executarTurno({
      userId, conversaId, conteudoUsuario: msg.conteudo, modelo: ag.modelo || cfg.modelo_agendados, origem: 'agendado', tetoExecucao: ag.teto_execucao_usd,
      extraSistema: `Agendado: "${ag.nome}". Fuso desta tarefa: ${ag.fuso}. Destino do resultado: ${ag.destino_texto}.`,
    });
    let enviadoPara = 'aba da assistente';
    if (precisaWhatsApp(ag.destino)) {
      try {
        enviadoPara = await entregar(ag.destino, r.texto, userId);
      } catch (err) {
        fechar('nao_enviada', { resposta: r.texto, custo: r.custo, erro: `Pronto, mas não foi enviado: ${err.message}` });
        run("INSERT INTO agente_mensagens (conversa_id, papel, texto) VALUES (?, 'evento', ?)", [conversaId, `⚠️ Não enviado ao WhatsApp: ${err.message}`]);
        emitir('agente', { usuario: userId, alerta: `Agendado "${ag.nome}" ficou pronto mas não foi enviado: ${err.message}` });
        return get('SELECT * FROM agente_execucoes WHERE id = ?', [execId]);
      }
      run("INSERT INTO agente_mensagens (conversa_id, papel, texto) VALUES (?, 'evento', ?)", [conversaId, `📤 Enviado para ${enviadoPara}`]);
    }
    fechar('ok', { resposta: r.texto, custo: r.custo, enviado_para: enviadoPara });
  } catch (err) {
    const temporario = err instanceof ErroIA && err.temporario;
    if (!manual && temporario && tentativa < MAX_TENTATIVAS) {
      concluir(ag, execId, 'aguardando_tentativa', { erro: `${err.message} (nova tentativa em 5 min)`, tentarDeNovoEm: new Date(Date.now() + ESPERA_TENTATIVA_MS).toISOString() });
      run('UPDATE agente_agendados SET ultimo_status = ? WHERE id = ?', [`tentativa:${tentativa + 1}`, ag.id]);
    } else {
      fechar('falhou', { erro: err.message });
      if (conversaId) registrarFalha(userId, conversaId, err);
      emitir('agente', { usuario: userId, alerta: `Agendado "${ag.nome}" falhou: ${err.message}` });
    }
  } finally {
    executando.delete(ag.id);
    avisar(userId, { agendado: ag.id });
  }
  return get('SELECT * FROM agente_execucoes WHERE id = ?', [execId]);
}

/** Relógio: a cada 30 s roda o que venceu (um de cada vez por agendado) */
export async function verificarAgendados(agoraMs = Date.now()) {
  const vencidos = all(
    'SELECT a.id, a.ultimo_status FROM agente_agendados a JOIN users u ON u.id = a.user_id WHERE a.ativo = 1 AND u.active = 1 AND a.proxima_em IS NOT NULL AND a.proxima_em <= ? ORDER BY a.proxima_em LIMIT 10',
    [new Date(agoraMs).toISOString()]
  );
  for (const v of vencidos) {
    if (executando.has(v.id)) continue;
    const tentativa = /^tentativa:(\d)$/.test(v.ultimo_status || '') ? Number(v.ultimo_status.split(':')[1]) : 1;
    executarAgendado(v.id, { tentativa }).catch((err) => console.error('[agente] agendado', v.id, err.message));
  }
  return vencidos.length;
}

export function iniciarRelogioAgendados() {
  pararRelogioAgendados();
  relogio = setInterval(() => { verificarAgendados().catch(() => {}); }, 30000);
  relogio.unref?.();
}

export function pararRelogioAgendados() {
  if (relogio) clearInterval(relogio);
  relogio = null;
}

export const emExecucao = (id) => executando.has(id);

// A Alice também pode propor um agendado no chat (vira cartão de aprovação)
registrarExecutor('criar_agendado', {
  validar(d, ctx) {
    const v = validarAgendado(d, ctx.userId);
    return {
      dados: { ...d, ...v },
      resumo: `Agendado "${v.nome}": ${descreverFrequencia(v.frequencia)} (${v.fuso}) → ${descreverDestino(v.destino)}`,
      editaveis: ['nome', 'prompt'],
    };
  },
  executar(d, userId) {
    const a = criarAgendado(userId, d);
    return { agendado_id: a.id };
  },
});
