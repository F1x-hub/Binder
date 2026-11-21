import { describe, expect, it } from 'vitest';
import {
  changeLabel,
  collectionChange,
  collectionSeries,
  historyCards,
  historyDocIds,
  monthFresh,
  valueChange,
  type HistoryCard,
  type MonthDocs,
} from '@/lib/collection-history';
import type { CardView } from '@/lib/useCardViews';

const card = (count: number, currency: 'usd' | 'eur', current: number, days: Record<string, number> = {}): HistoryCard => ({
  count,
  currency,
  current,
  days,
});

/** Карта альбома в том виде, в каком её отдаёт useCardViews (только нужные поля). */
function view(partial: Partial<CardView> & Pick<CardView, 'docId'>): CardView {
  return {
    cardId: null,
    catalog: null,
    setId: '',
    lang: 'en',
    count: 1,
    printed: null,
    name: partial.docId,
    englishName: null,
    localId: '',
    thumb: null,
    setName: '',
    printedTotal: null,
    releaseDate: null,
    price: null,
    approximate: false,
    limitless: null,
    ...partial,
  } as CardView;
}

describe('collectionSeries', () => {
  it('складывает копии × цену дня и кончается нынешними ценами', () => {
    const series = collectionSeries(
      [card(2, 'usd', 12, { '2026-11-20': 10, '2026-11-21': 11 }), card(1, 'usd', 5, { '2026-11-21': 4 })],
      '2026-11-22',
    );
    expect(series).toEqual([
      // До первой известной цены второй карты — её первая известная (4), без скачка
      { day: '2026-11-20', usd: 24, eur: null },
      { day: '2026-11-21', usd: 26, eur: null },
      { day: '2026-11-22', usd: 29, eur: null },
    ]);
  });

  it('день без цены — последняя известная', () => {
    const series = collectionSeries([card(1, 'usd', 9, { '2026-11-20': 6, '2026-11-23': 8 })], '2026-11-24');
    expect(series.map((point) => point.usd)).toEqual([6, 6, 6, 8, 9]);
  });

  it('не смешивает доллары и евро', () => {
    const series = collectionSeries([card(1, 'usd', 3, { '2026-11-20': 2 }), card(3, 'eur', 1.5, { '2026-11-20': 1 })], '2026-11-21');
    expect(series).toEqual([
      { day: '2026-11-20', usd: 2, eur: 3 },
      { day: '2026-11-21', usd: 3, eur: 4.5 },
    ]);
  });

  it('без истории — одна точка сегодня, без карт — пустые ряды', () => {
    expect(collectionSeries([card(1, 'usd', 3)], '2026-11-21')).toEqual([{ day: '2026-11-21', usd: 3, eur: null }]);
    expect(collectionSeries([], '2026-11-21')).toEqual([{ day: '2026-11-21', usd: null, eur: null }]);
  });

  it('берёт сегодня нынешнюю цену, а не записанную утром, и не видит будущих дней', () => {
    const series = collectionSeries([card(1, 'usd', 7, { '2026-11-20': 5, '2026-11-21': 6, '2026-11-25': 100 })], '2026-11-21');
    expect(series).toEqual([
      { day: '2026-11-20', usd: 5, eur: null },
      { day: '2026-11-21', usd: 7, eur: null },
    ]);
  });

  it('считает в центах без хвостов', () => {
    const series = collectionSeries([card(3, 'usd', 0.1, { '2026-11-20': 0.1 })], '2026-11-21');
    expect(series[0]!.usd).toBe(0.3);
  });
});

describe('valueChange', () => {
  const days = (count: number, from: number, step: number) =>
    Array.from({ length: count }, (_, index) => ({
      day: new Date(Date.UTC(2026, 10, 20 + index)).toISOString().slice(0, 10),
      usd: from + step * index,
      eur: null,
    }));

  it('за 30 дней — от точки 30 дней назад', () => {
    const points = days(41, 100, 1); // 20 ноября … 30 декабря
    const result = valueChange(points, 30)!;
    expect(result.days).toBe(30);
    expect(result.change).toBeCloseTo((140 - 110) / 110);
  });

  it('история короче — от первой точки, с настоящим числом дней', () => {
    const result = valueChange(days(13, 100, 2), 30)!;
    expect(result).toEqual({ change: 0.24, days: 12, currency: 'usd' });
  });

  it('одна точка или нулевая стоимость в начале — изменения нет', () => {
    expect(valueChange(days(1, 100, 0))).toBeNull();
    expect(valueChange(days(3, 0, 5))).toBeNull();
    expect(valueChange([])).toBeNull();
  });

  it('без долларов считает по евро', () => {
    const result = valueChange([
      { day: '2026-11-20', usd: null, eur: 10 },
      { day: '2026-11-21', usd: null, eur: 11 },
    ])!;
    expect(result.currency).toBe('eur');
    expect(result.change).toBeCloseTo(0.1);
  });
});

