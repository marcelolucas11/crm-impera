// Motor da IA de primeiro contato.
//
// Regras de quando a IA atua:
//  - Só em conversa individual (nunca grupo), de lead NOVO: ninguém da equipe falou com ele antes e a conversa não
//    tem mensagens mais antigas que "janela_lead_novo_horas". Conversa que não passa nessa avaliação fica marcada
//    como "ignorada" e a IA nunca mais olha para ela.
//  - Para na hora em que alguém da equipe manda mensagem (pelo CRM ou pelo celular): a conversa vira "humano".
//  - Passa para um humano (marca o lead como "aguardando minha resposta" no kanban) quando o lead pede uma pessoa,
//    quando ela percebe que precisa de um humano, quando bate o limite de mensagens ou quando algo dá errado.
//  - Mensagens da saudação automática dos Disparos e da própria IA não contam como "contato humano".
//
// Proteção do número (WhatsApp por QR code não é oficial): espera o lead terminar de digitar, mostra "digitando…"
// pelo tempo de uma pessoa, respeita o limite de mensagens por hora e só fala com quem chegou agora.
import { get, all, run, agora } from '../../db.js';
import { registrarEvento } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { variantesTelefone } from '../../util.js';
import { lerConfig } from './config.js';
import { dentroDoHorario, saudacaoDoMomento } from './horario.js';
import { tentativaDeComando, pedeHumano, validarSaida } from './seguranca.js';
import { textoDoSistema, montarPedido, primeiroNome } from './prompt.js';
import { diretrizesAtivas } from './diretrizes.js';
import { dadosDoFormulario } from './formulario.js';
import { perguntarModelo, lerJsonDaResposta, registrar, ErroIA, perguntarNoFormato } from './cliente.js';

// Dependências do WhatsApp (trocadas nos testes)
const deps = {
  async enviar(numeroId, destino, dados) {
    const { enviar } = await import('../whatsapp/envio.js');
    return enviar(numeroId, destino, dados, dados.userId || null);
  },
  async digitando(numeroId, jid, estado) {
    const { avisarDigitando } = await import('../whatsapp/envio.js');
    return avisarDigitando(numeroId, jid, estado);
  },
  async numeroDisponivel(preferidos) {
    const { socketConectado, algumConectado } = await import('../whatsapp/instancias.js');
    for (const id of preferidos) if (socketConectado(id)) return Number(id);
    return algumConectado()?.id || null;
  },
  async virarLead(chave) {
    const { transformarEmLead } = await import('../whatsapp/conversas.js');
    return transformarEmLead(chave, null);
  },
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  aleatorio: Math.random,
};
export function definirDependencias(novas) {
  Object.assign(deps, novas);
}

const avisarTela = (conversa, extra = {}) => {
  emitir('ia', { conversa: conversa?.id, chave: conversa?.chave, ...extra });
  if (conversa?.jid) emitir('whatsapp', { chat: conversa.jid });
};

// ------------------------------------------------------------------ quem é a conversa

function jidsDoContato({ leadId, phone, jid }) {
  const jids = new Set(jid ? [jid] : []);
  if (leadId) all('SELECT jid FROM wa_contacts WHERE lead_id = ?', [leadId]).forEach((r) => jids.add(r.jid));
  if (phone) {
    const v = variantesTelefone(phone);
    all(`SELECT jid FROM wa_contacts WHERE phone IN (${v.map(() => '?').join(',')})`, v).forEach((r) => jids.add(r.jid));
    v.forEach((p) => jids.add(`${p}@s.whatsapp.net`));
  }
  return [...jids].filter((j) => !/@g\.us$/.test(j));
}

// Filtro SQL das mensagens deste contato (lead e/ou jids)
function filtro({ leadId, jids }) {
  const partes = [];
  const params = [];
  if (leadId) { partes.push('m.lead_id = ?'); params.push(leadId); }
  if (jids.length) { partes.push(`m.chat_jid IN (${jids.map(() => '?').join(',')})`); params.push(...jids); }
  return { where: partes.length ? `(${partes.join(' OR ')})` : '0', params };
}

