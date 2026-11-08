// Relatórios da IA sobre o Instagram: semanal automático (toda segunda, por padrão), na hora (botão) ou de um período
// escolhido. A IA recebe os números que o CRM guardou (perfil, publicações, formatos, horários, anúncios, Direct e leads)
// e escreve a análise com o que repetir, cortar e testar. Modelo e prompt do analista ficam em Instagram → Ajustes.
import { get, all, run, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { chaveApi, nomeDoModelo } from '../ia/config.js';
import { perguntarModelo, ErroIA } from '../ia/cliente.js';
import { custoDaChamada } from '../organizador/config.js';
import { lerConfig, fuso } from './config.js';
import { periodoEmDias, periodoAnterior, resumoDoPeriodo, listarPosts, horarios, listarAnuncios, formato } from './desempenho.js';
import { diaNoFuso, somarDias, inicioDoDia } from './metricas.js';
import { registrar } from './perfis.js';

const emCurso = new Set();

export function gastoHoje() {
  return get('SELECT COALESCE(sum(custo_usd), 0) AS v FROM ig_relatorios WHERE criado_em >= ?', [new Date(inicioDoDia(diaNoFuso())).toISOString()]).v;
}

function enxugarPost(p) {
  return {
    formato: p.formato, publicado: p.publicado_em, legenda: p.legenda ? p.legenda.slice(0, 160) : null,
    visualizacoes: p.visualizacoes, alcance: p.alcance, curtidas: p.curtidas, comentarios: p.comentarios, salvamentos: p.salvamentos,
    compartilhamentos: p.compartilhamentos, seguiram: p.seguiram, engajamento_pct: p.engajamento, tempo_medio_s: p.tempo_medio_s,
    taxa_pulo: p.taxa_pulo, pago: p.pago,
  };
}

/** Pacote de dados que vai para a IA (também fica guardado junto do relatório) */
export function dadosDoRelatorio({ perfilId = null, de, ate }) {
  const p = periodoEmDias({ inicio: new Date(inicioDoDia(de)).toISOString(), fim: new Date(inicioDoDia(somarDias(ate, 1))).toISOString() });
  const antes = periodoAnterior(p);
  const atual = resumoDoPeriodo(perfilId, p);
  const anterior = resumoDoPeriodo(perfilId, antes);
  const posts = listarPosts({ perfilId, inicio: new Date(inicioDoDia(p.de)).toISOString(), fim: new Date(inicioDoDia(somarDias(p.ate, 1))).toISOString(), ordenar: 'visualizacoes', limite: 200 });
  const stories = listarPosts({ perfilId, inicio: new Date(inicioDoDia(p.de)).toISOString(), fim: new Date(inicioDoDia(somarDias(p.ate, 1))).toISOString(), formato: 'stories', limite: 100 });
  const comNumeros = posts.filter((x) => x.visualizacoes !== null);
  const perfis = perfilId
    ? all('SELECT id, username, seguidores FROM ig_perfis WHERE id = ?', [perfilId])
    : all('SELECT id, username, seguidores FROM ig_perfis WHERE ativo = 1');
  const h = horarios(perfilId);
  return {
    perfis: perfis.map((x) => ({ username: x.username, seguidores: x.seguidores })),
    periodo: { de: p.de, ate: p.ate, dias: p.dias, fuso: fuso() },
    periodo_anterior: { de: antes.de, ate: antes.ate },
    numeros: atual,
    numeros_periodo_anterior: anterior,
    melhores_publicacoes: comNumeros.slice(0, 8).map(enxugarPost),
    piores_publicacoes: comNumeros.length > 8 ? comNumeros.slice(-5).map(enxugarPost) : [],
    stories: { quantidade: stories.length, alcance_medio: stories.length ? Math.round(stories.reduce((t, s) => t + (s.alcance || 0), 0) / stories.length) : null },
    publicacoes_por_formato: comNumeros.reduce((r, x) => {
      const k = x.formato;
      r[k] = r[k] || { publicacoes: 0, visualizacoes: 0, interacoes: 0, alcance: 0 };
      r[k].publicacoes++; r[k].visualizacoes += x.visualizacoes || 0; r[k].interacoes += x.interacoes || 0; r[k].alcance += x.alcance || 0;
      return r;
    }, {}),
    melhores_horarios_publicacao: h.publicacao.slice(0, 6),
    seguidores_online_por_hora: h.seguidores_online.filter((x) => x.seguidores !== null),
    anuncios: listarAnuncios({ perfilId, inicio: new Date(inicioDoDia(p.de)).toISOString(), fim: new Date(inicioDoDia(somarDias(p.ate, 1))).toISOString() }).slice(0, 15),
    comparativo_perfis: perfilId ? null : perfis.length > 1 ? perfis.map((x) => {
      const r = resumoDoPeriodo(x.id, p);
      return { username: x.username, seguidores: x.seguidores, ganho: r.ganho_seguidores, visualizacoes: r.visualizacoes, interacoes: r.interacoes, conversas: r.direct.conversas_novas, leads: r.direct.leads + r.leads_formulario };
    }) : null,
  };
}

const FORMATO_RESPOSTA = `

# Formato do relatório
Escreva em Markdown, em português do Brasil, com estes títulos (## ):
1. Resumo (3 a 5 frases com o principal do período)
2. Números do período (tabela: indicador, período, anterior, variação)
3. O que funcionou (publicações e motivos prováveis)
4. O que não funcionou
5. Formatos e horários
6. Direct, leads e anúncios (orgânico × pago, custo por conversa e por lead quando houver)
7. Ações para a próxima semana (lista numerada, curta e prática)
Use só os números recebidos. Quando um número não veio (null), diga que a Meta não informou; não invente.`;

/** Começa a gerar um relatório (em segundo plano). Devolve o id. */
export function pedirRelatorio({ perfilId = null, de = null, ate = null, tipo = 'manual', userId = null, modelo = null } = {}) {
  const cfg = lerConfig();
  if (!chaveApi()) throw new ErroHttp(400, 'Cole a chave da API da Anthropic na tela IA antes de gerar relatórios');
  if (gastoHoje() >= cfg.teto_relatorios_dia) throw new ErroHttp(429, `O teto de gasto com relatórios hoje (US$ ${cfg.teto_relatorios_dia}) foi atingido. Ajuste em Instagram → Ajustes.`);
  const hoje = diaNoFuso();
  const fim = ate || somarDias(hoje, -1);
  const inicio = de || somarDias(fim, -6);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim) throw new ErroHttp(400, 'Período inválido');
  const perfil = perfilId ? get('SELECT username FROM ig_perfis WHERE id = ?', [perfilId]) : null;
  if (perfilId && !perfil) throw new ErroHttp(404, 'Perfil não encontrado');
  const titulo = `${tipo === 'semanal' ? 'Semanal' : 'Relatório'} ${perfil ? `@${perfil.username}` : 'todos os perfis'} · ${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}`;
  const modeloFinal = modelo || cfg.relatorio_modelo;
  const id = Number(run('INSERT INTO ig_relatorios (perfil_id, tipo, titulo, inicio, fim, status, modelo, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    perfilId || null, tipo, titulo, inicio, fim, 'gerando', modeloFinal, userId,
  ]).lastInsertRowid);
  emitir('instagram', { relatorio: id });
  gerar(id).catch((err) => console.error('[instagram] relatório:', err.message));
  return id;
}

