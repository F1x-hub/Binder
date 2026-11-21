import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { jpPriceDocId } from '@/lib/jp-prices';
import { pickPrice, type PrintingPrices } from '@/lib/justtcg';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import { normalizeNumber } from '@/lib/matching';
import { countLabel, type WordForms } from '@/lib/format';
import { historyMonths, type PricePoint } from '@/lib/price-history';
import { mapLimit, priceDocId, utcDay, type CardPrice } from '@/lib/prices';
import { japaneseRefs, type CardView } from '@/lib/useCardViews';

/**
 * История стоимости альбома по дням: сколько стоил бы текущий альбом (его карты и копии)
 * по ценам каждого дня. Цены — из истории, которую клуб копит сам с 20 ноября 2026:
 * prices/{сет}/months/{ГГГГ-ММ} (TCGdex) и prices/jt_{КОД}/months/{ГГГГ-ММ} (доллары
 * JustTCG у японских карт). Новых записей в Firestore нет, только чтение месяцев.
 *
 * Доллары и евро не смешиваются, как в итогах альбома (collectionTotals): карта идёт
 * в долларовый ряд, если у неё сейчас есть цена TCGplayer, иначе — в евро, если есть
 * Cardmarket. Так состав каждого ряда один и тот же во все дни.
 */

/** Карта альбома для истории: копии, ряд, нынешняя цена и известные цены по дням «ГГГГ-ММ-ДД». */
export type HistoryCard = {
  count: number;
  currency: 'usd' | 'eur';
  current: number;
  days: Record<string, number>;
};

/** Месячные документы истории: ID документа цен → месяц «ГГГГ-ММ» → данные документа. */
export type MonthDocs = Map<string, Map<string, Record<string, unknown>>>;

/** Документы цен, нужные для истории альбома: TCGdex — по сетам каталога, JustTCG — по кодам японских сетов. */
export function historyDocIds(views: CardView[]): string[] {
  const ids = new Set<string>();
  for (const view of views) {
    if (view.cardId && view.catalog && !view.approximate && view.price) ids.add(priceDocId(view.catalog, view.setId));
  }
  for (const ref of japaneseUsdRefs(views)) ids.add(jpPriceDocId(ref.setCode));
  return [...ids];
}

/** Японские карты с долларами JustTCG; у карты, добавленной как есть, — только если её имя сошлось сейчас (price.u). */
function japaneseUsdRefs(views: CardView[]) {
  const priced = new Map(views.map((view) => [view.docId, view]));
  return japaneseRefs(views).filter((ref) => priced.get(ref.key)?.price?.u != null);
}

const day = (month: string, dd: string) => `${month}-${dd.padStart(2, '0')}`;

/** Цены карт альбома по дням из месячных документов. Карты без нынешней цены в историю не идут. */
export function historyCards(views: CardView[], docs: MonthDocs): HistoryCard[] {
  const japanese = new Map(japaneseUsdRefs(views).map((ref) => [ref.key, ref]));
  return views.flatMap((view): HistoryCard[] => {
    const price = view.price;
    const currency = price?.u != null ? 'usd' : price?.e != null ? 'eur' : null;
    if (!price || !currency) return [];
    const days: Record<string, number> = {};

    if (view.cardId && view.catalog && !view.approximate) {
      for (const [month, data] of docs.get(priceDocId(view.catalog, view.setId)) ?? []) {
        const byDay = (data[view.cardId] ?? {}) as Record<string, CardPrice>;
        for (const [dd, entry] of Object.entries(byDay)) {
          const value = currency === 'usd' ? entry?.u : entry?.e;
          if (typeof value === 'number' && value > 0) days[day(month, dd)] = value;
        }
      }
    }

    // Доллары JustTCG — там, где у TCGdex долларов за этот день нет (у японских карт их нет вовсе)
    const ref = currency === 'usd' ? japanese.get(view.docId) : undefined;
    if (ref) {
      const number = normalizeNumber(ref.number);
      for (const [month, data] of docs.get(jpPriceDocId(ref.setCode)) ?? []) {
        const byDay = (data[number] ?? {}) as Record<string, PrintingPrices>;
        for (const [dd, prices] of Object.entries(byDay)) {
          const value = pickPrice(prices ?? {}, ref.printing);
          const key = day(month, dd);
          if (value !== null && value > 0 && !(key in days)) days[key] = value;
        }
      }
    }

    return [{ count: view.count, currency, current: currency === 'usd' ? price.u! : price.e!, days }];
  });
}

