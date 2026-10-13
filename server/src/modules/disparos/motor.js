// Motor da fila de disparos. Roda no servidor: continua enviando se a pessoa trocar de tela, fechar o navegador
// ou o CRM reiniciar (o progresso fica no banco e cada contato continua do bloco em que parou).
//
// Para cada campanha "executando" existe um laço que:
//   1) respeita a janela de horário permitido e espera o número de WhatsApp estar conectado;
//   2) respeita o timer entre contatos (fixo ou aleatório) e o descanso a cada lote;
//   3) envia os blocos do fluxo em ordem, com a espera e o "digitando…/gravando áudio…" de cada bloco.
// A tela acompanha pelo evento "disparos" (tempo real) e pelo estado ao vivo de cada campanha.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run, agora } from '../../db.js';
import { config as configApp } from '../../config.js';
import { lerJson } from '../../events.js';
import { emitir } from '../../tempoReal.js';
import { variantesTelefone, ErroHttp } from '../../util.js';
import { renderizar, variaveisDoContato } from './texto.js';
import { dentroDaJanela, sortearIntervalo } from './blocos.js';

const ROTULO_TIPO = { texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', arquivo: 'Arquivo' };
// Entre um lead e outro da saudação automática (vários leads chegando juntos)
const INTERVALO_YAY_S = 5;
// O "digitando…" do WhatsApp some sozinho depois de uns segundos: é renovado neste intervalo
const RENOVAR_PRESENCA_MS = 5000;

// ------------------------------------------------------------------ dependências (trocadas nos testes)
const padrao = {
  async enviar(numeroId, destino, dados, userId) {
    const { enviar } = await import('../whatsapp/envio.js');
    return enviar(numeroId, destino, dados, userId);
  },
  async presenca(numeroId, jid, estado) {
    const { avisarDigitando } = await import('../whatsapp/envio.js');
    return avisarDigitando(numeroId, jid, estado);
  },
  // Número que vai enviar (o escolhido, ou qualquer conectado quando a campanha aceita "qualquer número")
  async numeroConectado(numeroId) {
    const { socketConectado, algumConectado } = await import('../whatsapp/instancias.js');
    if (numeroId) return socketConectado(numeroId) ? numeroId : null;
    return algumConectado()?.id ?? null;
  },
  async resolverJid(numeroId, { leadId, phone }) {
    if (leadId) {
      const j = get(
        "SELECT jid FROM wa_contacts WHERE lead_id = ? AND jid NOT LIKE '%@g.us' ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
        [leadId]
      )?.jid;
      if (j) return j;
    }
    const variantes = variantesTelefone(phone);
    if (variantes.length) {
      const j = get(
        `SELECT jid FROM wa_contacts WHERE phone IN (${variantes.map(() => '?').join(',')}) AND jid NOT LIKE '%@g.us'
          ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
        variantes
      )?.jid;
      if (j) return j;
    }
    const { socketConectado, carregarBaileys } = await import('../whatsapp/instancias.js');
    const e = socketConectado(numeroId);
    if (!e) throw new ErroHttp(409, 'Este número não está conectado');
    const lib = await carregarBaileys();
    const resultado = await e.sock.onWhatsApp(...variantes);
    const achado = (resultado || []).find((r) => r.exists);
    if (!achado) throw new ErroHttp(400, 'Este telefone não tem WhatsApp');
    return lib.jidNormalizedUser(achado.jid);
  },
  async temFfmpeg() {
    const ff = await import('../whatsapp/ffmpeg.js');
    return Boolean(await ff.ffmpeg());
  },
};
let deps = { ...padrao };
export function definirDependencias(novas) {
  deps = { ...padrao, ...novas };
}

// ------------------------------------------------------------------ estado
const workers = new Map(); // campanhaId → { estado, acordar, timer }
let parando = false;

const avisar = (campanhaId) => emitir('disparos', { campanha: campanhaId });

function definirEstado(w, campanhaId, estado) {
  w.estado = { ...estado, em: agora() };
  avisar(campanhaId);
}

export function estadoAoVivo(campanhaId) {
  return workers.get(Number(campanhaId))?.estado || null;
}

// Espera ms, mas acorda antes se a campanha for pausada/cancelada/retomada
function dormir(w, ms) {
  return new Promise((resolve) => {
    const fim = () => {
      clearTimeout(w.timer);
      w.acordar = null;
      resolve();
    };
    w.acordar = fim;
    w.timer = setTimeout(fim, Math.max(0, ms));
    w.timer.unref?.();
  });
}

export function acordar(campanhaId) {
  workers.get(Number(campanhaId))?.acordar?.();
}

const campanha = (id) => get('SELECT * FROM disparo_campanhas WHERE id = ?', [id]);
const statusDe = (id) => get('SELECT status FROM disparo_campanhas WHERE id = ?', [id])?.status;

function proximoItem(campanhaId, { agoraIso = agora() } = {}) {
  return get(
    `SELECT * FROM disparo_fila WHERE campanha_id = ? AND status = 'pendente'
       AND (agendado_para IS NULL OR agendado_para <= ?)
     ORDER BY COALESCE(agendado_para, created_at), id LIMIT 1`,
    [campanhaId, agoraIso]
  );
}

const restantes = (campanhaId) => get(
  "SELECT count(*) AS n, min(agendado_para) AS proximo FROM disparo_fila WHERE campanha_id = ? AND status IN ('pendente', 'enviando')",
  [campanhaId]
);

function bloqueado(phone) {
  return Boolean(get('SELECT 1 AS ok FROM disparo_bloqueio WHERE phone IN (' + variantesTelefone(phone).map(() => '?').join(',') + ')', variantesTelefone(phone)));
}

function dadosDoContato(item) {
  const lead = item.lead_id
    ? get('SELECT l.id, l.name, l.phone, l.email, l.extra, s.name AS etapa FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?', [item.lead_id])
    : null;
  // Contato que virou lead depois de entrar na lista
  const porTelefone = !lead
    ? get(
      `SELECT l.id, l.name, l.phone, l.email, l.extra, s.name AS etapa FROM leads l JOIN stages s ON s.id = l.stage_id
        WHERE l.phone IN (${variantesTelefone(item.phone).map(() => '?').join(',')}) ORDER BY l.created_at DESC LIMIT 1`,
      variantesTelefone(item.phone)
    )
    : null;
  const l = lead || porTelefone;
  return {
    leadId: l?.id || null,
    nome: l?.name || item.nome || '',
    phone: item.phone,
    email: l?.email || '',
    etapa: l?.etapa || '',
    extra: lerJson(l?.extra, {}),
  };
}

// Copia a mídia guardada para um arquivo temporário (a conversão do WhatsApp cria arquivos ao lado dele)
async function prepararMidia(bloco) {
  const midia = get('SELECT * FROM disparo_midias WHERE id = ?', [bloco.midia_id]);
  if (!midia) throw new ErroHttp(400, 'O arquivo deste bloco foi apagado');
  const origem = path.join(configApp.filesDir, midia.path);
  if (!fs.existsSync(origem)) throw new ErroHttp(400, 'O arquivo deste bloco não está mais no servidor');
  const pasta = path.join(configApp.filesDir, 'whatsapp', 'tmp');
  fs.mkdirSync(pasta, { recursive: true });
  const caminho = path.join(pasta, `disparo-${crypto.randomUUID()}`);
  fs.copyFileSync(origem, caminho);
  const mime = midia.mime.split(';')[0].trim().toLowerCase();
  let modo = 'auto';
  if (bloco.tipo === 'arquivo') modo = 'documento';
  else if (bloco.tipo === 'audio' && bloco.ptt) modo = 'voz';
  else if (bloco.tipo === 'imagem' && mime === 'image/gif' && (await deps.temFfmpeg())) modo = 'gif';
  return {
    arquivo: { caminho, mime: midia.mime, nome: bloco.nome_arquivo || midia.nome, modo, unica: false },
    limpar: () => { for (const c of [caminho, `${caminho}.ogg`, `${caminho}.mp4`, `${caminho}.webp`]) fs.rmSync(c, { force: true }); },
  };
}

// Interrompido (pausa/cancelamento) no meio de um contato: volta para a fila, sem perder os blocos já enviados
function devolverItem(item, campanhaId) {
  const status = statusDe(campanhaId) === 'cancelada' ? 'cancelado' : 'pendente';
  run('UPDATE disparo_fila SET status = ? WHERE id = ?', [status, item.id]);
}

/**
 * Envia o fluxo para um contato. Devolve 'enviado' | 'falha' | 'pulado' | 'interrompido' | 'desconectado'.
 */
async function processarItem(w, c, blocos, item, numeroId) {
  if (bloqueado(item.phone)) {
    run("UPDATE disparo_fila SET status = 'pulado', erro = ?, enviado_em = ? WHERE id = ?", ['Número na lista de bloqueio', agora(), item.id]);
    avisar(c.id);
    return 'pulado';
  }
  run("UPDATE disparo_fila SET status = 'enviando', iniciado_em = COALESCE(iniciado_em, ?) WHERE id = ?", [agora(), item.id]);
  const contato = dadosDoContato(item);
  if (contato.leadId && contato.leadId !== item.lead_id) run('UPDATE disparo_fila SET lead_id = ? WHERE id = ?', [contato.leadId, item.id]);
  const nome = contato.nome || item.nome || item.phone;
  let jid = null;

  try {
    jid = await deps.resolverJid(numeroId, { leadId: contato.leadId, phone: item.phone });
    const destino = contato.leadId ? { leadId: contato.leadId } : { jid };

    for (let i = item.bloco_atual; i < blocos.length; i++) {
      const bloco = blocos[i];
      // Espera antes do bloco, com "digitando…" / "gravando áudio…" renovado de tempos em tempos
      let resta = (bloco.espera?.segundos || 0) * 1000;
      const presenca = bloco.espera?.presenca || 'nenhuma';
      definirEstado(w, c.id, {
        fase: 'enviando', item_id: item.id, contato: nome, bloco: i + 1, blocos: blocos.length,
        tipo_bloco: ROTULO_TIPO[bloco.tipo] || bloco.tipo, presenca, ate: new Date(Date.now() + resta).toISOString(),
      });
      while (resta > 0) {
        if (presenca !== 'nenhuma') await deps.presenca(numeroId, jid, presenca).catch(() => {});
        const passo = Math.min(resta, RENOVAR_PRESENCA_MS);
        const inicio = Date.now();
        await dormir(w, passo);
        resta -= Date.now() - inicio;
        if (parando || statusDe(c.id) !== 'executando') {
          if (presenca !== 'nenhuma') await deps.presenca(numeroId, jid, 'paused').catch(() => {});
          devolverItem(item, c.id);
          return 'interrompido';
        }
      }
      if (parando || statusDe(c.id) !== 'executando') { devolverItem(item, c.id); return 'interrompido'; }

      const variaveis = variaveisDoContato(contato);
      const texto = bloco.tipo === 'audio' ? null : renderizar(bloco.texto, variaveis) || null;
      let preparo = null;
      try {
        if (bloco.tipo !== 'texto') preparo = await prepararMidia(bloco);
        if (bloco.tipo === 'texto' && !texto) {
          // Texto que ficou vazio depois das variáveis: pula o bloco em vez de mandar mensagem vazia
        } else {
          await deps.enviar(numeroId, destino, { texto, arquivo: preparo?.arquivo || null, automatico: true }, c.criado_por || null);
        }
      } finally {
        preparo?.limpar();
      }
      if (presenca !== 'nenhuma') await deps.presenca(numeroId, jid, 'paused').catch(() => {});
      run('UPDATE disparo_fila SET bloco_atual = ? WHERE id = ?', [i + 1, item.id]);
      avisar(c.id);
    }
    run("UPDATE disparo_fila SET status = 'enviado', erro = NULL, enviado_em = ? WHERE id = ?", [agora(), item.id]);
    avisar(c.id);
    return 'enviado';
  } catch (err) {
    if (err.status === 409) {
      // Número caiu no meio: volta para a fila e espera reconectar
      run("UPDATE disparo_fila SET status = 'pendente' WHERE id = ?", [item.id]);
      avisar(c.id);
      return 'desconectado';
    }
    const motivo = String(err.message || 'Erro desconhecido').replace(/^O WhatsApp não aceitou a mensagem: /, 'WhatsApp recusou: ').slice(0, 300);
    run("UPDATE disparo_fila SET status = 'falha', erro = ?, enviado_em = ? WHERE id = ?", [motivo, agora(), item.id]);
    console.error(`[disparos] campanha #${c.id}: falha para ${item.phone}: ${motivo}`);
    avisar(c.id);
    return 'falha';
  }
}

async function laco(campanhaId, w) {
  while (!parando) {
    const c = campanha(campanhaId);
    if (!c || c.status !== 'executando') break;
    const config = lerJson(c.config, {});
    const blocos = lerJson(c.blocos, []);

    const janela = dentroDaJanela(config.janela);
    if (!janela.dentro) {
      definirEstado(w, c.id, { fase: 'janela', ate: janela.abreEm });
      await dormir(w, Math.min(janela.abreEmMs, 60000));
      continue;
    }

    const numeroId = await deps.numeroConectado(c.numero_id);
    if (!numeroId) {
      definirEstado(w, c.id, { fase: 'desconectado' });
      await dormir(w, 15000);
      continue;
    }

    // Timer entre contatos / descanso do lote (guardado no banco: vale também depois de reiniciar)
    if (c.proximo_em && c.proximo_em > agora()) {
      const prox = proximoItem(c.id, { agoraIso: c.proximo_em });
      // Depois de reiniciar o motivo não está na memória: lote zerado com o descanso ligado = descanso do lote
      const fase = w.motivo || (c.tipo === 'campanha' && config.lote?.ativo && !c.no_lote ? 'lote' : 'intervalo');
      definirEstado(w, c.id, { fase, contato: prox ? prox.nome || prox.phone : null, ate: c.proximo_em });
      await dormir(w, Math.min(new Date(c.proximo_em).getTime() - Date.now(), 60000));
      continue;
    }

    if (!blocos.length) {
      definirEstado(w, c.id, { fase: 'sem_fluxo' });
      await dormir(w, 30000);
      continue;
    }

    const item = proximoItem(c.id);
    if (!item) {
      const r = restantes(c.id);
      if (c.tipo !== 'yayforms' && !r.n) {
        run("UPDATE disparo_campanhas SET status = 'concluida', finished_at = ?, proximo_em = NULL WHERE id = ? AND status = 'executando'", [agora(), c.id]);
        console.log(`[disparos] campanha #${c.id} concluída`);
        avisar(c.id);
        break;
      }
      // Só itens agendados para depois (atraso da saudação): dorme até o próximo
      const espera = r.proximo ? Math.max(500, new Date(r.proximo).getTime() - Date.now()) : 30000;
      definirEstado(w, c.id, { fase: c.tipo === 'yayforms' ? (r.proximo ? 'agendado' : 'aguardando_leads') : 'agendado', ate: r.proximo || null });
      await dormir(w, Math.min(espera, 30000));
      continue;
    }

    const resultado = await processarItem(w, c, blocos, item, numeroId);
    if (resultado === 'interrompido') continue;
    if (resultado === 'desconectado') {
      definirEstado(w, c.id, { fase: 'desconectado' });
      await dormir(w, 15000);
      continue;
    }
    if (resultado === 'pulado') continue;

    // Próximo contato: timer entre contatos ou descanso do lote
    const atual = campanha(c.id);
    if (!atual) break;
    const temMais = restantes(c.id).n > 0;
    if (c.tipo === 'campanha' && temMais) {
      let noLote = (atual.no_lote || 0) + 1;
      let segundos;
      if (config.lote?.ativo && noLote >= config.lote.contatos) {
        segundos = config.lote.minutos * 60;
        noLote = 0;
        w.motivo = 'lote';
      } else {
        segundos = sortearIntervalo(config);
        w.motivo = 'intervalo';
      }
      run('UPDATE disparo_campanhas SET proximo_em = ?, no_lote = ? WHERE id = ?', [new Date(Date.now() + segundos * 1000).toISOString(), noLote, c.id]);
    } else if (c.tipo === 'yayforms' && temMais) {
      w.motivo = 'intervalo';
      run('UPDATE disparo_campanhas SET proximo_em = ? WHERE id = ?', [new Date(Date.now() + INTERVALO_YAY_S * 1000).toISOString(), c.id]);
    }
  }
}

// Liga o laço da campanha (se ainda não estiver rodando)
export function garantirWorker(campanhaId) {
  const id = Number(campanhaId);
  if (parando || !id) return;
  const existente = workers.get(id);
  if (existente) {
    existente.acordar?.();
    return;
  }
  const w = { estado: null, acordar: null, timer: null, motivo: null };
  workers.set(id, w);
  laco(id, w)
    .catch((err) => console.error(`[disparos] campanha #${id} parou com erro:`, err.message))
    .finally(() => {
      clearTimeout(w.timer);
      if (workers.get(id) === w) workers.delete(id);
      avisar(id);
      // Mudou para "executando" enquanto o laço terminava: liga de novo
      if (!parando && statusDe(id) === 'executando') setTimeout(() => garantirWorker(id), 200).unref?.();
    });
}

export function iniciarMotor() {
  parando = false;
  // Contatos que estavam no meio do envio quando o CRM desligou voltam para a fila (continuam do bloco em que pararam)
  const { changes } = run("UPDATE disparo_fila SET status = 'pendente' WHERE status = 'enviando'");
  if (changes) console.log(`[disparos] ${changes} contato(s) retomado(s) depois do reinício`);
  for (const c of all("SELECT id FROM disparo_campanhas WHERE status = 'executando'")) garantirWorker(c.id);
}

export function pararMotor() {
  parando = true;
  for (const w of workers.values()) w.acordar?.();
}

// Para os testes: espera todos os laços terminarem
export async function aguardarOcioso(limiteMs = 5000) {
  const fim = Date.now() + limiteMs;
  while (workers.size && Date.now() < fim) await new Promise((r) => setTimeout(r, 10));
  return workers.size === 0;
}
export const _paraTeste = { workers, processarItem, proximoItem };
