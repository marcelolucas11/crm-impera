// Ferramentas da Alice: funções que o modelo chama para ler o CRM ao vivo (livre) ou propor ações (com aprovação).
// Cada ferramenta recebe (entrada, ctx) e devolve texto ou blocos (imagem/PDF). ctx: { userId, papel, cfg, fuso,
// conversaId, origem, fonte(obj), progresso(texto) }.
import fs from 'node:fs';
import { get, all, run } from '../../db.js';
import { config } from '../../config.js';
import { lerJson } from '../../events.js';
import { idValido } from '../../util.js';
import { estado as estadoNumero } from '../whatsapp/instancias.js';
import { baixarMidia, absoluto } from '../whatsapp/midia.js';
import { rotuloFormulario, rotuloPergunta, formulariosConhecidos } from '../yayforms/catalogo.js';
import { calcularEstatisticas } from '../estatisticas/index.js';
import { lerConfig as lerConfigOrganizador } from '../organizador/config.js';
import { lerConfig as lerConfigIa } from '../ia/config.js';
import {
  interpretarConversa, nomeDaConversa, acharConversas, mensagensDaConversa, formatarMensagens, participantesDoGrupo,
  interpretarData, dataHora, chaveDe, COLUNAS, autorDaMensagem, textoDaMensagem,
} from './dados.js';
import { consultar } from './consulta.js';
import { extrairTexto, ehPdf, ehImagem } from './documentos.js';
import * as transcricao from './transcricao.js';
import { propor, TIPOS as TIPOS_ACAO } from './acoes.js';
import { temPermissao } from '../auth/permissoes.js';

const json = (obj) => JSON.stringify(obj, null, 1);
const cortar = (t, n) => (t && t.length > n ? `${t.slice(0, n)}… (cortado)` : t || '');
const limiteEntre = (v, min, max, padrao) => Math.min(max, Math.max(min, Math.round(Number(v) || padrao)));

// ------------------------------------------------------------------ definições (o que o modelo vê)

const PERIODO = {
  desde: { type: 'string', description: 'Início: AAAA-MM-DD, AAAA-MM-DDTHH:MM, "hoje", "ontem", "7d" (últimos 7 dias) ou "24h". No fuso do usuário.' },
  ate: { type: 'string', description: 'Fim (mesmos formatos). Vazio = agora.' },
};

