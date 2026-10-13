import './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipInterno, gerarPrevia } from '../src/modules/whatsapp/previa.js';

test('prévia de link nunca acessa endereços internos', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.equal(ipInterno(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '177.10.20.30', '2800:3f0:4001::200e']) assert.equal(ipInterno(ip), false, ip);
  assert.equal(await gerarPrevia('veja http://127.0.0.1:3000/api'), null);
  assert.equal(await gerarPrevia('veja http://localhost:3000/api'), null);
  assert.equal(await gerarPrevia('sem link nenhum'), null);
});

test('IPv4 escrito como IPv6 também é bloqueado', () => {
  assert.equal(ipInterno('::ffff:7f00:1'), true);
  assert.equal(ipInterno('::ffff:c0a8:1'), true);
  assert.equal(ipInterno('[::1]'), true);
});
