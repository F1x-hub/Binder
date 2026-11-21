import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { cardCacheKey } from '@/lib/catalog';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import type { TcgdexLanguage } from '@/lib/languages';
import {
  refreshTcgdexPrices,
  serverManaged,
  utcDay,
  priceDocId,
  priceKey,
  type CardPrice,
  type CardRef,
  type StoredPrice,
} from '@/lib/price-refresh';

// Чистая часть (форма документов, разбор ответа TCGdex) лежит в price-refresh.ts: её же
// использует ежедневная задача scripts/refresh-prices.ts. Здесь — то, что делает браузер.
export { mapLimit, priceDocId, priceFromCard, priceKey, utcDay } from '@/lib/price-refresh';
export type { CardPrice, CardRef, StoredPrice } from '@/lib/price-refresh';

/**
 * Правила не пускают запись цен (их пишет только ежедневная задача): после первого отказа
 * браузер больше не пробует писать и не тратит запросы JustTCG клуба (src/lib/jp-prices.ts).
 */
let readOnly = false;

export function pricesReadOnly(): boolean {
  return readOnly;
}

/** Запись в общий кэш — не обязательная часть показа цены. Отказ правил — не ошибка, а режим «только чтение». */
export async function commitPrices(batch: ReturnType<typeof writeBatch>, what: string): Promise<void> {
  if (readOnly) return;
  await batch.commit().catch((error: unknown) => {
    if ((error as { code?: unknown } | null)?.code === 'permission-denied') readOnly = true;
    else console.warn(`[binder] ${what} не сохранены`, error);
  });
}

type LocalPrices = { day: string; cards: Record<string, CardPrice> };

/**
 * Цены карт одного сета. Порядок самый экономный:
 * 1) кэш этого браузера на сегодня — без запросов вообще;
 * 2) общий кэш клуба prices/{setId} в Firestore — одно чтение на сет;
 * 3) у TCGdex только то, что сегодня ещё никто не освежал, и сразу запись в общий кэш
 *    и в историю prices/{setId}/months/{yyyy-mm}, из которой потом строятся графики.
 * Документ, который освежает ежедневная задача (поле server), браузер только читает:
 * у TCGdex спрашиваются лишь карты, которых в нём ещё нет (добавлены после задачи), и без записи.
 */
async function setPrices(
  db: Firestore,
  lang: TcgdexLanguage,
  setId: string,
  cardIds: string[],
  today: string,
): Promise<Map<string, CardPrice>> {
  const result = new Map<string, CardPrice>();
  const docId = priceDocId(lang, setId);
  const localKey = `prices:${docId}`;
  const local = await cacheGet<LocalPrices>(localKey, Number.POSITIVE_INFINITY);
  if (local?.day === today && cardIds.every((id) => id in local.cards)) {
    for (const id of cardIds) result.set(id, local.cards[id]!);
    return result;
  }

  const sharedRef = doc(db, 'prices', docId);
  const data = (await getDoc(sharedRef)).data();
  const shared = (data?.cards ?? {}) as Record<string, StoredPrice>;
  const byServer = serverManaged(data, today);
  const stale: string[] = [];
  for (const id of cardIds) {
    const stored = shared[id];
    if (stored) result.set(id, { u: stored.u, e: stored.e });
    if (byServer ? !stored : stored?.d !== today) stale.push(id);
  }

  if (stale.length > 0) {
    const fresh = await refreshTcgdexPrices(lang, stale, today);
    for (const [id, card] of fresh.details) void cachePut(cardCacheKey(id, lang), card);
    for (const [id, price] of fresh.prices) result.set(id, price);
    if (!byServer && Object.keys(fresh.updates).length > 0) {
      const batch = writeBatch(db);
      batch.set(sharedRef, { cards: fresh.updates }, { merge: true });
      batch.set(doc(db, 'prices', docId, 'months', today.slice(0, 7)), fresh.history, { merge: true });
      await commitPrices(batch, 'цены');
    }
  }

  const cards: Record<string, CardPrice> = { ...(local?.day === today ? local.cards : {}) };
  for (const [id, price] of result) cards[id] = price;
  // Пока задача сегодня не приходила, цены вчерашние: не запоминаем их как сегодняшние
  if (!byServer || data?.server === today) void cachePut<LocalPrices>(localKey, { day: today, cards });
  return result;
}

/** Цены для набора карт, по сетам параллельно. Ключи ответа — priceKey(каталог, ID карты). */
export async function loadPrices(db: Firestore, cards: CardRef[]): Promise<Map<string, CardPrice>> {
  const today = utcDay();
  const bySet = new Map<string, { lang: TcgdexLanguage; setId: string; ids: Set<string> }>();
  for (const { cardId, setId, lang } of cards) {
    const key = `${lang}|${setId}`;
    const group = bySet.get(key) ?? { lang, setId, ids: new Set<string>() };
    group.ids.add(cardId);
    bySet.set(key, group);
  }
  const parts = await Promise.all(
    [...bySet.values()].map(async ({ lang, setId, ids }) => {
      const prices = await setPrices(db, lang, setId, [...ids], today);
      return [...prices].map(([id, price]) => [priceKey(lang, id), price] as const);
    }),
  );
  return new Map(parts.flat());
}
