import { prepararBanco } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = await prepararBanco();
const { calcularEstatisticas } = await import('../src/modules/estatisticas/index.js');
const { registrarEvento } = await import('../src/events.js');

const etapas = db.all('SELECT id, name FROM stages ORDER BY position');
const [novo, contato, qualificado] = etapas;

function lead(nome, { source = 'yayforms', etapa = novo.id, criado = new Date(), utm = {} } = {}) {
  const extra = JSON.stringify({ formulario: null, form_id: 'abc', utm });
  return Number(
    db.run('INSERT INTO leads (name, source, stage_id, extra, created_at) VALUES (?, ?, ?, ?, ?)', [
      nome, source, etapa, extra, criado.toISOString(),
    ]).lastInsertRowid
  );
}

test('Calendly não aparece como origem e o formulário sem nome usa o ID', () => {
  lead('Form A', { utm: { utm_campaign: 'Camp 1', UTM_MEDIUM: 'Conj 1', utm_content: 'Ad 1' } });
  lead('Form B', { utm: { utm_campaign: 'Camp 1', utm_medium: 'Conj 2' } });
  lead('Pelo Calendly', { source: 'calendly' });

  const e = calcularEstatisticas({ dias: 7 });
  assert.deepEqual(e.por_origem.map((o) => o.origem), ['yayforms']);
  assert.equal(e.por_formulario[0].formulario, 'Formulário abc');
  assert.equal(e.leads.length, 3, 'a lista de leads do período inclui todos, inclusive os do Calendly');
  assert.deepEqual(e.leads[0].u, { utm_campaign: 'Camp 1', utm_medium: 'Conj 1', utm_content: 'Ad 1' });
  assert.deepEqual(e.chaves_utm, ['utm_campaign', 'utm_content', 'utm_medium']);
});

test('histórico de etapas entra no lead (para o funil) e a janela personalizada respeita início e fim', () => {
  const ontem = new Date(Date.now() - 86400000);
  const id = lead('Passou por qualificado', { etapa: contato.id, criado: ontem });
  registrarEvento({ leadId: id, type: 'stage_changed', data: { de: novo.name, para: qualificado.name } });
  registrarEvento({ leadId: id, type: 'stage_changed', data: { de: qualificado.name, para: contato.name } });
  registrarEvento({ leadId: id, type: 'stage_changed', data: { de: 'x', para: 'Etapa que não existe mais' } });

  const inicio = new Date(ontem.getTime() - 3600000).toISOString();
  const fim = new Date(ontem.getTime() + 3600000).toISOString();
  const e = calcularEstatisticas({ inicio, fim });
  assert.equal(e.leads.length, 1);
  assert.equal(e.entrada.novos, 1);
  assert.deepEqual(e.leads[0].p.sort(), [contato.id, qualificado.id].sort());
  assert.equal(e.leads[0].s, contato.id);
  assert.ok(e.por_dia.length >= 1 && e.por_dia.length <= 2);
});
