// Recebimento de arquivos enviados pelo navegador (corpo do pedido = o próprio arquivo), direto para o disco e com
// limite de tamanho conferido enquanto chega — nunca carrega o arquivo inteiro na memória.
// Usado pelo WhatsApp, Instagram, assistente e disparos (antes cada módulo tinha a sua cópia desta lógica).
import fs from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ErroHttp } from './util.js';

/** Transform que corta o envio quando passa de max bytes. .total() diz quantos bytes passaram. */
export function limitadorDeTamanho(max, mensagem) {
  let total = 0;
  const t = new Transform({
    transform(pedaco, _enc, cb) {
      total += pedaco.length;
      if (total > max) return cb(new ErroHttp(413, mensagem));
      cb(null, pedaco);
    },
  });
  t.total = () => total;
  return t;
}

/**
 * Grava um fluxo (pedido do navegador, download...) no arquivo destino. Devolve quantos bytes foram gravados.
 * Erro, envio interrompido ou arquivo vazio: apaga o que ficou pela metade e lança ErroHttp.
 */
export async function gravarFluxo(fonte, destino, { max, mensagem = 'Arquivo grande demais' }) {
  const limite = limitadorDeTamanho(max, mensagem);
  try {
    await pipeline(fonte, limite, fs.createWriteStream(destino));
  } catch (err) {
    fs.rmSync(destino, { force: true });
    throw err.status ? err : new ErroHttp(400, 'O envio do arquivo foi interrompido');
  }
  if (!limite.total()) {
    fs.rmSync(destino, { force: true });
    throw new ErroHttp(400, 'Arquivo vazio');
  }
  return limite.total();
}

/** Recebe o corpo do pedido no arquivo destino (confere antes o tamanho declarado pelo navegador) */
export async function receberCorpo(req, destino, { max, mensagem = 'Arquivo grande demais' }) {
  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > max) throw new ErroHttp(413, mensagem);
  return gravarFluxo(req, destino, { max, mensagem });
}
