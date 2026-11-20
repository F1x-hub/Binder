/// <reference types="vite/client" />

/** Конфиг Firebase из .env (шаблон в .env.example). WXT отдаёт в код переменные с приставкой WXT_. */
interface ImportMetaEnv {
  readonly WXT_FIREBASE_API_KEY?: string;
  readonly WXT_FIREBASE_AUTH_DOMAIN?: string;
  readonly WXT_FIREBASE_PROJECT_ID?: string;
  readonly WXT_FIREBASE_STORAGE_BUCKET?: string;
  readonly WXT_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly WXT_FIREBASE_APP_ID?: string;
}