let chamadaFalsa = null;
export function definirChamadaFalsaRelatorio(fn) { chamadaFalsa = fn; }

async function gerar(id) {
  if (emCurso.has(id)) return;
  emCurso.add(id);
  const r = get('SELECT * FROM ig_relatorios WHERE id = ?', [id]);
  const cfg = lerConfig();
  try {
    const dados = dadosDoRelatorio({ perfilId: r.perfil_id, de: r.inicio, ate: r.fim });
    run('UPDATE ig_relatorios SET dados = ? WHERE id = ?', [JSON.stringify(dados), id]);
    const sistema = `${cfg.prompt_analista}${FORMATO_RESPOSTA}`;
    const pedido = `Dados do Instagram (JSON; números somados no período, "null" = a Meta não informou):\n<dados>\n${JSON.stringify(dados)}\n</dados>\n\nEscreva o relatório.`;
    const resposta = chamadaFalsa
      ? await chamadaFalsa({ sistema, pedido, modelo: r.modelo })
      : await perguntarModelo({ sistema, mensagens: [{ role: 'user', content: pedido }], modelo: r.modelo, maxTokens: 6000, tempoMs: 240000 });
    const custo = custoDaChamada(r.modelo, resposta.uso);
    if (!resposta.texto) throw new ErroIA('O modelo não devolveu texto');
    run("UPDATE ig_relatorios SET status = 'pronto', texto = ?, custo_usd = ?, concluido_em = ?, erro = NULL WHERE id = ?", [resposta.texto, custo, agora(), id]);
    registrar(r.perfil_id, 'relatorio', `${r.titulo} pronto (${nomeDoModelo(r.modelo)}, US$ ${custo.toFixed(3)})`);
  } catch (err) {
    run("UPDATE ig_relatorios SET status = 'erro', erro = ?, concluido_em = ? WHERE id = ?", [String(err.message).slice(0, 500), agora(), id]);
    registrar(r.perfil_id, 'erro', `Relatório: ${err.message}`);
  } finally {
    emCurso.delete(id);
    emitir('instagram', { relatorio: id });
  }
}

