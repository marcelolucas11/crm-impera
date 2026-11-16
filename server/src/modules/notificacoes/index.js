// Notificações no celular (CRM instalado como app). Sempre que alguém agenda uma reunião no Calendly, todos os aparelhos
// inscritos recebem: "Nova reunião agendada — Nome do lead — dia e hora — Nicho".
// Em Equipe e integrações → Notificações do app: ligar neste aparelho, ver os aparelhos e disparar um teste com um lead
// que já agendou.
import { get, all, run, agora } from '../../db.js';
import { exigirLogin, exigirAdmin } from '../auth/middleware.js';
import { idValido } from '../../util.js';
import { aoAcontecer } from '../../ganchos.js';
import { configNotificacoes, salvarConfigNotificacoes, perguntasConhecidas, nichoDoLead } from '../reunioes/nicho.js';
import { chavesVapid, validarInscricao, destinatarios, montarAvisoReuniao, enviarAviso, historico } from './envio.js';

const HORA = 60 * 60 * 1000;
// Reunião agendada há mais tempo que isto (ex.: carga de reuniões antigas do Calendly) não vira notificação
const AGENDADA_HA_NO_MAXIMO = 48 * HORA;

const textoCurto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) || null;

/** Reunião nova chegou do Calendly: avisa os aparelhos uma única vez por reunião */
export async function avisarReuniaoAgendada({ leadId, uri }) {
  if (!uri || !configNotificacoes().ligado) return { ignorado: 'desligado' };
  const ev = get('SELECT uri, lead_id, start_time, status, booked_at, created_at, notificado_em FROM calendly_events WHERE uri = ?', [uri]);
  if (!ev || ev.status !== 'active' || ev.notificado_em) return { ignorado: 'ja_avisado' };
  const agendada = Date.parse(ev.booked_at || ev.created_at || '');
  const antiga = Number.isFinite(agendada) && Date.now() - agendada > AGENDADA_HA_NO_MAXIMO;
  const passou = Date.parse(ev.start_time) < Date.now() - HORA;
  // Marca antes de mandar: duas sincronizações ao mesmo tempo não avisam duas vezes
  const marcou = run('UPDATE calendly_events SET notificado_em = ? WHERE uri = ? AND notificado_em IS NULL', [agora(), uri]);
  if (!marcou.changes || antiga || passou) return { ignorado: antiga ? 'agendada_ha_muito_tempo' : passou ? 'ja_passou' : 'ja_avisado' };
  const aviso = montarAvisoReuniao({ leadId: leadId || ev.lead_id, uri });
  const aparelhos = destinatarios();
  if (!aviso || !aparelhos.length) return { ignorado: 'sem_aparelhos' };
  const resultados = await enviarAviso(aviso, aparelhos, { origem: 'calendly' });
  const ok = resultados.filter((r) => r.ok).length;
  console.log(`[notificações] reunião de ${aviso.nome}: avisados ${ok} de ${resultados.length} aparelho(s)`);
  return { resultados };
}

function aparelhoPublico(p, { comUsuario = false } = {}) {
  return {
    id: p.id,
    aparelho: p.aparelho || 'Aparelho',
    ...(comUsuario ? { usuario: p.usuario, user_id: p.user_id } : {}),
    criado_em: p.created_at,
    ultimo_ok_em: p.ultimo_ok_at,
    ultimo_envio_em: p.ultimo_envio_at,
    ultimo_erro: p.ultimo_erro,
    falhas: p.falhas,
    // Só o começo do endereço, para saber o serviço (Apple, Google...) sem expor a inscrição
    servico: (() => { try { return new URL(p.endpoint).host; } catch { return ''; } })(),
  };
}

