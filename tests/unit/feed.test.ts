import { describe, expect, it } from 'vitest';
import { SESSION_GAP, buildFeed, eventSets, groupTitle } from '@/lib/feed';
import { NBSP, timeAgo } from '@/lib/format';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** Полдень 21 ноября 2026 по местному времени: тесты не зависят от часового пояса машины. */
const NOW = new Date(2026, 10, 21, 12, 0).getTime();

type Card = { docId: string; addedAt: { toMillis(): number } | null; set?: string };

const card = (docId: string, ago: number | null): Card => ({
  docId,
  addedAt: ago === null ? null : { toMillis: () => NOW - ago },
});

const nika = { uid: 'nika', name: 'Ника' };
const mark = { uid: 'mark', name: 'Марк' };

const ids = (cards: Card[]) => cards.map((item) => item.docId);

describe('buildFeed', () => {
  it('одна карта — одно событие со временем её добавления', () => {
    const feed = buildFeed([{ owner: nika, cards: [card('a', 2 * HOUR)] }]);
    expect(feed).toHaveLength(1);
    const event = feed[0]!;
    expect(event).toMatchObject({ owner: nika, at: NOW - 2 * HOUR, since: NOW - 2 * HOUR });
    expect(ids(event.cards)).toEqual(['a']);
  });

  it('карты одного захода сворачиваются в одно событие, новые сверху', () => {
    const feed = buildFeed([
      { owner: nika, cards: [card('a', 50 * MIN), card('b', 10 * MIN), card('c', 30 * MIN)] },
    ]);
    expect(feed).toHaveLength(1);
    expect(ids(feed[0]!.cards)).toEqual(['b', 'c', 'a']);
    expect(feed[0]!.at).toBe(NOW - 10 * MIN);
    expect(feed[0]!.since).toBe(NOW - 50 * MIN);
  });

  it('заход тянется цепочкой: важен перерыв между соседними картами, а не длина захода', () => {
    // Перерывы по 25 минут: всё одно событие, хотя от первой карты до последней почти два часа
    const cards = [0, 1, 2, 3, 4].map((step) => card(`c${step}`, step * 25 * MIN));
    expect(buildFeed([{ owner: nika, cards }])).toHaveLength(1);
  });

  it('перерыв дольше получаса начинает новое событие', () => {
    const feed = buildFeed([
      {
        owner: nika,
        cards: [card('new', 5 * MIN), card('edge', 5 * MIN + SESSION_GAP), card('old', 5 * MIN + SESSION_GAP + 1 + SESSION_GAP)],
      },
    ]);
    expect(feed.map((event) => ids(event.cards))).toEqual([['new', 'edge'], ['old']]);
  });

  it('карты, записанные сканером одной записью (одно время), идут в одном событии по ID', () => {
    const feed = buildFeed([{ owner: nika, cards: [card('z', HOUR), card('a', HOUR), card('m', HOUR)] }]);
    expect(feed).toHaveLength(1);
    expect(ids(feed[0]!.cards)).toEqual(['a', 'm', 'z']);
  });

  it('у разных участников события не смешиваются и идут по времени', () => {
    const feed = buildFeed([
      { owner: nika, cards: [card('n1', 3 * HOUR), card('n2', 10 * MIN)] },
      { owner: mark, cards: [card('m1', HOUR), card('m2', HOUR + 5 * MIN)] },
    ]);
    expect(feed.map((event) => [event.owner.uid, ids(event.cards)])).toEqual([
      ['nika', ['n2']],
      ['mark', ['m1', 'm2']],
      ['nika', ['n1']],
    ]);
  });

  it('при равном времени события двух участников стоят в постоянном порядке', () => {
    const feed = buildFeed([
      { owner: nika, cards: [card('n', HOUR)] },
      { owner: mark, cards: [card('m', HOUR)] },
    ]);
    expect(feed.map((event) => event.owner.uid)).toEqual(['mark', 'nika']);
  });

  it('карты без времени добавления пропускает', () => {
    const feed = buildFeed([{ owner: nika, cards: [card('pending', null), card('a', HOUR)] }]);
    expect(feed.flatMap((event) => ids(event.cards))).toEqual(['a']);
    expect(buildFeed([{ owner: nika, cards: [card('pending', null)] }])).toEqual([]);
  });

  it('пустые альбомы — пустая лента', () => {
    expect(buildFeed([{ owner: nika, cards: [] }])).toEqual([]);
    expect(buildFeed([])).toEqual([]);
  });

  it('ключ события не меняется, когда в тот же заход добавили ещё карту', () => {
    const before = buildFeed([{ owner: nika, cards: [card('a', 20 * MIN), card('b', 10 * MIN)] }]);
    const after = buildFeed([{ owner: nika, cards: [card('a', 20 * MIN), card('b', 10 * MIN), card('c', MIN)] }]);
    expect(after).toHaveLength(1);
    expect(after[0]!.key).toBe(before[0]!.key);
  });

  it('ключи разных событий различаются, даже если время совпало', () => {
    const feed = buildFeed([
      { owner: nika, cards: [card('a', HOUR)] },
      { owner: mark, cards: [card('a', HOUR)] },
    ]);
    expect(new Set(feed.map((event) => event.key)).size).toBe(2);
  });

  it('длину перерыва можно задать', () => {
    const cards = [card('a', 0), card('b', 10 * MIN)];
    expect(buildFeed([{ owner: nika, cards }], 5 * MIN)).toHaveLength(2);
  });
});