export const DEFINICOES = [
  {
    name: 'visao_do_crm',
    description: 'Panorama do CRM agora: etapas do kanban com quantos leads em cada, papéis das etapas, usuários, números de WhatsApp (conectados ou não), critérios do Organizador, IA de primeiro contato, formulários do Yay! Forms, públicos e campanhas de disparo, grupos ativos. Use no começo quando precisar se situar.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_conversas',
    description: 'Lista conversas do WhatsApp (grupos, leads e contatos) com atividade no período, com a chave de cada uma (use a chave em ler_conversa). Filtre por nome/telefone com "busca".',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Parte do nome do grupo, do lead/contato ou do telefone' },
        tipo: { type: 'string', enum: ['todas', 'grupos', 'leads', 'contatos'] },
        ...PERIODO,
        numero_id: { type: 'integer', description: 'Só conversas deste número conectado' },
        limite: { type: 'integer', description: 'Máximo de conversas (padrão 40, máx. 200)' },
      },
    },
  },
  {
    name: 'listar_grupos',
    description: 'Grupos do WhatsApp com nome, participantes (nome, telefone e se é lead), quantas mensagens no período e a última atividade. Use para descobrir quais grupos são de clientes e de qual cliente.',
    input_schema: {
      type: 'object',
      properties: { busca: { type: 'string' }, ...PERIODO, com_participantes: { type: 'boolean', description: 'Incluir participantes (padrão true)' }, limite: { type: 'integer' } },
    },
  },
  {
    name: 'ler_conversa',
    description: 'Lê as mensagens de uma conversa (grupo, lead ou contato) no período, em ordem, com quem disse o quê e a hora no fuso do usuário. Áudios vêm transcritos quando a transcrição está ligada. Aceita a chave (g:..., l:..., t:..., j:...) ou o nome do grupo/lead.',
    input_schema: {
      type: 'object',
      properties: {
        conversa: { type: 'string', description: 'Chave da conversa ou nome do grupo/lead/contato' },
        ...PERIODO,
        so_minhas: { type: 'boolean', description: 'Só as mensagens enviadas pelo usuário/equipe (útil para "o que eu prometi")' },
        max_mensagens: { type: 'integer', description: 'Padrão 250, máx. 800 (as mais recentes do período)' },
      },
      required: ['conversa'],
    },
  },
  {
    name: 'buscar_mensagens',
    description: 'Procura um texto em todas as conversas (mensagens, legendas, transcrições de áudio e texto de documentos) e devolve os trechos com a conversa de cada um.',
    input_schema: { type: 'object', properties: { texto: { type: 'string' }, ...PERIODO, conversa: { type: 'string', description: 'Opcional: só nesta conversa' }, limite: { type: 'integer' } }, required: ['texto'] },
  },
  {
    name: 'buscar_leads',
    description: 'Busca leads do kanban com filtros combináveis (etapa, respostas do formulário do Yay! Forms, reunião no Calendly, proposta enviada, follow-up atrasado, temperatura da IA, datas). Devolve dados resumidos de cada lead.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Nome, telefone, e-mail ou empresa' },
        etapa: { type: 'string', description: 'Nome ou id da etapa' },
        status: { type: 'string', enum: ['abertos', 'ganhos', 'perdidos', 'todos'], description: 'Padrão: todos' },
        formulario: { type: 'string', description: 'Parte do nome do formulário' },
        formulario_completo: { type: 'boolean' },
        pergunta_contem: { type: 'string', description: 'Parte do texto da pergunta do formulário' },
        resposta_contem: { type: 'string', description: 'Parte da resposta (com pergunta_contem, só naquela pergunta). Ex.: pergunta "investimento" resposta "sim"' },
        criado_desde: { type: 'string' }, criado_ate: { type: 'string' },
        com_reuniao: { type: 'boolean', description: 'Tem reunião ativa no Calendly' },
        reuniao_desde: { type: 'string' }, reuniao_ate: { type: 'string' },
        reuniao_ja_aconteceu: { type: 'boolean' },
        proposta_enviada: { type: 'boolean', description: 'Enviamos PDF cujo nome começa com "Proposta comercial"' },
        followup_atrasado: { type: 'boolean', description: `Sem contato nosso há mais de ${config.followupHours} h` },
        sem_mensagem_nossa_ha_horas: { type: 'number', description: 'Nossa última mensagem foi há mais de N horas (ou nunca falamos)' },
        temperatura_min: { type: 'integer', description: 'Temperatura da IA do Organizador (0 a 100)' },
        responsavel: { type: 'string' },
        ordenar: { type: 'string', enum: ['recentes', 'atividade', 'temperatura'] },
        limite: { type: 'integer', description: 'Padrão 50, máx. 300' },
      },
    },
  },
  {
    name: 'ficha_lead',
    description: 'Tudo de um lead: dados, etapa, respostas do formulário, reuniões, histórico de eventos, o que a IA concluiu e as últimas mensagens.',
    input_schema: { type: 'object', properties: { lead_id: { type: 'integer' }, mensagens: { type: 'integer', description: 'Quantas mensagens recentes (padrão 40)' } }, required: ['lead_id'] },
  },
  {
    name: 'formularios',
    description: 'Formulários do Yay! Forms: quantos leads cada um trouxe, parciais × completos e, para um formulário, cada pergunta com a distribuição das respostas.',
    input_schema: { type: 'object', properties: { formulario: { type: 'string', description: 'Parte do nome para detalhar as respostas ("*" = todos)' }, ...PERIODO } },
  },
  {
    name: 'reunioes',
    description: 'Reuniões do Calendly no período (agendadas, canceladas), com o lead, a etapa atual e se a proposta já foi enviada depois.',
    input_schema: { type: 'object', properties: { ...PERIODO, status: { type: 'string', enum: ['ativas', 'canceladas', 'todas'] } } },
  },
  {
    name: 'estatisticas',
    description: 'Números do funil no período: leads novos, tempo de resposta, funil Yay! Forms → Calendly, por origem, por formulário, por etapa e por responsável.',
    input_schema: { type: 'object', properties: { dias: { type: 'integer', description: 'Últimos N dias (padrão 30)' } } },
  },
  {
    name: 'consultar_banco',
    description: 'Consulta SQL de LEITURA (SQLite) no banco do CRM para perguntas que as outras ferramentas não cobrem. Só SELECT/WITH; até 200 linhas. Datas são texto ISO em UTC. Tabelas sigilosas (chaves, senhas, sessões) são recusadas. O esquema está no seu prompt.',
    input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
  },
  {
    name: 'ver_midia',
    description: 'Abre a mídia de uma mensagem do WhatsApp (o número "msg N" que aparece nas conversas): imagem (você vê), PDF (você lê), áudio (transcreve), Word/Excel/PowerPoint/texto (extrai o texto).',
    input_schema: { type: 'object', properties: { mensagem_id: { type: 'integer' } }, required: ['mensagem_id'] },
  },
  // ------------------------------- ações (viram cartão de aprovação; nada acontece sem o usuário aprovar)
  {
    name: 'propor_mensagem',
    description: 'Propõe enviar uma mensagem de texto no WhatsApp (para lead, contato ou grupo). Vira um cartão: o usuário revisa, edita e aprova. Use o tom do usuário.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string' }, lead_id: { type: 'integer' }, conversa: { type: 'string', description: 'Chave ou nome do grupo/contato' },
        telefone: { type: 'string' }, numero_id: { type: 'integer', description: 'Número do CRM que envia (padrão: o último usado na conversa)' },
      },
      required: ['texto'],
    },
  },
  {
    name: 'propor_mover_lead',
    description: 'Propõe mover um lead para outra etapa do kanban.',
    input_schema: { type: 'object', properties: { lead_id: { type: 'integer' }, etapa: { type: 'string', description: 'Nome ou id da etapa' }, motivo: { type: 'string' } }, required: ['lead_id', 'etapa'] },
  },
  {
    name: 'propor_atualizar_lead',
    description: 'Propõe trocar o responsável de um lead e/ou acrescentar uma nota.',
    input_schema: { type: 'object', properties: { lead_id: { type: 'integer' }, responsavel: { type: 'string' }, responsavel_id: { type: 'integer' }, nota: { type: 'string' } }, required: ['lead_id'] },
  },
  {
    name: 'propor_publico',
    description: 'Propõe criar um público (lista de contatos para disparo) com leads e/ou telefones. Monte a lista com buscar_leads antes.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' }, descricao: { type: 'string' },
        lead_ids: { type: 'array', items: { type: 'integer' } },
        telefones: { type: 'array', items: { type: 'object', properties: { telefone: { type: 'string' }, nome: { type: 'string' } } } },
      },
      required: ['nome'],
    },
  },
  {
    name: 'propor_disparo',
    description: 'Propõe um disparo em massa como RASCUNHO: fica em Disparos → Disparo personalizado para o usuário revisar, ajustar e dar play (nunca começa sozinho). Textos aceitam {{primeiro_nome}}, {{nome}}, {{saudacao}}, {{etapa_kanban}} e Spintax {Oi|Olá}.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        blocos: { type: 'array', items: { type: 'object', properties: { texto: { type: 'string' }, espera_segundos: { type: 'integer' } }, required: ['texto'] } },
        lista_ids: { type: 'array', items: { type: 'integer' }, description: 'Públicos existentes' },
        lead_ids: { type: 'array', items: { type: 'integer' } },
        numero_id: { type: 'integer' },
      },
      required: ['blocos'],
    },
  },
  {
    name: 'propor_modelo_disparo',
    description: 'Propõe salvar um modelo de fluxo de disparo (blocos de texto) para usar depois.',
    input_schema: { type: 'object', properties: { nome: { type: 'string' }, blocos: { type: 'array', items: { type: 'object', properties: { texto: { type: 'string' }, espera_segundos: { type: 'integer' } } } } }, required: ['nome', 'blocos'] },
  },
  {
    name: 'propor_criterio_organizador',
    description: 'Propõe um critério novo para o Organizador do kanban (o que a IA procura nas conversas e para qual etapa o lead vai). Nasce desligado. Só administradores.',
    input_schema: { type: 'object', properties: { titulo: { type: 'string' }, etapa: { type: 'string' }, prompt: { type: 'string' } }, required: ['titulo', 'etapa', 'prompt'] },
  },
  {
    name: 'propor_memoria',
    description: 'Propõe guardar um fato duradouro na sua memória (algo que o usuário pediu para lembrar ou um padrão importante que ele confirmou).',
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  },
  {
    name: 'propor_agendado',
    description: 'Propõe criar um agendado (tarefa que você executa sozinha num horário, como "todo dia às 8h resuma os grupos e mande no meu WhatsApp"). Pergunte antes o que faltar (horário, fuso, frequência, destino).',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        prompt: { type: 'string', description: 'Instrução completa e autossuficiente que você vai executar a cada vez' },
        frequencia: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['uma_vez', 'diario', 'dias_uteis', 'semanal', 'mensal', 'a_cada_horas'] },
            hora: { type: 'string', description: 'HH:MM' }, dias: { type: 'array', items: { type: 'integer' }, description: '0=domingo … 6=sábado (semanal)' },
            dia_mes: { type: 'integer' }, horas: { type: 'integer' }, data: { type: 'string', description: 'AAAA-MM-DD (uma_vez)' },
          },
          required: ['tipo'],
        },
        fuso: { type: 'string', description: 'Ex.: America/Sao_Paulo, America/Santiago' },
        destino: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['aba', 'proprio', 'numero', 'grupo'], description: 'aba = só na Alice; proprio = "mensagem para mim" do número do CRM; numero = outro telefone; grupo = um grupo' },
            numero_id: { type: 'integer' }, telefone: { type: 'string' }, conversa: { type: 'string', description: 'Chave ou nome do grupo' },
          },
          required: ['tipo'],
        },
        modelo: { type: 'string' },
      },
      required: ['nome', 'prompt', 'frequencia', 'destino'],
    },
  },
];

