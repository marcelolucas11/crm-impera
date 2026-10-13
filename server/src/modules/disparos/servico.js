// Regras dos disparos: listas, campanhas, lista de bloqueio e a saudação automática do Yay! Forms
import { get, all, run, tx, agora } from '../../db.js';
import { lerJson } from '../../events.js';
import { lerEstado, salvarEstado } from '../../estado.js';
import { config as configApp } from '../../config.js';
import { ErroHttp, idValido, variantesTelefone } from '../../util.js';
import { chaveTelefone, slug, VARIAVEIS_PADRAO } from './texto.js';
import { validarBlocos, validarConfig } from './blocos.js';
import { identificarTelefone } from './contatos.js';
import { garantirWorker, acordar, estadoAoVivo } from './motor.js';
import { interpretarPayload } from '../yayforms/parser.js';

export const MAX_DESTINATARIOS = 5000;

// ------------------------------------------------------------------ destinatários

/**
 * Junta contatos escolhidos e listas salvas num conjunto sem números repetidos.
 *  contatos: [{ telefone, lead_id, nome }]   listas: [ids]
 * Devolve { itens: [{ phone, lead_id, nome }], bloqueados, invalidos, repetidos }
 */
export function montarDestinatarios({ contatos = [], listas = [] } = {}) {
  const porTelefone = new Map();
  let invalidos = 0;
  let repetidos = 0;
  const adicionar = (c) => {
    const phone = chaveTelefone(c.telefone ?? c.phone);
    if (!phone) { invalidos++; return; }
    const atual = porTelefone.get(phone);
    if (atual) {
      repetidos++;
      // Prioriza os dados do kanban
      if (!atual.lead_id && c.lead_id) atual.lead_id = idValido(c.lead_id);
      if (!atual.nome && c.nome) atual.nome = String(c.nome).slice(0, 200);
      return;
    }
    porTelefone.set(phone, { phone, lead_id: idValido(c.lead_id) || null, nome: c.nome ? String(c.nome).slice(0, 200) : null });
  };
  for (const c of Array.isArray(contatos) ? contatos : []) adicionar(c || {});
  for (const listaId of (Array.isArray(listas) ? listas : []).map(idValido).filter(Boolean)) {
    for (const m of all('SELECT phone, lead_id, nome FROM disparo_lista_membros WHERE lista_id = ?', [listaId])) adicionar(m);
  }
  // Números sem lead: procura um lead com o mesmo telefone (contato do WhatsApp que já virou lead)
  for (const item of porTelefone.values()) {
    if (item.lead_id && !get('SELECT 1 AS ok FROM leads WHERE id = ?', [item.lead_id])) item.lead_id = null;
    if (!item.lead_id) {
      const achado = identificarTelefone(item.phone);
      if (achado?.lead_id) item.lead_id = achado.lead_id;
      if (!item.nome && achado?.nome) item.nome = achado.nome;
    }
  }
  const bloqueio = new Set(all('SELECT phone FROM disparo_bloqueio').map((b) => chaveTelefone(b.phone)));
  const itens = [];
  let bloqueados = 0;
  for (const item of porTelefone.values()) {
    if (bloqueio.has(item.phone)) { bloqueados++; continue; }
    itens.push(item);
  }
  return { itens, bloqueados, invalidos, repetidos };
}

// ------------------------------------------------------------------ campanhas

function numeroValido(numeroId, { obrigatorio = true } = {}) {
  const id = idValido(numeroId);
  if (!id) {
    if (obrigatorio) throw new ErroHttp(400, 'Escolha o número de WhatsApp que vai enviar');
    return null;
  }
  if (!get('SELECT 1 AS ok FROM wa_instances WHERE id = ?', [id])) throw new ErroHttp(400, 'Número de WhatsApp não encontrado');
  return id;
}

