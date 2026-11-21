import {
  JusttcgError,
  findJusttcgCard,
  pickPrice,
  refreshJusttcgCards,
  type JusttcgAuth,
  type Printing,
  type PrintingPrices,
} from '@/lib/justtcg';
import type { TcgdexLanguage } from '@/lib/languages';
import { namesMatch, normalizeNumber } from '@/lib/matching';
import { tcgdexApi, type CardDetail, type TcgplayerPrice } from '@/lib/tcgdex';

/**
 * Освежение цен без Firestore и без браузера: что спросить у TCGdex и JustTCG и в каком виде
 * это лежит в общем кэше prices/… и в истории prices/…/months/{ГГГГ-ММ}. Этим пользуются и
 * браузер (src/lib/prices.ts, src/lib/jp-prices.ts), и ежедневная задача в GitHub Actions
 * (scripts/refresh-prices.ts): форма документов у них одна, клиент читает их без изменений.
 */

/** Цена карты: u — рыночная на TCGplayer в долларах, e — тренд на Cardmarket в евро. */
export type CardPrice = { u: number | null; e: number | null };

/** Цена в общем кэше клуба: d — день, за который она получена (UTC). */
export type StoredPrice = CardPrice & { d: string };

/** Карта в каталоге TCGdex: у японских карт свой каталог и свои цены (только Cardmarket). */
export type CardRef = { cardId: string; setId: string; lang: TcgdexLanguage };

/**
 * Документ prices/… освежает ежедневная задача: поле server — день (UTC), когда она его писала.
 * Пока отметка свежая, браузер цены не освежает и не пишет, а только читает. Если задача
 * не приходила дольше SERVER_STALE_DAYS, браузер снова показывает свежие цены сам.
 */
export const SERVER_FIELD = 'server';
export const SERVER_STALE_DAYS = 2;

/** День по UTC в виде «2026-11-20»: цены освежаются раз в такой день. */
export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Документ освежает задача, и она приходила не позже SERVER_STALE_DAYS дней назад. */
export function serverManaged(data: Record<string, unknown> | undefined, today: string): boolean {
  const day = data?.[SERVER_FIELD];
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  return age <= SERVER_STALE_DAYS;
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

/** Свежие цены одного сета TCGdex: запись в prices/{docId}.cards и в историю за день. */
export type TcgdexRefresh = {
  /** Цена каждой карты, которую TCGdex отдал */
  prices: Map<string, CardPrice>;
  /** Карточки TCGdex целиком: браузер кладёт их в свой кэш, задача берёт из них номер и число карт */
  details: Map<string, CardDetail>;
  /** cards.{ID} = {u, e, d} */
  updates: Record<string, StoredPrice>;
  /** {ID}.{ДД} = {u, e} — документ prices/{docId}/months/{ГГГГ-ММ} */
  history: Record<string, Record<string, CardPrice>>;
};

/** Цены карт одного каталога TCGdex, по 4 запроса за раз. Карта, которую TCGdex не отдал, просто пропускается. */
export async function refreshTcgdexPrices(lang: TcgdexLanguage, cardIds: string[], today: string): Promise<TcgdexRefresh> {
  const fresh = await mapLimit(cardIds, 4, async (id) => {
    try {
      return [id, await tcgdexApi.card(id, lang)] as const;
    } catch {
      return null; // карта останется со вчерашней ценой
    }
  });
  const result: TcgdexRefresh = { prices: new Map(), details: new Map(), updates: {}, history: {} };
  for (const entry of fresh) {
    if (!entry) continue;
    const [id, card] = entry;
    const price = priceFromCard(card);
    result.details.set(id, card);
    result.prices.set(id, price);
    result.updates[id] = { ...price, d: today };
    result.history[id] = { [today.slice(8)]: price };
  }
  return result;
}

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

/** Свежие записи одного японского сета и то, почему освежились не все. */
export type JapaneseRefresh = {
  /** cards.{номер} — что записать в prices/jt_{КОД} */
  fresh: Record<string, StoredJapanesePrice>;
  /** {номер}.{ДД} = цены по печатям — документ prices/jt_{КОД}/months/{ГГГГ-ММ} */
  history: Record<string, Record<string, PrintingPrices>>;
  /** JustTCG отказал (лимит, нет связи, ключ не подошёл): часть карт осталась со старой ценой */
  error: JusttcgError | null;
};

/**
 * Цены одного японского сета из JustTCG. known — что уже лежит в prices/jt_{КОД}.cards.
 * Известные карты (есть ID в JustTCG) обновляются пакетом по 20 за запрос, новые ищутся
 * по одной, один раз: найденный ID дальше хранится в общем кэше. Освежаются только номера,
 * у которых день записи не сегодняшний.
 */
export async function refreshJapaneseSet(
  auth: JusttcgAuth,
  setCode: string,
  refs: JapaneseRef[],
  known: Record<string, StoredJapanesePrice>,
  today: string,
): Promise<JapaneseRefresh> {
  const numbers = [...new Set(refs.map((ref) => normalizeNumber(ref.number)))];
  const stale = numbers.filter((number) => known[number]?.d !== today);
  const fresh: Record<string, StoredJapanesePrice> = {};
  let failure: JusttcgError | null = null;
  try {
    const withId = stale.filter((number) => known[number]?.j);
    if (withId.length > 0) {
      const prices = await refreshJusttcgCards(
        auth,
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
      const found = await findJusttcgCard(auth, setCode, ref.number, { englishName, total: ref.total });
      fresh[number] = found ? { d: today, j: found.cardId, n: found.name, v: found.prices } : { d: today, j: null, n: null, v: {} };
    }
  } catch (error) {
    // Лимит на сегодня, нет связи или ключ не подошёл: что успели — освежено, остальное ждёт
    if (!(error instanceof JusttcgError)) throw error;
    failure = error;
  }
  const history: Record<string, Record<string, PrintingPrices>> = {};
  for (const [number, entry] of Object.entries(fresh)) {
    if (Object.keys(entry.v).length > 0) history[number] = { [today.slice(8)]: entry.v };
  }
  return { fresh, history, error: failure };
}