// Ferramentas que não podem rodar dentro de um agendado (lá ninguém aprova na hora) continuam virando proposta
const PARA_ACAO = {
  propor_mensagem: 'enviar_mensagem', propor_mover_lead: 'mover_lead', propor_atualizar_lead: 'atualizar_lead', propor_publico: 'criar_publico',
  propor_disparo: 'criar_disparo', propor_modelo_disparo: 'criar_modelo_disparo', propor_criterio_organizador: 'criar_criterio',
  propor_memoria: 'guardar_memoria', propor_agendado: 'criar_agendado',
};

// ------------------------------------------------------------------ extensões
// Outros módulos (ex.: Instagram) acrescentam ferramentas sem a assistente depender deles. Cada extensão diz:
//  definicao: { name, description, input_schema } · impl(entrada, ctx) (leitura) ou acao: tipo de ação (vira proposta)
//  descrever(entrada): texto de progresso · permitido(ctx): se o usuário pode usar (ex.: permissão da tela)
const EXTRAS = new Map();

export function registrarFerramenta({ definicao, impl = null, acao = null, descrever = null, permitido = null }) {
  if (!definicao?.name || EXTRAS.has(definicao.name)) return;
  EXTRAS.set(definicao.name, { definicao, impl, acao, descrever, permitido });
  DEFINICOES.push(definicao);
}

// Ferramentas próprias que dependem de uma tela liberada para o usuário (Equipe e integrações → Permissões).
// Sem isso, quem não tem acesso ao WhatsApp (ou às estatísticas) conseguia ler tudo pela assistente.
const PERMISSAO_DA_FERRAMENTA = {
  buscar_conversas: 'whatsapp', listar_grupos: 'whatsapp', ler_conversa: 'whatsapp', buscar_mensagens: 'whatsapp', ver_midia: 'whatsapp',
  consultar_banco: 'whatsapp', estatisticas: 'estatisticas',
  propor_mensagem: 'whatsapp_enviar', propor_mover_lead: 'leads_editar', propor_atualizar_lead: 'leads_editar',
  propor_publico: 'disparos', propor_disparo: 'disparos', propor_modelo_disparo: 'disparos',
};

function liberada(nome, ctx) {
  const extra = EXTRAS.get(nome);
  if (extra) return !extra.permitido || extra.permitido(ctx);
  const chave = PERMISSAO_DA_FERRAMENTA[nome];
  return !chave || ctx?.papel === 'admin' || temPermissao(ctx?.userId, chave);
}

/** Ferramentas que este usuário pode usar (respeitam as permissões dele) */
export function definicoesPara(ctx) {
  return DEFINICOES.filter((d) => liberada(d.name, ctx));
}

// Mensagens de progresso (aparecem na tela enquanto ela trabalha)
export function descreverChamada(nome, e = {}) {
  const extra = EXTRAS.get(nome);
  if (extra) return extra.descrever?.(e) || (extra.acao ? `Preparando: ${TIPOS_ACAO[extra.acao] || extra.acao}` : nome);
  switch (nome) {
    case 'visao_do_crm': return 'Olhando o panorama do CRM';
    case 'buscar_conversas': return e.busca ? `Procurando conversas com "${e.busca}"` : 'Listando conversas';
    case 'listar_grupos': return 'Vendo os grupos';
    case 'ler_conversa': return `Lendo a conversa ${e.conversa || ''}`.trim();
    case 'buscar_mensagens': return `Procurando "${e.texto}" nas mensagens`;
    case 'buscar_leads': return 'Buscando leads no kanban';
    case 'ficha_lead': return `Abrindo a ficha do lead ${e.lead_id}`;
    case 'formularios': return 'Lendo os formulários do Yay! Forms';
    case 'reunioes': return 'Vendo as reuniões do Calendly';
    case 'estatisticas': return 'Calculando as estatísticas';
    case 'consultar_banco': return 'Consultando o banco';
    case 'ver_midia': return `Abrindo a mídia da mensagem ${e.mensagem_id}`;
    default: return PARA_ACAO[nome] ? `Preparando: ${TIPOS_ACAO[PARA_ACAO[nome]]}` : nome;
  }
}

// ------------------------------------------------------------------ implementações

function resolverConversa(termo) {
  const c = interpretarConversa(termo);
  if (c) return c;
  const achadas = acharConversas(termo, { limite: 6 });
  if (achadas.length === 1) return interpretarConversa(achadas[0].chave);
  const exata = achadas.find((a) => a.nome?.toLowerCase() === String(termo).trim().toLowerCase());
  if (exata) return interpretarConversa(exata.chave);
  if (!achadas.length) throw new Error(`Nenhuma conversa encontrada para "${termo}". Use buscar_conversas ou listar_grupos.`);
  throw new Error(`"${termo}" bate com várias conversas; escolha a chave: ${achadas.map((a) => `${a.nome} → ${a.chave}`).join(' | ')}`);
}

