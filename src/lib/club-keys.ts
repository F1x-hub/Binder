import { Timestamp, doc, getDoc, serverTimestamp, setDoc, type DocumentData, type Firestore } from 'firebase/firestore';

/**
 * Ключи JustTCG клуба: документ config/justtcg, общий для всех участников. Читают все
 * участники (запросы к JustTCG идут из их браузеров), меняет только админ на своей странице.
 * Порядок — очередь: запросы идут с первого включённого ключа, у которого не кончился лимит
 * (src/lib/justtcg.ts). Где какой ключ упёрся в лимит, каждый браузер помнит сам
 * (src/lib/justtcg-keys.ts): один отказ JustTCG на браузер, и дальше ключ пропускается до сброса.
 */
export const MAX_CLUB_KEYS = 10;
export const MAX_LABEL = 40;

export type ClubKey = { key: string; label: string; enabled: boolean; addedAt: Timestamp };

/** Тот же шаблон, что в firestore.rules: ключи JustTCG вида tcg_… */
export function validKeyText(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,200}$/.test(value);
}

function configRef(db: Firestore) {
  return doc(db, 'config', 'justtcg');
}

/** Список из документа: битые записи пропускаются, лишние сверх десяти — тоже. */
export function clubKeysFrom(data: DocumentData | undefined): ClubKey[] {
  const items: unknown = data?.items;
  if (!Array.isArray(items)) return [];
  return items
    .flatMap((item: unknown): ClubKey[] => {
      const entry = item as Partial<ClubKey> | null;
      if (!entry || typeof entry.key !== 'string' || !validKeyText(entry.key)) return [];
      return [
        {
          key: entry.key,
          label: typeof entry.label === 'string' ? entry.label.slice(0, MAX_LABEL) : '',
          enabled: entry.enabled !== false,
          addedAt: entry.addedAt instanceof Timestamp ? entry.addedAt : Timestamp.now(),
        },
      ];
    })
    .slice(0, MAX_CLUB_KEYS);
}

export async function readClubKeys(db: Firestore): Promise<ClubKey[]> {
  return clubKeysFrom((await getDoc(configRef(db))).data());
}

const TTL = 5 * 60_000;
let cached: { at: number; keys: Promise<string[]> } | null = null;

/**
 * Включённые ключи по порядку — для запросов. Одно чтение Firestore на страницу раз в пять
 * минут; без связи или без доступа ключей нет, и цены JustTCG просто не освежаются.
 */
export function activeClubKeys(db: Firestore, now = Date.now()): Promise<string[]> {
  if (cached && now - cached.at < TTL) return cached.keys;
  const keys = readClubKeys(db)
    .then((items) => items.filter((item) => item.enabled).map((item) => item.key))
    .catch(() => {
      cached = null;
      return [] as string[];
    });
  cached = { at: now, keys };
  return keys;
}

/** Сохраняет весь список целиком: так проще правилам и не бывает полузаписанной очереди. */
export async function saveClubKeys(db: Firestore, uid: string, items: ClubKey[]): Promise<void> {
  const clean = items.slice(0, MAX_CLUB_KEYS).map(({ key, label, enabled, addedAt }) => ({
    key: key.trim(),
    label: label.trim().slice(0, MAX_LABEL),
    enabled,
    addedAt,
  }));
  await setDoc(configRef(db), { items: clean, updatedAt: serverTimestamp(), updatedBy: uid });
  cached = { at: Date.now(), keys: Promise.resolve(clean.filter((item) => item.enabled).map((item) => item.key)) };
}

/** Ключ с маской для экрана: tcg_••••a1b2. */
export function maskKey(key: string): string {
  const prefix = /^[a-z]+_/i.exec(key)?.[0] ?? '';
  return `${prefix}••••${key.slice(-4)}`;
}
