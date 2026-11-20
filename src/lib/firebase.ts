import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth/web-extension';

/** Конфиг веб-приложения из .env. Это не секрет: доступ к данным защищают правила Firestore. */
const config = {
  apiKey: import.meta.env.WXT_FIREBASE_API_KEY,
  authDomain: import.meta.env.WXT_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.WXT_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.WXT_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.WXT_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.WXT_FIREBASE_APP_ID,
};

export function firebaseApp(): FirebaseApp {
  const existing = getApps()[0];
  if (existing) return existing;
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Нет конфига Firebase (${missing.join(', ')}). Создай .env по образцу .env.example.`);
  }
  return initializeApp(config);
}

/**
 * Авторизация из сборки для расширений: она не загружает удалённый код, который запрещает MV3.
 * Сессия хранится в IndexedDB и общая для поп-апа, вкладки и service worker.
 */
export function binderAuth(): Auth {
  return getAuth(firebaseApp());
}
