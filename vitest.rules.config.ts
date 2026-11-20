import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Тесты правил Firestore. Запуск только через npm run test:rules:
// firebase emulators:exec поднимает эмулятор и передаёт его адрес в FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
