// Downloads de endereços digitados por alguém (prévia de link no WhatsApp, mídia de disparo por link).
// Regras: só http/https, nunca endereços internos (localhost, rede local, IPv6 local, metadados da nuvem).
// O IP é conferido na própria conexão (lookup), então um DNS que muda de resposta entre a checagem e o download não
// engana a proteção, e cada redirecionamento passa pela mesma conferência. Tempo e tamanho sempre limitados.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs';

// Endereços que nunca são acessados (listas separadas: o BlockList trata IPv4 como "::ffff:x.x.x.x" nas regras IPv6)
const BLOQUEADOS_V4 = new net.BlockList();
for (const [rede, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) BLOQUEADOS_V4.addSubnet(rede, bits, 'ipv4');
const BLOQUEADOS_V6 = new net.BlockList();
for (const [rede, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16]]) {
  BLOQUEADOS_V6.addSubnet(rede, bits, 'ipv6');
}

export function ipInterno(ip) {
  if (!ip) return true;
  const limpo = String(ip).replace(/^\[|\]$/g, '');
  const tipo = net.isIP(limpo);
  if (!tipo) return true;
  if (tipo === 6) {
    // IPv4 escrito dentro do IPv6 (::ffff:127.0.0.1 ou ::ffff:7f00:1)
    const m = limpo.toLowerCase().match(/^::ffff:(.+)$/);
    if (m) {
      if (net.isIPv4(m[1])) return ipInterno(m[1]);
      const p = m[1].split(':');
      if (p.length === 2) {
        const n = (parseInt(p[0], 16) << 16) + parseInt(p[1], 16);
        return ipInterno([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
      }
    }
    if (/^::ffff:/i.test(limpo)) return true;
    return BLOQUEADOS_V6.check(limpo, 'ipv6');
  }
  return BLOQUEADOS_V4.check(limpo, 'ipv4');
}

/** Nome de máquina que nunca deve ser acessado (IP interno escrito direto, localhost, .local, .internal) */
export function hostInterno(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  return (net.isIP(h) && ipInterno(h)) || /^localhost$|\.localhost$|\.local$|\.internal$/i.test(h);
}

// Resolve o nome e recusa endereços internos (usado pela própria conexão)
export function lookupSeguro(host, opcoes, cb) {
  dns.lookup(host, { ...opcoes, all: true }, (err, enderecos) => {
    if (err) return cb(err);
    const permitidos = (enderecos || []).filter((e) => !ipInterno(e.address));
    if (!permitidos.length || permitidos.length !== enderecos.length) return cb(new Error('Endereço interno não permitido'));
    if (opcoes?.all) return cb(null, permitidos);
    cb(null, permitidos[0].address, permitidos[0].family);
  });
}

export class ErroDownload extends Error {
  constructor(mensagem, { status = null, grande = false } = {}) {
    super(mensagem);
    this.statusHttp = status;
    this.grande = grande;
  }
}

/**
 * Baixa um endereço com as proteções acima.
 *  max: bytes no máximo · aoExceder: 'cortar' (devolve o que chegou, cortado: true) ou 'erro'
 *  tempoMs: sem receber nada por esse tempo, desiste · totalMs: tempo máximo do download inteiro
 *  destino: grava direto num arquivo (não guarda tudo na memória) em vez de devolver o corpo
 * Devolve { corpo | caminho, tamanho, tipo, url, cortado }
 */
export function baixarSeguro(url, { max, aoExceder = 'cortar', tempoMs = 4000, totalMs = null, redirecionamentos = 3, cabecalhos = {}, destino = null } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new ErroDownload('URL inválida')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new ErroDownload('Protocolo não permitido'));
    if (hostInterno(u.hostname)) return reject(new ErroDownload('Endereço interno não permitido'));
    const mod = u.protocol === 'https:' ? https : http;
    let encerrado = false;
    let arquivo = null;
    const fim = (erro, valor) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(relogio);
      if (erro) {
        if (arquivo) { arquivo.destroy(); fs.rm(destino, { force: true }, () => {}); }
        reject(erro);
      } else resolve(valor);
    };
    const relogio = totalMs ? setTimeout(() => { req.destroy(); fim(new ErroDownload('O download demorou demais')); }, totalMs) : null;
    const req = mod.get(u, { lookup: lookupSeguro, timeout: tempoMs, headers: cabecalhos }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirecionamentos <= 0) return fim(new ErroDownload('Redirecionamentos demais'));
        let proximo;
        try { proximo = new URL(res.headers.location, u).toString(); } catch { return fim(new ErroDownload('Redirecionamento inválido')); }
        clearTimeout(relogio);
        encerrado = true;
        return baixarSeguro(proximo, { max, aoExceder, tempoMs, totalMs, redirecionamentos: redirecionamentos - 1, cabecalhos, destino }).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return fim(new ErroDownload(`HTTP ${res.statusCode}`, { status: res.statusCode })); }
      const tipo = String(res.headers['content-type'] || '');
      const declarado = Number(res.headers['content-length'] || 0);
      if (aoExceder === 'erro' && declarado > max) { res.resume(); req.destroy(); return fim(new ErroDownload('Arquivo grande demais', { grande: true })); }
      const partes = [];
      let total = 0;
      if (destino) {
        arquivo = fs.createWriteStream(destino);
        arquivo.on('error', (e) => { req.destroy(); fim(e); });
      }
      res.on('data', (p) => {
        if (encerrado) return;
        total += p.length;
        if (total > max) {
          req.destroy();
          if (aoExceder === 'erro') return fim(new ErroDownload('Arquivo grande demais', { grande: true }));
          if (destino) { arquivo.end(() => fim(null, { caminho: destino, tamanho: total - p.length, tipo, url: u.toString(), cortado: true })); return; }
          return fim(null, { corpo: Buffer.concat(partes), tamanho: total - p.length, tipo, url: u.toString(), cortado: true });
        }
        if (destino) {
          if (!arquivo.write(p)) { res.pause(); arquivo.once('drain', () => res.resume()); }
        } else partes.push(p);
      });
      res.on('end', () => {
        if (encerrado) return;
        if (destino) arquivo.end(() => fim(null, { caminho: destino, tamanho: total, tipo, url: u.toString(), cortado: false }));
        else fim(null, { corpo: Buffer.concat(partes), tamanho: total, tipo, url: u.toString(), cortado: false });
      });
      res.on('error', (e) => fim(e));
      res.on('aborted', () => fim(new ErroDownload('O download foi interrompido')));
    });
    req.on('timeout', () => { req.destroy(); fim(new ErroDownload('Tempo esgotado')); });
    req.on('error', (e) => fim(e));
  });
}
