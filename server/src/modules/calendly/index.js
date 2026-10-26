// Módulo Calendly: sincroniza as reuniões a cada CALENDLY_INTERVALO_MIN minutos (padrão 5).
// Não precisa de endereço público nem de plano pago: o CRM consulta a API com o token pessoal.
import { all } from '../../db.js';
import { config } from '../../config.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido } from '../../util.js';
import { sincronizarCalendly } from './sincronizar.js';
import { tokenCalendly, conectarComToken, removerToken, montarStatus } from './token.js';

let timer = null;

export default {
  name: 'calendly',
  register(app) {
    app.get('/api/calendly/status', exigirLogin, exigirAdmin, (req, res) => {
      res.json(montarStatus());
    });

    // Cola o token pelo CRM: confere com o Calendly, guarda só no servidor e já começa a sincronizar
    app.post('/api/calendly/token', exigirLogin, exigirAdmin, async (req, res) => {
      try {
        const conta = await conectarComToken(req.body?.token);
        sincronizarCalendly().catch(() => {});
        res.json({ ok: true, conta });
      } catch (err) {
        res.status(err.status === 400 || err.status === 502 ? err.status : 500).json({ erro: err.message });
      }
    });

    app.delete('/api/calendly/token', exigirLogin, exigirAdmin, (req, res) => {
      removerToken();
      res.json({ ok: true });
    });

    app.post('/api/calendly/sincronizar', exigirLogin, exigirAdmin, async (req, res) => {
      if (!tokenCalendly()) return res.status(400).json({ erro: 'Conecte o Calendly primeiro: cole o token em Equipe e integrações.' });
      try {
        // { dias } opcional: "buscar reuniões antigas" (até 365 dias para trás)
        res.json({ ok: true, resumo: await sincronizarCalendly({ dias: req.body?.dias }) });
      } catch (err) {
        res.status(502).json({ erro: err.message });
      }
    });

    app.get('/api/leads/:id/reunioes', exigirLogin, (req, res) => {
      const id = idValido(req.params.id);
      res.json({
        reunioes: all(
          `SELECT uri, event_name, start_time, end_time, status, join_url, booked_at FROM calendly_events
            WHERE lead_id = ? ORDER BY start_time DESC LIMIT 20`,
          [id]
        ),
      });
    });
  },

  start() {
    // O token pode ser colado na tela depois que o CRM já está ligado: o relógio roda sempre e só trabalha com token
    const rodar = () => (tokenCalendly() ? sincronizarCalendly().catch(() => {}) : undefined);
    setTimeout(rodar, 5000).unref();
    timer = setInterval(rodar, config.calendly.intervaloMin * 60 * 1000);
    timer.unref();
    console.log(tokenCalendly()
      ? `[calendly] sincronizando a cada ${config.calendly.intervaloMin} min`
      : '[calendly] sem token — cole o token em Equipe e integrações para ligar');
  },

  stop() {
    if (timer) clearInterval(timer);
  },
};
