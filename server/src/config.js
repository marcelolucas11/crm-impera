// Configuração lida do arquivo .env (na raiz do app) e das variáveis de ambiente
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do app = pasta "app/" no SSD (onde ficam .env, server/, web/)
export const RAIZ_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  process.loadEnvFile(path.join(RAIZ_APP, '.env'));
} catch {
  // sem .env: usa só as variáveis de ambiente (ex.: testes)
}

const numero = (valor, padrao) => {
  const n = Number(valor);
  return valor === undefined || valor === '' || Number.isNaN(n) ? padrao : n;
};

// Caminhos relativos no .env são relativos à pasta do app
const caminho = (valor, padrao) => path.resolve(RAIZ_APP, valor || padrao);

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: numero(process.env.APP_PORT ?? process.env.PORT, 3000),
  version: process.env.APP_VERSION || 'dev',
  sessionSecret: process.env.SESSION_SECRET || '',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  dbFile: caminho(process.env.DB_FILE, '../dados/crm.db'),
  filesDir: caminho(process.env.FILES_DIR, '../arquivos'),
  followupHours: numero(process.env.FOLLOWUP_HORAS, 24),
  calendly: {
    token: process.env.CALENDLY_TOKEN || '',
    intervaloMin: Math.max(1, numero(process.env.CALENDLY_INTERVALO_MIN, 5)),
    apiUrl: (process.env.CALENDLY_API_URL || 'https://api.calendly.com').replace(/\/+$/, ''),
  },
  whatsapp: {
    ativo: process.env.WHATSAPP_ATIVO !== '0',
    pastaSessoes: caminho(process.env.WHATSAPP_SESSOES, '../dados/whatsapp'),
    criarLeadNovo: process.env.WHATSAPP_CRIAR_LEADS !== '0',
  },
  yayforms: {
    token: process.env.YAYFORMS_WEBHOOK_TOKEN || '',
    secret: process.env.YAYFORMS_WEBHOOK_SECRET || '',
    fieldName: process.env.YAYFORMS_CAMPO_NOME || '',
    fieldPhone: process.env.YAYFORMS_CAMPO_TELEFONE || '',
    fieldEmail: process.env.YAYFORMS_CAMPO_EMAIL || '',
  },
};

export function validarConfig() {
  const problemas = [];
  if (config.sessionSecret.length < 16) problemas.push('SESSION_SECRET ausente ou curto demais (mínimo 16 caracteres)');
  if (problemas.length) {
    throw new Error('Configuração inválida:\n - ' + problemas.join('\n - '));
  }
}
