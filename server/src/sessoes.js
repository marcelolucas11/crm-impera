// Guarda as sessões de login no próprio banco (sobrevivem a reinícios e atualizações)
import session from 'express-session';
import { get, run } from './db.js';

const UM_DIA = 24 * 60 * 60 * 1000;
// A sessão é renovada a cada pedido (cookie "rolling"). Gravar isso no banco a cada clique e a cada atualização
// automática da tela era uma escrita no disco por pedido; agora só grava quando o vencimento muda de verdade.
const RENOVAR_A_CADA_MS = 15 * 60 * 1000;

const vencimento = (sess) => (sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + UM_DIA);

export class LojaSessoes extends session.Store {
  constructor() {
    super();
    this.renovadas = new Map(); // sid → vencimento gravado
    setInterval(() => {
      try { run('DELETE FROM sessions WHERE expire < ?', [Date.now()]); } catch { /* ignora */ }
      const agora = Date.now();
      for (const [sid, expire] of this.renovadas) if (expire < agora) this.renovadas.delete(sid);
    }, 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    try {
      const r = get('SELECT sess, expire FROM sessions WHERE sid = ?', [sid]);
      cb(null, r && r.expire > Date.now() ? JSON.parse(r.sess) : null);
    } catch (e) {
      cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      const expire = vencimento(sess);
      run(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        [sid, JSON.stringify(sess), expire]
      );
      this.renovadas.set(sid, expire);
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }

  touch(sid, sess, cb) {
    try {
      const expire = vencimento(sess);
      const gravado = this.renovadas.get(sid);
      if (!gravado || expire - gravado > RENOVAR_A_CADA_MS) {
        run('UPDATE sessions SET expire = ? WHERE sid = ?', [expire, sid]);
        this.renovadas.set(sid, expire);
      }
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }

  destroy(sid, cb) {
    try {
      run('DELETE FROM sessions WHERE sid = ?', [sid]);
      this.renovadas.delete(sid);
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }
}

/** Encerra as sessões abertas de um usuário (senha trocada, conta desativada), menos a sessão atual (opcional) */
export function encerrarSessoesDoUsuario(userId, exceto = null) {
  try {
    run("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ? AND sid IS NOT ?", [Number(userId), exceto]);
  } catch (err) {
    console.error('[sessões] não consegui encerrar as sessões antigas:', err.message);
  }
}