export function criarCampanha({ nome, numero_id, blocos, config, destinatarios, tipo = 'campanha' }, userId) {
  const fluxo = validarBlocos(blocos);
  const cfg = validarConfig(config);
  const numeroId = numeroValido(numero_id);
  const { itens, bloqueados, invalidos, repetidos } = montarDestinatarios(destinatarios);
  if (!itens.length) throw new ErroHttp(400, bloqueados ? 'Todos os contatos escolhidos estão na lista de bloqueio' : 'Escolha pelo menos um contato com telefone válido');
  if (itens.length > MAX_DESTINATARIOS) throw new ErroHttp(400, `No máximo ${MAX_DESTINATARIOS} contatos por campanha`);
  const titulo = String(nome || '').trim().slice(0, 120) || (tipo === 'teste' ? 'Envio de teste' : `Campanha ${new Date().toLocaleDateString('pt-BR')}`);
  const id = tx(() => {
    const cid = Number(run(
      `INSERT INTO disparo_campanhas (nome, tipo, status, numero_id, blocos, config, criado_por, started_at)
       VALUES (?, ?, 'executando', ?, ?, ?, ?, ?)`,
      [titulo, tipo, numeroId, JSON.stringify(fluxo), JSON.stringify(cfg), userId || null, agora()]
    ).lastInsertRowid);
    for (const item of itens) {
      run('INSERT INTO disparo_fila (campanha_id, phone, lead_id, nome) VALUES (?, ?, ?, ?)', [cid, item.phone, item.lead_id, item.nome]);
    }
    return cid;
  });
  garantirWorker(id);
  return { id, total: itens.length, bloqueados, invalidos, repetidos };
}

const STATUS_FILA = ['pendente', 'enviando', 'enviado', 'falha', 'pulado', 'cancelado'];

function contagens(campanhaIds) {
  if (!campanhaIds.length) return new Map();
  const mapa = new Map(campanhaIds.map((id) => [id, Object.fromEntries(STATUS_FILA.map((s) => [s, 0]))]));
  for (const r of all(
    `SELECT campanha_id, status, count(*) AS n FROM disparo_fila WHERE campanha_id IN (${campanhaIds.map(() => '?').join(',')}) GROUP BY campanha_id, status`,
    campanhaIds
  )) {
    const c = mapa.get(r.campanha_id);
    if (c) c[r.status] = r.n;
  }
  return mapa;
}

function mapearCampanha(c, cont) {
  const contagem = cont || Object.fromEntries(STATUS_FILA.map((s) => [s, 0]));
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    status: c.status,
    numero_id: c.numero_id,
    numero_nome: c.numero_nome || null,
    criado_por_nome: c.criado_por_nome || null,
    created_at: c.created_at,
    started_at: c.started_at,
    finished_at: c.finished_at,
    proximo_em: c.proximo_em,
    contagem,
    total,
    ao_vivo: estadoAoVivo(c.id),
  };
}

const BASE_CAMPANHAS = `SELECT c.*, i.name AS numero_nome, u.name AS criado_por_nome FROM disparo_campanhas c
  LEFT JOIN wa_instances i ON i.id = c.numero_id LEFT JOIN users u ON u.id = c.criado_por`;

export function listarCampanhas({ limite = 60 } = {}) {
  const linhas = all(
    `${BASE_CAMPANHAS}
      ORDER BY CASE c.status WHEN 'executando' THEN 0 WHEN 'pausada' THEN 1 ELSE 2 END,
               CASE WHEN c.tipo = 'yayforms' THEN 0 ELSE 1 END, c.id DESC LIMIT ?`,
    [limite]
  );
  const cont = contagens(linhas.map((c) => c.id));
  return linhas.map((c) => mapearCampanha(c, cont.get(c.id)));
}

export function detalheCampanha(id, { status = null, pagina = 0, porPagina = 100 } = {}) {
  const c = get(`${BASE_CAMPANHAS} WHERE c.id = ?`, [id]);
  if (!c) throw new ErroHttp(404, 'Campanha não encontrada');
  const filtro = status && STATUS_FILA.includes(status) ? 'AND f.status = ?' : '';
  const params = filtro ? [id, status] : [id];
  const itens = all(
    `SELECT f.id, f.phone, f.lead_id, COALESCE(l.name, f.nome) AS nome, f.status, f.bloco_atual, f.erro,
            f.agendado_para, f.iniciado_em, f.enviado_em, f.created_at
       FROM disparo_fila f LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.campanha_id = ? ${filtro}
      ORDER BY CASE f.status WHEN 'enviando' THEN 0 WHEN 'falha' THEN 1 ELSE 2 END,
               CASE WHEN f.enviado_em IS NULL THEN 1 ELSE 0 END, f.enviado_em DESC, f.id ${c.tipo === 'yayforms' ? 'DESC' : 'ASC'}
      LIMIT ? OFFSET ?`,
    [...params, porPagina, pagina * porPagina]
  );
  return {
    campanha: { ...mapearCampanha(c, contagens([id]).get(id)), blocos: lerJson(c.blocos, []), config: lerJson(c.config, {}) },
    itens,
  };
}

