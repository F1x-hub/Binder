import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Сборка ежедневной задачи цен (scripts/refresh-prices.ts) в один файл для Node:
// пути «@/…» из src/lib разрешает Vite, пакеты из node_modules остаются внешними.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  logLevel: 'warn',
  publicDir: false,
  build: {
    ssr: 'scripts/refresh-prices.ts',
    outDir: '.output/scripts',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: '[name].mjs' } },
  },
});
