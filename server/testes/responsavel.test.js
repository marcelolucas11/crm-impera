import { prepararBanco, criarLeadDireto, PASTA } from './ajuda.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const db = await prepararBanco();
const foto = await import('../src/modules/users/foto.js');
const leads = await import('../src/modules/leads/service.js');
const servico = await import('../src/modules/disparos/servico.js');

const criarUsuario = (nome) => Number(db.run("INSERT INTO users (name, email, password_hash) VALUES (?, ?, 'x')", [nome, `${nome.toLowerCase()}@teste.com`]).lastInsertRowid);

// PNG 1x1 válido
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('foto: aceita PNG, troca apagando a antiga e remove', () => {
  const id = criarUsuario('Ana');
  const rel1 = foto.salvarFoto(id, PNG);
  const arq1 = path.join(PASTA, 'arquivos', rel1);
  assert.ok(fs.existsSync(arq1));
  const u = db.get('SELECT photo_path, photo_at FROM users WHERE id = ?', [id]);
  assert.equal(u.photo_path, rel1);
  assert.ok(u.photo_at);
  assert.equal(foto.arquivoDaFoto(id).mime, 'image/png');

  const rel2 = foto.salvarFoto(id, PNG);
  assert.notEqual(rel1, rel2);
  assert.ok(!fs.existsSync(arq1), 'a foto antiga é apagada');

  foto.removerFoto(id);
  assert.equal(foto.arquivoDaFoto(id), null);
  assert.ok(!fs.existsSync(path.join(PASTA, 'arquivos', rel2)));
});

test('foto: recusa o que não é imagem, mesmo dizendo que é', () => {
  const id = criarUsuario('Bia');
  const falso = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
  assert.throws(() => foto.salvarFoto(id, falso), /não é uma imagem/);
  assert.throws(() => foto.salvarFoto(id, 'data:text/html;base64,PGI+'), /JPG, PNG ou WebP/);
  assert.throws(() => foto.salvarFoto(id, ''), /JPG, PNG ou WebP/);
  assert.equal(db.get('SELECT photo_path FROM users WHERE id = ?', [id]).photo_path, null);
});

test('kanban: responsável com foto aparece no lead', async () => {
  const dono = criarUsuario('Caio');
  foto.salvarFoto(dono, PNG);
  const lead = await criarLeadDireto({ nome: 'Lead com dono', telefone: '5511911112222' });
  db.run('UPDATE leads SET owner_id = ? WHERE id = ?', [dono, lead]);
  const l = leads.buscarLead(lead);
  assert.equal(l.owner_name, 'Caio');
  assert.ok(l.owner_foto);
});

test('em massa: muda etapa e responsável e registra no histórico só o que mudou', async () => {
  const dono = criarUsuario('Duda');
  const etapa2 = db.get('SELECT id, name FROM stages ORDER BY position LIMIT 1 OFFSET 1');
  const a = await criarLeadDireto({ nome: 'A', telefone: '5511933330001' });
  const b = await criarLeadDireto({ nome: 'B', telefone: '5511933330002' });
  db.run('UPDATE leads SET owner_id = ? WHERE id = ?', [dono, b]);

  const r = db.tx(() => leads.alterarLeadsEmMassa([a, b, b, 999999], { stage_id: etapa2.id, owner_id: dono }, dono));
  assert.equal(r.alterados, 2);
  assert.equal(db.get('SELECT stage_id FROM leads WHERE id = ?', [a]).stage_id, etapa2.id);
  assert.equal(db.get('SELECT owner_id FROM leads WHERE id = ?', [a]).owner_id, dono);
  // B já era da Duda: só a etapa mudou
  assert.equal(db.get("SELECT count(*) AS n FROM lead_events WHERE lead_id = ? AND type = 'owner_changed'", [b]).n, 0);
  assert.equal(db.get("SELECT count(*) AS n FROM lead_events WHERE lead_id = ? AND type = 'stage_changed'", [b]).n, 1);

  // Tirar o responsável
  db.tx(() => leads.alterarLeadsEmMassa([a], { owner_id: null }, dono));
  assert.equal(db.get('SELECT owner_id FROM leads WHERE id = ?', [a]).owner_id, null);
  assert.throws(() => db.tx(() => leads.alterarLeadsEmMassa([a], { stage_id: 999999 })), /Etapa não existe/);
});

test('público criado no kanban vira lista de disparo sem números repetidos', async () => {
  const x = await criarLeadDireto({ nome: 'X', telefone: '5511984440001' });
  const y = await criarLeadDireto({ nome: 'Y', telefone: '551184440001' }); // mesmo número sem o 9º dígito
  const id = servico.criarLista({ nome: 'Público teste', descricao: 'Criado no kanban' }, null);
  const r = servico.adicionarMembros(id, [
    { telefone: '5511984440001', lead_id: x, nome: 'X' },
    { telefone: '551184440001', lead_id: y, nome: 'Y' },
  ]);
  assert.equal(r.total, 1);
  assert.ok(servico.listarListas().some((l) => l.id === id && l.total === 1));
});