function exigirCampanha(id) {
  const c = get('SELECT * FROM disparo_campanhas WHERE id = ?', [id]);
  if (!c) throw new ErroHttp(404, 'Campanha não encontrada');
  return c;
}

export function pausarCampanha(id) {
  const c = exigirCampanha(id);
  if (c.status !== 'executando') throw new ErroHttp(409, 'A campanha não está em andamento');
  run("UPDATE disparo_campanhas SET status = 'pausada' WHERE id = ?", [id]);
  if (c.tipo === 'yayforms') salvarConfigYay({ ...lerConfigYay(), ativo: false }, { soStatus: true });
  acordar(id);
}

export function retomarCampanha(id) {
  const c = exigirCampanha(id);
  if (c.status !== 'pausada') throw new ErroHttp(409, 'Só dá para retomar uma campanha pausada');
  run("UPDATE disparo_campanhas SET status = 'executando' WHERE id = ?", [id]);
  if (c.tipo === 'yayforms') salvarConfigYay({ ...lerConfigYay(), ativo: true }, { soStatus: true });
  garantirWorker(id);
}

export function cancelarCampanha(id) {
  const c = exigirCampanha(id);
  if (c.tipo === 'yayforms') throw new ErroHttp(400, 'A saudação automática se desliga na aba Automação Yay! Forms');
  if (['concluida', 'cancelada'].includes(c.status)) throw new ErroHttp(409, 'A campanha já terminou');
  tx(() => {
    run("UPDATE disparo_campanhas SET status = 'cancelada', finished_at = ?, proximo_em = NULL WHERE id = ?", [agora(), id]);
    run("UPDATE disparo_fila SET status = 'cancelado' WHERE campanha_id = ? AND status = 'pendente'", [id]);
  });
  acordar(id);
}

export function reenviarFalhas(id) {
  const c = exigirCampanha(id);
  const { changes } = run(
    "UPDATE disparo_fila SET status = 'pendente', bloco_atual = 0, erro = NULL, enviado_em = NULL WHERE campanha_id = ? AND status = 'falha'",
    [id]
  );
  if (!changes) throw new ErroHttp(400, 'Nenhuma falha para reenviar');
  if (c.status !== 'executando' && !(c.tipo === 'yayforms' && c.status === 'pausada')) {
    run("UPDATE disparo_campanhas SET status = 'executando', finished_at = NULL, proximo_em = NULL WHERE id = ?", [id]);
  }
  garantirWorker(id);
  return changes;
}

export function apagarCampanha(id) {
  const c = exigirCampanha(id);
  if (c.tipo === 'yayforms') throw new ErroHttp(400, 'O histórico da saudação automática não pode ser apagado');
  if (c.status === 'executando' || c.status === 'pausada') throw new ErroHttp(409, 'Cancele a campanha antes de apagar');
  run('DELETE FROM disparo_campanhas WHERE id = ?', [id]);
}

// ------------------------------------------------------------------ listas

export function listarListas() {
  return all(
    `SELECT l.id, l.nome, l.descricao, l.created_at, l.updated_at,
            (SELECT count(*) FROM disparo_lista_membros m WHERE m.lista_id = l.id) AS total,
            (SELECT count(*) FROM disparo_lista_membros m WHERE m.lista_id = l.id AND m.lead_id IS NOT NULL) AS do_kanban
       FROM disparo_listas l ORDER BY l.updated_at DESC, l.id DESC`
  );
}

export function membrosDaLista(id) {
  if (!get('SELECT 1 AS ok FROM disparo_listas WHERE id = ?', [id])) throw new ErroHttp(404, 'Lista não encontrada');
  return all(
    `SELECT m.phone AS telefone, m.lead_id, COALESCE(l.name, m.nome) AS nome, m.added_at,
            s.name AS etapa_nome, s.color AS etapa_cor
       FROM disparo_lista_membros m LEFT JOIN leads l ON l.id = m.lead_id LEFT JOIN stages s ON s.id = l.stage_id
      WHERE m.lista_id = ? ORDER BY m.added_at DESC`,
    [id]
  );
}

