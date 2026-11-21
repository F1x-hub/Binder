import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { activeClubKeys } from '@/lib/club-keys';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import { namesMatch, normalizeNumber } from '@/lib/matching';
import {
  jpPriceDocId,
  priceFor,
  refreshJapaneseSet,
  serverManaged,
  utcDay,
  type JapaneseRef,
  type StoredJapanesePrice,
} from '@/lib/price-refresh';
import { commitPrices, pricesReadOnly } from '@/lib/prices';

// Чистая часть (поиск в JustTCG, форма записей) лежит в price-refresh.ts: её же использует
// ежедневная задача scripts/refresh-prices.ts. Здесь — то, что делает браузер.
export { jpPriceDocId, priceFor } from '@/lib/price-refresh';
export type { JapaneseRef, StoredJapanesePrice } from '@/lib/price-refresh';

type LocalCache = { day: string; cards: Record<string, StoredJapanesePrice> };

/**
 * Цены одного японского сета. Как у цен TCGdex: кэш браузера на сегодня → общий кэш клуба
 * prices/jt_{КОД} (одно чтение) → JustTCG по ключам клуба. Известные карты обновляются
 * пакетом по 20 за запрос, новые ищутся по одной. Свежее сразу пишется в общий кэш
 * и в историю prices/jt_{КОД}/months/{ГГГГ-ММ}. Без ключей видна последняя известная цена,
 * а если JustTCG не ответил — вчерашняя. Документ, который освежает ежедневная задача
 * (поле server), и любой документ при правилах «только чтение» браузер только читает:
 * запросы JustTCG клуба остаются задаче.
 */
async function setPrices(db: Firestore, apiKeys: string[], setCode: string, refs: JapaneseRef[], today: string) {
  const docId = jpPriceDocId(setCode);
  const localKey = `prices:${docId}`;
  const numbers = [...new Set(refs.map((ref) => normalizeNumber(ref.number)))];
  const local = await cacheGet<LocalCache>(localKey, Number.POSITIVE_INFINITY);
  if (local?.day === today && numbers.every((number) => local.cards[number]?.d === today)) return local.cards;

  const sharedRef = doc(db, 'prices', docId);
  const data = (await getDoc(sharedRef)).data();
  const known = { ...((data?.cards ?? {}) as Record<string, StoredJapanesePrice>) };
  if (serverManaged(data, today) || pricesReadOnly()) return known;
  const stale = numbers.filter((number) => known[number]?.d !== today);

  if (stale.length > 0 && apiKeys.length > 0) {
    const { fresh, history, error } = await refreshJapaneseSet(apiKeys, setCode, refs, known, today);
    if (error) console.warn('[binder] JustTCG:', error.reason);
    if (Object.keys(fresh).length > 0) {
      Object.assign(known, fresh);
      const batch = writeBatch(db);
      batch.set(sharedRef, { cards: fresh }, { merge: true });
      if (Object.keys(history).length > 0) batch.set(doc(db, 'prices', docId, 'months', today.slice(0, 7)), history, { merge: true });
      await commitPrices(batch, 'цены JustTCG');
    }
  }

  // В кэш браузера на сегодня — только если всё свежее, иначе завтра цена освежится
  if (numbers.every((number) => known[number]?.d === today)) void cachePut<LocalCache>(localKey, { day: today, cards: known });
  return known;
}

/** Цены японских карт в долларах по ключам refs. Нет цены — нет ключа в ответе. */
export async function loadJapanesePrices(db: Firestore, refs: JapaneseRef[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (refs.length === 0) return result;
  const today = utcDay();
  const apiKeys = await activeClubKeys(db);
  const bySet = new Map<string, JapaneseRef[]>();
  for (const ref of refs) {
    const code = ref.setCode.trim().toUpperCase();
    bySet.set(code, [...(bySet.get(code) ?? []), ref]);
  }
  await Promise.all(
    [...bySet].map(async ([code, list]) => {
      const cards = await setPrices(db, apiKeys, code, list, today).catch((error: unknown) => {
        console.warn('[binder] цены японских карт недоступны', error);
        return {} as Record<string, StoredJapanesePrice>;
      });
      for (const ref of list) {
        const price = priceFor(ref, cards[normalizeNumber(ref.number)]);
        if (price !== null) result.set(ref.key, price);
      }
    }),
  );
  return result;
}

/**
 * ID японской карты в JustTCG для страницы карточки: из кэша браузера, иначе из общего кэша
 * (одно чтение). Ищет карту loadJapanesePrices или ежедневная задача; здесь поиска нет.
 * У карты, добавленной как есть, ID берётся, только если её английское имя совпало.
 */
export async function japaneseMarketId(db: Firestore, ref: JapaneseRef): Promise<string | null> {
  const docId = jpPriceDocId(ref.setCode);
  const number = normalizeNumber(ref.number);
  const local = await cacheGet<LocalCache>(`prices:${docId}`, Number.POSITIVE_INFINITY).catch(() => null);
  let stored = local?.cards[number];
  if (!stored?.j) {
    const shared = ((await getDoc(doc(db, 'prices', docId))).data()?.cards ?? {}) as Record<string, StoredJapanesePrice>;
    stored = shared[number];
  }
  if (!stored?.j) return null;
  if (ref.verifyName && !(ref.englishName && stored.n && namesMatch(ref.englishName, stored.n) >= 0.8)) return null;
  return stored.j;
}
