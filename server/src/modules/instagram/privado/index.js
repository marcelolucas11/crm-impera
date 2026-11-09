// Plugin "Direct pelo login do Instagram" (não oficial): o CRM entra no perfil como o app do celular, usando o cookie
// sessionid, e lê/responde o Direct sem a Análise do app da Meta e sem a janela de 24 h.
//  - Motor em Python (biblioteca instagrapi), num processo separado (motor.py). Instalado sob demanda pelo botão
//    "Instalar motor", numa pasta própria (dados/instagram-login) que as atualizações do CRM não apagam.
//  - Liga por perfil (ig_perfis.config.direct_motor = 'login'). Desempenho, publicações, comentários e anúncios
//    continuam pela API oficial; só o Direct muda de caminho. Desligar volta tudo para a API oficial.
//  - Busca a caixa de entrada a cada ~45 s (com variação, para parecer gente) e as solicitações de mensagem a cada
//    ~3 min. Grava pelo mesmo caminho do Direct oficial (direct.registrarMensagem): tela, Alice e leads não mudam.
//  - Proteções: confere que o cookie é do mesmo @ do perfil; para tudo (sem insistir) quando o Instagram pede
//    verificação ou derruba a sessão; espera 30–60 min quando avisa de limite; o cookie fica só no banco do CRM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../../../config.js';
import { get, all, run, agora } from '../../../db.js';
import { lerEstado, salvarEstado } from '../../../estado.js';
import { emitir } from '../../../tempoReal.js';
import { ErroHttp } from '../../../util.js';
import { lerConfig } from '../config.js';
import {
  obterPerfil, atualizarPerfil, configDoPerfil, motorDoPerfil, registrar, lerCredencial, salvarCredencial,
  apagarCredencial, perfisAtivos,
} from '../perfis.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOTOR_PY = path.join(AQUI, 'motor.py');
export const VERSAO_BIBLIOTECA = '3.2.8';
export const PASTA = () => process.env.IG_LOGIN_DIR || path.join(path.dirname(config.dbFile), 'instagram-login');
const VENV = () => path.join(PASTA(), 'venv');
const PYTHON = () => path.join(VENV(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const SESSOES = () => path.join(PASTA(), 'sessoes');
const MARCA = () => path.join(PASTA(), 'instalado.json');

export const INTERVALO_PADRAO_SEG = 45;
const INTERVALO_MIN_SEG = 20;
const INTERVALO_MAX_SEG = 600;
const PENDENTES_MS = 3 * 60000;
const AO_VIVO_MS = 15 * 60000;
const ESPERA_LIMITE_MIN = { limite: 30, bloqueio: 60 };

const chaveCred = (perfilId) => `login:${perfilId}`;
const chaveEstado = (perfilId) => `instagram_login_${perfilId}`;

export class ErroMotor extends Error {
  constructor(mensagem, tipo = 'outro') {
    super(mensagem);
    this.tipo = tipo;
  }
}

// ------------------------------------------------------------------ testes

let falso = null;
/** Testes: troca o motor Python por fn(cmd, dados) => resposta (ou lança ErroMotor) */
export function definirMotorFalso(fn) { falso = fn; }

// ------------------------------------------------------------------ instalação (Python + instagrapi numa pasta própria)

let instalacao = { status: 'parada' }; // parada | instalando | ok | erro

export const instalado = () => Boolean(falso) || (fs.existsSync(MARCA()) && fs.existsSync(PYTHON()));

function rodar(cmd, args, { env = {}, tempoMs = 15 * 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    const guardar = (d) => { saida = (saida + d.toString()).slice(-4000); };
    proc.stdout.on('data', guardar);
    proc.stderr.on('data', guardar);
    const relogio = setTimeout(() => proc.kill('SIGKILL'), tempoMs);
    proc.on('error', (err) => { clearTimeout(relogio); reject(new Error(`${cmd}: ${err.message}`)); });
    proc.on('close', (code) => {
      clearTimeout(relogio);
      if (code === 0) resolve(saida);
      else reject(new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} terminou com erro ${code}: ${saida.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

async function instalarAgora() {
  fs.mkdirSync(PASTA(), { recursive: true });
  const pacote = `instagrapi==${VERSAO_BIBLIOTECA}`;
  const tentativas = [];
  // 1) Python da própria VPS (python3 -m venv)
  try {
    if (!fs.existsSync(PYTHON())) await rodar('python3', ['-m', 'venv', VENV()], { tempoMs: 5 * 60000 });
    await rodar(PYTHON(), ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', pacote]);
  } catch (err) {
    tentativas.push(err.message);
    fs.rmSync(VENV(), { recursive: true, force: true });
    // 2) Sem python3-venv (comum no Ubuntu sem root): uv, que baixa um Python próprio para dentro da pasta
    const pastaUv = path.join(PASTA(), 'uv');
    const uv = path.join(pastaUv, 'uv');
    const env = { UV_PYTHON_INSTALL_DIR: path.join(PASTA(), 'python'), UV_CACHE_DIR: path.join(PASTA(), 'cache'), UV_NO_MODIFY_PATH: '1', UV_INSTALL_DIR: pastaUv };
    try {
      if (!fs.existsSync(uv)) await rodar('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], { env, tempoMs: 5 * 60000 });
      await rodar(uv, ['venv', '--python', '3.12', VENV()], { env });
      await rodar(uv, ['pip', 'install', '--python', PYTHON(), pacote], { env });
    } catch (err2) {
      tentativas.push(err2.message);
      throw new Error(`Não consegui instalar o motor. ${tentativas.join(' | ')}`.slice(0, 900));
    }
  }
  const versao = (await rodar(PYTHON(), ['-c', 'import instagrapi, importlib.metadata as m; print(m.version("instagrapi"))'], { tempoMs: 120000 })).trim();
  fs.writeFileSync(MARCA(), JSON.stringify({ versao, em: agora() }));
  return versao;
}

export function instalar() {
  if (instalacao.status === 'instalando') return estadoInstalacao();
  instalacao = { status: 'instalando', inicio: agora() };
  emitir('instagram', { login: true });
  instalarAgora()
    .then((versao) => {
      instalacao = { status: 'ok', versao, fim: agora() };
      registrar(null, 'conexao', `Motor do Direct pelo login instalado (instagrapi ${versao})`);
    })
    .catch((err) => {
      instalacao = { status: 'erro', erro: err.message, fim: agora() };
      registrar(null, 'erro', `Instalação do motor do Direct pelo login: ${err.message}`);
    })
    .finally(() => emitir('instagram', { login: true }));
  return estadoInstalacao();
}

export function estadoInstalacao() {
  let versao = null;
  try { versao = JSON.parse(fs.readFileSync(MARCA(), 'utf8')).versao; } catch { /* não instalado */ }
  return { instalado: instalado(), versao, ...instalacao, ...(instalacao.status === 'parada' && instalado() ? { status: 'ok' } : {}) };
}

// ------------------------------------------------------------------ processo Python

let proc = null;
let pronto = null;
let stderr = '';
const pendentes = new Map();
let seq = 0;

function iniciarMotor() {
  if (pronto) return pronto;
  if (!instalado()) return Promise.reject(new ErroMotor('O motor ainda não foi instalado (botão "Instalar motor").', 'instalacao'));
  fs.mkdirSync(SESSOES(), { recursive: true, mode: 0o700 });
  pronto = new Promise((resolve, reject) => {
    const p = spawn(PYTHON(), ['-u', MOTOR_PY], {
      env: { ...process.env, IG_PRIVADO_SESSOES: SESSOES(), PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc = p;
    stderr = '';
    const espera = setTimeout(() => reject(new ErroMotor('O motor não ligou a tempo', 'tempo')), 60000);
    readline.createInterface({ input: p.stdout }).on('line', (linha) => {
      let msg;
      try { msg = JSON.parse(linha); } catch { return; }
      if (msg.evento === 'pronto') { clearTimeout(espera); resolve(); return; }
      if (msg.evento === 'falha') { clearTimeout(espera); reject(new ErroMotor(msg.erro, 'instalacao')); return; }
      const pedido = pendentes.get(msg.id);
      if (!pedido) return;
      pendentes.delete(msg.id);
      clearTimeout(pedido.relogio);
      if (msg.ok) pedido.resolve(msg);
      else pedido.reject(new ErroMotor(msg.erro || 'Erro no motor', msg.tipo || 'outro'));
    });
    p.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-3000); });
    p.on('error', (err) => { clearTimeout(espera); reject(new ErroMotor(`Não consegui ligar o motor: ${err.message}`, 'instalacao')); });
    p.on('exit', (code) => {
      clearTimeout(espera);
      if (proc === p) { proc = null; pronto = null; }
      for (const [id, pedido] of pendentes) {
        clearTimeout(pedido.relogio);
        pedido.reject(new ErroMotor(`O motor parou (código ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`.trim(), 'motor'));
        pendentes.delete(id);
      }
    });
  });
  pronto.catch(() => { if (proc) proc.kill(); proc = null; pronto = null; });
  return pronto;
}

export function pararMotor() {
  if (proc) proc.kill();
  proc = null;
  pronto = null;
}

/** Um pedido ao motor (um por vez no Python; aqui só fica na fila) */
export async function pedir(cmd, dados = {}, { tempoMs = 150000 } = {}) {
  if (falso) return falso(cmd, dados);
  await iniciarMotor();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => {
      pendentes.delete(id);
      reject(new ErroMotor('O Instagram demorou demais para responder', 'rede'));
    }, tempoMs);
    pendentes.set(id, { resolve, reject, relogio });
    proc.stdin.write(`${JSON.stringify({ id, cmd, ...dados })}\n`);
  });
}

// ------------------------------------------------------------------ credenciais e estado por perfil

function lerAcesso(perfilId) {
  const c = lerCredencial(chaveCred(perfilId));
  if (!c?.token) return null;
  try { return JSON.parse(c.token); } catch { return null; }
}

const acessoParaMotor = (perfilId) => {
  const a = lerAcesso(perfilId);
  if (!a?.sessionid) throw new ErroMotor('Perfil sem cookie de login guardado', 'login');
  return { perfil: perfilId, sessionid: a.sessionid, proxy: a.proxy || null };
};

export const estadoDoPerfil = (perfilId) => lerEstado(chaveEstado(perfilId)) || {};
const salvarEstadoPerfil = (perfilId, dados) => salvarEstado(chaveEstado(perfilId), dados);

export function intervaloDoPerfil(perfil) {
  const n = Number(configDoPerfil(perfil).login_intervalo_seg) || INTERVALO_PADRAO_SEG;
  return Math.min(INTERVALO_MAX_SEG, Math.max(INTERVALO_MIN_SEG, n));
}

/** Estado para a tela (nunca mostra o cookie nem a senha do proxy) */
export function estadoParaTela(perfilId) {
  const p = get('SELECT * FROM ig_perfis WHERE id = ?', [perfilId]);
  if (!p) return null;
  const e = estadoDoPerfil(perfilId);
  const a = lerAcesso(perfilId);
  let proxy = null;
  if (a?.proxy) {
    try { const u = new URL(a.proxy); proxy = `${u.protocol}//${u.username ? '***@' : ''}${u.hostname}:${u.port || ''}`; } catch { proxy = '***'; }
  }
  return {
    ligado: motorDoPerfil(p) === 'login', com_cookie: Boolean(a?.sessionid), proxy,
    username: e.username || null, conectado_em: e.conectado_em || null, ultima_busca_em: e.ultima_busca_em || null,
    parado: Boolean(e.parado), erro: e.erro || null, erro_tipo: e.erro_tipo || null, erro_em: e.erro_em || null,
    pausado_ate: e.pausado_ate && e.pausado_ate > agora() ? e.pausado_ate : null,
    intervalo_seg: intervaloDoPerfil(p), historico_em: e.historico_em || null,
  };
}

/** Texto amigável para cada tipo de erro do motor */
function explicar(err) {
  const base = String(err?.message || err || '').slice(0, 200);
  return ({
    login: 'O Instagram encerrou a sessão (cookie vencido ou saiu da conta). Pegue um sessionid novo e conecte de novo.',
    desafio: 'O Instagram pediu verificação de segurança. Abra o app do perfil, confirme que foi você e conecte de novo com um cookie novo.',
    suspensa: 'O Instagram suspendeu ou restringiu a conta. Resolva pelo app antes de ligar de novo.',
    bloqueio: 'O Instagram bloqueou ações por um tempo ("tente mais tarde"). O CRM espera 1 hora antes de tentar de novo.',
    limite: 'O Instagram pediu para ir mais devagar. O CRM espera 30 minutos antes de tentar de novo.',
    proxy: 'O proxy foi recusado pelo Instagram. Troque o proxy ou deixe em branco.',
    rede: 'Sem resposta do Instagram agora (rede). Tenta de novo na próxima busca.',
    instalacao: base || 'O motor não está instalado.',
    bloqueado_pela_pessoa: 'Essa pessoa não aceita mensagens deste perfil.',
    nao_existe: 'Conversa não encontrada no Instagram.',
  })[err?.tipo] || base || 'Erro no motor do Instagram';
}

/** Trata um erro de busca ou envio: para, pausa ou só anota (devolve a mensagem amigável) */
function tratarErro(perfilId, err, onde) {
  const texto = explicar(err);
  const tipo = err?.tipo || 'outro';
  const dados = { erro: texto, erro_tipo: tipo, erro_em: agora() };
  if (['login', 'desafio', 'suspensa'].includes(tipo)) dados.parado = true;
  if (ESPERA_LIMITE_MIN[tipo]) dados.pausado_ate = new Date(Date.now() + ESPERA_LIMITE_MIN[tipo] * 60000).toISOString();
  salvarEstadoPerfil(perfilId, dados);
  if (dados.parado || dados.pausado_ate || estadoDoPerfil(perfilId).ultimo_erro_registrado !== texto) {
    registrar(perfilId, 'erro', `Direct pelo login (${onde}): ${texto}${tipo === 'outro' ? ` [${String(err?.message || '').slice(0, 150)}]` : ''}`);
    salvarEstadoPerfil(perfilId, { ultimo_erro_registrado: texto });
  }
  emitir('instagram', { perfil: perfilId, login: true });
  return texto;
}

// ------------------------------------------------------------------ conectar / desconectar

/** Limpa o que a pessoa colou: "sessionid=123%3Aabc;" → "123%3Aabc" */
export function limparSessionid(valor) {
  let s = String(valor || '').trim().replace(/^["']|["';]+$/g, '');
  const m = s.match(/sessionid=([^;\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/:/g, '%3A').trim();
  if (!/^\d{5,}%3A[\w%-]{10,}/.test(s)) throw new ErroHttp(400, 'Isso não parece um sessionid do Instagram (começa com números e "%3A"). Veja o passo a passo na tela.');
  return s;
}

export function limparProxy(valor) {
  const s = String(valor || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new ErroHttp(400, 'Proxy inválido. Use o formato http://usuario:senha@host:porta'); }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(u.protocol) || !u.hostname || !u.port) throw new ErroHttp(400, 'Proxy inválido. Use http://usuario:senha@host:porta (ou socks5://...)');
  return s;
}

/**
 * Liga o Direct pelo login num perfil já conectado pela API oficial.
 * dados: { sessionid, proxy } — proxy undefined mantém o atual; '' remove.
 */
export async function conectar(perfilId, { sessionid, proxy } = {}) {
  const perfil = obterPerfil(perfilId);
  if (!perfil.ativo) throw new ErroHttp(409, 'Conecte o perfil pela Meta primeiro (as estatísticas continuam por lá)');
  if (!instalado()) throw new ErroHttp(409, 'Instale o motor primeiro (botão "Instalar motor")');
  const atual = lerAcesso(perfilId) || {};
  const acesso = {
    sessionid: sessionid ? limparSessionid(sessionid) : atual.sessionid,
    proxy: proxy === undefined ? atual.proxy || null : limparProxy(proxy),
  };
  if (!acesso.sessionid) throw new ErroHttp(400, 'Cole o sessionid do perfil');
  let r;
  try {
    r = await pedir('entrar', { perfil: perfil.id, ...acesso });
  } catch (err) {
    if (err instanceof ErroMotor) throw new ErroHttp(422, explicar(err));
    throw err;
  }
  const esperado = String(perfil.username || '').toLowerCase();
  if (esperado && String(r.username || '').toLowerCase() !== esperado) {
    await pedir('sair', { perfil: perfil.id, apagar_sessao: true }).catch(() => {});
    throw new ErroHttp(400, `Esse cookie é da conta @${r.username}, não do @${perfil.username}. Pegue o cookie com o @${perfil.username} aberto no navegador.`);
  }
  salvarCredencial(chaveCred(perfil.id), { token: JSON.stringify(acesso), tipo: 'login', conta: r.username });
  atualizarPerfil(perfil.id, { config: JSON.stringify({ ...configDoPerfil(perfil), direct_motor: 'login' }) });
  const novo = !estadoDoPerfil(perfil.id).historico_em;
  salvarEstadoPerfil(perfil.id, {
    pk: r.pk, username: r.username, conectado_em: agora(), parado: false, erro: null, erro_tipo: null, pausado_ate: null,
    proxima_em: null, pendentes_em: null, ultimo_erro_registrado: null,
  });
  registrar(perfil.id, 'conexao', `Direct pelo login ligado no @${r.username}${acesso.proxy ? ' (com proxy)' : ''}`);
  emitir('instagram', { perfis: true, login: true });
  // Primeira vez: importa as conversas recentes, com o que o Instagram entregar de cada uma
  if (novo) tarefa(perfil.id, () => sincronizar(perfil.id, { historico: true }));
  return estadoParaTela(perfil.id);
}

/** Desliga o Direct pelo login: o perfil volta para a API oficial (apagarCookie = esquece o cookie também) */
export async function desligar(perfilId, { apagarCookie = true } = {}) {
  const perfil = obterPerfil(perfilId);
  await pedir('sair', { perfil: perfil.id, apagar_sessao: apagarCookie }).catch(() => {});
  if (apagarCookie) apagarCredencial(chaveCred(perfil.id));
  atualizarPerfil(perfil.id, { config: JSON.stringify({ ...configDoPerfil(perfil), direct_motor: 'oficial' }) });
  salvarEstadoPerfil(perfil.id, { parado: false, erro: null, erro_tipo: null, pausado_ate: null });
  registrar(perfil.id, 'conexao', 'Direct pelo login desligado: o Direct volta para a API oficial da Meta');
  emitir('instagram', { perfis: true, login: true });
  return estadoParaTela(perfil.id);
}

export function definirIntervalo(perfilId, segundos) {
  const perfil = obterPerfil(perfilId);
  const n = Math.min(INTERVALO_MAX_SEG, Math.max(INTERVALO_MIN_SEG, Math.round(Number(segundos) || INTERVALO_PADRAO_SEG)));
  atualizarPerfil(perfil.id, { config: JSON.stringify({ ...configDoPerfil(perfil), login_intervalo_seg: n }) });
  return estadoParaTela(perfil.id);
}

// ------------------------------------------------------------------ pessoas e conversas

const isoDeMicro = (us) => (us ? new Date(Math.floor(Number(us) / 1000)).toISOString() : null);

/**
 * IGSID usado pelo CRM para a pessoa. Se ela já falou com o perfil pela API oficial (mesmo @), reaproveita a
 * conversa antiga; senão usa "p<pk>" (o pk é o número da pessoa no Instagram).
 */
export function igsidDaPessoa(perfil, u) {
  const pk = String(u.pk);
  const porPk = get('SELECT igsid FROM ig_contatos WHERE perfil_id = ? AND pk = ?', [perfil.id, pk]);
  if (porPk) return porPk.igsid;
  if (u.username) {
    const porUsuario = get('SELECT igsid FROM ig_contatos WHERE perfil_id = ? AND lower(username) = lower(?) AND pk IS NULL ORDER BY atualizado_em DESC LIMIT 1', [perfil.id, u.username]);
    if (porUsuario) {
      run('UPDATE ig_contatos SET pk = ? WHERE perfil_id = ? AND igsid = ?', [pk, perfil.id, porUsuario.igsid]);
      return porUsuario.igsid;
    }
  }
  const igsid = `p${pk}`;
  run('INSERT INTO ig_contatos (perfil_id, igsid, pk) VALUES (?, ?, ?) ON CONFLICT(perfil_id, igsid) DO UPDATE SET pk = excluded.pk', [perfil.id, igsid, pk]);
  return igsid;
}

async function atualizarContato(perfil, igsid, u, { foto = true } = {}) {
  const fotoNova = Boolean(u.foto) && foto;
  run(
    'UPDATE ig_contatos SET username = COALESCE(?, username), nome = COALESCE(?, nome), verificado = ?, foto_url = COALESCE(?, foto_url), atualizado_em = ? WHERE perfil_id = ? AND igsid = ?',
    [u.username || null, u.nome || null, u.verificado ? 1 : 0, u.foto || null, agora(), perfil.id, igsid]
  );
  if (!fotoNova) return;
  try {
    const { baixarArquivo } = await import('../graph.js');
    const { PASTA: pastaIg } = await import('../conexao.js');
    const r = await baixarArquivo(u.foto, path.join(pastaIg(), 'contatos', String(perfil.id), igsid.replace(/\W/g, '')), { maxBytes: 3 * 1024 * 1024 });
    run('UPDATE ig_contatos SET foto_local = ? WHERE perfil_id = ? AND igsid = ?', [path.relative(config.filesDir, r.caminho), perfil.id, igsid]);
    emitir('instagram', { contato: igsid });
  } catch { /* sem foto */ }
}

/** Item do motor → dados de direct.registrarMensagem */
export function dadosDoItem(item, igsid) {
  const anexos = (item.anexos || []).map((a) => {
    // Post, reel e link do instagram.com viram "compartilhamento" (a tela mostra o link para abrir)
    if (['post', 'reel', 'compartilhamento'].includes(a.tipo)) return { tipo: 'compartilhamento', url: a.url || null, nome: a.nome || null };
    return { tipo: a.tipo, url: a.url || null, mime: a.mime || null, nome: a.nome || null };
  }).filter((a) => a.url || a.tipo !== 'compartilhamento');
  let story = null;
  if (item.story?.tipo === 'compartilhado') {
    if (item.story.url) anexos.push({ tipo: 'imagem', url: item.story.url, nome: 'Story compartilhado' });
  } else if (item.story) story = { tipo: item.story.tipo === 'mencao' ? 'mencao' : 'resposta', url: item.story.url || null, id: null };
  return {
    igsid, mid: String(item.mid), deMim: Boolean(item.de_mim), timestamp: isoDeMicro(item.timestamp_us) || agora(),
    texto: item.texto || null, anexos, story, respostaMid: item.resposta_mid || null,
    naoSuportada: Boolean(item.nao_suportada) && !item.texto && !anexos.length, origem: item.de_mim ? 'celular' : null, status: 2,
  };
}

function atualizarReacoes(item, meuPk) {
  if (!item.reacoes?.length) return;
  const alvo = get('SELECT id, conversa_id, reacoes FROM ig_mensagens WHERE mid = ?', [String(item.mid)]);
  if (!alvo) return;
  const reacoes = {};
  for (const r of item.reacoes) reacoes[String(r.de) === String(meuPk) ? 'eu' : 'contato'] = r.emoji || '❤️';
  const json = JSON.stringify(reacoes);
  if (json !== alvo.reacoes) {
    run('UPDATE ig_mensagens SET reacoes = ? WHERE id = ?', [json, alvo.id]);
    emitir('instagram', { conversa: alvo.conversa_id });
  }
}

// ------------------------------------------------------------------ busca

/**
 * Busca a caixa de entrada (e, de tempos em tempos, as solicitações) e grava o que for novo.
 *  historico: primeira vez — até 60 conversas com as 20 mensagens mais recentes de cada (nada fica "não lida")
 */
export async function sincronizar(perfilId, { historico = false } = {}) {
  const perfil = obterPerfil(perfilId);
  if (!perfil.ativo || motorDoPerfil(perfil) !== 'login') return { conversas: 0, mensagens: 0 };
  const { registrarMensagem, garantirConversa } = await import('../direct.js');
  const acesso = acessoParaMotor(perfil.id);
  const est = estadoDoPerfil(perfil.id);
  const inicio = agora();
  let caixa;
  let pend = null;
  try {
    caixa = await pedir('inbox', { ...acesso, limite: historico ? 60 : 20, msgs: historico ? 20 : 10 });
    if (historico || !est.pendentes_em || Date.now() - new Date(est.pendentes_em).getTime() >= PENDENTES_MS) {
      pend = await pedir('inbox', { ...acesso, pendentes: true, limite: 20, msgs: historico ? 20 : 10 });
      salvarEstadoPerfil(perfil.id, { pendentes_em: agora() });
    }
  } catch (err) {
    if (err instanceof ErroMotor) { tratarErro(perfil.id, err, 'busca'); return { conversas: 0, mensagens: 0, erro: err.tipo }; }
    throw err;
  }
  const meuPk = caixa.meu_pk;
  const threads = [...(caixa.threads || []), ...((pend?.threads || []).map((t) => ({ ...t, pendente: true })))];
  let lidas = 0;
  let novas = 0;
  const tocadas = [];
  for (const t of threads) {
    if (t.grupo) continue; // grupos ficam só no app
    const pessoa = (t.usuarios || [])[0];
    if (!pessoa?.pk || String(pessoa.pk) === String(meuPk)) continue;
    const igsid = igsidDaPessoa(perfil, pessoa);
    const conversa = garantirConversa(perfil.id, igsid);
    tocadas.push(conversa.id);
    const ultima = isoDeMicro(t.ultima_us);
    if (conversa.thread_id !== t.thread_id || Boolean(conversa.pendente) !== Boolean(t.pendente)) {
      run('UPDATE ig_conversas SET thread_id = ?, pendente = ? WHERE id = ?', [t.thread_id, t.pendente ? 1 : 0, conversa.id]);
    }
    // Nome, @ e foto: na primeira vez, quando o @ muda ou a cada 3 dias (o link da foto muda a cada busca)
    const contato = get('SELECT atualizado_em, foto_local, username FROM ig_contatos WHERE perfil_id = ? AND igsid = ?', [perfil.id, igsid]);
    const velho = !contato?.atualizado_em || Date.now() - new Date(contato.atualizado_em).getTime() > 3 * 86400000;
    if (velho || (pessoa.username && contato.username !== pessoa.username)) await atualizarContato(perfil, igsid, pessoa, { foto: velho });
    if (!historico && conversa.sync_em && ultima && ultima <= conversa.sync_em) continue;
    let itens = t.itens || [];
    // Chegou mais do que veio na caixa (muitas mensagens desde a última busca): busca a conversa inteira recente
    const maisAntiga = itens.length ? Math.min(...itens.map((i) => Number(i.timestamp_us) || 0)) : 0;
    if (!historico && t.tem_mais && conversa.sync_em && maisAntiga && isoDeMicro(maisAntiga) > conversa.sync_em) {
      try {
        itens = (await pedir('thread', { ...acesso, thread_id: t.thread_id, quantos: 60 })).thread?.itens || itens;
      } catch (err) {
        if (err instanceof ErroMotor && ['login', 'desafio', 'suspensa', 'limite', 'bloqueio'].includes(err.tipo)) { tratarErro(perfil.id, err, 'busca'); break; }
      }
    }
    lidas++;
    for (const item of [...itens].sort((a, b) => Number(a.timestamp_us) - Number(b.timestamp_us))) {
      const dados = dadosDoItem(item, igsid);
      const aoVivo = !historico && Date.now() - new Date(dados.timestamp).getTime() < AO_VIVO_MS;
      const r = registrarMensagem(perfil, dados, { aoVivo });
      if (r.nova) novas++;
      else atualizarReacoes(item, meuPk);
    }
    run('UPDATE ig_conversas SET sync_em = ? WHERE id = ?', [ultima || inicio, conversa.id]);
  }
  if (historico && tocadas.length) run(`UPDATE ig_conversas SET nao_lidas = 0 WHERE id IN (${tocadas.map(() => '?').join(',')})`, tocadas);
  salvarEstadoPerfil(perfil.id, {
    ultima_busca_em: inicio, erro: null, erro_tipo: null, ultimo_erro_registrado: null,
    ...(historico ? { historico_em: inicio } : {}),
  });
  atualizarPerfil(perfil.id, { sync_direct_em: inicio });
  if (novas) emitir('instagram', { perfil: perfil.id, conversas: true });
  if (historico) registrar(perfil.id, 'direct', `Direct pelo login: ${lidas} conversa(s) importada(s), ${novas} mensagem(ns)`);
  return { conversas: lidas, mensagens: novas };
}

// ------------------------------------------------------------------ envio

const tipoDoMime = (mime) => (/^image\//.test(mime) ? 'imagem' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'arquivo');

/** Converte o que o Instagram não aceita direto (áudio → m4a, vídeo que não é mp4 → mp4). Devolve { caminho, apagar } */
async function prepararArquivo(caminho, tipo, mime) {
  if (tipo === 'audio' && !/mp4|m4a|aac/.test(mime)) {
    const { converterParaM4a } = await import('../../whatsapp/ffmpeg.js');
    const saida = path.join(os.tmpdir(), `crm-igl-${crypto.randomUUID()}.m4a`);
    await converterParaM4a(caminho, saida);
    return { caminho: saida, apagar: true };
  }
  if (tipo === 'video' && !/mp4/.test(mime)) {
    const { converterParaMp4 } = await import('../../whatsapp/ffmpeg.js');
    const saida = path.join(os.tmpdir(), `crm-igl-${crypto.randomUUID()}.mp4`);
    await converterParaMp4(caminho, saida);
    return { caminho: saida, apagar: true };
  }
  return { caminho, apagar: false };
}

/**
 * Envia pelo motor de login. mensagem: { text } ou { arquivo: { caminho, mime } }. Devolve { message_id } (como a API oficial).
 */
export async function enviar(perfil, conversa, mensagem) {
  const est = estadoDoPerfil(perfil.id);
  if (est.parado) throw new ErroHttp(409, `Direct pelo login parado: ${est.erro || 'conecte de novo'}`);
  if (est.pausado_ate && est.pausado_ate > agora()) throw new ErroHttp(429, `O Instagram pediu uma pausa: o CRM volta a enviar às ${new Date(est.pausado_ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`);
  const acesso = acessoParaMotor(perfil.id);
  const pk = get('SELECT pk FROM ig_contatos WHERE perfil_id = ? AND igsid = ?', [perfil.id, conversa.igsid])?.pk || null;
  if (!conversa.thread_id && !pk) throw new ErroHttp(409, 'Essa conversa ainda não apareceu no Direct pelo login. Espere a próxima busca (menos de 1 minuto) e tente de novo.');
  const alvo = conversa.thread_id ? { thread_id: conversa.thread_id } : { user_pk: pk };
  let r;
  try {
    if (mensagem.arquivo) {
      const tipo = tipoDoMime(mensagem.arquivo.mime);
      if (tipo === 'arquivo') throw new ErroHttp(400, 'Pelo Direct só dá para mandar foto, vídeo ou áudio');
      if (!conversa.thread_id) throw new ErroHttp(409, 'Mande uma mensagem de texto antes do primeiro arquivo nesta conversa');
      const prep = await prepararArquivo(mensagem.arquivo.caminho, tipo, mensagem.arquivo.mime);
      try {
        r = await pedir('enviar_arquivo', { ...acesso, ...alvo, caminho: prep.caminho, tipo }, { tempoMs: 300000 });
      } finally {
        if (prep.apagar) fs.rmSync(prep.caminho, { force: true });
      }
    } else {
      r = await pedir('enviar_texto', { ...acesso, ...alvo, texto: String(mensagem.text || '') });
    }
  } catch (err) {
    if (err instanceof ErroMotor) {
      const texto = tratarErro(perfil.id, err, 'envio');
      throw new ErroHttp(['limite', 'bloqueio'].includes(err.tipo) ? 429 : 422, texto);
    }
    throw err;
  }
  if (r.thread_id && !conversa.thread_id) run('UPDATE ig_conversas SET thread_id = ? WHERE id = ?', [r.thread_id, conversa.id]);
  if (conversa.pendente) run('UPDATE ig_conversas SET pendente = 0 WHERE id = ?', [conversa.id]);
  return { message_id: r.mid };
}

// ------------------------------------------------------------------ relógio

const rodando = new Set();
let relogio = null;

function tarefa(perfilId, fn) {
  if (rodando.has(perfilId)) return null;
  rodando.add(perfilId);
  return Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`[instagram-login] perfil ${perfilId}:`, err.message))
    .finally(() => rodando.delete(perfilId));
}

/** Um passo do relógio: busca de cada perfil ligado quando chegar a hora (com variação de ±30%) */
export function passo(agoraMs = Date.now()) {
  if (!instalado() || !lerConfig().direct_ativo) return;
  for (const p of perfisAtivos()) {
    if (motorDoPerfil(p) !== 'login' || !lerAcesso(p.id)) continue;
    const e = estadoDoPerfil(p.id);
    if (e.parado || (e.pausado_ate && e.pausado_ate > new Date(agoraMs).toISOString())) continue;
    if (e.proxima_em && new Date(e.proxima_em).getTime() > agoraMs) continue;
    const ms = intervaloDoPerfil(p) * 1000 * (0.7 + Math.random() * 0.6);
    salvarEstadoPerfil(p.id, { proxima_em: new Date(agoraMs + ms).toISOString() });
    tarefa(p.id, () => sincronizar(p.id, { historico: !e.historico_em }));
  }
}

/** Busca agora (botão "Atualizar agora") */
export function buscarAgora(perfilId) {
  salvarEstadoPerfil(perfilId, { proxima_em: null, pausado_ate: null });
  return tarefa(perfilId, () => sincronizar(perfilId, { historico: !estadoDoPerfil(perfilId).historico_em }));
}

export function iniciarRelogio() {
  if (relogio) return;
  relogio = setInterval(() => { try { passo(); } catch (err) { console.error('[instagram-login] relógio:', err.message); } }, 5000);
  relogio.unref?.();
}

export function pararRelogio() {
  if (relogio) clearInterval(relogio);
  relogio = null;
  pararMotor();
}

/** Perfis com o Direct pelo login ligado (para as estatísticas da tela) */
export const perfisNoLogin = () => all('SELECT * FROM ig_perfis WHERE ativo = 1').filter((p) => motorDoPerfil(p) === 'login').map((p) => p.id);
