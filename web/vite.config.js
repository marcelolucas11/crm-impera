import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento (npm run dev), as chamadas /api vão para o servidor na porta 3000.
// Na versão compilada os arquivos usam caminho relativo ('./'), então a interface funciona
// tanto na raiz quanto num subcaminho como /interno (o servidor coloca o <base href> certo).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
    },
  },
}));