describe('eventSets', () => {
  it('сеты по числу карт, при равенстве — в порядке карт', () => {
    expect(eventSets(['151', 'Surging Sparks', 'Surging Sparks', 'MBG'])).toEqual({
      named: ['Surging Sparks', '151', 'MBG'],
      unnamed: false,
    });
  });

  it('карты без сета отмечает отдельно', () => {
    expect(eventSets([null, '151'])).toEqual({ named: ['151'], unnamed: true });
  });
});

describe('groupTitle', () => {
  it('одна или несколько карт одного сета', () => {
    expect(groupTitle(['Surging Sparks', 'Surging Sparks', 'Surging Sparks', 'Surging Sparks', 'Surging Sparks'])).toBe(
      `5${NBSP}новых карт из Surging Sparks`,
    );
    expect(groupTitle(['151', '151'])).toBe(`2${NBSP}новые карты из 151`);
    expect(groupTitle(['MBG'])).toBe(`1${NBSP}новая карта из MBG`);
  });

  it('два сета называет оба, больший первым', () => {
    expect(groupTitle(['MBG', '151', '151'])).toBe(`3${NBSP}новые карты из 151 и MBG`);
  });

  it('три сета и больше — числом', () => {
    const sets = ['a', 'b', 'c', 'd', 'a', 'a', 'b', 'c', 'd', 'a', 'b', 'c'];
    expect(groupTitle(sets)).toBe(`12${NBSP}новых карт из 4${NBSP}сетов`);
  });

  it('«из 21 сета» в родительном падеже единственного числа', () => {
    const sets = Array.from({ length: 21 }, (_, index) => `set${index}`);
    expect(groupTitle(sets)).toBe(`21${NBSP}новая карта из 21${NBSP}сета`);
  });

  it('карты вне базы без кода сета не называют сет', () => {
    expect(groupTitle([null, null])).toBe(`2${NBSP}новые карты`);
    expect(groupTitle([null, '151'])).toBe(`2${NBSP}новые карты из 2${NBSP}сетов`);
  });
});

describe('timeAgo', () => {
  it('меньше минуты и время из будущего — «только что»', () => {
    expect(timeAgo(NOW - 30 * 1000, NOW)).toBe('только что');
    expect(timeAgo(NOW + 5000, NOW)).toBe('только что');
  });

  it('минуты и часы словами, как в макете ленты', () => {
    expect(timeAgo(NOW - MIN, NOW)).toBe(`1${NBSP}минуту назад`);
    expect(timeAgo(NOW - 10 * MIN, NOW)).toBe(`10${NBSP}минут назад`);
    expect(timeAgo(NOW - 22 * MIN, NOW)).toBe(`22${NBSP}минуты назад`);
    expect(timeAgo(NOW - 59 * MIN, NOW)).toBe(`59${NBSP}минут назад`);
    expect(timeAgo(NOW - HOUR, NOW)).toBe(`1${NBSP}час назад`);
    expect(timeAgo(NOW - 2 * HOUR - 40 * MIN, NOW)).toBe(`2${NBSP}часа назад`);
    expect(timeAgo(NOW - 11 * HOUR, NOW)).toBe(`11${NBSP}часов назад`);
  });

  it('вчера — по календарю, а не по 24 часам', () => {
    const lateEvening = new Date(2026, 10, 20, 23, 0).getTime();
    expect(timeAgo(lateEvening, new Date(2026, 10, 21, 0, 30).getTime())).toBe('вчера');
    expect(timeAgo(lateEvening, new Date(2026, 10, 20, 23, 50).getTime())).toBe(`50${NBSP}минут назад`);
    expect(timeAgo(new Date(2026, 10, 20, 8, 0).getTime(), NOW)).toBe('вчера');
  });

  it('до недели — днями, дальше — датой', () => {
    expect(timeAgo(new Date(2026, 10, 18, 20, 0).getTime(), NOW)).toBe(`3${NBSP}дня назад`);
    expect(timeAgo(new Date(2026, 10, 15, 9, 0).getTime(), NOW)).toBe(`6${NBSP}дней назад`);
    expect(timeAgo(new Date(2026, 10, 14, 9, 0).getTime(), NOW)).toBe('14 ноября');
  });

  it('в другом году — с годом', () => {
    expect(timeAgo(new Date(2025, 11, 3, 9, 0).getTime(), NOW)).toMatch(/^3 декабря 2025/);
  });
});