export function criarLista({ nome, descricao }, userId) {
  const n = String(nome || '').trim().slice(0, 100);
  if (!n) throw new ErroHttp(400, 'Dê um nome à lista');
  return Number(run('INSERT INTO disparo_listas (nome, descricao, criado_por) VALUES (?, ?, ?)', [n, String(descricao || '').trim().slice(0, 300) || null, userId || null]).lastInsertRowid);
}

export function editarLista(id, { nome, descricao }) {
  const atual = get('SELECT * FROM disparo_listas WHERE id = ?', [id]);
  if (!atual) throw new ErroHttp(404, 'Lista não encontrada');
  const n = nome === undefined ? atual.nome : String(nome || '').trim().slice(0, 100);
  if (!n) throw new ErroHttp(400, 'Dê um nome à lista');
  run('UPDATE disparo_listas SET nome = ?, descricao = ?, updated_at = ? WHERE id = ?', [
    n, descricao === undefined ? atual.descricao : String(descricao || '').trim().slice(0, 300) || null, agora(), id,
  ]);
}

export function apagarLista(id) {
  if (!run('DELETE FROM disparo_listas WHERE id = ?', [id]).changes) throw new ErroHttp(404, 'Lista não encontrada');
}

// Adiciona contatos (sem repetir números). Devolve quantos entraram de fato.
export function adicionarMembros(id, contatos = []) {
  if (!get('SELECT 1 AS ok FROM disparo_listas WHERE id = ?', [id])) throw new ErroHttp(404, 'Lista não encontrada');
  const { itens, invalidos } = montarDestinatarios({ contatos });
  // Na lista entram também os bloqueados (o bloqueio é conferido na hora de enviar)
  const bloqueados = (Array.isArray(contatos) ? contatos : []).map((c) => chaveTelefone(c?.telefone ?? c?.phone)).filter(Boolean);
  const todos = new Map(itens.map((i) => [i.phone, i]));
  for (const phone of bloqueados) if (!todos.has(phone)) todos.set(phone, { phone, lead_id: null, nome: null });
  const contar = () => get('SELECT count(*) AS n FROM disparo_lista_membros WHERE lista_id = ?', [id]).n;
  const antes = contar();
  tx(() => {
    for (const item of todos.values()) {
      run(
        `INSERT INTO disparo_lista_membros (lista_id, phone, lead_id, nome) VALUES (?, ?, ?, ?)
         ON CONFLICT(lista_id, phone) DO UPDATE SET lead_id = COALESCE(excluded.lead_id, disparo_lista_membros.lead_id),
           nome = COALESCE(disparo_lista_membros.nome, excluded.nome)`,
        [id, item.phone, item.lead_id, item.nome]
      );
    }
    run('UPDATE disparo_listas SET updated_at = ? WHERE id = ?', [agora(), id]);
  });
  const total = contar();
  return { adicionados: total - antes, invalidos, total };
}

export function removerMembros(id, telefones = []) {
  const lista = (Array.isArray(telefones) ? telefones : []).map(chaveTelefone).filter(Boolean);
  if (!lista.length) return 0;
  let removidos = 0;
  tx(() => {
    for (const phone of lista) removidos += run('DELETE FROM disparo_lista_membros WHERE lista_id = ? AND phone = ?', [id, phone]).changes;
    run('UPDATE disparo_listas SET updated_at = ? WHERE id = ?', [agora(), id]);
  });
  return removidos;
}

// ------------------------------------------------------------------ bloqueio

export function listarBloqueio() {
  return all(
    `SELECT b.phone AS telefone, b.nome, b.motivo, b.created_at, u.name AS criado_por_nome
       FROM disparo_bloqueio b LEFT JOIN users u ON u.id = b.criado_por ORDER BY b.created_at DESC`
  );
}

export function bloquear({ telefone, nome, motivo }, userId) {
  const phone = chaveTelefone(telefone);
  if (!phone) throw new ErroHttp(400, 'Telefone inválido');
  const achado = identificarTelefone(phone);
  run(
    `INSERT INTO disparo_bloqueio (phone, nome, motivo, criado_por) VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET motivo = COALESCE(excluded.motivo, disparo_bloqueio.motivo)`,
    [phone, String(nome || '').trim().slice(0, 120) || achado?.nome || null, String(motivo || '').trim().slice(0, 200) || null, userId || null]
  );
  // Tira da fila o que ainda não foi enviado para esse número
  const variantes = variantesTelefone(phone);
  run(
    `UPDATE disparo_fila SET status = 'pulado', erro = 'Número na lista de bloqueio', enviado_em = ?
      WHERE status = 'pendente' AND phone IN (${variantes.map(() => '?').join(',')})`,
    [agora(), ...variantes]
  );
  return phone;
}

