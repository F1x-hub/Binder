import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timestamp } from 'firebase/firestore';

// Кэш в памяти вместо IndexedDB: так видно, что второй раз сет из сети не читается
const cache = new Map<string, unknown>();
vi.mock('@/lib/kv-cache', () => ({
  cacheGet: async (key: string) => cache.get(key) ?? null,
  cachePut: async (key: string, value: unknown) => {
    cache.set(key, value);
  },
}));

import { checklistPockets, type AlbumCard } from '@/lib/library-filters';
import {
  limitlessChecklist,
  limitlessSetCards,
  mergeSetLists,
  outOfBaseSet,
  parseSetList,
  printedNumberId,
} from '@/lib/limitless-set';

/** Строки таблицы сета, как их отдаёт limitlesstcg.com/cards/jp/MBG?display=list. */
function row(set: string, number: string, name: string, query = ''): string {
  return `<tr data-hover="https://cdn/tpc/${set}/${set}_${number}_R_JP_XS.png">
    <td><span class="card-set" data-tooltip="スターターセットMEGA"><img class="set" alt="${set}">${set}</span></td>
    <td><a href="/cards/jp/${set}/${number}${query}">${number}</a></td>
    <td><a href="/cards/jp/${set}/${number}${query}">${name}</a></td>
    <td class="md-only"><a href="/cards/jp/${set}/${number}${query}"><span class="ptcg-symbol">D</span> Stage 2</a></td>
    <td class="md-only"><a href="/cards/jp/${set}/${number}${query}"></a></td>
  </tr>`;
}

const page = (rows: string) => `<table class="data-table"><tr><th>Set</th><th>No</th><th>Name</th></tr>${rows}</table>`;

const JP = page(
  row('MBG', '1', 'ゴース') + row('MBG', '3', 'メガゲンガーex') + row('MBG', '2', 'ゴースト') + row('MBG', '19', 'アイリスの闘志'),
);
const EN = page(
  row('MBG', '1', 'Gastly', '?translate=en') +
    row('MBG', '2', 'Haunter', '?translate=en') +
    row('MBG', '3', 'Mega Gengar ex', '?translate=en') +
    row('MBG', '19', 'Iris&#039;s Fighting Spirit', '?translate=en'),
);

describe('таблица сета Limitless', () => {
  it('из строки берутся код сета, номер и имя; заголовок и пустые ссылки пропускаются', () => {
    expect(parseSetList(JP, 'MBG')).toEqual([
      { set: 'MBG', number: '1', name: 'ゴース' },
      { set: 'MBG', number: '3', name: 'メガゲンガーex' },
      { set: 'MBG', number: '2', name: 'ゴースト' },
      { set: 'MBG', number: '19', name: 'アイリスの闘志' },
    ]);
  });

  it('код сета без учёта регистра, но в ответе — как у Limitless; строки чужого сета отбрасываются', () => {
    const html = page(row('SV2a', '94', 'ゲンガー') + row('SV2', '5', 'ほか'));
    expect(parseSetList(html, 'SV2A')).toEqual([{ set: 'SV2a', number: '94', name: 'ゲンガー' }]);
  });

  it('английские имена — по номеру, сущности HTML раскрываются, порядок — по номеру', () => {
    expect(mergeSetLists(parseSetList(JP, 'MBG'), parseSetList(EN, 'MBG'))).toEqual([
      { set: 'MBG', number: '1', name: 'ゴース', englishName: 'Gastly' },
      { set: 'MBG', number: '2', name: 'ゴースト', englishName: 'Haunter' },
      { set: 'MBG', number: '3', name: 'メガゲンガーex', englishName: 'Mega Gengar ex' },
      { set: 'MBG', number: '19', name: 'アイリスの闘志', englishName: "Iris's Fighting Spirit" },
    ]);
  });

  it('без перевода английского имени нет', () => {
    expect(mergeSetLists(parseSetList(JP, 'MBG'), [])[0]).toEqual({ set: 'MBG', number: '1', name: 'ゴース', englishName: null });
  });
});

