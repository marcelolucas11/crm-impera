// Ações da Alice: tudo que envia mensagem ou muda o CRM vira uma proposta (cartão no chat) e só acontece depois
// que o usuário aprova. Ler é livre; executar depende dele. Nenhuma ação apaga nada.
//  propor(tipo, dados, ctx)  → valida, monta o resumo e grava como "pendente"
//  aprovar(id, userId, edicao) → executa (com o que o usuário editou no cartão)
//  recusar(id) · desfazer(id) (quando dá: mover lead, responsável, nota)
import { get, all, run, tx, agora } from '../../db.js';
import { lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { ErroHttp, idValido, normalizarTelefone } from '../../util.js';
import { alterarLeadsEmMassa } from '../leads/service.js';
import { registrarEvento } from '../../events.js';
import { validarBlocos, validarConfig } from '../disparos/blocos.js';
import { criarLista, adicionarMembros, salvarModelo } from '../disparos/servico.js';
import { lerConfig as lerConfigOrganizador, salvarConfig as salvarConfigOrganizador } from '../organizador/config.js';
import { maxMsgId, maxEventoId } from '../organizador/motor.js';
import { socketConectado } from '../whatsapp/instancias.js';
import { interpretarConversa, nomeDaConversa, acharConversas } from './dados.js';

export const TIPOS = {
  enviar_mensagem: 'Enviar mensagem no WhatsApp',
  mover_lead: 'Mover lead no kanban',
  atualizar_lead: 'Atualizar lead',
  criar_publico: 'Criar público (lista de disparo)',
  criar_disparo: 'Criar disparo (rascunho)',
  criar_modelo_disparo: 'Criar modelo de disparo',
  criar_criterio: 'Criar critério do Organizador',
  guardar_memoria: 'Guardar na memória',
  criar_agendado: 'Criar agendado',
};
const MAX_TEXTO = 4000;
let executores = {};
/** Os agendados registram o executor deles (evita importação circular) */
export function registrarExecutor(tipo, { validar, executar }) { executores[tipo] = { validar, executar }; }

const avisarTela = (userId, dados = {}) => emitir('agente', { usuario: userId, acoes: true, ...dados });
const textoLimpo = (v, max = MAX_TEXTO) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// ------------------------------------------------------------------ validação de cada tipo

function numeroParaEnviar(numeroId, chave) {
  const pedido = idValido(numeroId);
  if (pedido) {
    if (!get('SELECT 1 AS ok FROM wa_instances WHERE id = ?', [pedido])) throw new Error(`Número de WhatsApp ${pedido} não existe`);
    return pedido;
  }
  // O último número usado nesta conversa; senão o primeiro conectado
  if (chave) {
    const c = interpretarConversa(chave);
    if (c) {
      const ultimo = c.tipo === 'lead'
        ? get('SELECT instance_id FROM wa_messages WHERE lead_id = ? AND instance_id IS NOT NULL ORDER BY timestamp DESC LIMIT 1', [c.leadId])
        : get('SELECT instance_id FROM wa_messages WHERE chat_jid = ? AND instance_id IS NOT NULL ORDER BY timestamp DESC LIMIT 1', [c.jid || '']);
      if (ultimo?.instance_id) return ultimo.instance_id;
    }
  }
  const conectado = all('SELECT id FROM wa_instances ORDER BY id').find((n) => socketConectado(n.id));
  return conectado?.id || get('SELECT id FROM wa_instances ORDER BY id LIMIT 1')?.id || null;
}

function destinoDe(dados) {
  if (dados.lead_id) {
    const lead = get('SELECT id, name, phone FROM leads WHERE id = ?', [idValido(dados.lead_id)]);
    if (!lead) throw new Error(`Lead ${dados.lead_id} não existe`);
    return { chave: `l:${lead.id}`, nome: lead.name || `Lead ${lead.id}`, destino: { leadId: lead.id } };
  }
  if (dados.conversa) {
    let c = interpretarConversa(dados.conversa);
    if (!c) {
      const achadas = acharConversas(dados.conversa, { limite: 3 });
      if (achadas.length !== 1) throw new Error(achadas.length ? `"${dados.conversa}" bate com mais de uma conversa: ${achadas.map((a) => `${a.nome} (${a.chave})`).join(', ')}` : `Conversa "${dados.conversa}" não encontrada`);
      c = interpretarConversa(achadas[0].chave);
    }
    if (c.tipo === 'lead') return { chave: c.chave, nome: nomeDaConversa(c), destino: { leadId: c.leadId } };
    if (c.tipo === 'grupo' || c.tipo === 'jid') return { chave: c.chave, nome: nomeDaConversa(c), destino: { jid: c.jid } };
    const contato = get("SELECT jid FROM wa_contacts WHERE phone = ? AND jid NOT LIKE '%@g.us' ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END LIMIT 1", [c.phone]);
    return { chave: c.chave, nome: nomeDaConversa(c), destino: { jid: contato?.jid || `${c.phone}@s.whatsapp.net` } };
  }
  if (dados.telefone) {
    const t = normalizarTelefone(dados.telefone);
    if (!t) throw new Error('Telefone inválido');
    const lead = get('SELECT id, name FROM leads WHERE phone = ? LIMIT 1', [t]);
    if (lead) return { chave: `l:${lead.id}`, nome: lead.name || `+${t}`, destino: { leadId: lead.id } };
    return { chave: `t:${t}`, nome: `+${t}`, destino: { jid: `${t}@s.whatsapp.net` } };
  }
  throw new Error('Diga para quem enviar: lead_id, conversa (chave ou nome do grupo) ou telefone');
}

function etapaPorIdOuNome(v) {
  const id = idValido(v);
  const e = id ? get('SELECT id, name, kind FROM stages WHERE id = ?', [id]) : get('SELECT id, name, kind FROM stages WHERE lower(name) = lower(?)', [String(v || '').trim()]);
  if (!e) throw new Error(`Etapa "${v}" não existe. Etapas: ${all('SELECT id, name FROM stages ORDER BY position').map((s) => `${s.id}=${s.name}`).join(', ')}`);
  return e;
}

function leadsDe(ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(idValido).filter(Boolean))].slice(0, 5000);
  if (!lista.length) return [];
  const linhas = [];
  for (let i = 0; i < lista.length; i += 500) {
    const pedaco = lista.slice(i, i + 500);
    linhas.push(...all(`SELECT id, name, phone FROM leads WHERE id IN (${pedaco.map(() => '?').join(',')})`, pedaco));
  }
  return linhas;
}