export default {
  name: 'notificacoes',
  register(app) {
    // Chave pública que o navegador usa para se inscrever
    app.get('/api/notificacoes/chave', exigirLogin, (req, res) => {
      res.json({ chave_publica: chavesVapid().publica, ligado: configNotificacoes().ligado });
    });

    // Este aparelho quer receber (ou renovou a inscrição): guarda ou atualiza pelo endereço da inscrição
    app.post('/api/notificacoes/inscrever', exigirLogin, (req, res) => {
      let insc;
      try { insc = validarInscricao(req.body?.inscricao); } catch (err) { return res.status(err.status || 400).json({ erro: err.message }); }
      const aparelho = textoCurto(req.body?.aparelho, 80) || 'Aparelho';
      const ua = textoCurto(req.get('user-agent'), 300);
      run(
        `INSERT INTO push_inscricoes (user_id, endpoint, p256dh, auth, aparelho, user_agent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           aparelho = excluded.aparelho, user_agent = excluded.user_agent, falhas = 0, ultimo_erro = NULL, updated_at = excluded.updated_at`,
        [req.user.id, insc.endpoint, insc.p256dh, insc.auth, aparelho, ua, agora()]
      );
      const p = get('SELECT * FROM push_inscricoes WHERE endpoint = ?', [insc.endpoint]);
      res.json({ ok: true, aparelho: aparelhoPublico(p) });
    });

    // Este aparelho desligou as notificações
    app.post('/api/notificacoes/cancelar', exigirLogin, (req, res) => {
      const endpoint = String(req.body?.endpoint || '');
      const p = endpoint ? get('SELECT id, user_id FROM push_inscricoes WHERE endpoint = ?', [endpoint]) : null;
      if (p && (p.user_id === req.user.id || req.user.role === 'admin')) run('DELETE FROM push_inscricoes WHERE id = ?', [p.id]);
      res.json({ ok: true });
    });

    // Aparelhos inscritos: o administrador vê todos; os outros, só os seus
    app.get('/api/notificacoes/aparelhos', exigirLogin, (req, res) => {
      const admin = req.user.role === 'admin';
      const linhas = all(
        `SELECT p.*, u.name AS usuario FROM push_inscricoes p JOIN users u ON u.id = p.user_id
          ${admin ? '' : 'WHERE p.user_id = ?'} ORDER BY u.name, p.created_at`,
        admin ? [] : [req.user.id]
      );
      const recebem = new Set(destinatarios().map((p) => p.id));
      res.json({ aparelhos: linhas.map((p) => ({ ...aparelhoPublico(p, { comUsuario: admin }), recebe: recebem.has(p.id) })) });
    });

    app.delete('/api/notificacoes/aparelhos/:id', exigirLogin, (req, res) => {
      const id = idValido(req.params.id);
      const p = id ? get('SELECT id, user_id FROM push_inscricoes WHERE id = ?', [id]) : null;
      if (!p) return res.status(404).json({ erro: 'Aparelho não encontrado' });
      if (p.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ erro: 'Este aparelho é de outra pessoa' });
      run('DELETE FROM push_inscricoes WHERE id = ?', [id]);
      res.json({ ok: true });
    });

    // Leads que já agendaram (para escolher no teste), as reuniões mais próximas primeiro
    app.get('/api/notificacoes/leads-agendados', exigirLogin, (req, res) => {
      const linhas = all(
        `SELECT c.lead_id, c.uri, c.start_time, l.name, l.extra
           FROM calendly_events c JOIN leads l ON l.id = c.lead_id
          WHERE c.status = 'active'
          ORDER BY (c.start_time >= ?) DESC, abs(julianday(c.start_time) - julianday('now')) ASC
          LIMIT 300`,
        [agora()]
      );
      const vistos = new Set();
      const leads = [];
      for (const r of linhas) {
        if (vistos.has(r.lead_id)) continue;
        vistos.add(r.lead_id);
        leads.push({ lead_id: r.lead_id, uri: r.uri, nome: r.name || `Lead #${r.lead_id}`, inicio: r.start_time, nicho: nichoDoLead(r.extra) });
        if (leads.length >= 100) break;
      }
      res.json({ leads });
    });

    // Teste: monta o aviso de um lead que agendou e manda já. Administrador escolhe o aparelho (ou todos);
    // os outros só testam nos próprios aparelhos.
    app.post('/api/notificacoes/teste', exigirLogin, async (req, res) => {
      const leadId = idValido(req.body?.lead_id);
      if (!leadId) return res.status(400).json({ erro: 'Escolha um lead que já agendou reunião' });
      const aviso = montarAvisoReuniao({ leadId, uri: req.body?.uri ? String(req.body.uri) : null, teste: true });
      if (!aviso) return res.status(400).json({ erro: 'Este lead não tem reunião agendada no CRM' });
      const admin = req.user.role === 'admin';
      const aparelhoId = idValido(req.body?.aparelho_id);
      let aparelhos;
      if (aparelhoId) {
        // Teste num aparelho específico: vai mesmo se a pessoa não puder ver o kanban (é só para conferir)
        const p = get('SELECT p.*, u.name AS usuario FROM push_inscricoes p JOIN users u ON u.id = p.user_id WHERE p.id = ?', [aparelhoId]);
        if (!p) return res.status(404).json({ erro: 'Aparelho não encontrado. Atualize a lista.' });
        if (!admin && p.user_id !== req.user.id) return res.status(403).json({ erro: 'Você só pode testar nos seus aparelhos' });
        aparelhos = [p];
      } else {
        aparelhos = admin ? destinatarios() : destinatarios({ userId: req.user.id });
      }
      if (!aparelhos.length) {
        return res.status(400).json({ erro: 'Nenhum aparelho com notificações ligadas. Abra o CRM instalado no celular e toque em "Ligar notificações neste aparelho".' });
      }
      const resultados = await enviarAviso(aviso, aparelhos, { origem: `teste por ${req.user.name}` });
      res.json({ aviso, resultados });
    });

    app.get('/api/notificacoes/config', exigirLogin, exigirAdmin, (req, res) => {
      res.json({ ...configNotificacoes(), perguntas: perguntasConhecidas(), historico: historico() });
    });

    app.put('/api/notificacoes/config', exigirLogin, exigirAdmin, (req, res) => {
      const cfg = salvarConfigNotificacoes(req.body || {});
      res.json({ ...cfg, perguntas: perguntasConhecidas(), historico: historico() });
    });
  },

  start() {
    chavesVapid(); // cria as chaves já na 1ª vez que o CRM liga
    aoAcontecer('calendly:agendou', (d) => avisarReuniaoAgendada(d).catch((err) => console.error('[notificações]', err.message)));
  },
};