export function desbloquear(telefone) {
  const phone = chaveTelefone(telefone);
  if (!phone || !run('DELETE FROM disparo_bloqueio WHERE phone = ?', [phone]).changes) throw new ErroHttp(404, 'Número não está na lista');
}

// ------------------------------------------------------------------ modelos

export const listarModelos = () => all('SELECT id, nome, blocos, created_at, updated_at FROM disparo_modelos ORDER BY updated_at DESC')
  .map((m) => ({ ...m, blocos: lerJson(m.blocos, []) }));

export function salvarModelo({ id, nome, blocos }, userId) {
  const n = String(nome || '').trim().slice(0, 100);
  if (!n) throw new ErroHttp(400, 'Dê um nome ao modelo');
  const fluxo = validarBlocos(blocos, { exigirConteudo: false });
  if (!fluxo.length) throw new ErroHttp(400, 'O modelo precisa de pelo menos um bloco');
  const existente = idValido(id) && get('SELECT id FROM disparo_modelos WHERE id = ?', [idValido(id)]);
  if (existente) {
    run('UPDATE disparo_modelos SET nome = ?, blocos = ?, updated_at = ? WHERE id = ?', [n, JSON.stringify(fluxo), agora(), existente.id]);
    return existente.id;
  }
  return Number(run('INSERT INTO disparo_modelos (nome, blocos, criado_por) VALUES (?, ?, ?)', [n, JSON.stringify(fluxo), userId || null]).lastInsertRowid);
}

export function apagarModelo(id) {
  if (!run('DELETE FROM disparo_modelos WHERE id = ?', [id]).changes) throw new ErroHttp(404, 'Modelo não encontrado');
}

// ------------------------------------------------------------------ saudação automática do Yay! Forms

const ESTADO_YAY = 'disparos_yayforms';
const CONFIG_YAY_PADRAO = {
  ativo: false,
  numero_id: null,
  atraso_min: 15,
  atraso_max: 30,
  apenas_completas: false,
  nao_repetir_horas: 24,
  pular_se_conversa: true,
  conversa_horas: 24,
  janela: { ativa: false, inicio: '08:00', fim: '21:00', dias: [0, 1, 2, 3, 4, 5, 6] },
  blocos: [
    { id: 'b1', tipo: 'texto', texto: '{{saudacao}}, {{primeiro_nome}}! {Tudo bem?|Tudo certo?|Como vai?} 😊', espera: { segundos: 3, presenca: 'composing' } },
    { id: 'b2', tipo: 'texto', texto: 'Recebi seu cadastro aqui e já vou te passar todos os detalhes.', espera: { segundos: 5, presenca: 'composing' } },
  ],
};

export function lerConfigYay() {
  const salvo = lerEstado(ESTADO_YAY);
  return { ...CONFIG_YAY_PADRAO, ...salvo, janela: { ...CONFIG_YAY_PADRAO.janela, ...(salvo.janela || {}) } };
}

// A saudação automática usa uma "campanha" permanente (tipo yayforms) para a fila e o histórico
export function campanhaYay({ criar = true } = {}) {
  let c = get("SELECT * FROM disparo_campanhas WHERE tipo = 'yayforms' ORDER BY id LIMIT 1");
  if (!c && criar) {
    const cfg = lerConfigYay();
    const id = Number(run(
      `INSERT INTO disparo_campanhas (nome, tipo, status, numero_id, blocos, config, started_at)
       VALUES ('Saudação automática · Yay! Forms', 'yayforms', ?, ?, ?, ?, ?)`,
      [cfg.ativo ? 'executando' : 'pausada', cfg.numero_id, JSON.stringify(cfg.blocos), JSON.stringify(validarConfig({ janela: cfg.janela })), agora()]
    ).lastInsertRowid);
    c = get('SELECT * FROM disparo_campanhas WHERE id = ?', [id]);
  }
  return c;
}