/** Число и слово идут через неразрывный пробел */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('changeLabel и collectionChange', () => {
  it('пишет значок, процент с запятой и дни', () => {
    expect(plain(changeLabel(0.124, 30))).toBe('▲ 12,4% за 30 дней');
    expect(plain(changeLabel(-0.03, 12))).toBe('▼ 3% за 12 дней');
    expect(plain(changeLabel(0.0004, 1))).toBe('0% за 1 день');
    expect(plain(changeLabel(0.05, 2))).toBe('▲ 5% за 2 дня');
    expect(plain(changeLabel(0.05, null))).toBe('▲ 5%');
  });

  it('collectionChange: направление и текст, без истории — null', () => {
    expect(collectionChange(null)).toBeNull();
    expect(
      collectionChange([
        { day: '2026-11-20', usd: 100, eur: null },
        { day: '2026-11-21', usd: 90, eur: null },
      ]),
    ).toEqual({ text: '▼ 10% за 1 день', direction: 'down' });
  });
});

describe('historyCards и historyDocIds', () => {
  const english = view({ docId: 'sv03-125', cardId: 'sv03-125', catalog: 'en', setId: 'sv03', count: 2, price: { u: 30, e: 25 } });
  const euroOnly = view({ docId: 'SV2a-006_ja', cardId: 'SV2a-006', catalog: 'ja', setId: 'SV2a', lang: 'ja', localId: '006', price: { u: null, e: 40 } });
  const jpDollars = view({ docId: 'SV2a-025_ja', cardId: 'SV2a-025', catalog: 'ja', setId: 'SV2a', lang: 'ja', localId: '025', price: { u: 3, e: 2 } });
  const similar = view({ docId: 'sv03-001_x', cardId: 'sv03-001', catalog: 'en', setId: 'sv03', lang: 'other', approximate: true, price: null });
  const unpriced = view({ docId: 'sv03-002', cardId: 'sv03-002', catalog: 'en', setId: 'sv03', price: null });

  type Month = Map<string, Record<string, unknown>>;
  const docs: MonthDocs = new Map<string, Month>([
    [
      'sv03',
      new Map<string, Record<string, unknown>>([
        ['2026-11', { 'sv03-125': { '20': { u: 28, e: 24 }, '21': { u: null, e: 24.5 } } }],
        ['2026-12', { 'sv03-125': { '1': { u: 31, e: 26 } } }],
      ]),
    ],
    ['ja_SV2a', new Map<string, Record<string, unknown>>([['2026-11', { 'SV2a-006': { '20': { u: null, e: 38 } }, 'SV2a-025': { '21': { u: null, e: 2 } } }]])],
    ['jt_SV2A', new Map<string, Record<string, unknown>>([['2026-11', { '25': { '20': { Normal: 2.5 }, '21': { Normal: 2.75, Holofoil: 9 } } }]])],
  ]);

  it('читает только документы карт с ценой: сет TCGdex и японский сет JustTCG', () => {
    expect(historyDocIds([english, euroOnly, jpDollars, similar, unpriced]).sort()).toEqual(['ja_SV2a', 'jt_SV2A', 'sv03']);
  });

  it('берёт цены своего ряда по дням, у японских — доллары JustTCG своей печати', () => {
    const cards = historyCards([english, euroOnly, jpDollars, similar, unpriced], docs);
    expect(cards).toEqual([
      { count: 2, currency: 'usd', current: 30, days: { '2026-11-20': 28, '2026-12-01': 31 } },
      { count: 1, currency: 'eur', current: 40, days: { '2026-11-20': 38 } },
      { count: 1, currency: 'usd', current: 3, days: { '2026-11-20': 2.5, '2026-11-21': 2.75 } },
    ]);
  });

  it('японская карта вне базы без долларов сейчас — не берёт чужие доллары под тем же номером', () => {
    const custom = view({
      docId: 'x-ja-SV2a-25',
      lang: 'ja',
      printed: { name: 'ピカチュウ', englishName: 'Pikachu', number: '025', total: '165', setCode: 'SV2a' },
      price: null,
    });
    expect(historyDocIds([custom])).toEqual([]);
    expect(historyCards([custom], docs)).toEqual([]);
  });
});

describe('monthFresh', () => {
  it('текущий месяц — до конца дня, прошлый — насовсем, если прочитан уже после него', () => {
    expect(monthFresh({ day: '2026-11-21', data: {} }, '2026-11', '2026-11-21')).toBe(true);
    expect(monthFresh({ day: '2026-11-20', data: {} }, '2026-11', '2026-11-21')).toBe(false);
    expect(monthFresh({ day: '2026-12-01', data: {} }, '2026-11', '2027-03-04')).toBe(true);
    // Прочитан 30 ноября: за этот день могли дописать — перечитать один раз
    expect(monthFresh({ day: '2026-11-30', data: {} }, '2026-11', '2026-12-02')).toBe(false);
    expect(monthFresh(undefined, '2026-11', '2026-11-21')).toBe(false);
  });
});
