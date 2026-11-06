// Motor da Alice: conversas, histórico e o laço de ferramentas.
//  1) monta o prompt (regras + cérebro + esquema) e o histórico da conversa;
//  2) chama o modelo com as ferramentas; enquanto ele pedir ferramentas, executa (em paralelo) e devolve os resultados;
//  3) grava a resposta final, as fontes usadas (conversas e leads, que viram links na tela) e o custo.
// Roda em segundo plano: a tela acompanha pelo tempo real ("Lendo o grupo X…"). Tetos de custo por dia (chat e
// agendados separados) e, nos agendados, teto por execução.
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, agora } from '../../db.js';
import { config } from '../../config.js';
import { lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { ErroIA } from '../ia/cliente.js';
import { MODELOS, nomeDoModelo } from '../ia/config.js';
import { custoDaChamada } from '../organizador/config.js';
import { chamarModelo, textoDaResposta } from './cliente.js';
import { lerConfig } from './config.js';
import { montarSistema } from './prompt.js';
import { DEFINICOES, executarFerramenta, descreverChamada, blocoDeArquivo } from './ferramentas.js';
import { registrarUso, statusTeto } from './uso.js';
import { ehAudio } from './documentos.js';
import * as transcricao from './transcricao.js';

const MAX_RODADAS = 16;
const MAX_RESULTADO = 80000;
const RESULTADO_ANTIGO = 1500;
const TURNOS_COMPLETOS = 2;
const MAX_LINHAS_HISTORICO = 40;
export const PASTA_ANEXOS = path.join(config.filesDir, 'agente');

const rodando = new Map(); // conversaId → Promise
const avisar = (userId, dados) => emitir('agente', { usuario: userId, ...dados });

// ------------------------------------------------------------------ conversas

export function criarConversa(userId, { titulo = null, origem = 'chat', agendadoId = null, modelo = null } = {}) {
  const id = Number(run('INSERT INTO agente_conversas (user_id, titulo, origem, agendado_id, modelo) VALUES (?, ?, ?, ?, ?)',
    [userId, titulo ? String(titulo).slice(0, 120) : null, origem, agendadoId, modelo]).lastInsertRowid);
  return id;
}

export function obterConversaBruta(userId, id) {
  const c = get('SELECT * FROM agente_conversas WHERE id = ? AND user_id = ?', [id, userId]);
  if (!c) throw new ErroHttp(404, 'Conversa não encontrada');
  return c;
}

export function listarConversas(userId, { arquivadas = false, limite = 200 } = {}) {
  return all(
    `SELECT c.id, c.titulo, c.origem, c.agendado_id, c.status, c.etapa, c.arquivada, c.created_at, c.updated_at,
            (SELECT texto FROM agente_mensagens m WHERE m.conversa_id = c.id AND m.papel IN ('usuario', 'alice') ORDER BY m.id DESC LIMIT 1) AS ultima,
            (SELECT count(*) FROM agente_acoes a WHERE a.conversa_id = c.id AND a.status = 'pendente') AS pendentes
       FROM agente_conversas c WHERE c.user_id = ? AND c.arquivada = ? ORDER BY c.updated_at DESC LIMIT ?`,
    [userId, arquivadas ? 1 : 0, limite]
  ).map((c) => ({ ...c, arquivada: Boolean(c.arquivada), ultima: c.ultima ? String(c.ultima).slice(0, 140) : null }));
}

export function mensagensParaTela(userId, conversaId) {
  obterConversaBruta(userId, conversaId);
  return all('SELECT id, papel, texto, anexos, fontes, modelo, custo_usd, created_at FROM agente_mensagens WHERE conversa_id = ? ORDER BY id', [conversaId])
    .map((m) => ({ ...m, anexos: lerJson(m.anexos, []), fontes: lerJson(m.fontes, []), modelo_nome: m.modelo ? nomeDoModelo(m.modelo) : null }));
}

export function atualizarConversa(userId, id, { titulo, arquivada } = {}) {
  obterConversaBruta(userId, id);
  if (titulo !== undefined) run('UPDATE agente_conversas SET titulo = ? WHERE id = ?', [String(titulo).trim().slice(0, 120) || null, id]);
  if (arquivada !== undefined) run('UPDATE agente_conversas SET arquivada = ? WHERE id = ?', [arquivada ? 1 : 0, id]);
}

function marcarEtapa(userId, conversaId, etapa, status = 'pensando') {
  run('UPDATE agente_conversas SET status = ?, etapa = ?, erro = NULL, updated_at = ? WHERE id = ?', [status, etapa, agora(), conversaId]);
  avisar(userId, { conversa: conversaId, etapa, status });
}

// ------------------------------------------------------------------ anexos

export function guardarAnexo(userId, { caminhoTemporario, nome, mime, tamanho }) {
  const pasta = path.join(PASTA_ANEXOS, String(userId));
  fs.mkdirSync(pasta, { recursive: true });
  const ext = path.extname(String(nome || '')).slice(0, 10).replace(/[^.\w]/g, '');
  const rel = path.join('agente', String(userId), `a${Date.now()}${Math.random().toString(36).slice(2, 7)}${ext}`);
  fs.copyFileSync(caminhoTemporario, path.join(config.filesDir, rel));
  const id = Number(run('INSERT INTO agente_anexos (user_id, nome, mime, caminho, tamanho) VALUES (?, ?, ?, ?, ?)',
    [userId, String(nome || 'arquivo').slice(0, 200), String(mime || 'application/octet-stream').slice(0, 100), rel, tamanho || null]).lastInsertRowid);
  return { id, nome, mime, tamanho };
}

export function anexoDoUsuario(userId, id) {
  const a = get('SELECT * FROM agente_anexos WHERE id = ? AND user_id = ?', [id, userId]);
  if (!a) throw new ErroHttp(404, 'Anexo não encontrado');
  return { ...a, absoluto: path.join(config.filesDir, a.caminho) };
}

/** Transcreve um áudio anexado (ditado por voz ou áudio mandado no chat). Guarda o texto no anexo. */
export async function transcreverAnexo(userId, id) {
  const a = anexoDoUsuario(userId, id);
  if (a.texto) return a.texto;
  const texto = await transcricao.transcreverArquivo(a.absoluto);
  run('UPDATE agente_anexos SET texto = ? WHERE id = ?', [texto, id]);
  return texto;
}

// Blocos de um anexo para o modelo (imagem/PDF direto; áudio transcrito; documento em texto)
async function blocosDoAnexo(userId, id) {
  let a;
  try { a = anexoDoUsuario(userId, id); } catch { return [{ type: 'text', text: `[anexo ${id} não encontrado]` }]; }
  if (!fs.existsSync(a.absoluto)) return [{ type: 'text', text: `[anexo "${a.nome}" não está mais no servidor]` }];
  if (ehAudio(a.mime, a.nome)) {
    try {
      const texto = await transcreverAnexo(userId, id);
      return [{ type: 'text', text: `[Áudio anexado "${a.nome}" — transcrição: "${texto}"]` }];
    } catch (err) {
      return [{ type: 'text', text: `[Áudio anexado "${a.nome}" — não consegui transcrever: ${err.message}]` }];
    }
  }
  const r = blocoDeArquivo(a.absoluto, { mime: a.mime, nome: a.nome });
  return typeof r === 'string' ? [{ type: 'text', text: `[Anexo] ${r}` }] : r;
}

// ------------------------------------------------------------------ histórico para a API

function encolherBloco(b) {
  if (b.type === 'image') return { type: 'text', text: '[imagem vista antes nesta conversa]' };
  if (b.type === 'document') return { type: 'text', text: '[PDF lido antes nesta conversa]' };
  if (b.type === 'tool_result') {
    const texto = typeof b.content === 'string' ? b.content
      : (b.content || []).map((x) => (x.type === 'text' ? x.text : x.type === 'image' ? '[imagem]' : '[PDF]')).join('\n');
    return { ...b, content: texto.length > RESULTADO_ANTIGO ? `${texto.slice(0, RESULTADO_ANTIGO)}… [resultado antigo encurtado; chame a ferramenta de novo se precisar]` : texto };
  }
  return b;
}

const SEM_REPETIR = new Set(['thinking', 'redacted_thinking']);
const blocos = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);

