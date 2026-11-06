// Transcrição de áudio na própria VPS (sem chave e sem custo por minuto), com o Whisper rodando pelo transformers.js.
//  - A biblioteca (~480 MB) é instalada sob demanda pelo botão "Ativar transcrição", numa pasta própria
//    (dados/transcricao), que as atualizações do CRM não apagam. O modelo é baixado na primeira transcrição.
//  - Roda num processo separado (transcritor-processo.js): se faltar memória, o CRM continua no ar.
//  - Cada áudio é transcrito uma vez só e guardado na mensagem (wa_messages.transcricao).
//  - "Transcrever áudios novos": a cada 2 min transcreve os áudios dos últimos 3 dias (leads, contatos e grupos),
//    um por vez, em segundo plano. A IA de primeiro contato, o Organizador e a Alice passam a ler esses textos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';
import { get, all, run, agora } from '../../db.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp } from '../../util.js';
import { baixarMidia, absoluto } from '../whatsapp/midia.js';
import * as ff from '../whatsapp/ffmpeg.js';

const ESTADO = 'transcricao';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const PASTA = process.env.TRANSCRICAO_DIR || path.join(path.dirname(config.dbFile), 'transcricao');
const PACOTE = '@huggingface/transformers@4';
const OCIOSO_MS = 10 * 60 * 1000;
const TEMPO_POR_AUDIO_MS = 15 * 60 * 1000;
const MAX_SEGUNDOS = 20 * 60;

export const MODELOS_WHISPER = [
  { id: 'base', nome: 'Rápido (Whisper base, ~80 MB)', ram: '~500 MB de RAM' },
  { id: 'small', nome: 'Equilibrado (Whisper small, ~250 MB)', ram: '~1 GB de RAM' },
  { id: 'turbo', nome: 'Mais preciso (Whisper large v3 turbo, ~800 MB)', ram: '~3 GB de RAM' },
];
export const IDIOMAS = ['auto', 'portuguese', 'spanish', 'english'];
const PADRAO = { ativo: false, modelo: 'small', idioma: 'auto', auto_novos: true };

let falso = null;
/** Testes: troca o Whisper por uma função (caminhoDoArquivo) => texto */
export function definirTranscritorFalso(fn) { falso = fn; }

let instalacao = { status: 'parada' }; // parada | instalando | ok | erro
let processo = null;
let pronto = null;
let ocioso = null;
const pendentes = new Map();
let seq = 0;
let fila = Promise.resolve();
let relogio = null;
let varrendo = false;
let ultimaMedida = null; // { segundos, ms }

export function lerConfig() {
  return { ...PADRAO, ...lerEstado(ESTADO) };
}

export const instalada = () => Boolean(falso) || fs.existsSync(path.join(PASTA, 'node_modules', '@huggingface', 'transformers', 'package.json'));

function tamanhoDaPasta(p) {
  let total = 0;
  try {
    for (const item of fs.readdirSync(p, { withFileTypes: true })) {
      const c = path.join(p, item.name);
      total += item.isDirectory() ? tamanhoDaPasta(c) : fs.statSync(c).size;
    }
  } catch { /* pasta ainda não existe */ }
  return total;
}

export function status() {
  const cfg = lerConfig();
  const pendentesAuto = get(
    "SELECT count(*) AS n FROM wa_messages WHERE type = 'audio' AND transcricao_em IS NULL AND deleted_at IS NULL AND timestamp >= ?",
    [new Date(Date.now() - 3 * 86400000).toISOString()]
  ).n;
  return {
    config: cfg,
    instalada: instalada(),
    instalacao,
    modelos: MODELOS_WHISPER,
    idiomas: IDIOMAS,
    pronta: cfg.ativo && instalada(),
    modelos_baixados_mb: Math.round(tamanhoDaPasta(path.join(PASTA, 'modelos')) / 1048576),
    transcritos_7_dias: get("SELECT count(*) AS n FROM wa_messages WHERE type = 'audio' AND transcricao IS NOT NULL AND transcricao_em >= ?", [new Date(Date.now() - 7 * 86400000).toISOString()]).n,
    na_fila: pendentesAuto,
    ultima_medida: ultimaMedida,
    // Para escolher o modelo certo para a máquina
    servidor: { cpus: os.cpus().length, ram_gb: Math.round((os.totalmem() / 1073741824) * 10) / 10, ram_livre_gb: Math.round((os.freemem() / 1073741824) * 10) / 10 },
  };
}