function periodo(e, ctx, padraoDesde = null) {
  return {
    desde: interpretarData(e.desde, ctx.fuso) || (padraoDesde ? interpretarData(padraoDesde, ctx.fuso) : null),
    ate: interpretarData(e.ate, ctx.fuso, { fimDoDia: true }),
  };
}

function nomesDosNumeros() {
  return Object.fromEntries(all('SELECT id, name, phone FROM wa_instances').map((n) => [n.id, n.name || n.phone || `Número ${n.id}`]));
}

const IMPL = {
  visao_do_crm(e, ctx) {
    const etapas = all(
      `SELECT s.id, s.name, s.kind, s.role, s.position, (SELECT count(*) FROM leads l WHERE l.stage_id = s.id) AS leads
         FROM stages s ORDER BY s.position`
    );
    const numeros = all('SELECT id, name, phone FROM wa_instances ORDER BY id').map((n) => ({ ...n, status: estadoNumero(n.id).status }));
    const org = lerConfigOrganizador();
    const ia = lerConfigIa();
    const desde7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const grupos = get('SELECT count(DISTINCT chat_jid) AS n FROM wa_messages WHERE chat_jid LIKE ? AND timestamp >= ?', ['%@g.us', desde7]).n;
    const forms = all(
      `SELECT json_extract(extra, '$.form_id') AS id, max(json_extract(extra, '$.formulario')) AS nome, count(*) AS leads,
              sum(CASE WHEN json_extract(extra, '$.parcial') THEN 1 ELSE 0 END) AS parciais
         FROM leads WHERE json_extract(extra, '$.form_id') IS NOT NULL OR json_extract(extra, '$.formulario') IS NOT NULL
        GROUP BY 1 ORDER BY leads DESC LIMIT 30`
    ).map((f) => ({ formulario: rotuloFormulario(f.id, f.nome), leads: f.leads, parciais: f.parciais }));
    return json({
      agora: dataHora(new Date().toISOString(), ctx.fuso),
      etapas: etapas.map((s) => ({ id: s.id, nome: s.name, tipo: s.kind === 'open' ? 'em andamento' : s.kind === 'won' ? 'ganho' : 'perdido', papel: s.role, leads: s.leads })),
      usuarios: all('SELECT id, name AS nome, role AS papel FROM users WHERE active = 1'),
      numeros_whatsapp: numeros,
      organizador: { ligado: org.ativo, criterios: org.criterios.map((c) => ({ titulo: c.titulo, etapa_id: c.etapa_id || c.papel, ativo: c.ativo })) },
      ia_primeiro_contato: { ligada: ia.ativo, atendente: ia.nome_atendente, modo: ia.modo },
      formularios_yay: forms,
      publicos: all('SELECT l.id, l.nome, (SELECT count(*) FROM disparo_lista_membros m WHERE m.lista_id = l.id) AS contatos FROM disparo_listas l ORDER BY l.updated_at DESC LIMIT 30'),
      campanhas_recentes: all("SELECT id, nome, status, tipo, created_at FROM disparo_campanhas WHERE status <> 'usado' ORDER BY id DESC LIMIT 10"),
      grupos_ativos_7_dias: grupos,
      leads_total: get('SELECT count(*) AS n FROM leads').n,
      followup_horas: config.followupHours,
      transcricao_de_audio: transcricao.lerConfig().ativo && transcricao.instalada() ? 'ligada' : 'desligada',
    });
  },

  buscar_conversas(e, ctx) {
    const { desde, ate } = periodo(e, ctx, '7d');
    const limite = limiteEntre(e.limite, 1, 200, 40);
    const filtros = ['m.timestamp >= ?', 'm.hidden_at IS NULL'];
    const valores = [desde];
    if (ate) { filtros.push('m.timestamp <= ?'); valores.push(ate); }
    if (e.numero_id) { filtros.push('m.instance_id = ?'); valores.push(idValido(e.numero_id)); }
    if (e.tipo === 'grupos') filtros.push("m.chat_jid LIKE '%@g.us'");
    if (e.tipo === 'leads') filtros.push("m.lead_id IS NOT NULL AND m.chat_jid NOT LIKE '%@g.us'");
    if (e.tipo === 'contatos') filtros.push("m.lead_id IS NULL AND m.chat_jid NOT LIKE '%@g.us'");
    const linhas = all(
      `SELECT m.chat_jid, m.lead_id, c.phone, count(*) AS mensagens, sum(CASE WHEN m.from_me = 0 THEN 1 ELSE 0 END) AS recebidas,
              max(m.timestamp) AS ultima, max(m.instance_id) AS numero_id
         FROM wa_messages m LEFT JOIN wa_contacts c ON c.jid = m.chat_jid
        WHERE ${filtros.join(' AND ')} GROUP BY m.chat_jid ORDER BY ultima DESC LIMIT 1500`,
      valores
    );
    // Junta os identificadores do mesmo lead/telefone numa conversa só
    const porChave = new Map();
    for (const l of linhas) {
      const chave = chaveDe(l.chat_jid, l.lead_id, l.phone);
      const atual = porChave.get(chave);
      if (atual) { atual.mensagens += l.mensagens; atual.recebidas += l.recebidas; if (l.ultima > atual.ultima) atual.ultima = l.ultima; continue; }
      porChave.set(chave, { chave, mensagens: l.mensagens, recebidas: l.recebidas, ultima: l.ultima, numero_id: l.numero_id });
    }
    const numeros = nomesDosNumeros();
    const busca = String(e.busca || '').toLowerCase().trim();
    const saida = [];
    for (const item of porChave.values()) {
      const c = interpretarConversa(item.chave);
      const nome = nomeDaConversa(c);
      if (busca && !nome.toLowerCase().includes(busca) && !item.chave.toLowerCase().includes(busca.replace(/\D/g, '') || '§')) continue;
      saida.push({ chave: item.chave, nome, tipo: c.tipo === 'grupo' ? 'grupo' : c.tipo === 'lead' ? 'lead' : 'contato', mensagens: item.mensagens, recebidas: item.recebidas, ultima: dataHora(item.ultima, ctx.fuso), numero: numeros[item.numero_id] || null });
      if (saida.length >= limite) break;
    }
    return json({ periodo: { desde: dataHora(desde, ctx.fuso), ate: ate ? dataHora(ate, ctx.fuso) : 'agora' }, total: saida.length, conversas: saida });
  },

  listar_grupos(e, ctx) {
    const { desde, ate } = periodo(e, ctx, '30d');
    const limite = limiteEntre(e.limite, 1, 100, 40);
    const busca = `%${String(e.busca || '').replace(/[%_]/g, '')}%`;
    const grupos = all(
      `SELECT c.jid, c.name, c.archived, (SELECT count(*) FROM wa_messages m WHERE m.chat_jid = c.jid AND m.timestamp >= ? ${ate ? 'AND m.timestamp <= ?' : ''}) AS mensagens,
              (SELECT max(timestamp) FROM wa_messages m WHERE m.chat_jid = c.jid) AS ultima,
              (SELECT max(m.instance_id) FROM wa_messages m WHERE m.chat_jid = c.jid) AS numero_id
         FROM wa_chats c WHERE c.is_group = 1 AND COALESCE(c.name, '') LIKE ?
        ORDER BY ultima DESC LIMIT ?`,
      ate ? [desde, ate, busca, limite] : [desde, busca, limite]
    );
    const numeros = nomesDosNumeros();
    const lista = grupos.map((g) => {
      ctx.fonte({ tipo: 'conversa', chave: `g:${g.jid}`, nome: g.name });
      return {
        chave: `g:${g.jid}`, nome: g.name || 'Grupo sem nome', mensagens_no_periodo: g.mensagens, ultima: dataHora(g.ultima, ctx.fuso),
        numero: numeros[g.numero_id] || null, arquivado: Boolean(g.archived),
        ...(e.com_participantes === false ? {} : { participantes: participantesDoGrupo(g.jid, { limite: 25 }) }),
      };
    });
    return json({ periodo_desde: dataHora(desde, ctx.fuso), grupos: lista });
  },

  async ler_conversa(e, ctx) {
    const c = resolverConversa(e.conversa);
    const { desde, ate } = periodo(e, ctx);
    const limite = limiteEntre(e.max_mensagens, 1, 800, 250);
    const nome = nomeDaConversa(c);
    ctx.fonte({ tipo: c.tipo === 'lead' ? 'lead' : 'conversa', chave: c.chave, id: c.leadId, nome });
    let { mensagens, cortada } = mensagensDaConversa(c, { desde, ate, limite, soMinhas: Boolean(e.so_minhas), usuarioId: ctx.userId });
    // Transcreve na hora os áudios ainda sem texto (até 8 por leitura)
    const semTexto = mensagens.filter((m) => m.type === 'audio' && !m.transcricao && !m.deleted_at).slice(-8);
    if (semTexto.length && transcricao.lerConfig().ativo && transcricao.instalada()) {
      ctx.progresso(`Transcrevendo ${semTexto.length} áudio(s) de ${nome}`);
      for (const m of semTexto) {
        try { m.transcricao = await transcricao.transcreverMensagem(m.id); } catch { /* segue sem a transcrição */ }
      }
    }
    const cabecalho = [
      `Conversa: ${nome} (${c.chave}) — ${c.tipo === 'grupo' ? 'grupo' : c.tipo === 'lead' ? 'lead do kanban' : 'contato'}`,
      `Período: ${desde ? dataHora(desde, ctx.fuso) : 'início'} até ${ate ? dataHora(ate, ctx.fuso) : 'agora'} · ${mensagens.length} mensagem(ns)${cortada ? ' (há mais antigas: aumente max_mensagens ou use desde)' : ''}`,
    ];
    if (c.tipo === 'lead') {
      const l = get('SELECT l.name, s.name AS etapa FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [c.leadId]);
      if (l) cabecalho.push(`Lead ${c.leadId}: ${l.name || ''} · etapa "${l.etapa}"`);
    }
    if (!mensagens.length) return `${cabecalho.join('\n')}\n(nenhuma mensagem no período)`;
    return `${cabecalho.join('\n')}\n\n${formatarMensagens(mensagens, { fuso: ctx.fuso, nomeContato: c.tipo === 'grupo' ? null : nome, usuarioId: ctx.userId })}`;
  },

  buscar_mensagens(e, ctx) {
    const termo = String(e.texto || '').trim();
    if (termo.length < 2) throw new Error('Texto de busca curto demais');
    const { desde, ate } = periodo(e, ctx, '90d');
    const like = `%${termo.replace(/[%_]/g, '')}%`;
    const filtros = ['m.timestamp >= ?', '(m.body LIKE ? OR m.legenda LIKE ? OR m.transcricao LIKE ? OR m.texto_extraido LIKE ? OR m.media_name LIKE ?)'];
    const valores = [desde, like, like, like, like, like];
    if (ate) { filtros.push('m.timestamp <= ?'); valores.push(ate); }
    if (e.conversa) {
      const c = resolverConversa(e.conversa);
      if (c.tipo === 'lead') { filtros.push('m.lead_id = ?'); valores.push(c.leadId); } else { filtros.push('m.chat_jid = ?'); valores.push(c.jid || ''); }
    }
    const linhas = all(
      `SELECT ${COLUNAS}, c.phone FROM wa_messages m LEFT JOIN users u ON u.id = m.sent_by LEFT JOIN wa_contacts c ON c.jid = m.chat_jid
        WHERE ${filtros.join(' AND ')} ORDER BY m.timestamp DESC LIMIT ?`,
      [...valores, limiteEntre(e.limite, 1, 100, 40)]
    );
    return json(linhas.map((m) => {
      const chave = chaveDe(m.chat_jid, m.lead_id, m.phone);
      const nome = nomeDaConversa(interpretarConversa(chave));
      return { conversa: nome, chave, quando: dataHora(m.timestamp, ctx.fuso), autor: autorDaMensagem(m, { nomeContato: nome, usuarioId: ctx.userId }), texto: cortar(textoDaMensagem(m), 500) };
    }));
  },

  buscar_leads(e, ctx) {
    const f = [];
    const v = [];
    if (e.busca) { f.push('(l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.company LIKE ?)'); const b = `%${e.busca}%`; v.push(b, `%${String(e.busca).replace(/\D/g, '') || '§'}%`, b, b); }
    if (e.etapa) {
      const id = idValido(e.etapa);
      if (id) { f.push('l.stage_id = ?'); v.push(id); } else { f.push('s.name LIKE ?'); v.push(`%${e.etapa}%`); }
    }
    if (e.status === 'abertos') f.push("s.kind = 'open'");
    if (e.status === 'ganhos') f.push("s.kind = 'won'");
    if (e.status === 'perdidos') f.push("s.kind = 'lost'");
    if (e.formulario) { f.push("COALESCE(json_extract(l.extra, '$.formulario'), '') LIKE ?"); v.push(`%${e.formulario}%`); }
    if (e.formulario_completo === true) f.push("(l.source = 'yayforms' OR json_extract(l.extra, '$.form_id') IS NOT NULL) AND NOT COALESCE(json_extract(l.extra, '$.parcial'), 0)");
    if (e.formulario_completo === false) f.push("COALESCE(json_extract(l.extra, '$.parcial'), 0)");
    if (e.resposta_contem || e.pergunta_contem) {
      const cond = [];
      if (e.pergunta_contem) { cond.push("lower(COALESCE(json_extract(r.value, '$.pergunta'), json_extract(r.value, '$.titulo'), '')) LIKE lower(?)"); v.push(`%${e.pergunta_contem}%`); }
      if (e.resposta_contem) { cond.push("lower(CAST(COALESCE(json_extract(r.value, '$.resposta'), json_extract(r.value, '$.valor'), '') AS TEXT)) LIKE lower(?)"); v.push(`%${e.resposta_contem}%`); }
      f.push(`json_valid(l.extra) AND EXISTS (SELECT 1 FROM json_each(l.extra, '$.respostas') r WHERE ${cond.join(' AND ')})`);
    }
    const criadoDesde = interpretarData(e.criado_desde, ctx.fuso);
    const criadoAte = interpretarData(e.criado_ate, ctx.fuso, { fimDoDia: true });
    if (criadoDesde) { f.push('l.created_at >= ?'); v.push(criadoDesde); }
    if (criadoAte) { f.push('l.created_at <= ?'); v.push(criadoAte); }
    const rDesde = interpretarData(e.reuniao_desde, ctx.fuso);
    const rAte = interpretarData(e.reuniao_ate, ctx.fuso, { fimDoDia: true });
    if (e.com_reuniao !== undefined || rDesde || rAte || e.reuniao_ja_aconteceu !== undefined) {
      const cond = ["c.lead_id = l.id", "c.status = 'active'"];
      if (rDesde) { cond.push('c.start_time >= ?'); v.push(rDesde); }
      if (rAte) { cond.push('c.start_time <= ?'); v.push(rAte); }
      if (e.reuniao_ja_aconteceu === true) { cond.push('c.start_time < ?'); v.push(new Date().toISOString()); }
      if (e.reuniao_ja_aconteceu === false) { cond.push('c.start_time >= ?'); v.push(new Date().toISOString()); }
      f.push(`${e.com_reuniao === false ? 'NOT ' : ''}EXISTS (SELECT 1 FROM calendly_events c WHERE ${cond.join(' AND ')})`);
    }
    const proposta = `EXISTS (SELECT 1 FROM wa_messages pm WHERE pm.lead_id = l.id AND pm.from_me = 1 AND pm.type = 'documento' AND lower(COALESCE(pm.media_name, pm.body, '')) LIKE 'proposta comercial%')`;
    if (e.proposta_enviada === true) f.push(proposta);
    if (e.proposta_enviada === false) f.push(`NOT ${proposta}`);
    if (e.followup_atrasado === true) { f.push("s.kind = 'open' AND (julianday('now') - julianday(COALESCE(l.last_contact_at, l.created_at))) * 24 > ?"); v.push(config.followupHours); }
    if (e.sem_mensagem_nossa_ha_horas) {
      f.push("COALESCE((SELECT max(m.timestamp) FROM wa_messages m WHERE m.lead_id = l.id AND m.from_me = 1 AND m.type <> 'chamada'), '0') < ?");
      v.push(new Date(Date.now() - Number(e.sem_mensagem_nossa_ha_horas) * 3600e3).toISOString());
    }
    if (e.temperatura_min !== undefined) { f.push('l.ia_temperatura >= ?'); v.push(Number(e.temperatura_min)); }
    if (e.responsavel) { f.push('u.name LIKE ?'); v.push(`%${e.responsavel}%`); }
    const ordem = e.ordenar === 'temperatura' ? 'l.ia_temperatura DESC NULLS LAST' : e.ordenar === 'atividade' ? 'COALESCE(l.last_contact_at, l.created_at) DESC' : 'l.created_at DESC';
    const limite = limiteEntre(e.limite, 1, 300, 50);
    const where = f.length ? `WHERE ${f.join(' AND ')}` : '';
    const total = get(`SELECT count(*) AS n FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id ${where}`, v).n;
    const linhas = all(
      `SELECT l.id, l.name, l.phone, l.email, l.company, l.source, l.created_at, l.last_contact_at, l.ia_temperatura, l.ia_resumo, l.extra,
              s.name AS etapa, s.kind, u.name AS responsavel, ${proposta} AS proposta,
              (SELECT max(m.timestamp) FROM wa_messages m WHERE m.lead_id = l.id AND m.from_me = 0) AS ultima_dele,
              (SELECT max(m.timestamp) FROM wa_messages m WHERE m.lead_id = l.id AND m.from_me = 1 AND m.type <> 'chamada') AS ultima_nossa,
              (SELECT group_concat(c.start_time, ',') FROM calendly_events c WHERE c.lead_id = l.id AND c.status = 'active') AS reunioes
         FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id ${where}
        ORDER BY ${ordem} LIMIT ?`,
      [...v, limite]
    );
    const leads = linhas.map((l) => {
      const extra = lerJson(l.extra);
      ctx.fonte({ tipo: 'lead', id: l.id, nome: l.name });
      return {
        id: l.id, nome: l.name, telefone: l.phone, empresa: l.company || undefined, etapa: l.etapa, responsavel: l.responsavel || undefined,
        criado: dataHora(l.created_at, ctx.fuso), origem: l.source,
        formulario: extra.form_id || extra.formulario ? `${rotuloFormulario(extra.form_id, extra.formulario)}${extra.parcial ? ' (parcial)' : ''}` : undefined,
        temperatura: l.ia_temperatura ?? undefined, resumo_ia: l.ia_resumo ? cortar(l.ia_resumo, 200) : undefined,
        ultima_msg_dele: l.ultima_dele ? dataHora(l.ultima_dele, ctx.fuso) : null, ultima_msg_nossa: l.ultima_nossa ? dataHora(l.ultima_nossa, ctx.fuso) : null,
        reunioes: l.reunioes ? l.reunioes.split(',').map((r) => dataHora(r, ctx.fuso)) : [], proposta_enviada: Boolean(l.proposta), conversa: `l:${l.id}`,
      };
    });
    return json({ total_que_atendem: total, mostrando: leads.length, leads });
  },

  ficha_lead(e, ctx) {
    const id = idValido(e.lead_id);
    const l = get(
      `SELECT l.*, s.name AS etapa, s.kind, u.name AS responsavel FROM leads l JOIN stages s ON s.id = l.stage_id LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = ?`,
      [id]
    );
    if (!l) throw new Error(`Lead ${e.lead_id} não existe`);
    ctx.fonte({ tipo: 'lead', id, nome: l.name });
    const extra = lerJson(l.extra);
    const respostas = (Array.isArray(extra.respostas) ? extra.respostas : []).map((r) => ({
      pergunta: rotuloPergunta(r.pergunta ?? r.titulo, r.id), resposta: r.resposta ?? r.valor,
    }));
    const eventos = all('SELECT e.type, e.data, e.created_at, u.name AS usuario FROM lead_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = ? ORDER BY e.id DESC LIMIT 40', [id])
      .map((ev) => ({ quando: dataHora(ev.created_at, ctx.fuso), tipo: ev.type, por: ev.usuario || undefined, dados: cortar(ev.data, 300) }));
    const reunioes = all('SELECT event_name, start_time, status, booked_at FROM calendly_events WHERE lead_id = ? ORDER BY start_time DESC', [id])
      .map((r) => ({ evento: r.event_name, quando: dataHora(r.start_time, ctx.fuso), status: r.status, agendada_em: dataHora(r.booked_at, ctx.fuso) }));
    const { mensagens } = mensagensDaConversa({ tipo: 'lead', leadId: id }, { limite: limiteEntre(e.mensagens, 0, 200, 40) });
    return [
      json({
        id, nome: l.name, telefone: l.phone, email: l.email, empresa: l.company, origem: l.source, etapa: l.etapa, responsavel: l.responsavel,
        criado: dataHora(l.created_at, ctx.fuso), ultimo_contato: dataHora(l.last_contact_at, ctx.fuso), notas: l.notes,
        formulario: extra.form_id || extra.formulario ? { nome: rotuloFormulario(extra.form_id, extra.formulario), parcial: Boolean(extra.parcial), respostas } : null,
        utm: extra.utm || undefined,
        ia: { temperatura: l.ia_temperatura, resumo: l.ia_resumo, objecao: l.ia_objecao, avaliado: dataHora(l.ia_avaliado_em, ctx.fuso) },
        aguardando: l.waiting_since ? { desde: dataHora(l.waiting_since, ctx.fuso), nota: l.waiting_note } : null,
        reunioes, eventos, conversa: `l:${id}`,
      }),
      mensagens.length ? `\nÚltimas mensagens:\n${formatarMensagens(mensagens, { fuso: ctx.fuso, nomeContato: l.name, usuarioId: ctx.userId })}` : '\n(sem mensagens no WhatsApp)',
    ].join('');
  },

  formularios(e, ctx) {
    const { desde, ate } = periodo(e, ctx);
    const f = ["(json_extract(l.extra, '$.form_id') IS NOT NULL OR json_extract(l.extra, '$.formulario') IS NOT NULL)"];
    const v = [];
    if (desde) { f.push('l.created_at >= ?'); v.push(desde); }
    if (ate) { f.push('l.created_at <= ?'); v.push(ate); }
    const leads = all(`SELECT l.id, l.extra, s.kind FROM leads l JOIN stages s ON s.id = l.stage_id WHERE ${f.join(' AND ')}`, v);
    const porForm = new Map();
    for (const l of leads) {
      const ex = lerJson(l.extra);
      const nome = rotuloFormulario(ex.form_id, ex.formulario);
      if (!porForm.has(nome)) porForm.set(nome, { formulario: nome, leads: 0, parciais: 0, ganhos: 0, perdidos: 0, perguntas: new Map() });
      const p = porForm.get(nome);
      p.leads++;
      if (ex.parcial) p.parciais++;
      if (l.kind === 'won') p.ganhos++;
      if (l.kind === 'lost') p.perdidos++;
      for (const r of Array.isArray(ex.respostas) ? ex.respostas : []) {
        const pergunta = rotuloPergunta(r.pergunta ?? r.titulo, r.id);
        const resposta = String(r.resposta ?? r.valor ?? '').trim().slice(0, 120);
        if (!pergunta || !resposta || /@|^\+?\d[\d\s()-]{7,}$/.test(resposta)) continue;
        if (!p.perguntas.has(pergunta)) p.perguntas.set(pergunta, new Map());
        const m = p.perguntas.get(pergunta);
        m.set(resposta, (m.get(resposta) || 0) + 1);
      }
    }
    const filtro = String(e.formulario || '').toLowerCase();
    const lista = [...porForm.values()].sort((a, b) => b.leads - a.leads).map((p) => {
      const detalhar = filtro === '*' || (filtro && p.formulario.toLowerCase().includes(filtro));
      return {
        formulario: p.formulario, leads: p.leads, parciais: p.parciais, ganhos: p.ganhos, perdidos: p.perdidos,
        ...(detalhar ? {
          perguntas: [...p.perguntas.entries()].map(([pergunta, m]) => {
            const respostas = [...m.entries()].sort((a, b) => b[1] - a[1]);
            return { pergunta, respostas_distintas: respostas.length, mais_comuns: respostas.slice(0, 12).map(([r, n]) => `${r} (${n})`) };
          }),
        } : {}),
      };
    });
    return json({ formularios_conhecidos: formulariosConhecidos().length, por_formulario: lista });
  },

  reunioes(e, ctx) {
    const { desde, ate } = periodo(e, ctx, '7d');
    const f = ['c.start_time >= ?'];
    const v = [desde];
    if (ate) { f.push('c.start_time <= ?'); v.push(ate); }
    if (e.status === 'ativas') f.push("c.status = 'active'");
    if (e.status === 'canceladas') f.push("c.status = 'canceled'");
    const linhas = all(
      `SELECT c.event_name, c.start_time, c.status, c.invitee_name, c.lead_id, l.name AS lead, s.name AS etapa,
              EXISTS (SELECT 1 FROM wa_messages pm WHERE pm.lead_id = c.lead_id AND pm.from_me = 1 AND pm.type = 'documento'
                       AND lower(COALESCE(pm.media_name, pm.body, '')) LIKE 'proposta comercial%' AND pm.timestamp >= c.start_time) AS proposta_depois
         FROM calendly_events c LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN stages s ON s.id = l.stage_id
        WHERE ${f.join(' AND ')} ORDER BY c.start_time`,
      v
    );
    return json(linhas.map((r) => {
      if (r.lead_id) ctx.fonte({ tipo: 'lead', id: r.lead_id, nome: r.lead });
      return { quando: dataHora(r.start_time, ctx.fuso), evento: r.event_name, status: r.status === 'active' ? 'ativa' : 'cancelada', convidado: r.invitee_name, lead_id: r.lead_id, lead: r.lead, etapa: r.etapa, proposta_enviada_depois: Boolean(r.proposta_depois) };
    }));
  },

  estatisticas(e) {
    const dias = limiteEntre(e.dias, 1, 365, 30);
    const { leads, por_dia, chaves_utm, ...resto } = calcularEstatisticas({ dias });
    return cortar(json({ dias, ...resto }), 12000);
  },

  async consultar_banco(e, ctx) {
    // Dados do Instagram só para quem tem acesso a ele (permissões da equipe)
    if (/\big_\w+/i.test(String(e.sql || '')) && !['instagram', 'instagram_desempenho', 'instagram_comentarios'].some((c) => temPermissao(ctx.userId, c))) {
      throw new Error('Este usuário não tem acesso aos dados do Instagram');
    }
    const r = await consultar(e.sql);
    if (r.erro) throw new Error(r.erro);
    return cortar(json(r), 30000);
  },

  async ver_midia(e, ctx) {
    const m = get('SELECT id, type, media_mime, media_name, media_path, legenda, transcricao, texto_extraido, chat_jid, lead_id FROM wa_messages WHERE id = ?', [idValido(e.mensagem_id)]);
    if (!m) throw new Error('Mensagem não encontrada');
    if (m.type === 'audio') {
      ctx.progresso('Transcrevendo o áudio');
      const texto = await transcricao.transcreverMensagem(m.id);
      return `Transcrição do áudio (msg ${m.id}): "${texto}"`;
    }
    if (m.type === 'texto') throw new Error('Esta mensagem é só texto');
    const linha = await baixarMidia(m.id);
    const caminho = absoluto(linha.media_path);
    return blocoDeArquivo(caminho, { mime: m.media_mime, nome: m.media_name, legenda: m.legenda, guardarTexto: (t) => {
      if (t) run('UPDATE wa_messages SET texto_extraido = ? WHERE id = ?', [t.slice(0, 60000), m.id]);
    } });
  },
};

const MAX_IMAGEM = 3.7 * 1024 * 1024;
const MAX_PDF = 25 * 1024 * 1024;

/** Conteúdo de um arquivo para o modelo: imagem e PDF como blocos; documentos como texto */
export function blocoDeArquivo(caminho, { mime = '', nome = '', legenda = null, guardarTexto = null } = {}) {
  const tamanho = fs.statSync(caminho).size;
  const rotulo = `${nome ? `"${nome}" ` : ''}${legenda ? `(legenda: ${legenda})` : ''}`.trim();
  if (ehImagem(mime)) {
    if (tamanho > MAX_IMAGEM) return `A imagem ${rotulo} é grande demais para abrir (${Math.round(tamanho / 1048576)} MB).`;
    return [
      { type: 'text', text: `Imagem ${rotulo}`.trim() },
      { type: 'image', source: { type: 'base64', media_type: String(mime).split(';')[0], data: fs.readFileSync(caminho).toString('base64') } },
    ];
  }
  if (ehPdf(mime, nome)) {
    if (tamanho > MAX_PDF) return `O PDF ${rotulo} é grande demais para abrir (${Math.round(tamanho / 1048576)} MB).`;
    return [
      { type: 'text', text: `PDF ${rotulo}`.trim() },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(caminho).toString('base64') } },
    ];
  }
  const texto = extrairTexto(caminho, { mime, nome });
  if (texto === null) return `Não sei abrir este tipo de arquivo (${mime || nome}).`;
  guardarTexto?.(texto);
  return `Conteúdo de ${rotulo || 'arquivo'}:\n${texto}`;
}