const inteiro = (v, min, max, padrao) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

export function salvarConfigYay(entrada = {}, { soStatus = false } = {}) {
  const atual = lerConfigYay();
  const ativo = Boolean(entrada.ativo);
  let cfg;
  if (soStatus) {
    cfg = { ...atual, ativo };
  } else {
    const blocos = validarBlocos(entrada.blocos ?? atual.blocos, { exigirConteudo: ativo });
    const atrasoMin = inteiro(entrada.atraso_min, 0, 3600, 15);
    cfg = {
      ativo,
      numero_id: numeroValido(entrada.numero_id, { obrigatorio: false }),
      atraso_min: atrasoMin,
      atraso_max: Math.max(atrasoMin, inteiro(entrada.atraso_max, 0, 3600, 30)),
      apenas_completas: Boolean(entrada.apenas_completas),
      nao_repetir_horas: inteiro(entrada.nao_repetir_horas, 0, 24 * 90, 24),
      pular_se_conversa: entrada.pular_se_conversa !== false,
      conversa_horas: inteiro(entrada.conversa_horas, 1, 24 * 90, 24),
      janela: validarConfig({ janela: entrada.janela }).janela,
      blocos,
    };
    if (ativo && !cfg.blocos.length) throw new ErroHttp(400, 'Monte pelo menos um bloco antes de ligar a automação');
  }
  salvarEstado(ESTADO_YAY, cfg);
  const c = campanhaYay();
  run('UPDATE disparo_campanhas SET status = ?, numero_id = ?, blocos = ?, config = ? WHERE id = ?', [
    cfg.ativo ? 'executando' : 'pausada', cfg.numero_id, JSON.stringify(cfg.blocos), JSON.stringify(validarConfig({ janela: cfg.janela })), c.id,
  ]);
  if (cfg.ativo) garantirWorker(c.id); else acordar(c.id);
  return cfg;
}

function registrarPulo(campanhaId, { phone, leadId, nome, motivo }) {
  run(
    "INSERT INTO disparo_fila (campanha_id, phone, lead_id, nome, status, erro, enviado_em) VALUES (?, ?, ?, ?, 'pulado', ?, ?)",
    [campanhaId, phone || '-', leadId, nome, motivo, agora()]
  );
}

/**
 * Chamado pelo webhook do Yay! Forms depois de criar/atualizar o lead.
 *  resultado: { leadId, novo, tipo } (o que o módulo do Yay! Forms devolveu)
 * Devolve o que aconteceu: { enfileirado, motivo }
 */
