// Dados de exemplo (falsos) para ver a tela de WhatsApp sem conectar nenhum número.
// Uso: DB_FILE=/tmp/x/crm.db FILES_DIR=/tmp/x/arquivos node testes/semear.js
// Nunca rode apontando para o banco real.
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BANCO_REAL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'dados', 'crm.db');
if (!process.env.DB_FILE || path.resolve(process.env.DB_FILE) === BANCO_REAL) {
  console.error('Defina DB_FILE para um banco temporário (nunca o banco real).');
  process.exit(1);
}
process.env.SESSION_SECRET ||= 'semente-de-exemplo-123456';

const db = await import('../src/db.js');
const { aplicarMigracoes } = await import('../src/migrar.js');
db.abrirBanco();
aplicarMigracoes(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations'));
const { run, get } = db;

const agora = Date.now();
const iso = (minAtras) => new Date(agora - minAtras * 60000).toISOString();
const etapa = (n) => get('SELECT id FROM stages ORDER BY position LIMIT 1 OFFSET ?', [n]).id;

run("INSERT OR IGNORE INTO wa_instances (id, name, phone) VALUES (1, 'Comercial', '5511900000000'), (2, 'Suporte', '5511900000001')");
const lead = (nome, tel, e, origem = 'yayforms') => Number(run('INSERT INTO leads (name, phone, source, stage_id, created_at) VALUES (?, ?, ?, ?, ?)', [nome, tel, origem, etapa(e), iso(60 * 24 * 3)]).lastInsertRowid);
const ana = lead('Ana Ribeiro', '5511987650001', 0);
const bruno = lead('Bruno Costa', '5521987650002', 1);
const carla = lead('Carla Mendes', '5531987650003', 2, 'calendly');

const contato = (jid, phone, leadId, push) => run('INSERT OR REPLACE INTO wa_contacts (jid, phone, lead_id, push_name) VALUES (?, ?, ?, ?)', [jid, phone, leadId, push]);
contato('5511987650001@s.whatsapp.net', '5511987650001', ana, 'Ana');
contato('5521987650002@s.whatsapp.net', '5521987650002', bruno, 'Bruno');
contato('5531987650003@s.whatsapp.net', '5531987650003', carla, 'Carla');
contato('5541912340004@s.whatsapp.net', '5541912340004', null, 'Diego (não é lead)');
contato('5511955550005@s.whatsapp.net', '5511955550005', null, 'Marina');
contato('5511955550006@s.whatsapp.net', '5511955550006', null, 'Paulo');

let n = 0;
const usuario = get('SELECT id FROM users ORDER BY id LIMIT 1')?.id || null;
const msg = (jid, leadId, deMim, tipo, body, minAtras, extra = {}) => {
  n++;
  return Number(run(
    `INSERT INTO wa_messages (instance_id, lead_id, chat_jid, wa_id, from_me, type, body, legenda, timestamp, status, read_at, extra, reactions,
       participant_jid, participant_name, starred_at, edited_at, deleted_at, quoted_wa_id, quoted_body, quoted_from_me, sent_by, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [extra.numero || 1, leadId, jid, `EX${n}`, deMim ? 1 : 0, tipo, body, extra.legenda || null, iso(minAtras), deMim ? extra.status ?? 4 : null,
      deMim || extra.lida === false ? null : iso(minAtras - 1), extra.extra ? JSON.stringify(extra.extra) : null, extra.reacoes ? JSON.stringify(extra.reacoes) : null,
      extra.participante || null, extra.nomeParticipante || null, extra.estrela ? iso(1) : null, extra.editada ? iso(minAtras - 2) : null,
      extra.apagada ? iso(minAtras - 1) : null, extra.citada || null, extra.citadaTexto || null, extra.citadaMinha ?? null, deMim ? usuario : null, extra.raw || null]
  ).lastInsertRowid);
};

// Ana: conversa longa (rolagem e lista virtual) + vários tipos
const jidAna = '5511987650001@s.whatsapp.net';
for (let i = 0; i < 260; i++) {
  msg(jidAna, ana, i % 3 === 0, 'texto', i % 3 === 0 ? `Mensagem nossa número ${i}` : `Oi! Pergunta ${i} sobre o serviço de tráfego pago`, 60 * 24 * 80 - i * 400);
}
msg(jidAna, ana, false, 'texto', 'Olá, vi o anúncio de vocês no Instagram e queria saber mais sobre *gestão de tráfego*.', 300);
msg(jidAna, ana, true, 'texto', 'Oi Ana! Tudo bem? Claro, posso te explicar. Dá uma olhada: https://www.exemplo.com/planos', 290, {
  extra: { previa: { url: 'https://www.exemplo.com/planos', titulo: 'Planos — Agência de Exemplo', descricao: 'Gestão de tráfego, criativos e relatórios semanais.' } }, reacoes: { contato: '❤️' },
});
msg(jidAna, ana, false, 'texto', 'Perfeito, quanto custa o plano mensal?', 280, { citada: 'EX262', citadaTexto: 'Oi Ana! Tudo bem? Claro, posso te explicar.', citadaMinha: 1 });
msg(jidAna, ana, true, 'enquete', '📊 Qual horário fica melhor para a reunião?', 270, {
  extra: { pergunta: 'Qual horário fica melhor para a reunião?', opcoes: ['Manhã', 'Tarde', 'Noite'], multipla: false, votos: { [jidAna]: ['Tarde'] } },
});
msg(jidAna, ana, false, 'chamada', '📞 Chamada de voz perdida', 200, { extra: { video: false, resultado: 'perdida' } });
msg(jidAna, ana, true, 'texto', 'Te liguei de volta, mas não consegui falar. Pode ser amanhã às 15h?', 190, { estrela: true, editada: true });
msg(jidAna, ana, false, 'localizacao', '📍 Escritório', 120, { extra: { lat: -23.5613, lng: -46.6565, nome: 'Escritório', endereco: 'Av. Paulista, 1000 — São Paulo' } });
msg(jidAna, ana, false, 'contato', '👤 Rafael (sócio)', 100, { extra: { contatos: [{ nome: 'Rafael (sócio)', telefones: ['5511944443333'] }] } });
msg(jidAna, ana, false, 'texto', 'Esse é meu sócio, pode falar com ele também 🙂', 30, { lida: false });
msg(jidAna, ana, false, 'texto', 'Aguardo a proposta!', 25, { lida: false });

// Bruno: chamada recebida, apagada, mensagem temporária
const jidBruno = '5521987650002@s.whatsapp.net';
msg(jidBruno, bruno, false, 'texto', 'Boa tarde, recebi a proposta.', 60 * 26);
msg(jidBruno, bruno, true, 'texto', 'Que bom! Alguma dúvida?', 60 * 25.5, { status: 3 });
msg(jidBruno, bruno, false, 'texto', 'Mensagem que ele apagou', 60 * 25, { apagada: true });
msg(jidBruno, bruno, false, 'chamada', '📞 Chamada de vídeo atendida no celular (3 min 12 s)', 60 * 24, { extra: { video: true, resultado: 'atendida_em_outro_aparelho', duracao: 192 } });
msg(jidBruno, bruno, true, 'texto', 'Combinado então, segue o contrato amanhã.', 60 * 23, { extra: { temporaria: 604800 }, status: 2, numero: 2 });

// Carla e contatos que não são leads
msg('5531987650003@s.whatsapp.net', carla, false, 'texto', 'Consegui agendar pelo Calendly 👍', 60 * 30);
msg('5541912340004@s.whatsapp.net', null, false, 'texto', 'Vocês atendem em Curitiba?', 50, { lida: false });
msg('5511955550005@s.whatsapp.net', null, true, 'texto', 'Obrigado pelo contato, Marina!', 60 * 24 * 4);
msg('5511955550006@s.whatsapp.net', null, false, 'texto', 'Conversa arquivada de exemplo', 60 * 24 * 6);

// Grupo com menções
const grupo = '120363000000000001@g.us';
run("INSERT OR REPLACE INTO wa_contacts (jid) VALUES (?)", [grupo]);
contato('5511900001111@s.whatsapp.net', '5511900001111', null, 'Júlia');
contato('5511900002222@s.whatsapp.net', '5511900002222', null, 'Marcos');
msg(grupo, null, false, 'texto', 'Bom dia, equipe! Reunião às 10h.', 90, { participante: '5511900001111@s.whatsapp.net', nomeParticipante: 'Júlia' });
msg(grupo, null, false, 'texto', '@5511900001111 confirmado, levo o relatório.', 80, { participante: '5511900002222@s.whatsapp.net', nomeParticipante: 'Marcos', extra: { mencoes: { '5511900001111': 'Júlia' } }, lida: false });
msg(grupo, null, true, 'texto', 'Perfeito, até já!', 70);

// Estado das conversas, etiquetas
run("INSERT OR IGNORE INTO wa_labels (id, name, color) VALUES (1, 'Orçamento', '#e0a050'), (2, 'Pós-venda', '#4fb3a9')");
const chat = (jid, campos) => run(`INSERT INTO wa_chats (jid, instance_id, is_group, name, archived, pinned_at, muted_until, favorite, labels, ephemeral_seconds)
  VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(jid) DO NOTHING`,
[jid, campos.grupo ? 1 : 0, campos.nome || null, campos.arquivada ? 1 : 0, campos.fixada ? iso(5) : null, campos.silenciada || null, campos.favorita ? 1 : 0, campos.etiquetas ? JSON.stringify(campos.etiquetas) : null, campos.temporarias || null]);
chat(jidAna, { fixada: true, favorita: true, etiquetas: [1] });
chat(jidBruno, { etiquetas: [2], temporarias: 604800 });
chat(grupo, { grupo: true, nome: 'Equipe Impera (exemplo)', silenciada: '9999-12-31T00:00:00.000Z' });
chat('5511955550006@s.whatsapp.net', { arquivada: true });

// Figurinhas de exemplo (geradas pelo FFmpeg, sem arquivos de terceiros)
try {
  const ffmpeg = (await import('ffmpeg-static')).default;
  const pasta = path.join(process.env.FILES_DIR, 'whatsapp', 'figurinhas');
  fs.mkdirSync(pasta, { recursive: true });
  const cores = ['gold', 'teal', 'tomato', 'mediumpurple'];
  for (const [i, cor] of cores.entries()) {
    const arq = path.join(pasta, `exemplo-${i}.webp`);
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=512x512,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-256,Y-256),230),255,0)'`, '-frames:v', '1', '-c:v', 'libwebp', arq], { stdio: 'ignore' });
    run('INSERT OR IGNORE INTO wa_stickers (hash, path, mime, crm_favorite, phone_favorite, last_used_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`exemplo-${i}`, path.join('whatsapp', 'figurinhas', `exemplo-${i}.webp`), 'image/webp', i % 2, i === 0 ? 1 : 0, iso(i * 10), 'exemplo']);
  }
  const fig = get('SELECT path FROM wa_stickers WHERE hash = ?', ['exemplo-0']).path;
  const id = msg(jidAna, ana, false, 'figurinha', '🙂 Figurinha', 20, { lida: false });
  run("UPDATE wa_messages SET media_mime = 'image/webp', media_path = ?, media_status = 'ok', media_w = 512, media_h = 512 WHERE id = ?", [fig, id]);
} catch (err) {
  console.error('Sem FFmpeg: figurinhas de exemplo não criadas', err.message);
}

console.log(`Dados de exemplo criados: ${n} mensagens.`);
db.fecharBanco();