// Mensagem nossa que NÃO é da IA nem da saudação automática = alguém da equipe falou com o lead
const EH_HUMANA = `m.from_me = 1 AND m.type <> 'chamada' AND m.deleted_at IS NULL
  AND COALESCE(CASE WHEN json_valid(m.extra) THEN json_extract(m.extra, '$.origem') END, '') NOT IN ('ia', 'disparo')`;

export function teveContatoHumano(contato, desde = null) {
  const f = filtro(contato);
  const depois = desde ? ' AND m.timestamp >= ?' : '';
  return Boolean(get(`SELECT 1 AS ok FROM wa_messages m WHERE ${f.where} AND ${EH_HUMANA}${depois} LIMIT 1`, desde ? [...f.params, desde] : f.params));
}

function mensagemMaisAntiga(contato) {
  const f = filtro(contato);
  return get(`SELECT min(m.timestamp) AS t FROM wa_messages m WHERE ${f.where} AND m.type <> 'chamada'`, f.params)?.t || null;
}

function contatoDaConversa(c) {
  return { leadId: c.lead_id, phone: c.phone, jid: c.jid, jids: jidsDoContato({ leadId: c.lead_id, phone: c.phone, jid: c.jid }) };
}

export function acharConversa({ leadId = null, phone = null, jid = null }) {
  const condicoes = [];
  const params = [];
  if (leadId) { condicoes.push('lead_id = ?'); params.push(leadId); }
  if (phone) {
    const v = variantesTelefone(phone);
    condicoes.push(`phone IN (${v.map(() => '?').join(',')})`);
    params.push(...v);
  }
  if (jid) { condicoes.push('jid = ?'); params.push(jid); }
  if (!condicoes.length) return null;
  return get(`SELECT * FROM ia_conversas WHERE ${condicoes.join(' OR ')} ORDER BY id DESC LIMIT 1`, params);
}

const chaveDe = ({ leadId, phone, jid }) => (leadId ? `l:${leadId}` : phone ? `t:${phone}` : `j:${jid}`);

function criarConversa({ leadId, phone, jid, instanciaId, origem, status, motivo, proximaEm = null }) {
  const chave = chaveDe({ leadId, phone, jid });
  run(
    `INSERT INTO ia_conversas (chave, lead_id, phone, jid, instance_id, origem, status, motivo, proxima_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chave) DO NOTHING`,
    [chave, leadId, phone, jid, instanciaId, origem, status, motivo, proximaEm]
  );
  return get('SELECT * FROM ia_conversas WHERE chave = ?', [chave]);
}

function atualizar(id, campos) {
  const chaves = Object.keys(campos);
  run(`UPDATE ia_conversas SET ${chaves.map((k) => `${k} = ?`).join(', ')}, atualizada_em = ? WHERE id = ?`, [
    ...chaves.map((k) => campos[k]), agora(), id,
  ]);
}