export function aoReceberLeadYay({ leadId, novo, tipo } = {}) {
  const cfg = lerConfigYay();
  if (!cfg.ativo || !leadId) return { enfileirado: false, motivo: 'desligada' };
  const terminou = tipo === 'form_completed';
  if (!novo && !terminou) return { enfileirado: false, motivo: 'lead_existente' };
  const lead = get('SELECT id, name, phone, extra FROM leads WHERE id = ?', [leadId]);
  if (!lead) return { enfileirado: false, motivo: 'sem_lead' };
  const extra = lerJson(lead.extra, {});
  // "Só respostas completas": a parcial espera a pessoa terminar o formulário
  if (cfg.apenas_completas && extra.parcial) return { enfileirado: false, motivo: 'parcial' };
  const c = campanhaYay();
  // Lead que já recebeu (ou vai receber) a saudação quando chegou com a resposta parcial não recebe de novo ao terminar
  if (terminou && get("SELECT 1 AS ok FROM disparo_fila WHERE campanha_id = ? AND lead_id = ? AND status IN ('pendente', 'enviando', 'enviado')", [c.id, leadId])) {
    return { enfileirado: false, motivo: 'ja_saudado' };
  }
  const phone = chaveTelefone(lead.phone);
  if (!phone) {
    registrarPulo(c.id, { phone: null, leadId, nome: lead.name, motivo: 'Lead sem telefone' });
    return { enfileirado: false, motivo: 'sem_telefone' };
  }
  const variantes = variantesTelefone(phone);
  const em = `(${variantes.map(() => '?').join(',')})`;
  if (get(`SELECT 1 AS ok FROM disparo_bloqueio WHERE phone IN ${em}`, variantes)) {
    registrarPulo(c.id, { phone, leadId, nome: lead.name, motivo: 'Número na lista de bloqueio' });
    return { enfileirado: false, motivo: 'bloqueado' };
  }
  if (cfg.nao_repetir_horas > 0) {
    const desde = new Date(Date.now() - cfg.nao_repetir_horas * 3600000).toISOString();
    const recente = get(
      `SELECT 1 AS ok FROM disparo_fila WHERE campanha_id = ? AND phone IN ${em}
         AND (status IN ('pendente', 'enviando') OR (status = 'enviado' AND enviado_em >= ?))`,
      [c.id, ...variantes, desde]
    );
    if (recente) {
      registrarPulo(c.id, { phone, leadId, nome: lead.name, motivo: `Já recebeu a saudação nas últimas ${cfg.nao_repetir_horas} h` });
      return { enfileirado: false, motivo: 'repetido' };
    }
  }
  if (cfg.pular_se_conversa) {
    const desde = new Date(Date.now() - cfg.conversa_horas * 3600000).toISOString();
    const conversa = get(
      `SELECT 1 AS ok FROM wa_messages m WHERE m.timestamp >= ? AND m.type <> 'chamada'
         AND (m.lead_id = ? OR m.chat_jid IN (SELECT jid FROM wa_contacts WHERE phone IN ${em}))
       LIMIT 1`,
      [desde, leadId, ...variantes]
    );
    if (conversa) {
      registrarPulo(c.id, { phone, leadId, nome: lead.name, motivo: `Já existe conversa no WhatsApp nas últimas ${cfg.conversa_horas} h` });
      return { enfileirado: false, motivo: 'conversa_ativa' };
    }
  }
  const atraso = cfg.atraso_min + Math.round(Math.random() * Math.max(0, cfg.atraso_max - cfg.atraso_min));
  run('INSERT INTO disparo_fila (campanha_id, phone, lead_id, nome, agendado_para) VALUES (?, ?, ?, ?, ?)', [
    c.id, phone, leadId, lead.name, new Date(Date.now() + atraso * 1000).toISOString(),
  ]);
  if (c.status !== 'executando') run("UPDATE disparo_campanhas SET status = 'executando' WHERE id = ?", [c.id]);
  garantirWorker(c.id);
  console.log(`[disparos] saudação do lead #${leadId} agendada para daqui a ${atraso}s`);
  return { enfileirado: true, atraso };
}

// Último payload do Yay! Forms, com as variáveis que cada campo vira
export function inspecionarUltimoPayload() {
  const ev = get(
    `SELECT id, payload, received_at, status, lead_id FROM webhook_events
      WHERE source = 'yayforms' AND status IN ('processed', 'duplicado', 'received', 'error')
      ORDER BY id DESC LIMIT 1`
  );
  const padroes = VARIAVEIS_PADRAO.map((v) => ({ variavel: v, padrao: true }));
  if (!ev) return { recebido_em: null, campos: [], padroes, bruto: null };
  const body = lerJson(ev.payload, {});
  const dados = interpretarPayload(body, {
    campoNome: configApp.yayforms.fieldName,
    campoTelefone: configApp.yayforms.fieldPhone,
    campoEmail: configApp.yayforms.fieldEmail,
    nomesFormularios: lerEstado('yayforms').nomes || {},
  });
  const campos = [];
  const usados = new Set(VARIAVEIS_PADRAO);
  for (const r of dados.respostas) {
    const s = slug(r.pergunta);
    const variavel = s && !usados.has(s) ? s : `campo_${slug(r.id)}`;
    usados.add(variavel);
    campos.push({ origem: 'Pergunta', rotulo: r.pergunta, valor: r.resposta, variavel });
  }
  for (const [k, v] of Object.entries(dados.utm || {})) campos.push({ origem: 'UTM', rotulo: k, valor: v, variavel: slug(k) });
  for (const [k, v] of Object.entries(dados.variaveis || {})) campos.push({ origem: 'Variável do formulário', rotulo: k, valor: v, variavel: slug(k) });
  if (dados.formulario) campos.push({ origem: 'Formulário', rotulo: 'Nome do formulário', valor: dados.formulario, variavel: 'formulario' });
  return {
    recebido_em: ev.received_at,
    lead_id: ev.lead_id,
    identificados: { nome: dados.name, telefone: dados.phone, email: dados.email },
    campos,
    padroes,
    bruto: body,
  };
}
