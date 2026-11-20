import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { cardCacheKey } from '@/lib/catalog';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import type { TcgdexLanguage } from '@/lib/languages';
import { tcgdexApi, type CardDetail, type TcgplayerPrice } from '@/lib/tcgdex';

/** Цена карты: u — рыночная на TCGplayer в долларах, e — тренд на Cardmarket в евро. */
export type CardPrice = { u: number | null; e: number | null };

/** Цена в общем кэше клуба: d — день, за который она получена (UTC). */
export type StoredPrice = CardPrice & { d: string };

/** Карта в каталоге TCGdex: у японских карт свой каталог и свои цены (только Cardmarket). */
export type CardRef = { cardId: string; setId: string; lang: TcgdexLanguage };

/** День по UTC в виде «2026-11-20»: цены освежаются раз в такой день. */
export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Документ общего кэша prices/{id}: у английского каталога — ID сета, у остальных — с языком каталога. */
export function priceDocId(lang: TcgdexLanguage, setId: string): string {
  return lang === 'en' ? setId : `${lang}_${setId}`;
}

/** Ключ цены карты в ответе loadPrices: ID карт японского и тайваньского каталогов совпадают. */
export function priceKey(lang: TcgdexLanguage, cardId: string): string {
  return lang === 'en' ? cardId : `${lang}:${cardId}`;
}

function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

/**
 * Цена из ответа TCGdex. У TCGplayer цены лежат по вариантам печати: для голо-карты
 * сначала смотрим holofoil, для обычной — normal, дальше остальные варианты.
 * У японских карт TCGplayer пуст, есть только Cardmarket.
 */
export function priceFromCard(card: Pick<CardDetail, 'pricing' | 'variants'>): CardPrice {
  const tcgplayer = (card.pricing?.tcgplayer ?? {}) as Record<string, TcgplayerPrice | undefined>;
  const holoFirst = Boolean(card.variants?.holo) && !card.variants?.normal;
  const order = holoFirst
    ? ['holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil', 'unlimitedHolofoil', '1stEditionNormal']
    : ['normal', 'holofoil', 'reverseHolofoil', 'unlimited', '1stEditionNormal', '1stEditionHolofoil'];
  let usd: number | null = null;
  for (const key of order) {
    usd = money(tcgplayer[key]?.marketPrice) ?? money(tcgplayer[key]?.midPrice);
    if (usd !== null) break;
  }
  const cardmarket = card.pricing?.cardmarket;
  return { u: usd, e: money(cardmarket?.trend) ?? money(cardmarket?.avg) };
}

export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

type LocalPrices = { day: string; cards: Record<string, CardPrice> };

/**
 * Цены карт одного сета. Порядок самый экономный:
 * 1) кэш этого браузера на сегодня — без запросов вообще;
 * 2) общий кэш клуба prices/{setId} в Firestore — одно чтение на сет;
 * 3) у TCGdex только то, что сегодня ещё никто не освежал, и сразу запись в общий кэш
 *    и в историю prices/{setId}/months/{yyyy-mm}, из которой потом строятся графики.
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
  const shared = ((await getDoc(sharedRef)).data()?.cards ?? {}) as Record<string, StoredPrice>;
  const stale: string[] = [];
  for (const id of cardIds) {
    const stored = shared[id];
    if (stored) result.set(id, { u: stored.u, e: stored.e });
    if (stored?.d !== today) stale.push(id);
  }

  if (stale.length > 0) {
    const fresh = await mapLimit(stale, 4, async (id) => {
      try {
        const card = await tcgdexApi.card(id, lang);
        void cachePut(cardCacheKey(id, lang), card);
        return [id, priceFromCard(card)] as const;
      } catch {
        return null; // карта останется со вчерашней ценой
      }
    });
    const updates: Record<string, StoredPrice> = {};
    const history: Record<string, Record<string, CardPrice>> = {};
    for (const entry of fresh) {
      if (!entry) continue;
      const [id, price] = entry;
      result.set(id, price);
      updates[id] = { ...price, d: today };
      history[id] = { [today.slice(8)]: price };
    }
    if (Object.keys(updates).length > 0) {
      const batch = writeBatch(db);
      batch.set(sharedRef, { cards: updates }, { merge: true });
      batch.set(doc(db, 'prices', docId, 'months', today.slice(0, 7)), history, { merge: true });
      // Запись в общий кэш — не обязательная часть показа цены
      await batch.commit().catch((error: unknown) => console.warn('[binder] цены не сохранены', error));
    }
  }

  const cards: Record<string, CardPrice> = { ...(local?.day === today ? local.cards : {}) };
  for (const [id, price] of result) cards[id] = price;
  void cachePut<LocalPrices>(localKey, { day: today, cards });
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
