// Comandos administrativos, rodados dentro do container:
//   node src/cli.js criar-usuario [--admin] [--nome X --email Y --senha Z]
//   node src/cli.js redefinir-senha email@exemplo.com
//   node src/cli.js contar-usuarios
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { normalizarEmail } from './util.js';

const args = process.argv.slice(2);
const comando = args[0];
const opcao = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function perguntar(texto, oculto = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (s) => {
        if (s.includes(texto)) rl.output.write(s);
        else if (s === '\r\n' || s === '\n') rl.output.write(s);
        else rl.output.write('*');
      };
    }
    rl.question(texto, (resposta) => {
      rl.close();
      if (oculto) process.stdout.write('\n');
      resolve(resposta.trim());
    });
  });
}

async function criarUsuario() {
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

  const existe = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (existe.rowCount) throw new Error('Já existe um usuário com esse e-mail');

  await pool.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)', [
    nome,
    email,
    await bcrypt.hash(senha, 12),
    admin ? 'admin' : 'member',
  ]);
  console.log(`✔ Usuário ${admin ? 'administrador ' : ''}criado: ${email}`);
}

async function redefinirSenha() {
  const email = normalizarEmail(args[1] || (await perguntar('E-mail do usuário: ')));
  if (!email) throw new Error('E-mail inválido');
  const senha = opcao('senha') || (await perguntar('Nova senha (mín. 8 caracteres): ', true));
  if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres');
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $1, active = true WHERE lower(email) = $2', [
    await bcrypt.hash(senha, 12),
    email,
  ]);
  if (!rowCount) throw new Error('Usuário não encontrado');
  console.log(`✔ Senha redefinida para ${email}`);
}

async function contarUsuarios() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  console.log(rows[0].n);
}

const comandos = {
  'criar-usuario': criarUsuario,
  'redefinir-senha': redefinirSenha,
  'contar-usuarios': contarUsuarios,
};

const executar = comandos[comando];
if (!executar) {
  console.log('Comandos: criar-usuario [--admin], redefinir-senha <email>, contar-usuarios');
  process.exit(1);
}

executar()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('✖', err.message);
    await pool.end();
    process.exit(1);
  });