export function salvarConfig(entrada = {}) {
  const atual = lerConfig();
  const novo = { ...atual };
  if (entrada.ativo !== undefined) novo.ativo = Boolean(entrada.ativo);
  if (entrada.modelo !== undefined && MODELOS_WHISPER.some((m) => m.id === entrada.modelo)) novo.modelo = entrada.modelo;
  if (entrada.idioma !== undefined && IDIOMAS.includes(entrada.idioma)) novo.idioma = entrada.idioma;
  if (entrada.auto_novos !== undefined) novo.auto_novos = Boolean(entrada.auto_novos);
  if (novo.ativo && !instalada()) throw new ErroHttp(409, 'Instale a transcrição antes de ligar (botão "Instalar")');
  salvarEstado(ESTADO, novo);
  if (novo.modelo !== atual.modelo) encerrarProcesso();
  emitir('agente', { transcricao: true });
  return novo;
}

// ------------------------------------------------------------------ instalação sob demanda

function npmDoNode() {
  const pasta = path.dirname(process.execPath);
  for (const nome of ['npm', 'npm.cmd']) {
    const c = path.join(pasta, nome);
    if (fs.existsSync(c)) return c;
  }
  return 'npm';
}

export function instalar() {
  if (instalacao.status === 'instalando') return instalacao;
  fs.mkdirSync(PASTA, { recursive: true });
  const pkg = path.join(PASTA, 'package.json');
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: 'crm-transcricao', private: true, type: 'module' }, null, 2));
  instalacao = { status: 'instalando', inicio: agora(), log: '' };
  emitir('agente', { transcricao: true });
  const npm = npmDoNode();
  // O pacote de execução do ONNX tenta baixar extras de GPU de outro site; a VPS não precisa (roda na CPU)
  const env = { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
  const proc = spawn(npm, ['install', PACOTE, '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error'], { cwd: PASTA, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const guardar = (d) => { instalacao.log = (instalacao.log + d).slice(-4000); };
  proc.stdout.on('data', guardar);
  proc.stderr.on('data', guardar);
  proc.on('error', (err) => { instalacao = { status: 'erro', erro: `Não consegui rodar o npm: ${err.message}`, fim: agora() }; emitir('agente', { transcricao: true }); });
  proc.on('close', (codigo) => {
    instalacao = codigo === 0 && instalada()
      ? { status: 'ok', fim: agora() }
      : { status: 'erro', erro: `A instalação falhou (código ${codigo}). ${instalacao.log.split('\n').filter(Boolean).slice(-3).join(' ')}`, fim: agora() };
    if (instalacao.status === 'ok') salvarEstado(ESTADO, { ...lerConfig(), ativo: true });
    console.log(`[transcrição] instalação: ${instalacao.status}`);
    emitir('agente', { transcricao: true });
  });
  return instalacao;
}

// ------------------------------------------------------------------ processo do Whisper

function encerrarProcesso() {
  clearTimeout(ocioso);
  if (processo) {
    try { processo.kill(); } catch { /* já saiu */ }
  }
  processo = null;
  pronto = null;
}

function garantirProcesso() {
  if (processo && pronto) return pronto;
  processo = fork(path.join(AQUI, 'transcritor-processo.js'), [], {
    env: { ...process.env, TRANSCRICAO_DIR: PASTA },
    execArgv: ['--disable-warning=ExperimentalWarning'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let erroTexto = '';
  processo.stderr?.on('data', (d) => { erroTexto = (erroTexto + d).slice(-2000); });
  pronto = new Promise((resolve, reject) => {
    const p = processo;
    p.once('message', (m) => (m?.evento === 'pronto' ? resolve(p) : null));
    p.once('error', reject);
    p.on('message', (m) => {
      if (!m?.id) return;
      const espera = pendentes.get(m.id);
      if (!espera) return;
      pendentes.delete(m.id);
      if (m.erro) espera.reject(new Error(m.erro));
      else espera.resolve(m.texto || '');
    });
    p.on('exit', (codigo) => {
      for (const [, espera] of pendentes) espera.reject(new Error(`O processo de transcrição saiu (código ${codigo}). ${erroTexto.split('\n').filter(Boolean).slice(-2).join(' ')}`));
      pendentes.clear();
      if (processo === p) { processo = null; pronto = null; }
    });
  });
  return pronto;
}

async function transcreverPcm(pcm, cfg) {
  const p = await garantirProcesso();
  clearTimeout(ocioso);
  const id = ++seq;
  const texto = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendentes.delete(id); reject(new Error('A transcrição demorou demais')); encerrarProcesso(); }, TEMPO_POR_AUDIO_MS);
    pendentes.set(id, {
      resolve: (t) => { clearTimeout(timer); resolve(t); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    p.send({ id, pcm, modelo: cfg.modelo, idioma: cfg.idioma });
  });
  // Libera a memória se ficar parado
  ocioso = setTimeout(encerrarProcesso, OCIOSO_MS);
  ocioso.unref?.();
  return texto;
}

/** Transcreve um arquivo de áudio qualquer (um por vez, em fila). Devolve o texto. */
export function transcreverArquivo(caminho, { exigirAtiva = true } = {}) {
  const cfg = lerConfig();
  if (!falso) {
    if (!instalada()) return Promise.reject(new ErroHttp(409, 'A transcrição de áudio não está instalada (IA → Agente → Ajustes → Transcrição)'));
    if (exigirAtiva && !cfg.ativo) return Promise.reject(new ErroHttp(409, 'A transcrição de áudio está desligada (IA → Agente → Ajustes → Transcrição)'));
  }
  const tarefa = fila.then(async () => {
    if (falso) return String(await falso(caminho)).trim();
    const pcm = path.join(os.tmpdir(), `crm-pcm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.f32`);
    const inicio = Date.now();
    try {
      await ff.paraPcm16k(caminho, pcm);
      const segundos = fs.statSync(pcm).size / 4 / 16000;
      if (segundos > MAX_SEGUNDOS) throw new Error(`Áudio longo demais para transcrever (${Math.round(segundos / 60)} min; máximo ${MAX_SEGUNDOS / 60} min)`);
      const texto = await transcreverPcm(pcm, cfg);
      ultimaMedida = { segundos: Math.round(segundos), ms: Date.now() - inicio, modelo: cfg.modelo, em: agora() };
      return texto;
    } finally {
      fs.rm(pcm, { force: true }, () => {});
    }
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

/** Transcrição de uma mensagem de áudio do WhatsApp (usa a guardada, se já existir) */
export async function transcreverMensagem(linhaId, { exigirAtiva = true } = {}) {
  const m = get('SELECT id, type, transcricao FROM wa_messages WHERE id = ?', [linhaId]);
  if (!m) throw new ErroHttp(404, 'Mensagem não encontrada');
  if (m.type !== 'audio') throw new ErroHttp(400, 'Esta mensagem não é um áudio');
  if (m.transcricao) return m.transcricao;
  const linha = await baixarMidia(linhaId);
  try {
    const texto = await transcreverArquivo(absoluto(linha.media_path), { exigirAtiva });
    run('UPDATE wa_messages SET transcricao = ?, transcricao_em = ? WHERE id = ?', [texto || '(áudio sem fala)', agora(), linhaId]);
    return texto || '(áudio sem fala)';
  } catch (err) {
    run('UPDATE wa_messages SET transcricao_em = ? WHERE id = ?', [agora(), linhaId]);
    throw err;
  }
}

// ------------------------------------------------------------------ áudios novos em segundo plano

export async function varrerNovos({ maximo = 5 } = {}) {
  const cfg = lerConfig();
  if (varrendo || !cfg.ativo || !cfg.auto_novos || !instalada()) return 0;
  varrendo = true;
  let feitos = 0;
  try {
    const audios = all(
      `SELECT id FROM wa_messages WHERE type = 'audio' AND transcricao_em IS NULL AND deleted_at IS NULL AND timestamp >= ?
         AND (media_status IS NULL OR media_status <> 'erro') ORDER BY timestamp DESC LIMIT ?`,
      [new Date(Date.now() - 3 * 86400000).toISOString(), maximo]
    );
    for (const a of audios) {
      try { await transcreverMensagem(a.id); feitos++; } catch { /* fica marcado como tentado */ }
    }
  } finally {
    varrendo = false;
  }
  return feitos;
}

export function iniciarRelogioTranscricao() {
  pararRelogioTranscricao();
  relogio = setInterval(() => { varrerNovos().catch(() => {}); }, 2 * 60 * 1000);
  relogio.unref?.();
}

export function pararRelogioTranscricao() {
  if (relogio) clearInterval(relogio);
  relogio = null;
  encerrarProcesso();
}
