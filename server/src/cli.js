// Comandos administrativos (rodados pelos scripts .sh):
//   node server/src/cli.js criar-usuario [--admin] [--nome X --email Y --senha Z]
//   node server/src/cli.js redefinir-senha email@exemplo.com [--senha Z]
//   node server/src/cli.js contar-usuarios
//   node server/src/cli.js backup <arquivo-destino.db>
//   node server/src/cli.js verificar <arquivo.db>
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import { RAIZ_APP } from './config.js';
import { abrirBanco, fecharBanco, get, run, copiarBanco } from './db.js';
import { aplicarMigracoes } from './migrar.js';
import { normalizarEmail } from './util.js';

const args = process.argv.slice(2);
const comando = args[0];
const opcao = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// Uma única interface de leitura para todas as perguntas (não perde respostas digitadas rápido)
let leitor = null;
let ocultar = false;
function obterLeitor() {
  if (!leitor) {
    leitor = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    const escreverOriginal = leitor._writeToOutput.bind(leitor);
    leitor._writeToOutput = (s) => {
      if (!ocultar || s.endsWith(': ') || s === '\r\n' || s === '\n') escreverOriginal(s);
      else escreverOriginal('*'.repeat(s.length));
    };
  }
  return leitor;
}

function perguntar(texto, oculto = false) {
  return new Promise((resolve, reject) => {
    const rl = obterLeitor();
    const aoFechar = () => reject(new Error('Entrada encerrada antes da resposta'));
    rl.once('close', aoFechar);
    ocultar = false;
    rl.question(texto, (resposta) => {
      rl.off('close', aoFechar);
      ocultar = false;
      resolve(resposta.trim());
    });
    ocultar = oculto && Boolean(process.stdin.isTTY);
  });
}

const fecharLeitor = () => leitor?.close();

function prepararBanco() {
  abrirBanco();
  aplicarMigracoes(path.join(RAIZ_APP, 'server', 'migrations'));
}

async function criarUsuario() {
  prepararBanco();
  const admin = args.includes('--admin');
  const nome = opcao('nome') || (await perguntar('Nome: '));
  const email = normalizarEmail(opcao('email') || (await perguntar('E-mail: ')));
  if (!nome || !email) throw new Error('Nome e e-mail válidos são obrigatórios');

  let senha = opcao('senha');
  if (!senha) {
    senha = await perguntar('Senha (mín. 8 caracteres): ', true);
    const confirma = await perguntar('Repita a senha: ', true);
    if (senha !== confirma) throw new Error('As senhas não conferem');
  }
  if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres');
  if (get('SELECT 1 FROM users WHERE lower(email) = ?', [email])) throw new Error('Já existe um usuário com esse e-mail');

  run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [
    nome,
    email,
    await bcrypt.hash(senha, 12),
    admin ? 'admin' : 'member',
  ]);
  console.log(`✔ Usuário ${admin ? 'administrador ' : ''}criado: ${email}`);
}

async function redefinirSenha() {
  prepararBanco();
  const email = normalizarEmail(args[1] && !args[1].startsWith('--') ? args[1] : await perguntar('E-mail do usuário: '));
  if (!email) throw new Error('E-mail inválido');
  const senha = opcao('senha') || (await perguntar('Nova senha (mín. 8 caracteres): ', true));
  if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres');
  const { changes } = run('UPDATE users SET password_hash = ?, active = 1 WHERE lower(email) = ?', [await bcrypt.hash(senha, 12), email]);
  if (!changes) throw new Error('Usuário não encontrado');
  console.log(`✔ Senha redefinida para ${email}`);
}

function contarUsuarios() {
  prepararBanco();
  console.log(get('SELECT count(*) AS n FROM users').n);
}

// Cópia consistente do banco (funciona com o CRM rodando)
function backup() {
  const destino = args[1];
  if (!destino) throw new Error('Informe o arquivo de destino');
  if (fs.existsSync(destino)) throw new Error(`O arquivo já existe: ${destino}`);
  abrirBanco();
  copiarBanco(path.resolve(destino));
  console.log(path.resolve(destino));
}

// Confere se um arquivo de banco está íntegro (usado antes de restaurar)
function verificar() {
  const arquivo = args[1];
  if (!arquivo || !fs.existsSync(arquivo)) throw new Error('Arquivo não encontrado');
  const db = new DatabaseSync(arquivo, { readOnly: true });
  const r = db.prepare('PRAGMA integrity_check').get();
  const leads = db.prepare('SELECT count(*) AS n FROM leads').get().n;
  db.close();
  if (r.integrity_check !== 'ok') throw new Error(`Arquivo corrompido: ${r.integrity_check}`);
  console.log(`ok (${leads} leads)`);
}

const comandos = {
  'criar-usuario': criarUsuario,
  'redefinir-senha': redefinirSenha,
  'contar-usuarios': contarUsuarios,
  backup,
  verificar,
};

const executar = comandos[comando];
if (!executar) {
  console.log('Comandos: criar-usuario [--admin], redefinir-senha <email>, contar-usuarios, backup <destino>, verificar <arquivo>');
  process.exit(1);
}

Promise.resolve()
  .then(executar)
  .then(() => {
    fecharLeitor();
    fecharBanco();
  })
  .catch((err) => {
    console.error('✖', err.message);
    fecharLeitor();
    fecharBanco();
    process.exit(1);
  });
