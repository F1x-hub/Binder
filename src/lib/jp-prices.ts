import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore';
import {
  JusttcgError,
  findJusttcgCard,
  pickPrice,
  refreshJusttcgCards,
  type Printing,
  type PrintingPrices,
} from '@/lib/justtcg';
import { activeClubKeys } from '@/lib/club-keys';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import { namesMatch, normalizeNumber } from '@/lib/matching';
import { utcDay } from '@/lib/prices';

/**
 * Японская карта, которой нужна цена в долларах: код сета и номер (из TCGdex, Limitless или
 * напечатанные), английское имя и печать. verifyName — карта добавлена как есть, и её код
 * сета мог быть прочитан неверно: цена берётся, только если английское имя совпало.
 */
export type JapaneseRef = {
  /** Ключ в ответе, например ID документа альбома */
  key: string;
  setCode: string;
  number: string;
  /** Число после дроби: помогает найти карту в JustTCG по номеру «003/021» */
  total: string | null;
  englishName: string | null;
  /** Английское имя, если его нет под рукой (у японских карт TCGdex): нужно только при первом поиске */
  resolveEnglishName?: () => Promise<string | null>;
  printing: Printing;
  verifyName: boolean;
};

/**
 * Запись общего кэша про карту JustTCG под кодом сета и номером: d — день (UTC), j — её ID
 * в JustTCG (null — не нашлась), n — имя, v — цены Near Mint по печатям. Запись описывает
 * карту в базе, а не чью-то карту в альбоме: проверять имя своей карты каждый будет сам.
 */
export type StoredJapanesePrice = { d: string; j: string | null; n: string | null; v: PrintingPrices };

/** Документ общего кэша: prices/jt_{КОД СЕТА}. */
export function jpPriceDocId(setCode: string): string {
  return `jt_${setCode.trim().toUpperCase()}`.slice(0, 40);
}

/** Цена своей карты из записи о карте в базе: печать и, если нужно, совпадение имени. */
export function priceFor(ref: Pick<JapaneseRef, 'englishName' | 'printing' | 'verifyName'>, stored: StoredJapanesePrice | undefined): number | null {
  if (!stored?.j) return null;
  if (ref.verifyName && !(ref.englishName && stored.n && namesMatch(ref.englishName, stored.n) >= 0.8)) return null;
  return pickPrice(stored.v ?? {}, ref.printing);
}

type LocalCache = { day: string; cards: Record<string, StoredJapanesePrice> };

/**
 * Цены одного японского сета. Как у цен TCGdex: кэш браузера на сегодня → общий кэш клуба
 * prices/jt_{КОД} (одно чтение) → JustTCG, если у участника есть ключ. Известные карты
 * обновляются пакетом по 20 за запрос, новые ищутся по одной. Свежее сразу пишется
 * в общий кэш и в историю prices/jt_{КОД}/months/{ГГГГ-ММ}. Без ключа видна последняя
 * известная цена, а если JustTCG не ответил — вчерашняя.
 */
async function setPrices(db: Firestore, apiKeys: string[], setCode: string, refs: JapaneseRef[], today: string) {
  const docId = jpPriceDocId(setCode);
  const localKey = `prices:${docId}`;
  const numbers = [...new Set(refs.map((ref) => normalizeNumber(ref.number)))];
  const local = await cacheGet<LocalCache>(localKey, Number.POSITIVE_INFINITY);
  if (local?.day === today && numbers.every((number) => local.cards[number]?.d === today)) return local.cards;

  const sharedRef = doc(db, 'prices', docId);
  const known = { ...(((await getDoc(sharedRef)).data()?.cards ?? {}) as Record<string, StoredJapanesePrice>) };
  const stale = numbers.filter((number) => known[number]?.d !== today);

  if (stale.length > 0 && apiKeys.length > 0) {
    const fresh: Record<string, StoredJapanesePrice> = {};
    try {
      const withId = stale.filter((number) => known[number]?.j);
      if (withId.length > 0) {
        const prices = await refreshJusttcgCards(
          apiKeys,
          withId.map((number) => known[number]!.j!),
        );
        for (const number of withId) {
          const entry = known[number]!;
          const found = prices.get(entry.j!);
          if (found) fresh[number] = { ...entry, d: today, v: found };
        }
      }
      for (const number of stale.filter((item) => !known[item]?.j)) {
        const ref = refs.find((item) => normalizeNumber(item.number) === number)!;
        const englishName = ref.englishName ?? (await ref.resolveEnglishName?.().catch(() => null)) ?? null;
        const found = await findJusttcgCard(apiKeys, setCode, ref.number, { englishName, total: ref.total });
        fresh[number] = found
          ? { d: today, j: found.cardId, n: found.name, v: found.prices }
          : { d: today, j: null, n: null, v: {} };
      }
    } catch (error) {
      // Лимит на сегодня, нет связи или ключ не подошёл: показываем последнее известное
      if (!(error instanceof JusttcgError)) throw error;
      console.warn('[binder] JustTCG:', error.reason);
    }
    if (Object.keys(fresh).length > 0) {
      Object.assign(known, fresh);
      const history: Record<string, Record<string, PrintingPrices>> = {};
      for (const [number, entry] of Object.entries(fresh)) {
        if (Object.keys(entry.v).length > 0) history[number] = { [today.slice(8)]: entry.v };
      }
      const batch = writeBatch(db);
      batch.set(sharedRef, { cards: fresh }, { merge: true });
      if (Object.keys(history).length > 0) batch.set(doc(db, 'prices', docId, 'months', today.slice(0, 7)), history, { merge: true });
      await batch.commit().catch((error: unknown) => console.warn('[binder] цены JustTCG не сохранены', error));
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
 * (одно чтение). Ищет карту loadJapanesePrices, когда показывает её цену; здесь поиска нет.
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
