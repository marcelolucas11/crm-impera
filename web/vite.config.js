import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Depois de compilar, guarda ao lado de cada arquivo de texto (JS, CSS, SVG...) uma cópia já compactada (.br e .gz).
// O servidor entrega a cópia compactada sem gastar processador a cada acesso, e o navegador baixa ~4x menos.
function compactarArquivos() {
  let pasta = 'dist';
  return {
    name: 'crm-compactar',
    apply: 'build',
    configResolved(cfg) { pasta = path.resolve(cfg.root, cfg.build.outDir); },
    closeBundle() {
      const andar = (d) => {
        for (const nome of fs.readdirSync(d)) {
          const arq = path.join(d, nome);
          if (fs.statSync(arq).isDirectory()) { andar(arq); continue; }
          if (!/\.(js|mjs|css|svg|json|txt|map)$/i.test(nome)) continue;
          const dados = fs.readFileSync(arq);
          if (dados.length < 1024) continue;
          fs.writeFileSync(`${arq}.br`, zlib.brotliCompressSync(dados, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: dados.length },
          }));
          fs.writeFileSync(`${arq}.gz`, zlib.gzipSync(dados, { level: 9 }));
        }
      };
      if (fs.existsSync(pasta)) andar(pasta);
    },
  };
}

// Em desenvolvimento (npm run dev), as chamadas /api vão para o servidor na porta 3000.
// Na versão compilada os arquivos usam caminho relativo ('./'), então a interface funciona
// tanto na raiz quanto num subcaminho como /interno (o servidor coloca o <base href> certo).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), compactarArquivos()],
  build: {
    // Os pacotes grandes (3D do fundo, emojis) já são carregados à parte, só quando a tela precisa
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
    },
  },
}));
