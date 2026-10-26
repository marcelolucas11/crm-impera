// Módulo Calendly: sincroniza as reuniões a cada CALENDLY_INTERVALO_MIN minutos (padrão 5).
// Não precisa de endereço público nem de plano pago: o CRM consulta a API com o token pessoal.
import { all, get } from '../../db.js';
import { config } from '../../config.js';
import { lerEstado } from '../../estado.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido } from '../../util.js';
import { sincronizarCalendly } from './sincronizar.js';

let timer = null;

export default {
  name: 'calendly',
  register(app) {
    app.get('/api/calendly/status', exigirLogin, exigirAdmin, (req, res) => {
      const estado = lerEstado('calendly');
      const futuras = get(
        "SELECT count(*) AS n FROM calendly_events WHERE status = 'active' AND start_time > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
      ).n;
      res.json({
        configurado: Boolean(config.calendly.token),
        intervalo_min: config.calendly.intervaloMin,
        conta: estado.usuario_nome ? { nome: estado.usuario_nome, email: estado.usuario_email } : null,
        ultima_sincronizacao: estado.ultima_sincronizacao || null,
        ultimo_resumo: estado.ultimo_resumo || null,
        ultimo_erro: estado.ultimo_erro || null,
        reunioes_futuras: futuras,
      });
    });

    app.post('/api/calendly/sincronizar', exigirLogin, exigirAdmin, async (req, res) => {
      if (!config.calendly.token) return res.status(400).json({ erro: 'Token do Calendly não configurado. Rode ./scripts/configurar-calendly.sh' });
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
          `SELECT uri, event_name, start_time, end_time, status, join_url FROM calendly_events
            WHERE lead_id = ? ORDER BY start_time DESC LIMIT 20`,
          [id]
        ),
      });
    });
  },

  start() {
    if (!config.calendly.token) {
      console.log('[calendly] sem token — integração desligada (rode ./scripts/configurar-calendly.sh)');
      return;
    }
    const rodar = () => sincronizarCalendly().catch(() => {});
    setTimeout(rodar, 5000).unref();
    timer = setInterval(rodar, config.calendly.intervaloMin * 60 * 1000);
    timer.unref();
    console.log(`[calendly] sincronizando a cada ${config.calendly.intervaloMin} min`);
  },

  stop() {
    if (timer) clearInterval(timer);
  },
};
