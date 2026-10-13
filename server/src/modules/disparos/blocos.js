// Validação dos blocos do fluxo e das configurações de timer (o que vem da tela nunca é usado sem passar por aqui)
import { get } from '../../db.js';
import { ErroHttp } from '../../util.js';
import { horaLocal, FUSO } from './texto.js';

export const TIPOS = ['texto', 'imagem', 'video', 'audio', 'arquivo'];
const PRESENCAS = ['composing', 'recording', 'nenhuma'];
export const MAX_BLOCOS = 15;
export const MAX_ESPERA_S = 600;
// Nunca menos que isso entre um contato e outro, mesmo que a tela peça
export const INTERVALO_MINIMO_S = 3;

const inteiro = (v, min, max, padrao) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
};

/**
 * Limpa e valida a lista de blocos. exigirConteudo = false aceita blocos vazios (rascunho/modelo).
 * Devolve a lista no formato guardado.
 */
export function validarBlocos(entrada, { exigirConteudo = true } = {}) {
  if (!Array.isArray(entrada)) throw new ErroHttp(400, 'O fluxo precisa de pelo menos um bloco');
  if (entrada.length > MAX_BLOCOS) throw new ErroHttp(400, `No máximo ${MAX_BLOCOS} blocos por fluxo`);
  const blocos = entrada.map((b, i) => {
    const tipo = TIPOS.includes(b?.tipo) ? b.tipo : 'texto';
    const presencaPadrao = tipo === 'audio' ? 'recording' : 'composing';
    const bloco = {
      id: String(b?.id || `b${i + 1}`).slice(0, 40),
      tipo,
      texto: String(b?.texto ?? '').slice(0, 4000),
      midia_id: tipo === 'texto' ? null : Number(b?.midia_id) || null,
      nome_arquivo: tipo === 'arquivo' ? String(b?.nome_arquivo || '').trim().slice(0, 120) || null : null,
      ptt: tipo === 'audio' ? b?.ptt !== false : false,
      espera: {
        segundos: inteiro(b?.espera?.segundos, 0, MAX_ESPERA_S, i === 0 ? 2 : 4),
        presenca: PRESENCAS.includes(b?.espera?.presenca) ? b.espera.presenca : presencaPadrao,
      },
    };
    if (exigirConteudo) {
      if (tipo === 'texto' && !bloco.texto.trim()) throw new ErroHttp(400, `O bloco ${i + 1} (texto) está vazio`);
      if (tipo !== 'texto') {
        if (!bloco.midia_id) throw new ErroHttp(400, `Escolha o arquivo do bloco ${i + 1}`);
        if (!get('SELECT 1 AS ok FROM disparo_midias WHERE id = ?', [bloco.midia_id])) throw new ErroHttp(400, `O arquivo do bloco ${i + 1} não existe mais`);
      }
    }
    return bloco;
  });
  if (exigirConteudo && !blocos.length) throw new ErroHttp(400, 'O fluxo precisa de pelo menos um bloco');
  return blocos;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validarConfig(entrada = {}) {
  const i = entrada.intervalo || {};
  const min = inteiro(i.min, INTERVALO_MINIMO_S, 3600, 20);
  const max = Math.max(min, inteiro(i.max, INTERVALO_MINIMO_S, 3600, 50));
  const lote = entrada.lote || {};
  const janela = entrada.janela || {};
  const dias = Array.isArray(janela.dias) ? [...new Set(janela.dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [0, 1, 2, 3, 4, 5, 6];
  return {
    intervalo: {
      modo: i.modo === 'fixo' ? 'fixo' : 'aleatorio',
      fixo: inteiro(i.fixo, INTERVALO_MINIMO_S, 3600, 30),
      min,
      max,
    },
    lote: {
      ativo: Boolean(lote.ativo),
      contatos: inteiro(lote.contatos, 1, 1000, 30),
      minutos: inteiro(lote.minutos, 1, 720, 5),
    },
    janela: {
      ativa: Boolean(janela.ativa),
      inicio: HORA.test(janela.inicio || '') ? janela.inicio : '08:00',
      fim: HORA.test(janela.fim || '') ? janela.fim : '20:00',
      dias: dias.length ? dias.sort() : [0, 1, 2, 3, 4, 5, 6],
    },
  };
}

// Segundos de espera entre um contato e o próximo
export function sortearIntervalo(config, sorteio = Math.random) {
  const i = config.intervalo || {};
  if (i.modo === 'fixo') return Math.max(INTERVALO_MINIMO_S, i.fixo || 30);
  const min = Math.max(INTERVALO_MINIMO_S, i.min || 20);
  const max = Math.max(min, i.max || min);
  return min + Math.round(sorteio() * (max - min));
}

const minutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Está dentro da janela de horário permitido? Se não, devolve também em quantos ms abre de novo.
 * Janela que vira a noite (ex.: 20:00 → 02:00) também funciona.
 */
export function dentroDaJanela(janela, data = new Date(), fuso = FUSO) {
  if (!janela?.ativa) return { dentro: true, abreEmMs: 0 };
  const inicio = minutos(janela.inicio);
  const fim = minutos(janela.fim);
  const dias = janela.dias?.length ? janela.dias : [0, 1, 2, 3, 4, 5, 6];
  const permitido = (d) => {
    const { hora, minuto, diaSemana } = horaLocal(d, fuso);
    const agoraMin = hora * 60 + minuto;
    if (inicio === fim) return dias.includes(diaSemana);
    if (inicio < fim) return dias.includes(diaSemana) && agoraMin >= inicio && agoraMin < fim;
    // Vira a noite: depois da meia-noite conta como o dia em que a janela começou
    if (agoraMin >= inicio) return dias.includes(diaSemana);
    if (agoraMin < fim) return dias.includes((diaSemana + 6) % 7);
    return false;
  };
  if (permitido(data)) return { dentro: true, abreEmMs: 0 };
  // Procura, de minuto em minuto (até 8 dias), quando a janela abre
  const base = Math.ceil(data.getTime() / 60000) * 60000;
  for (let m = 0; m <= 8 * 24 * 60; m++) {
    const t = new Date(base + m * 60000);
    if (permitido(t)) return { dentro: false, abreEmMs: t.getTime() - data.getTime(), abreEm: t.toISOString() };
  }
  return { dentro: false, abreEmMs: 60 * 60000, abreEm: new Date(data.getTime() + 3600000).toISOString() };
}