export function listarRelatorios({ limite = 60 } = {}) {
  return all(
    `SELECT r.id, r.perfil_id, p.username, r.tipo, r.titulo, r.inicio, r.fim, r.status, r.modelo, r.custo_usd, r.erro, r.criado_em, r.concluido_em, u.name AS criado_por
       FROM ig_relatorios r LEFT JOIN ig_perfis p ON p.id = r.perfil_id LEFT JOIN users u ON u.id = r.criado_por
      ORDER BY r.id DESC LIMIT ?`,
    [limite]
  ).map((r) => ({ ...r, modelo_nome: r.modelo ? nomeDoModelo(r.modelo) : null }));
}

export function obterRelatorio(id) {
  const r = get('SELECT r.*, p.username FROM ig_relatorios r LEFT JOIN ig_perfis p ON p.id = r.perfil_id WHERE r.id = ?', [id]);
  if (!r) throw new ErroHttp(404, 'Relatório não encontrado');
  return { ...r, dados: undefined, modelo_nome: r.modelo ? nomeDoModelo(r.modelo) : null };
}

/** Relatórios que ficaram "gerando" quando o CRM foi desligado: marca como erro (dá para pedir de novo) */
export function soltarPresos() {
  run("UPDATE ig_relatorios SET status = 'erro', erro = 'O CRM foi reiniciado enquanto o relatório era gerado. Peça de novo.' WHERE status = 'gerando'");
}

/** Relatório semanal: no dia e hora configurados, um por semana (todos os perfis, últimos 7 dias completos) */
export function verificarSemanal(agoraMs = Date.now()) {
  const cfg = lerConfig();
  if (!cfg.relatorio_semanal || !chaveApi()) return null;
  if (!get('SELECT 1 AS ok FROM ig_perfis WHERE ativo = 1 LIMIT 1')) return null;
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(agoraMs)).map((x) => [x.type, x.value]));
  const diaSemana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
  if (diaSemana !== cfg.relatorio_dia) return null;
  if (`${partes.hour}:${partes.minute}` < cfg.relatorio_hora) return null;
  const hoje = diaNoFuso(agoraMs);
  const inicioHoje = new Date(inicioDoDia(hoje)).toISOString();
  if (get("SELECT 1 AS ok FROM ig_relatorios WHERE tipo = 'semanal' AND criado_em >= ?", [inicioHoje])) return null;
  try {
    return pedirRelatorio({ tipo: 'semanal', de: somarDias(hoje, -7), ate: somarDias(hoje, -1) });
  } catch (err) {
    registrar(null, 'aviso', `Relatório semanal não gerado: ${err.message}`);
    // Grava uma linha de erro para não tentar de novo a cada minuto
    run("INSERT INTO ig_relatorios (tipo, titulo, inicio, fim, status, erro) VALUES ('semanal', 'Semanal (não gerado)', ?, ?, 'erro', ?)", [somarDias(hoje, -7), somarDias(hoje, -1), String(err.message).slice(0, 300)]);
    return null;
  }
}

export { formato };
