import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { jpPriceDocId } from '@/lib/jp-prices';
import { pickPrice, type PrintingPrices } from '@/lib/justtcg';
import { normalizeNumber } from '@/lib/matching';
import { priceDocId, utcDay, type CardPrice } from '@/lib/prices';
import { japaneseRefs, type CardView } from '@/lib/useCardViews';

/**
 * История цены карты из общего кэша клуба: prices/{сет}/months/{ГГГГ-ММ} (цены TCGdex)
 * и prices/jt_{КОД}/months/{ГГГГ-ММ} (доллары JustTCG у японских карт). Истории у баз нет,
 * Binder копит её сам с 20 ноября 2026: точка появляется в день, когда карту открыл кто-то из клуба.
 */
export const HISTORY_START = '2026-11';

export type PricePoint = { day: string; usd: number | null; eur: number | null };

/** Месяцы «ГГГГ-ММ» от from до to включительно. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.split('-').map(Number) as [number, number];
  const [endYear, endMonth] = to.split('-').map(Number) as [number, number];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Последние count месяцев до текущего, но не раньше начала истории. */
export function historyMonths(count: number, today = utcDay()): string[] {
  const current = today.slice(0, 7);
  const [year, month] = current.split('-').map(Number) as [number, number];
  const startIndex = year * 12 + (month - 1) - (count - 1);
  const start = `${Math.floor(startIndex / 12)}-${String((startIndex % 12) + 1).padStart(2, '0')}`;
  return monthsBetween(start < HISTORY_START ? HISTORY_START : start, current);
}

async function monthDoc(db: Firestore, priceDoc: string, month: string): Promise<Record<string, unknown>> {
  return ((await getDoc(doc(db, 'prices', priceDoc, 'months', month))).data() ?? {}) as Record<string, unknown>;
}

/** История цены карты альбома за последние months месяцев, по дням. */
export async function loadPriceHistory(db: Firestore, view: CardView, months: number): Promise<PricePoint[]> {
  const list = historyMonths(months);
  const byDay = new Map<string, PricePoint>();
  const point = (day: string) => {
    const known = byDay.get(day) ?? { day, usd: null, eur: null };
    byDay.set(day, known);
    return known;
  };

  if (view.cardId && view.catalog && !view.approximate) {
    const priceDoc = priceDocId(view.catalog, view.setId);
    const docs = await Promise.all(list.map((month) => monthDoc(db, priceDoc, month).then((data) => [month, data] as const)));
    for (const [month, data] of docs) {
      const days = (data[view.cardId] ?? {}) as Record<string, CardPrice>;
      for (const [dd, price] of Object.entries(days)) {
        const entry = point(`${month}-${dd.padStart(2, '0')}`);
        entry.usd = price.u ?? entry.usd;
        entry.eur = price.e ?? entry.eur;
      }
    }
  }

  // Доллары JustTCG — у японских карт; у карты, добавленной как есть, — только если её имя сошлось сейчас
  const [japanese] = japaneseRefs([view]);
  if (japanese && (!japanese.verifyName || view.price?.u != null)) {
    const priceDoc = jpPriceDocId(japanese.setCode);
    const number = normalizeNumber(japanese.number);
    const docs = await Promise.all(list.map((month) => monthDoc(db, priceDoc, month).then((data) => [month, data] as const)));
    for (const [month, data] of docs) {
      const days = (data[number] ?? {}) as Record<string, PrintingPrices>;
      for (const [dd, prices] of Object.entries(days)) {
        const usd = pickPrice(prices, japanese.printing);
        const entry = point(`${month}-${dd.padStart(2, '0')}`);
        if (usd !== null && entry.usd === null) entry.usd = usd;
      }
    }
  }

  return [...byDay.values()].filter((entry) => entry.usd !== null || entry.eur !== null).sort((a, b) => a.day.localeCompare(b.day));
}

export type ChartPeriod = '1М' | '6М' | '1Г';

export const PERIOD_DAYS: Record<ChartPeriod, number> = { '1М': 30, '6М': 182, '1Г': 365 };
export const PERIOD_MONTHS: Record<ChartPeriod, number> = { '1М': 2, '6М': 7, '1Г': 13 };

export type Chart = {
  currency: 'usd' | 'eur';
  /** Точки линии в координатах 600×200 */
  line: string;
  area: string;
  /** Конец линии в процентах высоты: для кружка на последней цене */
  endTop: number;
  yLabels: [number, number, number];
  xLabels: string[];
  /** Изменение за период: 0.08 — рост на 8 % */
  change: number | null;
  first: number;
  last: number;
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «2026-11-21» → «21 ноя». */
export function shortDate(day: string): string {
  const [, month, date] = day.split('-').map(Number) as [number, number, number];
  return `${date} ${MONTHS[month - 1]}`;
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/**
 * Линия графика за период. Валюта — доллары, если они есть хоть в одной точке, иначе евро.
 * Цена от низа к верху — между линиями сетки на 160 и 40 из 200, как в макете. Меньше
 * двух точек — графика нет.
 */
export function buildChart(points: PricePoint[], period: ChartPeriod, today = utcDay()): Chart | null {
  const from = dayNumber(today) - PERIOD_DAYS[period];
  const inPeriod = points.filter((entry) => dayNumber(entry.day) >= from);
  const currency = inPeriod.some((entry) => entry.usd !== null) ? 'usd' : 'eur';
  const series = inPeriod.flatMap((entry) => {
    const value = currency === 'usd' ? entry.usd : entry.eur;
    return value === null ? [] : [{ x: dayNumber(entry.day), day: entry.day, value }];
  });
  if (series.length < 2) return null;

  let low = Math.min(...series.map((entry) => entry.value));
  let high = Math.max(...series.map((entry) => entry.value));
  if (high - low < high * 0.02) {
    // Почти ровная цена: даём ей коридор ±10 %, иначе линия прыгала бы на копейках
    low = high * 0.9;
    high = high * 1.1;
  }
  const start = series[0]!.x;
  const span = Math.max(series[series.length - 1]!.x - start, 1);
  const xy = series.map((entry) => {
    const x = ((entry.x - start) / span) * 600;
    const y = 160 - ((entry.value - low) / (high - low)) * 120;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = xy.map(([x, y]) => `${x},${y}`).join(' ');
  const labelCount = Math.min(5, series.length);
  const xLabels = Array.from({ length: labelCount }, (_, index) => {
    const target = start + (span * index) / Math.max(labelCount - 1, 1);
    const nearest = series.reduce((best, entry) => (Math.abs(entry.x - target) < Math.abs(best.x - target) ? entry : best));
    return shortDate(nearest.day);
  });
  const first = series[0]!.value;
  const last = series[series.length - 1]!.value;
  return {
    currency,
    line,
    area: `${line} 600,200 0,200`,
    endTop: xy[xy.length - 1]![1] / 2,
    yLabels: [high, (high + low) / 2, low],
    xLabels,
    change: first > 0 ? (last - first) / first : null,
    first,
    last,
  };
}
