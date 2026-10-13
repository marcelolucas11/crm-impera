import './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefone, variantesTelefone } from '../src/util.js';
import { telefoneDoJid } from '../src/modules/whatsapp/ligacao.js';

test('normalizarTelefone coloca o DDI e limpa a formatação', () => {
  assert.equal(normalizarTelefone('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizarTelefone('11 8765-4321'), '551187654321');
  assert.equal(normalizarTelefone('+55 11 98765-4321'), '5511987654321');
  assert.equal(normalizarTelefone('055 11 98765-4321'), '5511987654321');
  assert.equal(normalizarTelefone('+1 415 555 2671'), '14155552671');
  assert.equal(normalizarTelefone('123'), null);
  assert.equal(normalizarTelefone(null), null);
});

test('variantesTelefone: com e sem o 9º dígito', () => {
  assert.deepEqual(variantesTelefone('5511987654321').sort(), ['551187654321', '5511987654321'].sort());
  assert.deepEqual(variantesTelefone('551187654321').sort(), ['551187654321', '5511987654321'].sort());
  // Fixo (começa com 2-5) não ganha 9
  assert.deepEqual(variantesTelefone('551133334444'), ['551133334444']);
  // Fora do Brasil fica igual
  assert.deepEqual(variantesTelefone('14155552671'), ['14155552671']);
  assert.deepEqual(variantesTelefone(null), []);
});

test('telefoneDoJid lê o número do identificador do WhatsApp', () => {
  assert.equal(telefoneDoJid('5511987654321@s.whatsapp.net'), '5511987654321');
  assert.equal(telefoneDoJid('5511987654321:12@s.whatsapp.net'), '5511987654321');
  assert.equal(telefoneDoJid('123456789012345@lid'), null);
  assert.equal(telefoneDoJid('120363000000000000@g.us'), null);
});
