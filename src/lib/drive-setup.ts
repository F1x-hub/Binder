import { browser } from 'wxt/browser';
import { DRIVE_SCOPES, driveClient, type DriveClient } from '@/lib/drive';

/**
 * Выбор «Мои фото карточек», токен Google Drive и подключение. Лёгкий модуль без React
 * и Firestore: его импортирует service worker (src/entrypoints/background.ts).
 */

export type PhotoStore = 'none' | 'drive';

const STORE_KEY = 'photoStore';

function isPhotoStore(value: unknown): value is PhotoStore {
  return value === 'none' || value === 'drive';
}

/** Выбор лежит в chrome.storage.sync: идёт за аккаунтом Chrome во все его браузеры. */
export async function loadPhotoStore(): Promise<PhotoStore> {
  const area = browser?.storage?.sync;
  if (!area) return 'none';
  const stored: unknown = (await area.get(STORE_KEY))[STORE_KEY];
  return isPhotoStore(stored) ? stored : 'none';
}

export async function savePhotoStore(value: PhotoStore): Promise<void> {
  await browser.storage.sync.set({ [STORE_KEY]: value });
}

/** Подписка на смену выбора в других окнах (и на включение Drive из service worker). */
export function watchPhotoStore(onChange: (value: PhotoStore) => void): () => void {
  const storage = browser?.storage;
  if (!storage) return () => {};
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'sync' || !(STORE_KEY in changes)) return;
    const next = changes[STORE_KEY]?.newValue;
    onChange(isPhotoStore(next) ? next : 'none');
  };
  storage.onChanged.addListener(listener);
  return () => storage.onChanged.removeListener(listener);
}

/**
 * Токен для Drive: scopes входа плюс drive.file. Scope не в манифесте, а здесь: так согласие
 * на Drive спрашивается, только когда участник его включает. interactive: true может показать
 * окно согласия, поэтому так вызывает только service worker (как и вход, src/lib/auth.ts).
 */
export async function driveToken(interactive: boolean): Promise<string> {
  const result = await browser.identity.getAuthToken({ interactive, scopes: DRIVE_SCOPES });
  if (!result.token) throw new Error('chrome.identity не вернул токен для Drive');
  return result.token;
}

/** Забыть токен Drive в кэше Chrome: при выходе из Binder. */
export async function forgetDriveToken(): Promise<void> {
  const cached = await browser.identity.getAuthToken({ interactive: false, scopes: DRIVE_SCOPES }).catch(() => null);
  if (cached?.token) await browser.identity.removeCachedAuthToken({ token: cached.token });
}

export function driveFor(interactive = false): DriveClient {
  return driveClient({
    fetch: (...args) => fetch(...args),
    token: () => driveToken(interactive),
    dropToken: (token) => browser.identity.removeCachedAuthToken({ token }),
  });
}

/** Разрешение на Drive уже дано в этом браузере: токен берётся без окна. */
export async function driveReady(): Promise<boolean> {
  try {
    await driveToken(false);
    return true;
  } catch {
    return false;
  }
}

/**
 * Подключить Drive: окно согласия, папка «Binder», выбор сохраняется. Вызывает service worker:
 * поп-ап закрывается, когда Chrome показывает окно согласия, а выбор всё равно запишется.
 */
export async function connectDrive(): Promise<void> {
  await driveFor(true).ensureFolder();
  await savePhotoStore('drive');
}