/**
 * Executa a ferramenta pedida pelo modelo. Devolve { conteudo, erro } — o erro vai para o modelo como
 * is_error (ele lê, corrige e tenta de novo).
 */
export async function executarFerramenta(nome, entrada, ctx) {
  try {
    if (!liberada(nome, ctx)) return { conteudo: 'Erro: este usuário não tem permissão para esta parte do CRM.', erro: true };
    const extra = EXTRAS.get(nome);
    if (extra) {
      if (extra.acao) {
        const acao = propor(extra.acao, entrada, ctx);
        ctx.acoes?.push(acao.id);
        return { conteudo: `Proposta registrada como ação #${acao.id} ("${acao.resumo}"). Ela aparece como cartão para o usuário aprovar, editar ou recusar. Não repita a proposta; avise o usuário em uma frase.` };
      }
      const r = await extra.impl(entrada || {}, ctx);
      return { conteudo: r ?? '' };
    }
    if (PARA_ACAO[nome]) {
      const acao = propor(PARA_ACAO[nome], entrada, ctx);
      ctx.acoes?.push(acao.id);
      return { conteudo: `Proposta registrada como ação #${acao.id} ("${acao.resumo}"). Ela aparece como cartão para o usuário aprovar, editar ou recusar. Não repita a proposta; avise o usuário em uma frase.` };
    }
    const fn = IMPL[nome];
    if (!fn) return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
    const r = await fn(entrada || {}, ctx);
    return { conteudo: r ?? '' };
  } catch (err) {
    return { conteudo: `Erro: ${err.message}`, erro: true };
  }
}