/** Monta as mensagens da API a partir do que está guardado (os 2 últimos turnos inteiros; os antigos encolhidos) */
async function historicoParaApi(userId, conversaId, { ateId = null } = {}) {
  const linhas = all(
    `SELECT * FROM (SELECT id, papel, texto, conteudo FROM agente_mensagens WHERE conversa_id = ? ${ateId ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?) ORDER BY id`,
    ateId ? [conversaId, ateId, MAX_LINHAS_HISTORICO] : [conversaId, MAX_LINHAS_HISTORICO]
  );
  const turnosAlice = linhas.filter((l) => l.papel === 'alice').map((l) => l.id);
  const recentes = new Set(turnosAlice.slice(-TURNOS_COMPLETOS));
  const msgs = [];
  for (const l of linhas) {
    if (l.papel === 'evento') { msgs.push({ role: 'user', content: [{ type: 'text', text: `[Aviso do sistema] ${l.texto}` }] }); continue; }
    if (l.papel === 'usuario') {
      const guardado = lerJson(l.conteudo, null);
      const content = [];
      for (const b of Array.isArray(guardado) ? guardado : [{ type: 'text', text: l.texto || '' }]) {
        if (b.type === 'anexo') content.push({ type: 'text', text: `[anexo enviado antes: ${b.nome || b.id}]` });
        else content.push(b);
      }
      msgs.push({ role: 'user', content: content.length ? content : [{ type: 'text', text: '(vazio)' }] });
      continue;
    }
    const turno = lerJson(l.conteudo, null);
    if (!Array.isArray(turno) || !turno.length) { msgs.push({ role: 'assistant', content: [{ type: 'text', text: l.texto || '(sem resposta)' }] }); continue; }
    for (const m of turno) {
      // Pensamentos de turnos anteriores ficam de fora: a API só aceita um pensamento com o mesmo texto fixo e o mesmo
      // começo de conversa de quando ele foi criado, e o texto fixo muda a cada turno (hora, diretrizes, memória).
      let content = blocos(m.content).filter((b) => !SEM_REPETIR.has(b.type));
      if (!recentes.has(l.id)) content = content.map(encolherBloco);
      if (!content.length) content = [{ type: 'text', text: m.role === 'assistant' ? '(sem texto)' : '(vazio)' }];
      msgs.push({ ...m, content });
    }
  }
  // A conversa precisa começar com o usuário
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

// ------------------------------------------------------------------ laço do agente

function custoTexto(v) {
  return `US$ ${v.toFixed(v < 0.1 ? 4 : 2).replace('.', ',')}`;
}

/**
 * Executa um turno: o modelo responde à última mensagem do usuário usando as ferramentas.
 *  origem: chat | whatsapp | agendado · tetoExecucao (US$): só nos agendados
 * Devolve { texto, custo, fontes, acoes, mensagemId }.
 */
export async function executarTurno({ userId, conversaId, conteudoUsuario, modelo = null, origem = 'chat', tetoExecucao = null, extraSistema = null }) {
  const usuario = get('SELECT id, name, role FROM users WHERE id = ?', [userId]);
  if (!usuario) throw new ErroHttp(404, 'Usuário não encontrado');
  const cfg = lerConfig(userId);
  const teto = origem === 'agendado' ? 'agendados' : 'chat';
  const modeloUsado = MODELOS.some((m) => m.id === modelo) ? modelo : origem === 'agendado' ? cfg.modelo_agendados : cfg.modelo_chat;
  const st = statusTeto(userId, teto);
  if (st.atingido) {
    throw new ErroIA(`O teto de gasto ${teto === 'chat' ? 'do chat' : 'dos agendados'} de hoje (${custoTexto(st.teto)}) foi atingido. Volta à meia-noite ou aumente o teto em Ajustes.`, { status: 429, tipo: 'teto' });
  }

  const sistema = montarSistema({ userId, usuario, origem, extra: extraSistema });
  const historico = await historicoParaApi(userId, conversaId);
  const mensagens = [...historico, { role: 'user', content: conteudoUsuario }];
  const novos = [];
  const fontes = new Map();
  const acoes = [];
  let custo = 0;
  let ultima = null;
  const ferramentas = DEFINICOES;
  const ctx = {
    userId, papel: usuario.role, cfg, fuso: cfg.fuso, conversaId, origem, acoes,
    fonte: (f) => {
      if (!f) return;
      const chave = f.tipo === 'lead' ? `l:${f.id || String(f.chave || '').slice(2)}` : f.chave;
      if (chave && !fontes.has(chave)) fontes.set(chave, { tipo: f.tipo === 'lead' ? 'lead' : 'conversa', chave, id: f.id || null, nome: f.nome || chave });
    },
    progresso: (texto) => marcarEtapa(userId, conversaId, texto),
  };

  for (let rodada = 0; rodada <= MAX_RODADAS; rodada++) {
    const tetoDia = statusTeto(userId, teto);
    const passouExecucao = tetoExecucao && custo >= tetoExecucao;
    const encerrar = rodada === MAX_RODADAS || tetoDia.atingido || passouExecucao;
    if (encerrar && rodada > 0) {
      mensagens.push({ role: 'user', content: [{ type: 'text', text: `[Aviso do sistema] ${passouExecucao ? 'O teto de custo desta execução foi atingido.' : tetoDia.atingido ? 'O teto de gasto de hoje foi atingido.' : 'Você chegou ao limite de consultas deste pedido.'} Responda agora com o que já tem, dizendo o que ficou faltando.` }] });
    }
    marcarEtapa(userId, conversaId, rodada === 0 ? 'Pensando' : 'Juntando o que encontrei');
    const resp = await chamarModelo({
      sistema, mensagens, ferramentas, modelo: modeloUsado, maxTokens: 8000,
      ...(encerrar && rodada > 0 ? { toolChoice: { type: 'none' } } : {}),
    });
    custo += registrarUso(userId, origem === 'agendado' ? 'agendado' : origem === 'whatsapp' ? 'whatsapp' : 'chat', modeloUsado, resp.usage);
    const conteudo = (resp.content || []).filter((b) => !(b.type === 'text' && !b.text));
    const msgAssistente = { role: 'assistant', content: conteudo.length ? conteudo : [{ type: 'text', text: '(sem resposta)' }] };
    mensagens.push(msgAssistente);
    novos.push(msgAssistente);
    ultima = resp;
    const pedidos = conteudo.filter((b) => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !pedidos.length || (encerrar && rodada > 0)) break;

    marcarEtapa(userId, conversaId, pedidos.map((p) => descreverChamada(p.name, p.input)).slice(0, 3).join(' · ') + (pedidos.length > 3 ? ` (+${pedidos.length - 3})` : ''));
    const documentos = [];
    const resultados = await Promise.all(pedidos.map(async (p) => {
      const r = await executarFerramenta(p.name, p.input, ctx);
      let content = r.conteudo;
      if (typeof content === 'string' && content.length > MAX_RESULTADO) content = `${content.slice(0, MAX_RESULTADO)}\n… (resultado cortado: refine a busca com período ou filtros)`;
      // PDFs vão logo depois dos resultados (não dentro deles): é o formato que a API sempre aceita
      if (Array.isArray(content) && content.some((b) => b.type === 'document')) {
        documentos.push(...content.filter((b) => b.type === 'document'));
        content = content.filter((b) => b.type !== 'document');
        content.push({ type: 'text', text: '(o PDF está logo abaixo destes resultados)' });
      }
      return { type: 'tool_result', tool_use_id: p.id, content: typeof content === 'string' ? content || '(vazio)' : content, ...(r.erro ? { is_error: true } : {}) };
    }));
    const msgResultados = { role: 'user', content: [...resultados, ...documentos] };
    mensagens.push(msgResultados);
    novos.push(msgResultados);
  }

  let texto = textoDaResposta(ultima);
  if (ultima?.stop_reason === 'max_tokens') texto += '\n\n_(A resposta passou do tamanho máximo e foi cortada. Peça para continuar.)_';
  if (!texto) texto = acoes.length ? 'Deixei para a sua aprovação.' : '(sem resposta)';
  // Ações propostas neste turno que não foram mencionadas: a tela mostra os cartões de qualquer forma
  const listaFontes = [...fontes.values()].slice(0, 30);
  const mensagemId = Number(run(
    "INSERT INTO agente_mensagens (conversa_id, papel, texto, conteudo, fontes, modelo, custo_usd) VALUES (?, 'alice', ?, ?, ?, ?, ?)",
    [conversaId, texto, JSON.stringify(novos), JSON.stringify(listaFontes), modeloUsado, custo]
  ).lastInsertRowid);
  run("UPDATE agente_conversas SET status = 'ociosa', etapa = NULL, modelo = ?, updated_at = ? WHERE id = ?", [modeloUsado, agora(), conversaId]);
  avisar(userId, { conversa: conversaId, status: 'ociosa', mensagem: mensagemId });
  return { texto, custo, fontes: listaFontes, acoes, mensagemId };
}

/** Grava a mensagem do usuário (texto + anexos) e devolve { id, conteudo para a API } */
export async function gravarMensagemUsuario(userId, conversaId, { texto = '', anexoIds = [] } = {}) {
  const ids = (Array.isArray(anexoIds) ? anexoIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10);
  const anexos = ids.map((id) => { const a = anexoDoUsuario(userId, id); return { id, nome: a.nome, mime: a.mime }; });
  const limpo = String(texto || '').trim().slice(0, 20000);
  if (!limpo && !anexos.length) throw new ErroHttp(400, 'Escreva uma mensagem ou anexe um arquivo');
  const guardado = [...anexos.map((a) => ({ type: 'anexo', id: a.id, nome: a.nome })), ...(limpo ? [{ type: 'text', text: limpo }] : [])];
  const id = Number(run("INSERT INTO agente_mensagens (conversa_id, papel, texto, conteudo, anexos) VALUES (?, 'usuario', ?, ?, ?)",
    [conversaId, limpo, JSON.stringify(guardado), JSON.stringify(anexos)]).lastInsertRowid);
  // Conteúdo para a API: anexos abertos (imagem/PDF/documento/áudio transcrito) + texto
  const conteudo = [];
  for (const a of anexos) conteudo.push(...await blocosDoAnexo(userId, a.id));
  if (limpo) conteudo.push({ type: 'text', text: limpo });
  const conv = get('SELECT titulo FROM agente_conversas WHERE id = ?', [conversaId]);
  if (!conv?.titulo) run('UPDATE agente_conversas SET titulo = ? WHERE id = ?', [(limpo || anexos[0]?.nome || 'Conversa').replace(/\s+/g, ' ').slice(0, 70), conversaId]);
  run('UPDATE agente_conversas SET updated_at = ? WHERE id = ?', [agora(), conversaId]);
  return { id, conteudo: conteudo.length ? conteudo : [{ type: 'text', text: '(anexo)' }] };
}

/**
 * Mensagem nova no chat: grava, responde em segundo plano e devolve na hora.
 * Devolve { mensagem_id }. A resposta chega pelo tempo real.
 */
export async function enviarNoChat(userId, conversaId, { texto, anexoIds, modelo, origem = 'chat' }) {
  obterConversaBruta(userId, conversaId);
  if (rodando.has(conversaId)) throw new ErroHttp(409, 'A assistente ainda está respondendo a mensagem anterior nesta conversa');
  const st = statusTeto(userId, 'chat');
  if (st.atingido) throw new ErroHttp(429, `O teto de gasto do chat de hoje (${custoTexto(st.teto)}) foi atingido. Volta à meia-noite ou aumente o teto em Ajustes.`);
  marcarEtapa(userId, conversaId, anexoIds?.length ? 'Abrindo os anexos' : 'Pensando');
  let msg;
  try {
    msg = await gravarMensagemUsuario(userId, conversaId, { texto, anexoIds });
  } catch (err) {
    run("UPDATE agente_conversas SET status = 'ociosa', etapa = NULL WHERE id = ?", [conversaId]);
    throw err;
  }
  const tarefa = executarTurno({ userId, conversaId, conteudoUsuario: msg.conteudo, modelo, origem })
    .catch((err) => registrarFalha(userId, conversaId, err))
    .finally(() => rodando.delete(conversaId));
  rodando.set(conversaId, tarefa);
  return { mensagem_id: msg.id, tarefa };
}

export function registrarFalha(userId, conversaId, err) {
  const texto = err instanceof ErroIA || err instanceof ErroHttp ? err.message : `Erro inesperado: ${err.message}`;
  if (!(err instanceof ErroIA) && !(err instanceof ErroHttp)) console.error('[agente]', err);
  run("INSERT INTO agente_mensagens (conversa_id, papel, texto) VALUES (?, 'evento', ?)", [conversaId, `⚠️ ${texto}`]);
  run("UPDATE agente_conversas SET status = 'erro', etapa = NULL, erro = ?, updated_at = ? WHERE id = ?", [texto.slice(0, 500), agora(), conversaId]);
  avisar(userId, { conversa: conversaId, status: 'erro' });
  return { erro: texto };
}

export const respondendoAgora = (conversaId) => rodando.has(conversaId);
export const aguardarConversa = (conversaId) => rodando.get(conversaId) || Promise.resolve();

/** Ao ligar o CRM: conversas que ficaram "pensando" quando ele desligou voltam ao normal */
export function soltarPresas() {
  run("UPDATE agente_conversas SET status = 'ociosa', etapa = NULL WHERE status = 'pensando'");
}

export { custoDaChamada };
