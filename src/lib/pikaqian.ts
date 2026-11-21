import { cached } from '@/lib/kv-cache';
import { normalizeNumber } from '@/lib/matching';

/**
 * Цены и английские имена китайских карт для КНР из PikaQian (https://pikaqian.com): сайт
 * собирает продажи этих карт на eBay и цены Cardmarket и пересчитывает их раз в сутки.
 * Их API платный (данные с ключом, цены — от $20 в месяц), а страница сета отдаёт те же
 * данные без ключа: https://pikaqian.com/sets/{код}.data — ответ загрузчика React Router
 * в формате turbo-stream (плоский массив со ссылками по индексам, см. decodeTurboStream).
 * Cloudflare у них только CDN, проверки на бота нет (проверено 21 ноября 2026). CORS нет,
 * поэтому у расширения есть host_permissions на https://pikaqian.com/* (wxt.config.ts).
 * Это адрес их собственной страницы, он может поменяться без предупреждения: тогда цен
 * и английских имён просто нет, каталог и сканы от него не зависят.
 *
 * Код сета у них — код товара в нижнем регистре: CSV1C → csv1c. Есть 132 из 246 товаров
 * официальной базы: все бустеры и стартовые наборы, а промо и коробки — не все.
 */

const SITE = 'https://pikaqian.com';
const DAY = 24 * 60 * 60 * 1000;

/** Карта PikaQian: каждая печать — отдельная запись, we_chat_id — ID печати в официальной базе. */
export type PikaqianCard = {
  weChatId: number | null;
  number: string;
  name: string;
  englishName: string | null;
  /** Последняя продажа на eBay без грейда, в долларах */
  raw: number | null;
  /** Цена Cardmarket, пересчитанная ими в доллары; освежается каждый день */
  cardmarket: number | null;
  /** Сколько продаж учтено недавно */
  recentSales: number;
  updatedAt: string | null;
};

// turbo-stream: служебные отрицательные индексы
const NULL = -5;

/**
 * Разбор первой строки turbo-stream. Объект — {"_N": M}: ключ — строка под индексом N,
 * значение — под индексом M; массив — индексы элементов. Типы вроде дат («D») и промисов
 * («P») приходят массивом с буквой в начале; нам они не нужны и становятся null.
 */
export function decodeTurboStream(text: string): unknown {
  const line = text.split('\n', 1)[0] ?? '';
  const flat = JSON.parse(line) as unknown[];
  if (!Array.isArray(flat)) return null;
  const memo = new Map<number, unknown>();
  const hydrate = (index: number): unknown => {
    if (index < 0) return index === NULL ? null : undefined;
    if (memo.has(index)) return memo.get(index);
    const value = flat[index];
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') return null;
      const out: unknown[] = [];
      memo.set(index, out);
      for (const item of value) out.push(typeof item === 'number' ? hydrate(item) : null);
      return out;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      memo.set(index, out);
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const name = flat[Number(key.slice(1))];
        if (typeof name === 'string' && typeof item === 'number') out[name] = hydrate(item);
      }
      return out;
    }
    return value;
  };
  return hydrate(0);
}

const cents = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) / 100 : null;

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Карты из ответа страницы сета; null — ответ не той формы. */
export function pikaqianCardsFrom(decoded: unknown): PikaqianCard[] | null {
  const root = decoded as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') return null;
  const route = Object.entries(root).find(([key]) => key.startsWith('routes/sets'))?.[1] as { data?: { cards?: unknown } } | undefined;
  const cards = route?.data?.cards;
  if (!Array.isArray(cards)) return null;
  return cards.flatMap((item): PikaqianCard[] => {
    const card = item as Record<string, unknown> | null;
    if (!card || typeof card !== 'object') return [];
    const price = (card.current_price ?? {}) as Record<string, unknown>;
    const weChatId = typeof card.we_chat_id === 'number' ? card.we_chat_id : null;
    return [
      {
        weChatId,
        number: str(card.card_number) ?? '',
        name: str(card.native_card_name) ?? '',
        englishName: str(card.english_card_name),
        raw: cents(price.raw_price_cents),
        cardmarket: cents(price.cardmarket_price_cents),
        recentSales: typeof price.recent_sale_count === 'number' ? price.recent_sale_count : 0,
        updatedAt: str(price.updated_at),
      },
    ];
  });
}

/** Код сета PikaQian из кода товара официальной базы. */
export function pikaqianSetId(setId: string): string {
  return setId.trim().toLowerCase();
}

/**
 * Карты сета прямо с сайта, без кэша; null — такого сета у них нет. Ошибка сети или ответ
 * не той формы — исключение: вызывающий решит, оставить ли вчерашние цены.
 */
export async function fetchPikaqianSet(setId: string): Promise<PikaqianCard[] | null> {
  const response = await fetch(`${SITE}/sets/${encodeURIComponent(pikaqianSetId(setId))}.data`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`PikaQian ответил ${response.status}`);
  const cards = pikaqianCardsFrom(decodeTurboStream(await response.text()));
  if (!cards) throw new Error('PikaQian прислал ответ не той формы');
  return cards;
}

/**
 * Цена карты в долларах: Cardmarket (его PikaQian освежает каждый день), а если его нет —
 * последняя продажа на eBay. Продажи китайских карт на eBay редки, и последняя может быть
 * годичной давности, поэтому Cardmarket идёт первым.
 */
export function pikaqianPrice(card: Pick<PikaqianCard, 'raw' | 'cardmarket'>): number | null {
  return card.cardmarket ?? card.raw;
}

/**
 * Печать карты каталога среди карт PikaQian: сначала по ID печати в официальной базе,
 * потом по номеру и имени. prints — печати карты, обычная первой.
 */
export function matchPikaqian(
  cards: readonly PikaqianCard[],
  card: { localId: string; name: string; prints: ReadonlyArray<{ o: number }> },
): PikaqianCard | null {
  for (const print of card.prints) {
    const found = cards.find((item) => item.weChatId === print.o);
    if (found) return found;
  }
  const number = normalizeNumber(card.localId);
  const sameNumber = cards.filter((item) => normalizeNumber(item.number) === number);
  return sameNumber.find((item) => item.name === card.name) ?? null;
}

/**
 * Английские имена карт сета (номер без нулей и имя → английское имя), с кэшем на неделю.
 * Имена не меняются, а запрос к сайту тяжёлый (страница сета — до 1 МБ).
 */
export function pikaqianNames(setId: string): Promise<Record<string, string>> {
  return cached(`pikaqian:names:${pikaqianSetId(setId)}`, 7 * DAY, async () => {
    const cards = (await fetchPikaqianSet(setId)) ?? [];
    const names: Record<string, string> = {};
    for (const card of cards) {
      if (!card.englishName) continue;
      if (card.weChatId !== null) names[`#${card.weChatId}`] = card.englishName;
      names[`${normalizeNumber(card.number)}|${card.name}`] ??= card.englishName;
    }
    return names;
  });
}

/** Английское имя карты каталога: по ID печати, потом по номеру и имени. */
export function englishNameFrom(
  names: Record<string, string>,
  card: { localId: string; name: string; prints: ReadonlyArray<{ o: number }> },
): string | null {
  for (const print of card.prints) {
    const found = names[`#${print.o}`];
    if (found) return found;
  }
  return names[`${normalizeNumber(card.localId)}|${card.name}`] ?? null;
}
