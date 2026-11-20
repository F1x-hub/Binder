/**
 * Небольшой кэш в IndexedDB со сроком годности. Хранит ответы TCGdex и цены на день,
 * чтобы не ходить в сеть и в Firestore лишний раз. chrome.storage.local для этого
 * не годится: его лимит 10 МБ (урок прошлого расширения).
 */
const DB_NAME = 'binder-cache';
const STORE = 'kv';

type Entry<T> = { value: T; savedAt: number };

let dbPromise: Promise<IDBDatabase> | null = null;
const inflight = new Map<string, Promise<unknown>>();

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
  try {
    const db = await openDb();
    const entry = await new Promise<Entry<T> | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as Entry<T> | undefined);
      request.onerror = () => reject(request.error);
    });
    if (entry && Date.now() - entry.savedAt < maxAgeMs) return entry.value;
  } catch {
    // Без IndexedDB (например, в тестах под Node) просто работаем с сетью
  }
  return undefined;
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const entry: Entry<T> = { value, savedAt: Date.now() };
      tx.objectStore(STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Кэш необязателен
  }
}

/**
 * Значение из кэша, а если его нет или оно старое — из сети. Одинаковые одновременные
 * запросы склеиваются в один. Если сеть упала, отдаётся устаревшее значение, когда оно есть.
 */
export async function cached<T>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const fresh = await cacheGet<T>(key, maxAgeMs);
  if (fresh !== undefined) return fresh;

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const task = (async () => {
    try {
      const value = await load();
      void cachePut(key, value);
      return value;
    } catch (error) {
      const stale = await cacheGet<T>(key, Number.POSITIVE_INFINITY);
      if (stale !== undefined) return stale;
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}
