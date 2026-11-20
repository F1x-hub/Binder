/**
 * Небольшое хранилище в IndexedDB. В «kv» лежит кэш со сроком годности: ответы TCGdex
 * и цены на день, чтобы не ходить в сеть и в Firestore лишний раз. В «thumbs» — обложки
 * из фото (src/lib/thumbnails.ts), их срок не ограничен. chrome.storage.local для этого
 * не годится: его лимит 10 МБ (урок прошлого расширения).
 */
const DB_NAME = 'binder-cache';
const VERSION = 2;
const STORES = ['kv', 'thumbs'] as const;
export type StoreName = (typeof STORES)[number];

type Entry<T> = { value: T; savedAt: number };

let dbPromise: Promise<IDBDatabase> | null = null;
const inflight = new Map<string, Promise<unknown>>();

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Поп-ап и вкладка открывают базу одновременно: новая версия не должна ждать старую
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readEntries<T>(store: StoreName, keys: string[]): Promise<Array<Entry<T> | undefined>> {
  const db = await openDb();
  const objects = db.transaction(store).objectStore(store);
  return Promise.all(keys.map((key) => done(objects.get(key) as IDBRequest<Entry<T> | undefined>)));
}

async function writeEntry<T>(store: StoreName, key: string, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const entry: Entry<T> = { value, savedAt: Date.now() };
  tx.objectStore(store).put(entry, key);
  await committed(tx);
}

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
  try {
    const [entry] = await readEntries<T>('kv', [key]);
    if (entry && Date.now() - entry.savedAt < maxAgeMs) return entry.value;
  } catch {
    // Без IndexedDB (например, в тестах под Node) просто работаем с сетью
  }
  return undefined;
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    await writeEntry('kv', key, value);
  } catch {
    // Кэш необязателен
  }
}

/** Значения по ключам из хранилища без срока годности; чего нет — того нет в ответе. */
export async function storeGetMany<T>(store: StoreName, keys: string[]): Promise<Map<string, T>> {
  const result = new Map<string, T>();
  if (keys.length === 0) return result;
  const entries = await readEntries<T>(store, keys);
  entries.forEach((entry, index) => {
    if (entry) result.set(keys[index]!, entry.value);
  });
  return result;
}

export function storePut<T>(store: StoreName, key: string, value: T): Promise<void> {
  return writeEntry(store, key, value);
}

export async function storeDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await committed(tx);
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
