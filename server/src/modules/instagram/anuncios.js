// Anúncios ligados aos perfis do Instagram (API de Marketing, permissão ads_read): o CRM procura em todas as contas de
// anúncio que o acesso enxerga os anúncios que usam um dos perfis conectados (ou uma publicação deles) e guarda os
// números de cada dia (gasto, alcance, cliques, conversas iniciadas no Direct, leads). Assim cada publicação mostra o
// orgânico e o pago lado a lado, e o funil anúncio → Direct → lead → fechado fica completo.
import { get, all, run, agora } from '../../db.js';
import { emitir } from '../../tempoReal.js';
import { chamar, paginar, ErroMeta } from './graph.js';
import { lerConfig } from './config.js';
import { tokenUsuario, registrar } from './perfis.js';
import { diaNoFuso, somarDias } from './metricas.js';

const CAMPOS_ANUNCIO = 'id,name,effective_status,created_time,campaign{id,name,objective},adset{id,name},creative{id,effective_instagram_media_id,instagram_permalink_url,thumbnail_url,instagram_user_id}';
const CAMPOS_ANUNCIO_MINIMOS = 'id,name,effective_status,created_time,campaign{id,name,objective},adset{id,name},creative{id,effective_instagram_media_id,instagram_permalink_url,thumbnail_url}';
// Ações que contam como conversa iniciada e como lead
const CONVERSA = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];
const LEAD = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead'];

