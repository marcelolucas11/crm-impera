// Mesmas regras do servidor (server/src/modules/disparos/texto.js) para a prévia ao vivo:
// {{variavel}}, {{variavel|padrão}} e Spintax {Oi|Olá}. Na prévia o Spintax mostra sempre a 1ª opção
// (ou sorteia, quando pedido), para o texto não ficar trocando enquanto você digita.

export const VARIAVEIS = [
  { nome: 'primeiro_nome', rotulo: 'Primeiro nome' },
  { nome: 'nome', rotulo: 'Nome completo' },
  { nome: 'saudacao', rotulo: 'Bom dia/tarde/noite' },
  { nome: 'telefone', rotulo: 'Telefone' },
  { nome: 'email', rotulo: 'E-mail' },
  { nome: 'etapa_kanban', rotulo: 'Etapa do kanban' },
];

export const TIPOS_BLOCO = [
  { id: 'texto', rotulo: 'Texto' },
  { id: 'audio', rotulo: 'Áudio' },
  { id: 'video', rotulo: 'Vídeo' },
  { id: 'imagem', rotulo: 'Imagem / GIF' },
  { id: 'arquivo', rotulo: 'Arquivo' },
];

export const ACEITA = {
  audio: 'audio/*,.mp3,.ogg,.wav,.m4a,.opus',
  video: 'video/*,.mp4,.mov',
  imagem: 'image/png,image/jpeg,image/webp,image/gif',
  arquivo: '*/*',
};

export function aplicarSpintax(texto, sorteio = () => 0) {
  let atual = String(texto ?? '');
  const re = /\{([^{}]*\|[^{}]*)\}/;
  for (let i = 0; i < 500 && re.test(atual); i++) {
    atual = atual.replace(re, (_, dentro) => {
      const opcoes = dentro.split('|');
      return opcoes[Math.floor(sorteio() * opcoes.length)] ?? '';
    });
  }
  return atual;
}

const RE_VAR = /\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g;

export function renderizar(texto, variaveis = {}, sorteio) {
  const marcados = [];
  const comMarcas = String(texto ?? '').replace(RE_VAR, (_, nome, padrao) => {
    const v = variaveis[nome];
    marcados.push(v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : (padrao ?? '').trim());
    return `\u0000${marcados.length - 1}\u0000`;
  });
  return aplicarSpintax(comMarcas, sorteio).replace(/\u0000(\d+)\u0000/g, (_, i) => marcados[Number(i)] ?? '').trim();
}

// Variáveis usadas no texto que a prévia não conhece (provável erro de digitação)
export function variaveisDesconhecidas(texto, variaveis = {}) {
  const fora = new Set();
  for (const m of String(texto ?? '').matchAll(RE_VAR)) if (!(m[1] in variaveis) && m[2] === undefined) fora.add(m[1]);
  return [...fora];
}

export const novoId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function novoBloco(tipo = 'texto', primeiro = false) {
  return {
    id: novoId(),
    tipo,
    texto: '',
    midia_id: null,
    midia: null,
    nome_arquivo: '',
    ptt: true,
    espera: { segundos: primeiro ? 2 : 4, presenca: tipo === 'audio' ? 'recording' : 'composing' },
  };
}

// Blocos que vão para o servidor (sem os dados só da tela)
export const paraEnvio = (blocos) => blocos.map(({ midia, ...b }) => ({ ...b, midia_id: b.midia_id || midia?.id || null }));

export function formatarTelefone(digitos) {
  if (!digitos) return '';
  const d = String(digitos);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    return `(${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
  }
  return `+${d}`;
}

export function tamanhoArquivo(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function duracaoCurta(segundos) {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min${s % 60 ? ` ${s % 60}s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}min` : ''}`;
}