// Avalia se um contato é "lead novo que nunca teve contato". Devolve null (pode atuar) ou o motivo para não atuar.
export function motivoParaNaoAtuar(cfg, contato, { leadId } = {}) {
  if (teveContatoHumano(contato)) return 'Já teve contato da equipe antes';
  const antiga = mensagemMaisAntiga(contato);
  if (antiga && Date.now() - new Date(antiga).getTime() > cfg.janela_lead_novo_horas * 3600000) return 'Conversa antiga: não é lead novo';
  const v = contato.phone ? variantesTelefone(contato.phone) : [];
  if (v.length && get(`SELECT 1 AS ok FROM disparo_bloqueio WHERE phone IN (${v.map(() => '?').join(',')})`, v)) return 'Número na lista de bloqueio';
  if (leadId) {
    const lead = get('SELECT l.created_at, l.owner_id, l.extra, s.kind FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [leadId]);
    if (lead?.kind && lead.kind !== 'open') return 'Lead já está fechado ou perdido';
    if (lead && Date.now() - new Date(lead.created_at).getTime() > cfg.janela_lead_novo_horas * 3600000) return 'Lead antigo no CRM';
    try { if (JSON.parse(lead?.extra || '{}').ia_desligada) return 'IA desligada para este lead'; } catch { /* ignora */ }
  }
  return null;
}

// ------------------------------------------------------------------ eventos

const daquiA = (ms) => new Date(Date.now() + ms).toISOString();

/** Mensagem nova do contato (ao vivo). dados: { instanciaId, chatJid, leadId, phone, grupo, fromMe } */
export function aoReceberMensagem({ instanciaId, chatJid, leadId = null, phone = null, grupo = false }) {
  const cfg = lerConfig();
  if (!cfg.ativo || grupo || !chatJid) return null;
  if (cfg.numero_ids.length && !cfg.numero_ids.includes(Number(instanciaId))) return null;
  const tel = phone || get('SELECT phone FROM wa_contacts WHERE jid = ?', [chatJid])?.phone || null;
  let conversa = acharConversa({ leadId, phone: tel, jid: chatJid });
  if (!conversa) {
    const contato = { leadId, phone: tel, jid: chatJid, jids: jidsDoContato({ leadId, phone: tel, jid: chatJid }) };
    const motivo = motivoParaNaoAtuar(cfg, contato, { leadId });
    conversa = criarConversa({
      leadId, phone: tel, jid: chatJid, instanciaId, origem: 'whatsapp',
      status: motivo ? 'ignorada' : 'ativa', motivo, proximaEm: motivo ? null : daquiA(cfg.espera_agrupar_seg * 1000),
    });
    if (!motivo) {
      console.log(`[ia] assumiu o primeiro contato de ${tel || chatJid}`);
      registrar(conversa.id, 'inicio', 'WhatsApp');
      avisarTela(conversa);
    }
    return conversa;
  }
  // Conversa conhecida: completa o que faltava e, se a IA estiver atendendo, espera o lead terminar de digitar
  const completar = {};
  if (!conversa.lead_id && leadId) completar.lead_id = leadId;
  if (!conversa.jid) completar.jid = chatJid;
  if (!conversa.instance_id && instanciaId) completar.instance_id = instanciaId;
  if (conversa.status === 'ativa') completar.proxima_em = daquiA(cfg.espera_agrupar_seg * 1000);
  if (Object.keys(completar).length) atualizar(conversa.id, completar);
  return { ...conversa, ...completar };
}

/** Alguém da equipe mandou mensagem (CRM ou celular): a IA para nesta conversa na hora. */
export function aoMensagemHumana({ jid = null, leadId = null }) {
  const tel = jid ? get('SELECT phone FROM wa_contacts WHERE jid = ?', [jid])?.phone : null;
  const conversa = acharConversa({ leadId, phone: tel, jid });
  if (!conversa || !['ativa', 'aguardando_humano', 'pausada', 'erro'].includes(conversa.status)) return null;
  atualizar(conversa.id, { status: 'humano', motivo: 'Equipe assumiu a conversa', proxima_em: null });
  run("UPDATE ia_sugestoes SET status = 'expirada', decidida_em = ? WHERE conversa_id = ? AND status = 'pendente'", [agora(), conversa.id]);
  // A equipe respondeu: o aviso "aguardando minha resposta" que a IA acendeu já não vale
  if (conversa.lead_id) run("UPDATE leads SET waiting_since = NULL, waiting_note = NULL, updated_at = ? WHERE id = ? AND waiting_note LIKE 'IA%'", [agora(), conversa.lead_id]);
  registrar(conversa.id, 'humano_assumiu');
  avisarTela(conversa);
  return conversa;
}

/** Lead novo do Yay! Forms: a IA manda a primeira mensagem. resultado: { leadId, novo, tipo } */
export function aoReceberLeadFormulario({ leadId, novo } = {}, { saudacaoDisparosAtiva = false } = {}) {
  const cfg = lerConfig();
  if (!cfg.ativo || !cfg.iniciar_formulario || !leadId || !novo) return null;
  if (saudacaoDisparosAtiva) {
    console.log('[ia] lead do formulário não recebeu a primeira mensagem da IA: a saudação automática dos Disparos está ligada');
    return null;
  }
  const lead = get('SELECT id, phone FROM leads WHERE id = ?', [leadId]);
  if (!lead?.phone) return null;
  if (acharConversa({ leadId, phone: lead.phone })) return null;
  const contato = { leadId, phone: lead.phone, jid: null, jids: jidsDoContato({ leadId, phone: lead.phone }) };
  const motivo = motivoParaNaoAtuar(cfg, contato, { leadId });
  // Espera um pouco, como uma pessoa que viu o cadastro chegar (1 a 2 minutos)
  const atraso = 60000 + Math.round(deps.aleatorio() * 60000);
  const conversa = criarConversa({
    leadId, phone: lead.phone, jid: null, instanciaId: cfg.numero_ids[0] || null, origem: 'yayforms',
    status: motivo ? 'ignorada' : 'ativa', motivo, proximaEm: motivo ? null : daquiA(atraso),
  });
  if (!motivo) {
    registrar(conversa.id, 'inicio', 'Yay! Forms');
    console.log(`[ia] primeira mensagem para o lead #${leadId} (formulário) em ~${Math.round(atraso / 1000)}s`);
    avisarTela(conversa);
  }
  return conversa;
}

// ------------------------------------------------------------------ passar para um humano

export async function passarParaHumano(conversa, { motivo, resumo = null, userId = null }) {
  let leadId = conversa.lead_id;
  // Contato que só existia no WhatsApp vira lead, para aparecer no kanban
  if (!leadId) {
    try {
      leadId = (await deps.virarLead(conversa.chave))?.leadId || null;
    } catch (err) {
      console.error('[ia] não consegui transformar o contato em lead:', err.message);
    }
  }
  atualizar(conversa.id, { status: 'aguardando_humano', motivo, resumo: resumo || conversa.resumo, lead_id: leadId, proxima_em: null });
  if (leadId) {
    const nota = `IA: ${motivo}`.slice(0, 300);
    run('UPDATE leads SET waiting_since = COALESCE(waiting_since, ?), waiting_note = ?, updated_at = ? WHERE id = ?', [agora(), nota, agora(), leadId]);
    registrarEvento({ leadId, userId, type: 'ia_handoff', data: { motivo, resumo: resumo || conversa.resumo || null } });
  }
  registrar(conversa.id, 'passou_humano', motivo);
  console.log(`[ia] passou para humano (${conversa.chave}): ${motivo}`);
  avisarTela(conversa, { handoff: true, lead_id: leadId, motivo });
}

// ------------------------------------------------------------------ envio

const enviadasNaUltimaHora = () =>
  get("SELECT count(*) AS n FROM ia_registro WHERE tipo = 'enviada' AND created_at >= ?", [new Date(Date.now() - 3600000).toISOString()]).n;

async function numeroDaConversa(conversa, cfg) {
  const preferidos = [conversa.instance_id, ...cfg.numero_ids].filter(Boolean);
  return deps.numeroDisponivel(preferidos);
}

/** Envia como uma pessoa: espera ler, mostra "digitando…" pelo tempo proporcional ao texto e manda. */
export async function enviarComoPessoa(conversa, mensagens, { userId = null, simularDigitacao = true } = {}) {
  const cfg = lerConfig();
  const numeroId = await numeroDaConversa(conversa, cfg);
  if (!numeroId) throw new ErroIA('Nenhum número de WhatsApp conectado', { temporario: true });
  const destino = conversa.lead_id ? { leadId: conversa.lead_id } : { jid: conversa.jid };
  let enviadas = 0;
  for (const texto of mensagens) {
    if (simularDigitacao) {
      await deps.esperar(1500 + Math.round(deps.aleatorio() * 2500));
      // Alguém da equipe assumiu enquanto a IA "lia": não envia mais nada
      if (!userId && get('SELECT status FROM ia_conversas WHERE id = ?', [conversa.id])?.status !== 'ativa') break;
      const jidPresenca = conversa.jid || (destino.leadId ? get('SELECT jid FROM wa_contacts WHERE lead_id = ? LIMIT 1', [destino.leadId])?.jid : null);
      if (jidPresenca) await deps.digitando(numeroId, jidPresenca, 'composing').catch(() => {});
      await deps.esperar(Math.min(1200 + texto.length * 45, 12000) + Math.round(deps.aleatorio() * 1500));
      if (!userId && get('SELECT status FROM ia_conversas WHERE id = ?', [conversa.id])?.status !== 'ativa') break;
    }
    await deps.enviar(numeroId, destino, { texto, automatico: !userId, origem: 'ia', semPrevia: true, userId });
    enviadas++;
    registrar(conversa.id, 'enviada', texto.slice(0, 200));
  }
  if (enviadas) {
    run('UPDATE ia_conversas SET mensagens_ia = mensagens_ia + ?, instance_id = COALESCE(instance_id, ?), atualizada_em = ? WHERE id = ?', [
      enviadas, numeroId, agora(), conversa.id,
    ]);
  }
  return enviadas;
}

// ------------------------------------------------------------------ o atendimento em si

function historicoDaConversa(contato) {
  const f = filtro(contato);
  return all(
    `SELECT m.id, m.from_me, m.type, m.body, m.legenda, m.timestamp FROM wa_messages m
      WHERE ${f.where} AND m.type <> 'chamada' AND m.deleted_at IS NULL AND m.hidden_at IS NULL
      ORDER BY m.timestamp, m.id`,
    f.params
  );
}

function nomeDoLead(conversa, contato) {
  if (conversa.lead_id) {
    const n = get('SELECT name FROM leads WHERE id = ?', [conversa.lead_id])?.name;
    if (n) return n;
  }
  for (const jid of contato.jids) {
    const c = get('SELECT name, push_name FROM wa_contacts WHERE jid = ?', [jid]);
    if (c?.name || c?.push_name) return c.name || c.push_name;
  }
  return null;
}

/**
 * Decide e (no modo automático) envia a próxima resposta. Chamado pelo relógio quando proxima_em vence.
 * Devolve o que aconteceu (para testes e registro).
 */
export async function processarConversa(id) {
  const cfg = lerConfig();
  const conversa = get('SELECT * FROM ia_conversas WHERE id = ?', [id]);
  if (!conversa || conversa.status !== 'ativa') return { feito: 'nada' };
  atualizar(id, { proxima_em: null });
  if (!cfg.ativo) return { feito: 'ia_desligada' };

  const contato = contatoDaConversa(conversa);
  if (teveContatoHumano(contato, conversa.ativada_em)) {
    atualizar(id, { status: 'humano', motivo: 'Equipe assumiu a conversa' });
    avisarTela(conversa);
    return { feito: 'humano' };
  }

  const historico = historicoDaConversa(contato);
  const novas = historico.filter((m) => !m.from_me && m.id > conversa.ultima_lida_id);
  const primeiroContato = !historico.some((m) => m.from_me);
  if (!novas.length && !(conversa.origem === 'yayforms' && primeiroContato)) return { feito: 'sem_novidade' };

  // Proteção do número: limite de mensagens por hora
  if (enviadasNaUltimaHora() >= cfg.limite_por_hora) {
    atualizar(id, { proxima_em: daquiA(5 * 60000) });
    registrar(id, 'limite_hora');
    return { feito: 'limite_hora' };
  }

  if (novas.length) atualizar(id, { ultima_lida_id: Math.max(...novas.map((m) => m.id)) });
  const textoNovo = novas.map((m) => (m.type === 'texto' ? m.body : m.legenda) || '').join('\n');
  const foraDoHorario = !dentroDoHorario(cfg);
  const automatico = cfg.modo === 'automatico' || (foraDoHorario && cfg.automatico_fora_horario);
  const saudacao = saudacaoDoMomento(cfg);
  const nome = primeiroNome(nomeDoLead(conversa, contato));
  const precisaAvisoHorario = foraDoHorario && !conversa.aviso_fora_horario_em;
  const abertura = primeiroContato ? `${saudacao}${nome ? `, ${nome}` : ''}! ${cfg.apresentacao}` : null;

  // Resposta pronta (sem gastar chamada ao modelo): junta abertura e aviso de horário quando for o caso
  const comExtras = (texto) => [abertura ? `${abertura} ${texto}` : texto, precisaAvisoHorario ? cfg.aviso_fora_horario : null].filter(Boolean);

  // 1) Tentativa de usar a IA para outra coisa (código, senha, "ignore suas instruções")
  if (textoNovo && tentativaDeComando(textoNovo)) {
    const avisos = conversa.avisos_seguranca + 1;
    atualizar(id, { avisos_seguranca: avisos });
    registrar(id, 'bloqueio_entrada', textoNovo.slice(0, 300));
    if (avisos >= 2) {
      return decidir(conversa, cfg, {
        mensagens: comExtras(`Por aqui eu só consigo ajudar com dúvidas básicas sobre a ${cfg.empresa}. Vou deixar o ${cfg.nome_atendente} a par da conversa, tudo bem?`),
        acao: 'passar_humano', motivo: 'Lead insistiu em pedidos fora do atendimento (bloqueados pela segurança)',
      }, { automatico, foraDoHorario, precisaAvisoHorario });
    }
    return decidir(conversa, cfg, {
      mensagens: comExtras(`Por aqui eu consigo te ajudar só com dúvidas básicas sobre a ${cfg.empresa} ou chamar o ${cfg.nome_atendente}. Quer que eu chame ele?`),
      acao: 'responder',
    }, { automatico, foraDoHorario, precisaAvisoHorario });
  }

  // 2) Pediu para falar com uma pessoa
  if (textoNovo && pedeHumano(textoNovo)) {
    return decidir(conversa, cfg, {
      mensagens: comExtras(`Claro! Já avisei o ${cfg.nome_atendente}, ele vai continuar seu atendimento por aqui. 😊`),
      acao: 'passar_humano', motivo: 'Lead pediu para falar com uma pessoa',
    }, { automatico, foraDoHorario, precisaAvisoHorario });
  }

  // 3) Chegou no limite de mensagens da IA
  if (conversa.mensagens_ia >= cfg.max_mensagens_ia) {
    return decidir(conversa, cfg, {
      mensagens: comExtras(`Vou passar você para o ${cfg.nome_atendente}, que consegue te explicar tudo com mais detalhes. Ele continua por aqui. 😊`),
      acao: 'passar_humano', motivo: `IA chegou ao limite de ${cfg.max_mensagens_ia} mensagens`,
    }, { automatico, foraDoHorario, precisaAvisoHorario });
  }

  // 4) Pergunta ao modelo
  let resposta;
  try {
    const { resposta: lida, uso, tentativas, parada } = await perguntarNoFormato({
      sistema: textoDoSistema(cfg, diretrizesAtivas()),
      mensagens: montarPedido({
        cfg, lead: { primeiroNome: nome }, historico, foraDoHorario, saudacao, primeiroContato,
        origem: conversa.origem, jaAvisouForaHorario: Boolean(conversa.aviso_fora_horario_em),
        formulario: dadosDoFormulario(conversa.lead_id || contato.leadId, cfg),
      }),
    });
    registrar(id, 'chamada_modelo', tentativas > 1 ? `2ª tentativa (a 1ª veio fora do formato)` : null, uso);
    resposta = lida;
    if (!resposta) throw new ErroIA(parada === 'max_tokens' ? 'A resposta do modelo veio cortada (longa demais), mesmo na 2ª tentativa' : 'O modelo não respondeu no formato combinado, mesmo na 2ª tentativa');
  } catch (err) {
    registrar(id, 'erro', err.message);
    console.error(`[ia] conversa ${conversa.chave}: ${err.message}`);
    if (err.temporario && novas.length) {
      // Tenta de novo em 1 minuto (sem perder as mensagens: volta o ponteiro de leitura)
      atualizar(id, { ultima_lida_id: conversa.ultima_lida_id, proxima_em: daquiA(60000) });
      return { feito: 'tentar_de_novo' };
    }
    await passarParaHumano({ ...conversa, lead_id: conversa.lead_id }, { motivo: `Erro na IA: ${err.message}`.slice(0, 200) });
    return { feito: 'erro' };
  }

  const acao = resposta.acao === 'passar_humano' ? 'passar_humano' : 'responder';
  let mensagens = Array.isArray(resposta.mensagens) ? resposta.mensagens : [resposta.mensagens].filter(Boolean);
  // Garante o aviso de fora do horário na primeira resposta fora do horário
  if (precisaAvisoHorario && !mensagens.some((m) => String(m).includes(cfg.aviso_fora_horario.slice(0, 40)))) {
    const jaFalou = mensagens.some((m) => /prontid|algumas horas|fora do (nosso )?hor/i.test(String(m)));
    if (!jaFalou) mensagens = [...mensagens.slice(0, 2), cfg.aviso_fora_horario];
  }
  const conferida = validarSaida(mensagens, cfg);
  if (!conferida.ok) {
    registrar(id, 'bloqueio_saida', `${conferida.motivo}: ${JSON.stringify(mensagens).slice(0, 400)}`);
    return decidir(conversa, cfg, {
      mensagens: comExtras(`Essa o ${cfg.nome_atendente} vai saber te responder melhor. Já deixei ele avisado, ele continua por aqui. 😊`),
      acao: 'passar_humano', motivo: `Resposta da IA barrada pelo filtro de segurança (${conferida.motivo})`, resumo: resposta.resumo,
    }, { automatico, foraDoHorario, precisaAvisoHorario });
  }
  return decidir(conversa, cfg, {
    mensagens: conferida.mensagens, acao, motivo: String(resposta.motivo || '').slice(0, 200) || 'IA identificou que precisa de um humano',
    resumo: resposta.resumo ? String(resposta.resumo).slice(0, 500) : null,
  }, { automatico, foraDoHorario, precisaAvisoHorario });
}

// Envia (modo automático) ou guarda como sugestão (copiloto)
async function decidir(conversa, cfg, { mensagens, acao, motivo = null, resumo = null }, { automatico, precisaAvisoHorario }) {
  if (resumo) atualizar(conversa.id, { resumo });
  if (!automatico) {
    run("UPDATE ia_sugestoes SET status = 'expirada', decidida_em = ? WHERE conversa_id = ? AND status = 'pendente'", [agora(), conversa.id]);
    run('INSERT INTO ia_sugestoes (conversa_id, mensagens, acao, motivo) VALUES (?, ?, ?, ?)', [conversa.id, JSON.stringify(mensagens), acao, motivo]);
    if (conversa.lead_id) {
      run("UPDATE leads SET waiting_since = COALESCE(waiting_since, ?), waiting_note = ?, updated_at = ? WHERE id = ?", [
        agora(), 'IA sugeriu uma resposta: aprove na conversa', agora(), conversa.lead_id,
      ]);
    }
    registrar(conversa.id, 'sugestao', acao);
    avisarTela(conversa, { sugestao: true });
    return { feito: 'sugestao', mensagens, acao };
  }
  try {
    const enviadas = await enviarComoPessoa(conversa, mensagens);
    if (!enviadas) return { feito: 'interrompida' };
    if (precisaAvisoHorario) atualizar(conversa.id, { aviso_fora_horario_em: agora() });
  } catch (err) {
    registrar(conversa.id, 'erro', `Envio: ${err.message}`);
    if (err.temporario) {
      atualizar(conversa.id, { proxima_em: daquiA(2 * 60000) });
      return { feito: 'tentar_de_novo' };
    }
    await passarParaHumano(conversa, { motivo: `Não consegui enviar pelo WhatsApp: ${err.message}`.slice(0, 200), resumo });
    return { feito: 'erro' };
  }
  if (acao === 'passar_humano') await passarParaHumano(get('SELECT * FROM ia_conversas WHERE id = ?', [conversa.id]), { motivo, resumo });
  else avisarTela(conversa);
  return { feito: 'enviada', mensagens, acao };
}

// ------------------------------------------------------------------ copiloto: aprovar / descartar

export async function aprovarSugestao(sugestaoId, { mensagens = null, userId }) {
  const s = get('SELECT * FROM ia_sugestoes WHERE id = ?', [sugestaoId]);
  if (!s || s.status !== 'pendente') throw new ErroIA('Esta sugestão não está mais pendente', { status: 409 });
  const conversa = get('SELECT * FROM ia_conversas WHERE id = ?', [s.conversa_id]);
  const cfg = lerConfig();
  const originais = JSON.parse(s.mensagens);
  const finais = (Array.isArray(mensagens) && mensagens.length ? mensagens : originais).map((m) => String(m).trim()).filter(Boolean).slice(0, 3);
  if (!finais.length) throw new ErroIA('Nada para enviar', { status: 400 });
  const editada = JSON.stringify(finais) !== JSON.stringify(originais);
  run("UPDATE ia_sugestoes SET status = 'enviada', editada = ?, decidida_por = ?, decidida_em = ? WHERE id = ?", [editada, userId, agora(), s.id]);
  await enviarComoPessoa(conversa, finais, { userId, simularDigitacao: false });
  registrar(conversa.id, editada ? 'sugestao_editada' : 'sugestao_aprovada');
  if (dentroDoHorario(cfg) === false && !conversa.aviso_fora_horario_em) atualizar(conversa.id, { aviso_fora_horario_em: agora() });
  if (s.acao === 'passar_humano') {
    await passarParaHumano(get('SELECT * FROM ia_conversas WHERE id = ?', [conversa.id]), { motivo: s.motivo || 'IA recomendou atendimento humano', userId });
  } else if (conversa.lead_id) {
    run("UPDATE leads SET waiting_since = NULL, waiting_note = NULL, updated_at = ? WHERE id = ? AND waiting_note LIKE 'IA%'", [agora(), conversa.lead_id]);
  }
  avisarTela(conversa);
  return { enviadas: finais.length, editada };
}

export function descartarSugestao(sugestaoId, userId) {
  const s = get('SELECT * FROM ia_sugestoes WHERE id = ?', [sugestaoId]);
  if (!s || s.status !== 'pendente') return false;
  run("UPDATE ia_sugestoes SET status = 'descartada', decidida_por = ?, decidida_em = ? WHERE id = ?", [userId, agora(), s.id]);
  registrar(s.conversa_id, 'sugestao_descartada');
  avisarTela(get('SELECT * FROM ia_conversas WHERE id = ?', [s.conversa_id]));
  return true;
}

// ------------------------------------------------------------------ relógio

let relogio = null;
const emAndamento = new Set();

export async function verificarPendentes() {
  const vencidas = all("SELECT id FROM ia_conversas WHERE status = 'ativa' AND proxima_em IS NOT NULL AND proxima_em <= ? ORDER BY proxima_em LIMIT 10", [agora()]);
  for (const { id } of vencidas) {
    if (emAndamento.has(id)) continue;
    emAndamento.add(id);
    processarConversa(id)
      .catch((err) => console.error(`[ia] conversa #${id}:`, err.message))
      .finally(() => emAndamento.delete(id));
  }
}

export function iniciarRelogio() {
  if (relogio) return;
  relogio = setInterval(() => verificarPendentes().catch(() => {}), 3000);
  relogio.unref?.();
}

export function pararRelogio() {
  if (relogio) clearInterval(relogio);
  relogio = null;
}
