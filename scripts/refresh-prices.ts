import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { refreshClubPrices } from './refresh-prices-core';

/**
 * Ежедневное освежение цен клуба. Запуск: npm run prices:refresh (сборка Vite и Node 22).
 * В GitHub Actions ключ сервисного аккаунта Firebase — секрет FIREBASE_SERVICE_ACCOUNT (JSON).
 * С FIRESTORE_EMULATOR_HOST скрипт пишет в эмулятор (проект GCLOUD_PROJECT или demo-binder).
 * Выход с кодом 1, если TCGdex не ответил ни по одной карте или не удалось писать в Firestore:
 * так упавший запуск видно в Actions.
 */
async function main(): Promise<number> {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const account = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (emulator) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-binder' });
    console.log(`Эмулятор Firestore: ${emulator}`);
  } else if (account) {
    const parsed = JSON.parse(account) as { project_id?: string; client_email?: string; private_key?: string };
    initializeApp({ credential: cert(parsed as Parameters<typeof cert>[0]), projectId: parsed.project_id });
    console.log(`Проект Firebase: ${parsed.project_id}`);
  } else {
    console.error('Нет FIREBASE_SERVICE_ACCOUNT (JSON сервисного аккаунта) и нет FIRESTORE_EMULATOR_HOST');
    return 1;
  }

  const report = await refreshClubPrices(getFirestore(), { log: (line) => console.log(line) });
  console.log(JSON.stringify(report));
  if (report.tcgdex.cards > 0 && report.tcgdex.refreshed === 0 && report.tcgdex.failed > 0) {
    console.error('TCGdex не ответил ни по одной карте');
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
