// Segurança da IA de primeiro contato. Três camadas:
//  1. Entrada: mensagens do lead que tentam dar ordens à IA (pedir código, senha, acesso, "ignore suas instruções")
//     nem chegam ao modelo — recebem uma resposta pronta e contam como aviso.
//  2. O modelo não tem ferramentas nem acesso ao banco: só vê esta conversa, o texto sobre a empresa e o playbook
//     (que é anonimizado ao ser gerado). Não há dado de outro cliente para vazar.
//  3. Saída: toda resposta passa por um filtro antes de ir para o WhatsApp. Se escapar código, link estranho,
//     telefone, e-mail ou assunto de senha/sistema, nada é enviado e a conversa vai para um humano.

const normalizar = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Tentativas de comandar a IA ou de usá-la para outra coisa
const TENTATIVAS = [
  /\b(ignore|ignora|esqueca|esquece|desconsidere|desconsidera)\b.{0,40}\b(instruc|regra|prompt|comando|orienta)/,
  /\b(prompt|system prompt|instrucoes do sistema|suas instrucoes|suas regras|modelo de linguagem)\b/,
  /\b(modo desenvolvedor|developer mode|jailbreak|dan mode|sem restric|sem filtro)/,
  /\b(finja|finge|atue como|aja como|se passe por|roleplay|role play|interprete o papel)\b/,
  /\b(codigo|script|programa|funcao|algoritmo)\b.{0,30}\b(python|javascript|java|php|sql|html|css|bash|node|c\+\+|c#)\b/,
  /\b(python|javascript|php|sql|bash|powershell)\b.{0,30}\b(codigo|script|faca|escreva|gere|crie|me de|me da|manda)\b/,
  /\b(escreva|gere|crie|faca|me de|me da|manda|mande)\b.{0,20}\b(um |uma |o |a )?(codigo|script|programa|redacao|tcc|poema|musica|letra de musica)\b/,
  /\b(me |nos )?(passe|passa|envie|envia|mande|manda|informe|informa|digite|digita)\b.{0,25}\b(sua |seu |a |o |os |as )?(senha|password|token|api ?key|chave da api|credencia)/,
  /\bme (passe|passa|de|da|envie|envia|mande|manda|libere|libera)\b.{0,15}\b(o |seu |sua |um |uma )?(acesso|login|senha)\b/,
  /\b(qual|quais)\b.{0,20}\b(senha|token|chave da api|credencia)/,
  /\b(me |nos )?(passe|passa|envie|envia|mande|manda|liste|lista|mostre|mostra)\b.{0,25}\b(dados|telefones?|numeros?|contatos?|emails?|e-mails?|enderecos?|cpfs?)\b.{0,25}\b(de outros?|dos outros|de outros clientes|dos clientes|da lista|do banco|de todos)/,
  /\b(banco de dados|database|api da anthropic|openai|chatgpt|anthropic)\b/,
  /<\/?\s*(system|instruc|prompt|script)[^>]*>/,
  /\b(traduza|traduz|resuma|resume)\b.{0,30}\b(texto|isso|este|essa)\b/,
];

export function tentativaDeComando(texto) {
  const t = normalizar(texto);
  if (!t) return false;
  return TENTATIVAS.some((re) => re.test(t));
}

// Pedidos claros de falar com uma pessoa (a IA passa na hora, sem gastar chamada ao modelo)
const PEDE_HUMANO = [
  /\b(falar|conversar|atendimento)\b.{0,25}\b(com )?(um |uma |o |a )?(humano|pessoa|atendente|responsavel|gerente|dono|especialista|marcelo|alguem)\b/,
  /\b(quero|preciso|prefiro|pode|consigo)\b.{0,25}\b(humano|atendente|pessoa de verdade|pessoa real)\b/,
  /\b(me liga|me ligue|liga pra mim|ligar pra mim|pode ligar|ligacao)\b/,
];

export function pedeHumano(texto) {
  const t = normalizar(texto);
  return PEDE_HUMANO.some((re) => re.test(t));
}

// O lead perguntou se está falando com robô/IA (a resposta tem que ser honesta)
export function perguntaSeERobo(texto) {
  const t = normalizar(texto);
  return /\b(robo|bot|chatbot|ia|inteligencia artificial|automatico|automatica|maquina|gravacao)\b/.test(t) &&
    /(\?|\be\b|\bvoce\b|\bvc\b|\bisso\b|\bto falando\b|\bestou falando\b|\bfalando com\b)/.test(t);
}

// ------------------------------------------------------------------ saída

const PROIBIDO_SAIDA = [
  /```/,
  /<\s*\/?\s*(script|system|iframe|html|body)/i,
  /\b(def |function |import |const |let |var |class |SELECT .+ FROM|INSERT INTO|DROP TABLE|console\.log|print\()/,
  /\b(senha|password|api[ _-]?key|token|credencia|sk-ant|chave da api)/i,
  /\b(prompt|instru[cç][oõ]es do sistema|minhas instru[cç][oõ]es|fui programad|meu sistema|anthropic|claude|openai|chatgpt|modelo de linguagem)\b/i,
  /\b(garant|prometo|100%|resultado certo|resultado garantido|sem risco|n[aã]o tem como dar errado|lucro certo)\w*/i,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /(\+?\d[\d\s().-]{8,}\d)/,
];

function linksPermitidos(texto, cfg) {
  const links = String(texto).match(/https?:\/\/[^\s)]+|www\.[^\s)]+|\b[\w-]+\.(com|net|org|io|br|me|link|ly)(\/[^\s)]*)?\b/gi) || [];
  if (!links.length) return true;
  if (!cfg.link_agenda) return false;
  const permitido = cfg.link_agenda.replace(/\/+$/, '');
  return links.every((l) => l.replace(/[.,!?;:]+$/, '').replace(/\/+$/, '').startsWith(permitido) || permitido.includes(l.replace(/^https?:\/\//, '').replace(/\/+$/, '')));
}

// Confere a resposta do modelo. Devolve { ok, mensagens, motivo }
export function validarSaida(mensagens, cfg) {
  if (!Array.isArray(mensagens) || !mensagens.length) return { ok: false, motivo: 'resposta vazia' };
  const limpas = mensagens
    .map((m) => String(m ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!limpas.length) return { ok: false, motivo: 'resposta vazia' };
  for (const m of limpas) {
    if (m.length > 700) return { ok: false, motivo: 'resposta longa demais' };
    // O aviso de fora do horário e a apresentação são textos do próprio dono: não passam pelo filtro de promessas
    // "não posso garantir resultados" é exatamente o que ela deve dizer: a negação não conta como promessa
    const semTextosFixos = m
      .replace(cfg.aviso_fora_horario || '\u0000', '')
      .replace(cfg.apresentacao || '\u0000', '')
      .replace(/n[aã]o\s+(?:\S+\s+){0,4}?(prometer|garantir|prometemos|garantimos|prometo|garanto|promete|garante)\w*/gi, '');
    const achado = PROIBIDO_SAIDA.find((re) => re.test(semTextosFixos.replace(cfg.link_agenda || '\u0000', '')));
    if (achado) return { ok: false, motivo: `bloqueada pelo filtro de segurança (${achado.source.slice(0, 40)})` };
    if (!linksPermitidos(m, cfg)) return { ok: false, motivo: 'link não autorizado na resposta' };
  }
  return { ok: true, mensagens: limpas };
}

// ------------------------------------------------------------------ anonimização (playbook)

// Tira telefones, e-mails, links, valores e nomes próprios conhecidos de um texto antes de usá-lo como exemplo
export function anonimizar(texto, nomes = []) {
  let t = String(texto || '');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, '[link]');
  t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, '[número]');
  t = t.replace(/R\$\s?[\d.,]+/gi, 'R$ [valor]');
  for (const n of nomes) {
    const nome = String(n || '').trim();
    if (nome.length < 3) continue;
    for (const parte of nome.split(/\s+/).filter((p) => p.length >= 3)) {
      t = t.replace(new RegExp(`\\b${parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[nome]');
    }
  }
  return t;
}

export const _paraTeste = { normalizar };
