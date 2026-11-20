import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Проверки на настоящем TCGdex (нужен интернет): npm run test:live
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
