// Guarda as sessões de login no próprio banco (sobrevivem a reinícios e atualizações)
import session from 'express-session';
import { get, run } from './db.js';

const UM_DIA = 24 * 60 * 60 * 1000;

export class LojaSessoes extends session.Store {
  constructor() {
    super();
    setInterval(() => {
      try { run('DELETE FROM sessions WHERE expire < ?', [Date.now()]); } catch { /* ignora */ }
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
      const expire = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + UM_DIA;
      run(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        [sid, JSON.stringify(sess), expire]
      );
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }

  touch(sid, sess, cb) {
    try {
      const expire = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + UM_DIA;
      run('UPDATE sessions SET expire = ? WHERE sid = ?', [expire, sid]);
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }

  destroy(sid, cb) {
    try {
      run('DELETE FROM sessions WHERE sid = ?', [sid]);
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }
}
