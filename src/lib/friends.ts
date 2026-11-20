import {
  Timestamp,
  collection,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { cardsOf, ownedFromDoc, type OwnedCard } from '@/lib/collection';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import { memberRef } from '@/lib/membership';
import { showcaseOf } from '@/lib/showcase';

const DAY = 24 * 60 * 60 * 1000;

/** Участник клуба глазами других: имя, фото, с какого времени в клубе и витрина. */
export type ClubMember = {
  uid: string;
  displayName: string;
  photoURL: string | null;
  joinedAt: Timestamp | null;
  showcase: string[];
};

type Stamp = { seconds: number; nanoseconds: number; toDate(): Date };

function isStamp(value: unknown): value is Stamp {
  const stamp = value as Partial<Stamp> | null;
  return typeof stamp?.seconds === 'number' && typeof stamp.nanoseconds === 'number' && typeof stamp.toDate === 'function';
}

export function clubMemberFrom(uid: string, data: DocumentData): ClubMember {
  const name = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  return {
    uid,
    displayName: name || 'Участник',
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    joinedAt: isStamp(data.joinedAt) ? (data.joinedAt as Timestamp) : null,
    showcase: showcaseOf(data),
  };
}

const collator = new Intl.Collator('ru-RU', { sensitivity: 'base' });

export function byName(a: Pick<ClubMember, 'displayName'>, b: Pick<ClubMember, 'displayName'>): number {
  return collator.compare(a.displayName, b.displayName);
}

/** Все участники клуба по имени: одно чтение на участника. Правила пускают к списку только участников. */
export async function clubMembers(db: Firestore): Promise<ClubMember[]> {
  const snapshot = await getDocs(collection(db, 'members'));
  return snapshot.docs.map((item) => clubMemberFrom(item.id, item.data())).sort(byName);
}

/** Один участник; null — такого в клубе нет. */
export async function clubMember(db: Firestore, uid: string): Promise<ClubMember | null> {
  const snapshot = await getDoc(memberRef(db, uid));
  return snapshot.exists() ? clubMemberFrom(uid, snapshot.data()) : null;
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** «в клубе с августа», а если вступил не в этом году — «в клубе с августа 2025». */
export function joinedLabel(joinedAt: Pick<Stamp, 'toDate'> | null, now = new Date()): string | null {
  if (!joinedAt) return null;
  const date = joinedAt.toDate();
  // Месяц в родительном падеже даёт только формат с числом: «21 ноября»
  const month = dayMonth.formatToParts(date).find((part) => part.type === 'month')?.value;
  if (!month) return null;
  const year = date.getFullYear();
  return year === now.getFullYear() ? `в клубе с ${month}` : `в клубе с ${month} ${year}`;
}

/** Отметка времени в кэше браузера: секунды и наносекунды, как в Firestore, без потери точности. */
type StoredStamp = [seconds: number, nanoseconds: number];

/** Документ альбома в кэше: поля как в Firestore, отметки времени — парой чисел. */
type StoredCard = Record<string, unknown> & { addedAt: StoredStamp | null; updatedAt: StoredStamp | null };

/**
 * Альбом участника в кэше этого браузера. synced — самое позднее updatedAt среди карт,
 * fullAt — когда альбом в последний раз читали целиком.
 */
export type CachedAlbum = { fullAt: number; synced: StoredStamp; cards: Record<string, StoredCard> };

export type AlbumCache = {
  get(uid: string): Promise<CachedAlbum | undefined>;
  put(uid: string, album: CachedAlbum): Promise<void>;
};

/** Раз в месяц альбом читается целиком, даже если дочитывание ничего не заметило. */
const FULL_READ_EVERY = 30 * DAY;

/** Кэш альбомов друзей в IndexedDB (src/lib/kv-cache.ts): там нет лимита chrome.storage. */
export const browserAlbumCache: AlbumCache = {
  get: (uid) => cacheGet<CachedAlbum>(`album:${uid}`, FULL_READ_EVERY),
  put: (uid, album) => cachePut(`album:${uid}`, album),
};

const EPOCH: StoredStamp = [0, 0];

function isStoredStamp(value: unknown): value is StoredStamp {
  return Array.isArray(value) && value.length === 2 && value.every((part) => Number.isInteger(part) && part >= 0);
}

/** Кэш другой версии приложения или битая запись не должны ломать загрузку: тогда альбом читается целиком. */
export function isCachedAlbum(value: unknown): value is CachedAlbum {
  const album = value as Partial<CachedAlbum> | null;
  return (
    typeof album?.fullAt === 'number' &&
    isStoredStamp(album.synced) &&
    typeof album.cards === 'object' &&
    album.cards !== null &&
    Object.values(album.cards).every(
      (card) =>
        typeof card === 'object' &&
        card !== null &&
        (card.addedAt === null || isStoredStamp(card.addedAt)) &&
        (card.updatedAt === null || isStoredStamp(card.updatedAt)),
    )
  );
}

function toStored(value: unknown): StoredStamp | null {
  return isStamp(value) ? [value.seconds, value.nanoseconds] : null;
}

function later(a: StoredStamp, b: StoredStamp | null): StoredStamp {
  if (!b) return a;
  return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a;
}

function storedCard(data: DocumentData): StoredCard {
  return { ...data, addedAt: toStored(data.addedAt), updatedAt: toStored(data.updatedAt) };
}

/** Карты альбома из кэша, как будто их только что прочитали из Firestore. */
export function cardsOfAlbum(album: CachedAlbum): OwnedCard[] {
  return Object.entries(album.cards).map(([docId, card]) =>
    ownedFromDoc(docId, {
      ...card,
      addedAt: card.addedAt ? new Timestamp(...card.addedAt) : null,
      updatedAt: card.updatedAt ? new Timestamp(...card.updatedAt) : null,
    }),
  );
}

/** Дочитанные карты поверх кэша. Удалённые карты так не видны: их выдаёт счётчик count(). */
export function mergeAlbum(saved: CachedAlbum, changed: Array<{ id: string; data: DocumentData }>): CachedAlbum {
  const merged: CachedAlbum = { ...saved, cards: { ...saved.cards } };
  for (const { id, data } of changed) {
    const card = storedCard(data);
    merged.cards[id] = card;
    merged.synced = later(merged.synced, card.updatedAt);
  }
  return merged;
}

/**
 * Альбом участника для чтения. Firestore берёт плату за каждый прочитанный документ, поэтому
 * целиком альбом читается только в первый раз (и раз в месяц). Дальше из кэша браузера
 * дочитываются только карты, изменённые с прошлого раза: запрос по updatedAt и счётчик
 * count() — по одному чтению, плюс по чтению на изменённую карту. Если карт на сервере
 * меньше, чем вышло после дочитывания, значит часть удалена, и альбом читается заново.
 */
export async function loadAlbum(
  db: Firestore,
  uid: string,
  cache: AlbumCache = browserAlbumCache,
  now = Date.now(),
): Promise<OwnedCard[]> {
  const cards = cardsOf(db, uid);
  const saved = await cache.get(uid).catch(() => undefined);
  if (isCachedAlbum(saved) && now - saved.fullAt < FULL_READ_EVERY) {
    // «>=», а не «>»: последняя карта прочитается ещё раз, но это стоит столько же, сколько пустой ответ
    const [changed, total] = await Promise.all([
      getDocs(query(cards, where('updatedAt', '>=', new Timestamp(...saved.synced)))),
      getCountFromServer(cards),
    ]);
    const merged = mergeAlbum(
      saved,
      changed.docs.map((item) => ({ id: item.id, data: item.data() })),
    );
    if (Object.keys(merged.cards).length === total.data().count) {
      const fresh = changed.docs.some((item) => {
        const before = saved.cards[item.id]?.updatedAt;
        const after = toStored(item.data().updatedAt);
        return !before || !after || before[0] !== after[0] || before[1] !== after[1];
      });
      if (fresh) await cache.put(uid, merged).catch(() => undefined);
      return cardsOfAlbum(merged);
    }
  }

  const snapshot = await getDocs(cards);
  const album = mergeAlbum(
    { fullAt: now, synced: EPOCH, cards: {} },
    snapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
  );
  await cache.put(uid, album).catch(() => undefined);
  return cardsOfAlbum(album);
}

/** Понятная причина, почему участников или альбом не получилось загрузить. */
export function friendsErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'permission-denied') return 'Нет доступа. Возможно, участие в клубе закончилось: обнови страницу.';
  return 'Не получилось загрузить данные клуба. Проверь интернет и обнови страницу.';
}

const RECENT_MS = 60 * 1000;
const recent = new Map<string, { at: number; task: Promise<OwnedCard[]> }>();

/**
 * Альбом друга для страниц: со страницы «Друзья» в профиль и обратно за минуту
 * альбом второй раз не читается. Неудачная загрузка не запоминается.
 */
export function friendAlbum(db: Firestore, uid: string): Promise<OwnedCard[]> {
  const hit = recent.get(uid);
  if (hit && Date.now() - hit.at < RECENT_MS) return hit.task;
  const task = loadAlbum(db, uid);
  recent.set(uid, { at: Date.now(), task });
  task.catch(() => recent.delete(uid));
  return task;
}