const DAY_MS = 86_400_000;
const dayNumber = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) / DAY_MS;
const dayString = (number: number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * Стоимость альбома по дням, от первого дня с известной ценой до сегодня. День без цены
 * карты — её последняя известная цена; до первой известной — первая известная, иначе ряд
 * подскакивал бы в день, когда у карты впервые записали цену. Сегодня — нынешние цены
 * карт (те же, что в шапке альбома). usd или eur — null, если в ряду нет ни одной карты.
 */
export function collectionSeries(cards: HistoryCard[], today = utcDay()): PricePoint[] {
  const end = dayNumber(today);
  const prepared = cards.map((card) => {
    const known = Object.entries(card.days)
      .map(([key, value]) => [dayNumber(key), value] as const)
      .filter(([number]) => number < end)
      .sort((a, b) => a[0] - b[0]);
    return { card, known, next: 0, value: known[0]?.[1] ?? card.current };
  });
  const first = Math.min(end, ...prepared.flatMap(({ known }) => (known[0] ? [known[0][0]] : [])));
  const hasUsd = cards.some((card) => card.currency === 'usd');
  const hasEur = cards.some((card) => card.currency === 'eur');

  const points: PricePoint[] = [];
  for (let number = first; number <= end; number += 1) {
    let usd = 0;
    let eur = 0;
    for (const entry of prepared) {
      while (entry.next < entry.known.length && entry.known[entry.next]![0] <= number) {
        entry.value = entry.known[entry.next]![1];
        entry.next += 1;
      }
      const value = number === end ? entry.card.current : entry.value;
      if (entry.card.currency === 'usd') usd += value * entry.card.count;
      else eur += value * entry.card.count;
    }
    points.push({ day: dayString(number), usd: hasUsd ? cents(usd) : null, eur: hasEur ? cents(eur) : null });
  }
  return points;
}

/**
 * Изменение стоимости за days дней: от последней точки не позже, чем days дней назад, до
 * последней. Если история короче — от первой точки, и days в ответе — сколько дней на самом
 * деле. Ряд — доллары, если они есть, иначе евро, как у графика (buildChart). null — меньше
 * суток истории или нулевая стоимость в начале.
 */
export function valueChange(points: PricePoint[], days = 30): { change: number; days: number; currency: 'usd' | 'eur' } | null {
  const currency = points.some((point) => point.usd !== null) ? 'usd' : 'eur';
  const series = points.filter((point) => point[currency] !== null);
  const last = series[series.length - 1];
  if (!last) return null;
  const from = dayNumber(last.day) - days;
  const base = [...series].reverse().find((point) => dayNumber(point.day) <= from) ?? series[0]!;
  const span = dayNumber(last.day) - dayNumber(base.day);
  const start = base[currency]!;
  if (span < 1 || start <= 0) return null;
  return { change: (last[currency]! - start) / start, days: span, currency };
}

/** С какого дня клуб копит историю цен: для объяснения под пустым графиком. */
export const HISTORY_STARTED = '20 ноября 2026';

const DAY_FORMS: WordForms = ['день', 'дня', 'дней'];
const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/**
 * «▲ 12,4% за 30 дней», «▼ 3% за 12 дней», «0% за 30 дней»; days = null — без «за …».
 * В монохромных темах направление видно только по значку, поэтому он есть всегда.
 */
export function changeLabel(change: number, days: number | null): string {
  const rounded = Math.round(change * 1000) / 10;
  const sign = rounded > 0 ? '▲ ' : rounded < 0 ? '▼ ' : '';
  const text = `${sign}${percentFormat.format(Math.abs(rounded))}%`;
  return days === null ? text : `${text} за ${countLabel(days, DAY_FORMS)}`;
}

/** Изменение стоимости альбома за 30 дней для шапки: текст и направление; null — изменения пока нет. */
export function collectionChange(history: PricePoint[] | null): { text: string; direction: 'up' | 'down' | 'flat' } | null {
  const result = history ? valueChange(history, 30) : null;
  if (!result) return null;
  const rounded = Math.round(result.change * 1000);
  return { text: changeLabel(result.change, result.days), direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat' };
}

type CachedMonth = { day: string; data: Record<string, unknown> };

/**
 * Месячный документ истории закончен, если его прочитали уже в следующем месяце: пишут
 * только в месяц сегодняшнего дня. Такой лежит в кэше браузера насовсем, а текущий —
 * до конца дня (UTC).
 */
export function monthFresh(cached: CachedMonth | undefined, month: string, today: string): boolean {
  return Boolean(cached && (cached.day === today || cached.day.slice(0, 7) > month));
}

/** Чтения этой вкладки: альбом и главная просят одни и те же месяцы. */
const reading = new Map<string, Promise<Record<string, unknown> | null>>();

async function readMonth(db: Firestore, docId: string, month: string, today: string): Promise<Record<string, unknown> | null> {
  const key = `history:${docId}:${month}`;
  const cached = await cacheGet<CachedMonth>(key, Number.POSITIVE_INFINITY).catch(() => undefined);
  if (monthFresh(cached, month, today)) return cached!.data;
  try {
    const data = ((await getDoc(doc(db, 'prices', docId, 'months', month))).data() ?? {}) as Record<string, unknown>;
    void cachePut<CachedMonth>(key, { day: today, data }).catch(() => undefined);
    return data;
  } catch (error) {
    // Нет связи: лучше вчерашний месяц, чем дыра в графике; ошибка в кэш не попадает
    console.warn('[binder] история цен не прочиталась', docId, month, error);
    return cached?.data ?? null;
  }
}

/**
 * История стоимости альбома. Чтений Firestore: в первый раз — документов цен × месяцев
 * с ноября 2026 (не больше 13), потом — по одному на документ цен в сутки (текущий месяц),
 * прошлые месяцы берутся из кэша браузера. Документ цен — сет TCGdex или код японского сета.
 */
export async function loadCollectionHistory(db: Firestore, views: CardView[], today = utcDay()): Promise<PricePoint[]> {
  const ids = historyDocIds(views);
  const months = historyMonths(13, today);
  const pairs = ids.flatMap((docId) => months.map((month) => [docId, month] as const));
  const docs: MonthDocs = new Map();
  await mapLimit(pairs, 8, async ([docId, month]) => {
    const key = `${docId}|${month}|${today}`;
    let pending = reading.get(key);
    if (!pending) {
      pending = readMonth(db, docId, month, today);
      reading.set(key, pending);
      // Неудачное чтение повторится при следующем заходе
      void pending.then((data) => data === null && reading.delete(key));
    }
    const data = await pending;
    if (!data) return;
    const byMonth = docs.get(docId) ?? new Map<string, Record<string, unknown>>();
    byMonth.set(month, data);
    docs.set(docId, byMonth);
  });
  return collectionSeries(historyCards(views, docs), today);
}
