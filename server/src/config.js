// Configuração lida das variáveis de ambiente (.env)

const numero = (valor, padrao) => {
  const n = Number(valor);
  return valor === undefined || valor === '' || Number.isNaN(n) ? padrao : n;
};

export const config = {
  port: numero(process.env.PORT, 3000),
  version: process.env.APP_VERSION || 'dev',
  isProd: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || '',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  filesDir: process.env.FILES_DIR || './data/arquivos',
  followupHours: numero(process.env.FOLLOWUP_HORAS, 24),
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