// Blocos de texto do disparo (aceita o formato da ferramenta e o já validado, ao revalidar depois de editar)
const blocosDeTexto = (lista) => (Array.isArray(lista) ? lista : []).map((b, i) => ({
  tipo: 'texto', texto: b?.texto, espera: { segundos: b?.espera_segundos ?? b?.espera?.segundos ?? (i === 0 ? 2 : 4) },
}));

const VALIDAR = {
  enviar_mensagem(d) {
    const texto = textoLimpo(d.texto);
    if (!texto) throw new Error('Escreva o texto da mensagem');
    const alvo = destinoDe(d);
    const numeroId = numeroParaEnviar(d.numero_id, alvo.chave);
    if (!numeroId) throw new Error('Nenhum número de WhatsApp cadastrado no CRM');
    const numero = get('SELECT name, phone FROM wa_instances WHERE id = ?', [numeroId]);
    return {
      dados: { ...d, texto, numero_id: numeroId, conversa: alvo.chave, lead_id: alvo.destino.leadId || null },
      resumo: `Enviar para ${alvo.nome} pelo número ${numero?.name || numeroId}`,
      editaveis: ['texto'],
    };
  },
  mover_lead(d) {
    const lead = get('SELECT l.id, l.name, l.stage_id, s.name AS etapa FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [idValido(d.lead_id)]);
    if (!lead) throw new Error(`Lead ${d.lead_id} não existe`);
    const etapa = etapaPorIdOuNome(d.etapa_id ?? d.etapa);
    if (etapa.id === lead.stage_id) throw new Error(`${lead.name || 'O lead'} já está em "${etapa.name}"`);
    return { dados: { lead_id: lead.id, etapa_id: etapa.id, motivo: textoLimpo(d.motivo, 500) }, resumo: `Mover ${lead.name || `lead ${lead.id}`}: "${lead.etapa}" → "${etapa.name}"` };
  },
  atualizar_lead(d) {
    const lead = get('SELECT id, name FROM leads WHERE id = ?', [idValido(d.lead_id)]);
    if (!lead) throw new Error(`Lead ${d.lead_id} não existe`);
    const partes = [];
    const dados = { lead_id: lead.id };
    if (d.responsavel_id !== undefined || d.responsavel !== undefined) {
      const u = d.responsavel_id ? get('SELECT id, name FROM users WHERE id = ? AND active = 1', [idValido(d.responsavel_id)])
        : get('SELECT id, name FROM users WHERE lower(name) LIKE lower(?) AND active = 1', [`%${String(d.responsavel || '').trim()}%`]);
      if (!u) throw new Error('Responsável não encontrado entre os usuários ativos');
      dados.responsavel_id = u.id;
      partes.push(`responsável → ${u.name}`);
    }
    if (d.nota) {
      dados.nota = textoLimpo(d.nota, 2000);
      partes.push('acrescentar nota');
    }
    if (!partes.length) throw new Error('Nada para mudar: informe responsavel_id ou nota');
    return { dados, resumo: `${lead.name || `Lead ${lead.id}`}: ${partes.join(' e ')}`, editaveis: dados.nota ? ['nota'] : [] };
  },
  criar_publico(d) {
    const nome = textoLimpo(d.nome, 100);
    if (!nome) throw new Error('Dê um nome ao público');
    const leads = leadsDe(d.lead_ids);
    const avulsos = (Array.isArray(d.telefones) ? d.telefones : []).map((t) => (typeof t === 'object' ? t : { telefone: t }))
      .map((t) => ({ telefone: normalizarTelefone(t.telefone), nome: t.nome ? String(t.nome).slice(0, 200) : null })).filter((t) => t.telefone);
    // Revalidação depois de editar no cartão: os contatos já resolvidos continuam valendo
    const jaResolvidos = Array.isArray(d.contatos) ? d.contatos.filter((c) => c?.telefone) : [];
    const contatos = [...jaResolvidos, ...leads.filter((l) => l.phone).map((l) => ({ telefone: l.phone, lead_id: l.id, nome: l.name })), ...avulsos];
    if (!contatos.length) throw new Error('Nenhum contato com telefone: passe lead_ids ou telefones');
    return {
      dados: { nome, descricao: textoLimpo(d.descricao, 300), contatos: contatos.slice(0, 5000) },
      resumo: `Público "${nome}" com ${contatos.length} contato(s)${leads.length ? ` (${leads.length} do kanban)` : ''}`,
      editaveis: ['nome'],
    };
  },
  criar_disparo(d) {
    const nome = textoLimpo(d.nome, 120) || `Disparo da assistente ${new Date().toLocaleDateString('pt-BR')}`;
    const blocos = validarBlocos(blocosDeTexto(d.blocos), { exigirConteudo: true });
    const listas = (Array.isArray(d.lista_ids) ? d.lista_ids : []).map(idValido).filter(Boolean)
      .filter((id) => get('SELECT 1 AS ok FROM disparo_listas WHERE id = ?', [id]));
    const leads = Array.isArray(d.contatos) && !d.lead_ids
      ? d.contatos.map((c) => ({ phone: c.telefone, id: c.lead_id, name: c.nome })).filter((l) => l.phone)
      : leadsDe(d.lead_ids).filter((l) => l.phone);
    if (!listas.length && !leads.length) throw new Error('Escolha o público: lista_ids (públicos existentes) ou lead_ids');
    const numeroId = numeroParaEnviar(d.numero_id, null);
    const config = validarConfig(d.config || {
      intervalo: { modo: 'aleatorio', min: 25, max: 60 }, lote: { ativo: true, contatos: 30, minutos: 5 },
      janela: { ativa: true, inicio: '08:00', fim: '20:00', dias: [1, 2, 3, 4, 5, 6] },
    });
    const totalListas = listas.reduce((a, id) => a + get('SELECT count(*) AS n FROM disparo_lista_membros WHERE lista_id = ?', [id]).n, 0);
    return {
      dados: { nome, blocos, numero_id: numeroId, config, lista_ids: listas, contatos: leads.map((l) => ({ telefone: l.phone, lead_id: l.id, nome: l.name })) },
      resumo: `Rascunho "${nome}": ${blocos.length} bloco(s), ~${totalListas + leads.length} contato(s). Fica em Disparos para você revisar e dar play.`,
      editaveis: ['nome'],
    };
  },
  criar_modelo_disparo(d) {
    const nome = textoLimpo(d.nome, 100);
    if (!nome) throw new Error('Dê um nome ao modelo');
    const blocos = validarBlocos(blocosDeTexto(d.blocos));
    return { dados: { nome, blocos }, resumo: `Modelo "${nome}" com ${blocos.length} bloco(s)`, editaveis: ['nome'] };
  },
  criar_criterio(d, ctx) {
    if (ctx?.papel !== 'admin') throw new Error('Só administradores criam critérios do Organizador');
    const titulo = textoLimpo(d.titulo, 60);
    const prompt = textoLimpo(d.prompt, 4000);
    if (!titulo || !prompt) throw new Error('Informe titulo e prompt do critério');
    const etapa = etapaPorIdOuNome(d.etapa_id ?? d.etapa);
    if (etapa.kind !== 'open') throw new Error(`"${etapa.name}" é etapa final: o Organizador não leva leads para lá`);
    return { dados: { titulo, prompt, etapa_id: etapa.id }, resumo: `Critério "${titulo}" → etapa "${etapa.name}" (nasce desligado)`, editaveis: ['titulo', 'prompt'] };
  },
  guardar_memoria(d) {
    const texto = textoLimpo(d.texto, 500);
    if (!texto) throw new Error('O que guardar?');
    return { dados: { texto }, resumo: `Guardar: "${texto}"`, editaveis: ['texto'] };
  },
};

// ------------------------------------------------------------------ execução

const EXECUTAR = {
  async enviar_mensagem(d, userId) {
    const { enviar } = await import('../whatsapp/envio.js');
    if (!socketConectado(d.numero_id)) throw new ErroHttp(409, 'O número de WhatsApp escolhido está desconectado agora');
    const alvo = destinoDe(d);
    const r = await enviar(d.numero_id, alvo.destino, { texto: d.texto }, userId);
    return { mensagem_id: r.id, conversa: alvo.chave };
  },
  mover_lead(d, userId) {
    const antes = get('SELECT stage_id FROM leads WHERE id = ?', [d.lead_id]);
    if (!antes) throw new ErroHttp(404, 'O lead não existe mais');
    tx(() => alterarLeadsEmMassa([d.lead_id], { stage_id: d.etapa_id }, userId));
    return { etapa_anterior_id: antes.stage_id };
  },
  atualizar_lead(d, userId) {
    const antes = get('SELECT owner_id, notes FROM leads WHERE id = ?', [d.lead_id]);
    if (!antes) throw new ErroHttp(404, 'O lead não existe mais');
    tx(() => {
      if (d.responsavel_id) alterarLeadsEmMassa([d.lead_id], { owner_id: d.responsavel_id }, userId);
      if (d.nota) {
        const data = new Date().toLocaleDateString('pt-BR');
        const notas = [antes.notes, `[${data}] ${d.nota}`].filter(Boolean).join('\n');
        run('UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?', [notas, agora(), d.lead_id]);
        registrarEvento({ leadId: d.lead_id, userId, type: 'note_added', data: { origem: 'assistente' } });
      }
    });
    return { responsavel_anterior_id: antes.owner_id, notas_anteriores: antes.notes };
  },
  criar_publico(d, userId) {
    const id = criarLista({ nome: d.nome, descricao: d.descricao || 'Criado pela assistente' }, userId);
    const r = adicionarMembros(id, d.contatos);
    emitir('disparos', { listas: true });
    return { lista_id: id, total: r.total };
  },
  criar_disparo(d, userId) {
    const config = { ...d.config, rascunho: { listas: d.lista_ids || [], contatos: d.contatos || [] } };
    const id = Number(run(
      "INSERT INTO disparo_campanhas (nome, tipo, status, numero_id, blocos, config, criado_por) VALUES (?, 'campanha', 'rascunho', ?, ?, ?, ?)",
      [d.nome, d.numero_id || null, JSON.stringify(d.blocos), JSON.stringify(config), userId]
    ).lastInsertRowid);
    emitir('disparos', { rascunhos: true });
    return { rascunho_id: id };
  },
  criar_modelo_disparo(d, userId) {
    const id = salvarModelo({ nome: d.nome, blocos: d.blocos }, userId);
    emitir('disparos', { modelos: true });
    return { modelo_id: id };
  },
  criar_criterio(d) {
    const cfg = lerConfigOrganizador();
    const novo = { id: `c${Date.now().toString(36)}`, titulo: d.titulo, prompt: d.prompt, etapa_id: d.etapa_id, ativo: false };
    salvarConfigOrganizador({ criterios: [...cfg.criterios, novo] }, { maxMsgId: maxMsgId(), maxEventoId: maxEventoId() });
    emitir('organizador', { config: true });
    return { criterio_id: novo.id };
  },
  guardar_memoria(d, userId) {
    const id = Number(run("INSERT INTO agente_memoria (user_id, texto, origem) VALUES (?, ?, 'alice')", [userId, d.texto]).lastInsertRowid);
    return { memoria_id: id };
  },
};

const DESFAZER = {
  mover_lead(acao, userId) {
    const r = lerJson(acao.resultado);
    if (!r.etapa_anterior_id) throw new ErroHttp(409, 'Não sei para qual etapa voltar');
    tx(() => alterarLeadsEmMassa([lerJson(acao.dados).lead_id], { stage_id: r.etapa_anterior_id }, userId));
  },
  atualizar_lead(acao, userId) {
    const d = lerJson(acao.dados);
    const r = lerJson(acao.resultado);
    tx(() => {
      if (d.responsavel_id) alterarLeadsEmMassa([d.lead_id], { owner_id: r.responsavel_anterior_id ?? null }, userId);
      if (d.nota) run('UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?', [r.notas_anteriores ?? null, agora(), d.lead_id]);
    });
  },
};

// ------------------------------------------------------------------ ciclo de vida

function mapear(a) {
  if (!a) return null;
  const dados = lerJson(a.dados);
  return {
    id: a.id, tipo: a.tipo, titulo: TIPOS[a.tipo] || a.tipo, resumo: a.resumo, dados, status: a.status,
    resultado: lerJson(a.resultado, null), erro: a.erro, conversa_id: a.conversa_id,
    editaveis: dados.__editaveis || [], pode_desfazer: a.status === 'executada' && Boolean(DESFAZER[a.tipo]) && !a.desfeita_em,
    decidida_em: a.decidida_em, created_at: a.created_at,
  };
}

/** Grava a proposta. Devolve a ação (mapeada) ou lança Error com o motivo (o modelo lê e corrige). */
export function propor(tipo, entrada, ctx) {
  const validar = VALIDAR[tipo] || executores[tipo]?.validar;
  if (!validar) throw new Error(`Ação desconhecida: ${tipo}`);
  const { dados, resumo, editaveis = [] } = validar(entrada || {}, ctx);
  const id = Number(run('INSERT INTO agente_acoes (user_id, conversa_id, tipo, resumo, dados) VALUES (?, ?, ?, ?, ?)', [
    ctx.userId, ctx.conversaId || null, tipo, resumo, JSON.stringify({ ...dados, __editaveis: editaveis }),
  ]).lastInsertRowid);
  avisarTela(ctx.userId, { acao: id });
  return mapear(get('SELECT * FROM agente_acoes WHERE id = ?', [id]));
}

export function obterAcao(id, userId) {
  const a = get('SELECT * FROM agente_acoes WHERE id = ? AND user_id = ?', [id, userId]);
  if (!a) throw new ErroHttp(404, 'Ação não encontrada');
  return a;
}

export function listarAcoes(userId, { status = null, limite = 60, conversaId = null } = {}) {
  const filtros = ['user_id = ?'];
  const valores = [userId];
  if (status) { filtros.push('status = ?'); valores.push(status); }
  if (conversaId) { filtros.push('conversa_id = ?'); valores.push(conversaId); }
  return all(`SELECT * FROM agente_acoes WHERE ${filtros.join(' AND ')} ORDER BY id DESC LIMIT ?`, [...valores, limite]).map(mapear);
}

function anotarNaConversa(acao, texto) {
  if (!acao.conversa_id) return;
  run("INSERT INTO agente_mensagens (conversa_id, papel, texto) VALUES (?, 'evento', ?)", [acao.conversa_id, texto]);
  run('UPDATE agente_conversas SET updated_at = ? WHERE id = ?', [agora(), acao.conversa_id]);
}

/** Aprova e executa. edicao: campos editáveis alterados no cartão (ex.: { texto }) */
export async function aprovar(id, userId, edicao = {}, { papel = 'member' } = {}) {
  const a = obterAcao(id, userId);
  if (a.status !== 'pendente') throw new ErroHttp(409, a.status === 'executada' ? 'Esta ação já foi executada' : 'Esta ação já foi decidida');
  let dados = lerJson(a.dados);
  const editaveis = dados.__editaveis || [];
  const mudou = Object.keys(edicao || {}).filter((k) => editaveis.includes(k) && edicao[k] !== undefined && edicao[k] !== dados[k]);
  if (mudou.length) {
    const validar = VALIDAR[a.tipo] || executores[a.tipo]?.validar;
    const revalidado = validar({ ...dados, ...Object.fromEntries(mudou.map((k) => [k, edicao[k]])) }, { userId, papel });
    dados = { ...revalidado.dados, __editaveis: editaveis };
    run('UPDATE agente_acoes SET dados = ?, resumo = ? WHERE id = ?', [JSON.stringify(dados), revalidado.resumo, id]);
  }
  // Marca antes de executar: dois cliques seguidos nunca mandam a mesma mensagem duas vezes
  const r0 = run("UPDATE agente_acoes SET status = 'executando', decidida_em = ? WHERE id = ? AND status = 'pendente'", [agora(), id]);
  if (!r0.changes) throw new ErroHttp(409, 'Esta ação já está sendo executada');
  const executar = EXECUTAR[a.tipo] || executores[a.tipo]?.executar;
  try {
    const { __editaveis, ...limpos } = dados;
    const resultado = await executar(limpos, userId);
    run("UPDATE agente_acoes SET status = 'executada', resultado = ? WHERE id = ?", [JSON.stringify(resultado || {}), id]);
    anotarNaConversa(a, `✅ Aprovado e feito: ${get('SELECT resumo FROM agente_acoes WHERE id = ?', [id]).resumo}`);
  } catch (err) {
    run("UPDATE agente_acoes SET status = 'falhou', erro = ? WHERE id = ?", [String(err.message).slice(0, 500), id]);
    anotarNaConversa(a, `⚠️ Aprovado, mas não deu certo: ${err.message}`);
    avisarTela(userId, { conversa: a.conversa_id });
    throw err instanceof ErroHttp ? err : new ErroHttp(422, err.message);
  }
  avisarTela(userId, { conversa: a.conversa_id });
  return mapear(get('SELECT * FROM agente_acoes WHERE id = ?', [id]));
}

export function recusar(id, userId) {
  const a = obterAcao(id, userId);
  if (a.status !== 'pendente') throw new ErroHttp(409, 'Esta ação já foi decidida');
  run("UPDATE agente_acoes SET status = 'recusada', decidida_em = ? WHERE id = ?", [agora(), id]);
  anotarNaConversa(a, `✖️ Recusado: ${a.resumo}`);
  avisarTela(userId, { conversa: a.conversa_id });
  return mapear(get('SELECT * FROM agente_acoes WHERE id = ?', [id]));
}

export function desfazer(id, userId) {
  const a = obterAcao(id, userId);
  if (a.status !== 'executada' || a.desfeita_em) throw new ErroHttp(409, 'Só dá para desfazer uma ação executada');
  const fn = DESFAZER[a.tipo];
  if (!fn) throw new ErroHttp(409, 'Esta ação não tem como ser desfeita (nada é apagado pelo CRM)');
  fn(a, userId);
  run("UPDATE agente_acoes SET status = 'desfeita', desfeita_em = ? WHERE id = ?", [agora(), id]);
  anotarNaConversa(a, `↩️ Desfeito: ${a.resumo}`);
  avisarTela(userId, { conversa: a.conversa_id });
  return mapear(get('SELECT * FROM agente_acoes WHERE id = ?', [id]));
}

export const pendentesDoUsuario = (userId) => get("SELECT count(*) AS n FROM agente_acoes WHERE user_id = ? AND status = 'pendente'", [userId]).n;
export { mapear as mapearAcao };