const somaAcoes = (acoes, tipos) => {
  const achadas = (acoes || []).filter((a) => tipos.includes(a.action_type));
  if (!achadas.length) return null;
  // Usa o primeiro tipo encontrado (eles se sobrepõem: somar contaria duas vezes)
  for (const t of tipos) {
    const a = achadas.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return null;
};

async function listarAnuncios(conta, token) {
  try {
    return await paginar(`${conta.id}/ads`, { token, params: { fields: CAMPOS_ANUNCIO, limit: 200 } }, { max: 5000 });
  } catch (err) {
    if (err instanceof ErroMeta && err.tipo === 'parametro') {
      return paginar(`${conta.id}/ads`, { token, params: { fields: CAMPOS_ANUNCIO_MINIMOS, limit: 200 } }, { max: 5000 });
    }
    throw err;
  }
}

function perfilDoAnuncio(a, perfis) {
  const igUsuario = String(a.creative?.instagram_user_id || '');
  if (igUsuario) {
    const p = perfis.find((x) => x.ig_id === igUsuario);
    if (p) return p.id;
  }
  const midia = a.creative?.effective_instagram_media_id;
  if (midia) {
    const post = get('SELECT perfil_id FROM ig_posts WHERE id = ?', [String(midia)]);
    if (post) return post.perfil_id;
  }
  return null;
}

async function numerosDosAnuncios(conta, ids, desde, ate, token) {
  let n = 0;
  for (let i = 0; i < ids.length; i += 150) {
    const lote = ids.slice(i, i + 150);
    const linhas = await paginar(`${conta.id}/insights`, {
      token,
      params: {
        level: 'ad', time_increment: 1, limit: 500,
        fields: 'ad_id,spend,impressions,reach,clicks,inline_link_clicks,actions,date_start',
        time_range: { since: desde, until: ate },
        filtering: [{ field: 'ad.id', operator: 'IN', value: lote }],
      },
    }, { max: 100000 });
    for (const l of linhas) {
      run(
        `INSERT INTO ig_anuncios_diario (anuncio_id, dia, gasto, impressoes, alcance, cliques, cliques_link, conversas, leads, acoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(anuncio_id, dia) DO UPDATE SET gasto = excluded.gasto, impressoes = excluded.impressoes, alcance = excluded.alcance,
           cliques = excluded.cliques, cliques_link = excluded.cliques_link, conversas = excluded.conversas, leads = excluded.leads, acoes = excluded.acoes`,
        [String(l.ad_id), l.date_start, Number(l.spend || 0), Number(l.impressions || 0), Number(l.reach || 0), Number(l.clicks || 0),
          Number(l.inline_link_clicks || 0), somaAcoes(l.actions, CONVERSA), somaAcoes(l.actions, LEAD),
          JSON.stringify(Object.fromEntries((l.actions || []).map((a) => [a.action_type, Number(a.value) || 0])))]
      );
      n++;
    }
  }
  return n;
}

/** Sincroniza contas, anúncios ligados aos perfis e números diários. Na primeira vez busca N dias para trás. */
export async function sincronizarAnuncios() {
  const cfg = lerConfig();
  if (!cfg.anuncios_ativo) return { pulado: 'desligado' };
  const token = tokenUsuario();
  if (!token) return { pulado: 'sem_acesso' };
  const perfis = all('SELECT id, ig_id FROM ig_perfis WHERE ativo = 1');
  if (!perfis.length) return { pulado: 'sem_perfis' };
  let contas;
  try {
    contas = await paginar('me/adaccounts', { token, params: { fields: 'id,name,currency,timezone_name,account_status', limit: 200 } }, { max: 500 });
  } catch (err) {
    registrar(null, 'aviso', `Anúncios: ${err.message}`);
    return { erro: err.message };
  }
  const hoje = diaNoFuso();
  let anunciosLigados = 0;
  let linhas = 0;
  for (const c of contas) {
    run(`INSERT INTO ig_anuncios_contas (id, nome, moeda, fuso, status) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, moeda = excluded.moeda, fuso = excluded.fuso, status = excluded.status`,
    [c.id, c.name || null, c.currency || null, c.timezone_name || null, c.account_status ?? null]);
    const conta = get('SELECT * FROM ig_anuncios_contas WHERE id = ?', [c.id]);
    try {
      const anuncios = await listarAnuncios(conta, token);
      const ids = [];
      for (const a of anuncios) {
        const perfilId = perfilDoAnuncio(a, perfis);
        if (!perfilId) continue;
        ids.push(String(a.id));
        run(
          `INSERT INTO ig_anuncios (id, conta_id, nome, status, campanha_id, campanha_nome, objetivo, conjunto_id, conjunto_nome, perfil_id, post_id, permalink, thumb_url, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, status = excluded.status, campanha_nome = excluded.campanha_nome,
             objetivo = excluded.objetivo, conjunto_nome = excluded.conjunto_nome, perfil_id = excluded.perfil_id,
             post_id = COALESCE(excluded.post_id, ig_anuncios.post_id), permalink = COALESCE(excluded.permalink, ig_anuncios.permalink),
             thumb_url = COALESCE(excluded.thumb_url, ig_anuncios.thumb_url), atualizado_em = excluded.atualizado_em`,
          [String(a.id), c.id, a.name || null, a.effective_status || null, a.campaign?.id || null, a.campaign?.name || null, a.campaign?.objective || null,
            a.adset?.id || null, a.adset?.name || null, perfilId, a.creative?.effective_instagram_media_id ? String(a.creative.effective_instagram_media_id) : null,
            a.creative?.instagram_permalink_url || null, a.creative?.thumbnail_url || null, a.created_time || null, agora()]
        );
      }
      anunciosLigados += ids.length;
      if (ids.length) {
        // Primeira vez: N dias para trás, em pedaços de 90 dias. Depois: os últimos 3 dias (a Meta ajusta a atribuição)
        const primeira = !conta.backfill_ate;
        const inicio = primeira ? somarDias(hoje, -Math.min(cfg.anuncios_dias, 1095)) : somarDias(hoje, -3);
        for (let d = inicio; d <= hoje; d = somarDias(d, 90)) {
          const fim = somarDias(d, 89) < hoje ? somarDias(d, 89) : hoje;
          linhas += await numerosDosAnuncios(conta, ids, d, fim, token);
        }
        run('UPDATE ig_anuncios_contas SET backfill_ate = COALESCE(backfill_ate, ?), sync_em = ?, erro = NULL WHERE id = ?', [inicio, agora(), c.id]);
      } else {
        run('UPDATE ig_anuncios_contas SET sync_em = ?, erro = NULL WHERE id = ?', [agora(), c.id]);
      }
    } catch (err) {
      run('UPDATE ig_anuncios_contas SET erro = ? WHERE id = ?', [String(err.message).slice(0, 300), c.id]);
      if (err.limite) break;
    }
  }
  registrar(null, 'anuncios', `Anúncios: ${contas.length} conta(s) lida(s), ${anunciosLigados} anúncio(s) ligados aos perfis, ${linhas} dia(s) de números`);
  emitir('instagram', { anuncios: true });
  return { contas: contas.length, anuncios: anunciosLigados, linhas };
}
