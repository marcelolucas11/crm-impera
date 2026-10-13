// Sincronização com o Calendly: busca as reuniões recentes e futuras, liga cada uma a um lead
// (criando o lead se preciso), avança o lead para "Reunião agendada" e registra cancelamentos.
import { get, tx, run, agora } from '../../db.js';
import { registrarEvento } from '../../events.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { normalizarTelefone, normalizarEmail, texto } from '../../util.js';
import { criarLead, encontrarExistente, avancarEtapa, vincularConversasExistentes } from '../leads/service.js';
import { chamar, listarTudo } from './cliente.js';

const DIAS_PARA_TRAS = 7;
const RE_TELEFONE = /telefone|whats|celular|fone|phone|contato/i;

// Etapa marcada como "reuniões do Calendly" no editor de etapas
function etapaReuniao() {
  return get("SELECT id FROM stages WHERE role = 'reuniao' AND kind = 'open' LIMIT 1")?.id || null;
}

function dadosDoConvidado(convidados) {
  const c = convidados.find((x) => x.status === 'active') || convidados[0];
  if (!c) return null;
  const respostas = (c.questions_and_answers || []).map((q) => ({ pergunta: q.question, resposta: q.answer }));
  const respTelefone = respostas.find((r) => RE_TELEFONE.test(r.pergunta || '') && /\d{8,}/.test(String(r.resposta || '').replace(/\D/g, '')));
  return {
    name: texto(c.name, 200),
    email: normalizarEmail(c.email),
    phone: normalizarTelefone(c.text_reminder_number || respTelefone?.resposta),
    respostas,
    utm: Object.fromEntries(Object.entries(c.tracking || {}).filter(([k, v]) => /^utm_/.test(k) && v)),
  };
}

function aplicarEvento(ev, convidado) {
  return tx(() => {
    const anterior = get('SELECT * FROM calendly_events WHERE uri = ?', [ev.uri]);
    let leadId = anterior?.lead_id && get('SELECT id FROM leads WHERE id = ?', [anterior.lead_id]) ? anterior.lead_id : null;
    let novoLead = false;

    if (!leadId && convidado) {
      leadId = encontrarExistente({ phone: convidado.phone, email: convidado.email });
      if (!leadId) {
        leadId = criarLead({
          name: convidado.name,
          phone: convidado.phone,
          email: convidado.email,
          source: 'calendly',
          extra: { formulario: ev.name, respostas: convidado.respostas, utm: convidado.utm },
        });
        novoLead = true;
      } else {
        run('UPDATE leads SET name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?) WHERE id = ?', [
          convidado.name, convidado.phone, convidado.email, leadId,
        ]);
        const telefone = get('SELECT phone FROM leads WHERE id = ?', [leadId])?.phone;
        if (telefone) vincularConversasExistentes(leadId, telefone);
      }
    }

    const dadosEvento = { evento: ev.name, inicio: ev.start_time, link: ev.location?.join_url || null };
    if (leadId) {
      if (!anterior && ev.status === 'active') {
        registrarEvento({ leadId, type: 'meeting_scheduled', data: dadosEvento });
        const etapa = etapaReuniao();
        if (etapa) avancarEtapa(leadId, etapa);
      } else if (anterior && anterior.status === 'active' && ev.status === 'canceled') {
        registrarEvento({ leadId, type: 'meeting_canceled', data: { ...dadosEvento, motivo: ev.cancellation?.reason || null } });
      } else if (anterior && ev.status === 'active' && anterior.start_time !== ev.start_time) {
        registrarEvento({ leadId, type: 'meeting_rescheduled', data: { ...dadosEvento, antes: anterior.start_time } });
      }
    }

    run(
      `INSERT INTO calendly_events (uri, lead_id, event_name, start_time, end_time, status, join_url,
                                    invitee_name, invitee_email, invitee_phone, remote_updated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         lead_id = excluded.lead_id, event_name = excluded.event_name, start_time = excluded.start_time,
         end_time = excluded.end_time, status = excluded.status, join_url = excluded.join_url,
         invitee_name = excluded.invitee_name, invitee_email = excluded.invitee_email,
         invitee_phone = excluded.invitee_phone, remote_updated_at = excluded.remote_updated_at, updated_at = excluded.updated_at`,
      [
        ev.uri, leadId, ev.name, ev.start_time, ev.end_time, ev.status, ev.location?.join_url || null,
        convidado?.name || null, convidado?.email || null, convidado?.phone || null, ev.updated_at || null, agora(),
      ]
    );
    return { novo: !anterior, novoLead };
  });
}

let rodando = false;

export async function sincronizarCalendly() {
  if (rodando) return { ignorado: true };
  rodando = true;
  const inicio = Date.now();
  try {
    let estado = lerEstado('calendly');
    if (!estado.usuario_uri) {
      const eu = (await chamar('/users/me')).resource;
      estado = salvarEstado('calendly', { usuario_uri: eu.uri, usuario_nome: eu.name, usuario_email: eu.email });
    }

    const desde = new Date(Date.now() - DIAS_PARA_TRAS * 24 * 3600 * 1000).toISOString();
    const eventos = await listarTudo('/scheduled_events', { user: estado.usuario_uri, min_start_time: desde, sort: 'start_time:asc' });

    let novos = 0;
    let atualizados = 0;
    let leadsCriados = 0;
    for (const ev of eventos) {
      const salvo = get('SELECT remote_updated_at, status FROM calendly_events WHERE uri = ?', [ev.uri]);
      if (salvo && salvo.remote_updated_at === ev.updated_at && salvo.status === ev.status) continue;
      const convidados = await listarTudo(`${ev.uri}/invitees`, {}, 2);
      const r = aplicarEvento(ev, dadosDoConvidado(convidados));
      if (r.novo) novos++; else atualizados++;
      if (r.novoLead) leadsCriados++;
    }

    const resumo = { novos, atualizados, leads_criados: leadsCriados, analisados: eventos.length };
    salvarEstado('calendly', { ultima_sincronizacao: agora(), ultimo_erro: null, ultimo_resumo: resumo, duracao_ms: Date.now() - inicio });
    if (novos || atualizados) console.log(`[calendly] ${novos} reunião(ões) nova(s), ${atualizados} atualizada(s), ${leadsCriados} lead(s) criado(s)`);
    return resumo;
  } catch (err) {
    salvarEstado('calendly', { ultimo_erro: err.message, ultima_tentativa: agora() });
    if (err.status === 401) salvarEstado('calendly', { usuario_uri: null });
    console.error('[calendly] erro na sincronização:', err.message);
    throw err;
  } finally {
    rodando = false;
  }
}