describe('ключ сета вне базы', () => {
  it('список есть только у японских сетов вне TCGdex с кодом', () => {
    expect(outOfBaseSet('x:ja:MBG')).toBe('MBG');
    expect(outOfBaseSet('x:ja:NOSET')).toBeNull();
    expect(outOfBaseSet('x:ko:MBG')).toBeNull();
    expect(outOfBaseSet('ja:SV2a')).toBeNull();
    expect(outOfBaseSet(null)).toBeNull();
  });
});

describe('загрузка сета из Limitless', () => {
  let requests: string[] = [];
  let pages: Record<string, string | number> = {};

  beforeEach(() => {
    cache.clear();
    requests = [];
    pages = {};
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      const body = pages[url.includes('translate=en') ? 'en' : 'jp'] ?? 404;
      return typeof body === 'number' ? new Response('', { status: body }) : new Response(body, { status: 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('два запроса на сет — с японскими и английскими именами, потом из кэша', async () => {
    pages = { jp: JP, en: EN };
    const cards = await limitlessSetCards('MBG');
    expect(cards?.map((card) => `${card.number} ${card.englishName}`)).toEqual([
      '1 Gastly',
      '2 Haunter',
      '3 Mega Gengar ex',
      "19 Iris's Fighting Spirit",
    ]);
    expect(requests).toEqual([
      'https://limitlesstcg.com/cards/jp/MBG?display=list&show=all',
      'https://limitlesstcg.com/cards/jp/MBG?display=list&show=all&translate=en',
    ]);
    await limitlessSetCards('mbg');
    expect(requests).toHaveLength(2);
  });

  it('перевод не пришёл — список с японскими именами', async () => {
    pages = { jp: JP, en: 503 };
    const cards = await limitlessSetCards('MBG');
    expect(cards?.[0]).toEqual({ set: 'MBG', number: '1', name: 'ゴース', englishName: null });
  });

  it('сета нет — null, и сутки сеть не трогается', async () => {
    pages = { jp: page('') };
    expect(await limitlessSetCards('ZZZ')).toBeNull();
    expect(await limitlessSetCards('ZZZ')).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('Limitless не отвечает — ошибка, отсутствие не запоминается', async () => {
    pages = { jp: 503 };
    await expect(limitlessSetCards('MBG')).rejects.toThrow();
    pages = { jp: JP, en: EN };
    expect(await limitlessSetCards('MBG')).toHaveLength(4);
  });

  it('странный код сета — без запроса', async () => {
    expect(await limitlessSetCards('../etc')).toBeNull();
    expect(await limitlessSetCards('NOSET')).toBeNull();
    expect(requests).toHaveLength(0);
  });
});

describe('разворот сета вне базы', () => {
  const at = (millis: number) => ({ toMillis: () => millis }) as unknown as Timestamp;
  const gengar: AlbumCard = {
    docId: 'x-ja-MBG-3',
    cardId: null,
    catalog: null,
    setId: 'MBG',
    lang: 'ja',
    count: 1,
    printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
    addedAt: at(1000),
    name: 'メガゲンガーex',
    englishName: 'Mega Gengar ex',
    localId: '003',
    setName: 'MBG',
    printedTotal: 21,
    releaseDate: null,
    price: null,
  };

  it('карта альбома встаёт в свой карман по напечатанному номеру, недостающие — со сканом Limitless', () => {
    const checklist = limitlessChecklist(mergeSetLists(parseSetList(JP, 'MBG'), parseSetList(EN, 'MBG')));
    const pockets = checklistPockets([gengar], checklist, printedNumberId);
    expect(pockets.map((pocket) => (pocket.kind === 'missing' ? `·${pocket.number} ${pocket.name}` : pocket.key))).toEqual([
      '·1 Gastly',
      '·2 Haunter',
      'x-ja-MBG-3',
      "·19 Iris's Fighting Spirit",
    ]);
    expect(pockets[0]).toMatchObject({ limitless: { region: 'jp', set: 'MBG', number: '1' } });
  });

  it('карта с номером вне списка — в конце', () => {
    const odd = { ...gengar, docId: 'x-ja-MBG-99', localId: '99' };
    const pockets = checklistPockets([odd], limitlessChecklist([{ set: 'MBG', number: '1', name: 'ゴース', englishName: null }]), printedNumberId);
    expect(pockets.map((pocket) => pocket.key)).toEqual(['missing:1', 'x-ja-MBG-99']);
  });
});
