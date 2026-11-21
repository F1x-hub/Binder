import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Кэш IndexedDB в тестах не нужен: каждый запрос идёт в подменённый fetch
vi.mock('@/lib/kv-cache', () => ({
  cached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  cacheGet: async () => null,
  cachePut: async () => undefined,
}));

import { catalog, findCandidates } from '@/lib/catalog';
import { setCnIndexForTests } from '@/lib/cn-catalog';
import { ownedFromDoc, setKey } from '@/lib/collection';
import { KO_IMAGES, cedricImage, resetKoCatalogForTests, splitKoId, typenullImage } from '@/lib/ko-catalog';
import { koCatalog } from '@/lib/ko-catalog';
import { refreshKoPrices, usdFrom } from '@/lib/ko-prices';

const koCatalogFind = (set: string, number: string) => koCatalog.find(set, number);
import { catalogIdOf } from '@/lib/languages';
import { decide, type DetectedCard } from '@/lib/matching';
import { matchPokepolio, parsePokepolioList, parsePokepolioSet, pokepolioSetFor } from '@/lib/pokepolio';
import { refreshTcgdexPrices } from '@/lib/price-refresh';
import { toNewCard } from '@/scan/useScan';
import { japaneseRefs, type CardView } from '@/lib/useCardViews';

/**
 * Корейские карты ищутся в своём каталоге (src/lib/ko-catalog.ts): выгрузки официальной
 * корейской базы ce-dric/pokecard-kr и type-null/PTCG-database, сканы с pokemoncard.co.kr,
 * цены — pokepolio. Записанные раньше корейские карты должны читаться по-прежнему.
 */

const gengar = (card: Partial<DetectedCard>): DetectedCard => ({
  name: '팬텀',
  englishName: 'Gengar',
  number: '094',
  total: '165',
  setCode: 'SV2a',
  holo: false,
  language: 'ko',
  box: null,
  confidence: 0.9,
  ...card,
});

const TN_GENGAR = {
  name: '팬텀',
  img: 'https://cards.image.pokemonkorea.co.kr/data/wmimages/SV/SV2a/SV2a_094.png',
  card_type: 'Pokémon',
  regulation: 'G',
  set_name: 'SV2a',
  set_full_name: '스칼렛&바이올렛 강화 확장팩 「포켓몬 카드 151」',
  number: '094',
  set_total: '165',
  rarity: 'R',
  author: ['Ryuta Fuse'],
  stage: '2진화',
  hp: 140,
  types_en: ['Psychic'],
  attacks: [{ cost: ['Psychic', 'Colorless'], name: '할로우다이브', damage: '70', effect: null }],
  weakness: { type: ['Darkness'], value: '×2' },
  resistance: { type: ['Fighting'], value: '-30' },
  retreat: 2,
};
const TN_095 = { ...TN_GENGAR, name: '근육몬', number: '095', img: 'https://cards.image.pokemonkorea.co.kr/data/wmimages/SV/SV2a/SV2a_095.png', rarity: 'C' };

const CEDRIC_M6A = {
  id: 'm6a',
  nameKo: '30th CELEBRATION',
  productNameKo: 'MEGA 확장팩 「30th CELEBRATION」',
  series: 'MEGA',
  regulation: 'J',
  expansionMark: 'M6a',
  releaseDateKr: '2026-09-16',
  printedTotal: 103,
  cards: [
    { number: '001', nameKo: '아라리', rarity: '', type: 'grass', category: 'pokemon', stage: 'basic', hp: 60, krCardId: 'BS2026006001' },
    { number: '136', nameKo: '피카츄', rarity: 'UR', type: 'electric', category: 'pokemon', stage: 'basic', hp: 270, krCardId: 'BS2026006136' },
    { number: 'GRA', nameKo: '기본 풀 에너지', rarity: '', type: 'grass', category: 'energy', stage: 'basic-energy', krCardId: 'BS2026006169' },
  ],
};

const JA_SETS = [{ id: 'SV2a', name: 'ポケモンカード151', cardCount: { total: 165, official: 165 } }];
const JA_SV2A = {
  id: 'SV2a',
  name: 'ポケモンカード151',
  cardCount: { total: 165, official: 165 },
  cards: [{ id: 'SV2a-094', localId: '094', name: 'ゲンガー' }],
};
const ENGLISH: Record<string, string> = { 'SV2a/94': 'Gengar', 'M6a/136': 'Pikachu' };

const LIST_HTML = `<main><section class="pack-section"><a class="pack-box-img-link" href="/sets/11111111-1111-1111-1111-111111111111"><img src="/x.png" alt="스칼렛&amp;바이올렛 강화 확장팩 「포켓몬 카드 151」"></a>
<img src="/api/card-image?src=https%3A%2F%2Fcards.image.pokemonkorea.co.kr%2Fdata%2Fwmimages%2FSV%2FSV2a%2FSV2a_201.png"></section>
<section class="pack-section"><a href="/sets/22222222-2222-2222-2222-222222222222"><img src="/y.png" alt="MEGA 확장팩 「30th CELEBRATION」"></a><img src="https://cdn.snkrdunk.com/a.webp"></section>
<div class="pagination"><span>1<!-- --> / <!-- -->1</span></div></main>`;

const item = (uuid: string, name: string, line: string, price: string, source: string, image = '') =>
  `<a class="card-grid-item" href="/cards/${uuid}"><div class="card-grid-img"><img src="${image}" alt="${name}"/></div><div class="card-grid-info"><strong>${name}</strong><span>${line}</span><em class="card-grid-price">${price}</em><small class="card-grid-source">${source}</small></div></a>`;

const SET_HTML = [
  item('aaaaaaaa-0000-0000-0000-000000000001', '팬텀', '094/165<!-- --> · R', '3,000원', 'Raw · 상태 A · 번개장터', '/api/card-image?src=https%3A%2F%2Fx%2FSV2a_094.png'),
  item('aaaaaaaa-0000-0000-0000-000000000002', '팬텀', '094/165<!-- --> · R', '9,000원', 'Raw · 번개장터', '/api/card-image?src=https%3A%2F%2Fx%2FSV2a_094_m.png'),
  item('aaaaaaaa-0000-0000-0000-000000000003', '근육몬', '095/165<!-- --> · C', '88,000원', ' 10 · MVC 네이버카페'),
  item('aaaaaaaa-0000-0000-0000-000000000004', '이상해씨', '001/165<!-- --> · C', '거래 없음', ''),
].join('');

let requests: string[] = [];

function respond(body: unknown, status = 200): Response {
  return typeof body === 'string'
    ? new Response(body, { status, headers: { 'content-type': 'text/html' } })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function server(url: string): Response {
  if (url === 'https://api.github.com/repos/ce-dric/pokecard-kr/contents/src/data/sets') return respond([{ name: 'm6a.json', type: 'file' }]);
  if (url === 'https://api.github.com/repos/type-null/PTCG-database/contents/data_ko') {
    return respond([
      { name: 'SV2a', type: 'dir' },
      { name: 'M6a', type: 'dir' },
    ]);
  }
  if (url === 'https://api.github.com/repos/type-null/PTCG-database/contents/data_ko/SV2a') {
    return respond(['094.json', '094-2.json', '095.json'].map((name) => ({ name, type: 'file' })));
  }
  if (url === 'https://raw.githubusercontent.com/type-null/PTCG-database/main/data_ko/SV2a/094.json') return respond(TN_GENGAR);
  if (url === 'https://raw.githubusercontent.com/type-null/PTCG-database/main/data_ko/SV2a/094-2.json') return respond({ ...TN_GENGAR, number: '094' });
  if (url === 'https://raw.githubusercontent.com/type-null/PTCG-database/main/data_ko/SV2a/095.json') return respond(TN_095);
  if (url === 'https://raw.githubusercontent.com/ce-dric/pokecard-kr/main/src/data/sets/m6a.json') return respond(CEDRIC_M6A);
  if (url === 'https://api.tcgdex.net/v2/ja/sets') return respond(JA_SETS);
  if (url === 'https://api.tcgdex.net/v2/ja/sets/SV2a') return respond(JA_SV2A);
  const limitless = url.match(/limitlesstcg\.com\/api\/cards\/([^/]+)\/([^?]+)\?translate/);
  if (limitless) {
    const name = ENGLISH[`${limitless[1]}/${limitless[2]}`];
    return name ? respond({ set: limitless[1], number: limitless[2], name, translation: 1 }) : respond('');
  }
  if (url.startsWith('https://api.frankfurter.dev/')) return respond({ base: 'KRW', rates: { USD: 0.0007 } });
  if (url === 'https://www.pokepolio.com/cards-list') return respond(LIST_HTML);
  if (url === 'https://www.pokepolio.com/sets/11111111-1111-1111-1111-111111111111') return respond(SET_HTML);
  return respond('not found', 404);
}

beforeEach(() => {
  requests = [];
  resetKoCatalogForTests();
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    return server(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('поиск корейской карты', () => {
  it('по коду сета и номеру находится корейская карта: корейское имя, английское, официальный скан, узнана сразу', async () => {
    const candidates = await findCandidates(gengar({}));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      cardId: 'SV2a-094',
      setId: 'SV2a',
      name: '팬텀',
      englishName: 'Gengar',
      setName: '스칼렛&바이올렛 강화 확장팩 「포켓몬 카드 151」',
      printedTotal: 165,
      lang: 'ko',
      approximate: false,
      source: 'tcgdex',
      image: `${KO_IMAGES}/SV/SV2a/SV2a_094.webp`,
      score: 1,
    });
    expect(decide(candidates).status).toBe('ready');
    // Ради одной карты сет целиком не грузится: только файл карты
    expect(requests.some((url) => url.endsWith('/contents/data_ko/SV2a'))).toBe(false);
  });

  it('код сета в другом регистре — та же карта с кодом как на карте', async () => {
    const [candidate] = await findCandidates(gengar({ setCode: 'sv2A', number: '94' }));
    expect(candidate).toMatchObject({ cardId: 'SV2a-094', setId: 'SV2a' });
  });

  it('чужая карта под тем же номером отбрасывается по корейскому имени', async () => {
    expect(await findCandidates(gengar({ name: '피카츄', englishName: 'Pikachu' }))).toEqual([]);
  });

  it('без кода сета находится японская пара по числу карт и номеру, а берётся корейская карта', async () => {
    const candidates = await findCandidates(gengar({ setCode: null }));
    expect(candidates.map((candidate) => [candidate.cardId, candidate.lang, candidate.name])).toEqual([['SV2a-094', 'ko', '팬텀']]);
    expect(await findCandidates(gengar({ setCode: null, englishName: 'Pikachu', name: '피카츄' }))).toEqual([]);
  });

  it('сет из ce-dric: ID сета как на карте, скан по ID карты на официальном сайте, у энергии тоже', async () => {
    const [pikachu] = await findCandidates(gengar({ name: '피카츄', englishName: 'Pikachu', number: '136', total: '103', setCode: 'M6A' }));
    expect(pikachu).toMatchObject({ cardId: 'M6a-136', setId: 'M6a', name: '피카츄', englishName: 'Pikachu', printedTotal: 103 });
    expect(pikachu!.image).toBe(`${KO_IMAGES}/MEGA/M6a/M6a_136.webp`);
    const energy = await catalog.card('M6a-GRA', 'ko');
    expect(energy).toMatchObject({ name: '기본 풀 에너지', category: 'Energy', energyType: 'Normal', image: `${KO_IMAGES}/MEGA/M6a/M6a_169.webp` });
    const card = await catalog.card('M6a-136', 'ko');
    expect(card).toMatchObject({ rarity: 'Ultra Rare', types: ['Lightning'], stage: 'Basic', hp: 270, regulationMark: 'J' });
  });

  it('карта, которой нет ни в одной выгрузке, добавляется как есть', async () => {
    expect(await findCandidates(gengar({ setCode: 'SV9a', number: '200' }))).toEqual([]);
    const { card } = toNewCard({ detected: gengar({ setCode: 'SV9a', number: '200' }), pick: null, details: {}, thumb: null });
    expect(card).toMatchObject({ docId: 'x-ko-SV9A-200', lang: 'ko', printed: { name: '팬텀', setCode: 'SV9a' } });
  });

  it('китайская карта для КНР в корейском каталоге не ищется', async () => {
    setCnIndexForTests({ version: 1, sets: [] });
    try {
      expect(await findCandidates(gengar({ name: '耿鬼', language: 'zh-cn', setCode: 'CSV1C' }))).toEqual([]);
      expect(requests.filter((url) => url.includes('github') || url.includes('limitless'))).toEqual([]);
    } finally {
      setCnIndexForTests(null);
    }
  });
});

describe('корейский каталог', () => {
  it('сет type-null целиком: карты по номеру, зеркальная печать — реверс, сведения в форме TCGdex', async () => {
    const set = await catalog.set('SV2a', 'ko');
    expect(set).toMatchObject({ id: 'SV2a', name: '스칼렛&바이올렛 강화 확장팩 「포켓몬 카드 151」', cardCount: { official: 165, total: 2 } });
    expect(set.cards.map((card) => card.id)).toEqual(['SV2a-094', 'SV2a-095']);
    const card = await catalog.card('SV2a-094', 'ko');
    expect(card).toMatchObject({
      category: 'Pokemon',
      types: ['Psychic'],
      stage: 'Stage2',
      hp: 140,
      rarity: 'Rare',
      illustrator: 'Ryuta Fuse',
      retreat: 2,
      weaknesses: [{ type: 'Darkness', value: '×2' }],
      variants: { normal: true, holo: false, reverse: true },
    });
  });

  it('список ce-dric не ответил (лимит api.github.com): сеты type-null работают, без ce-dric карт нет', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('ce-dric')) return respond({ message: 'API rate limit exceeded' }, 403);
      return server(url);
    });
    expect((await koCatalogFind('SV2a', '094'))?.card.id).toBe('SV2a-094');
    expect(await koCatalogFind('M6a', '001')).toBeNull();
  });

  it('адреса сканов и ID', () => {
    expect(typenullImage('https://cards.image.pokemonkorea.co.kr/data/wmimages/S/S8b/S8b_001.png')).toBe(`${KO_IMAGES}/S/S8b/S8b_001.webp`);
    expect(typenullImage('https://example.com/x.png')).toBeUndefined();
    expect(cedricImage({ series: 'SV', expansionMark: 'SV9' }, { krCardId: 'BS2024017105' })).toBe(`${KO_IMAGES}/SV/SV9/SV9_105.webp`);
    expect(cedricImage({ series: 'SV', expansionMark: 'SV9' }, {})).toBeUndefined();
    expect(splitKoId('S8a-G-001')).toEqual({ setId: 'S8a-G', number: '001' });
    expect(splitKoId('SV2a')).toBeNull();
  });
});

describe('корейские карты в альбоме', () => {
  it('новая карта пишется ссылкой на корейский каталог, без напечатанного', async () => {
    const [candidate] = await findCandidates(gengar({}));
    const { card } = toNewCard({ detected: gengar({}), pick: candidate!, details: {}, thumb: null });
    expect(card).toEqual({ docId: 'SV2a-094_ko', setId: 'SV2a', lang: 'ko', variant: 'normal' });
    expect(catalogIdOf(card.docId, 'ko')).toBe('SV2a-094');
  });

  it('документ «SV2a-094_ko», записанный, пока корейские карты были похожими японскими, читается из корейского каталога', async () => {
    const owned = ownedFromDoc('SV2a-094_ko', { setId: 'SV2a', count: 1, lang: 'ko' });
    expect(owned).toMatchObject({ cardId: 'SV2a-094', catalog: 'ko', lang: 'ko', printed: null });
    expect(setKey(owned)).toBe('ko:SV2a');
    const set = await catalog.set(owned.setId, owned.catalog!);
    expect(set.cards.find((card) => card.id === owned.cardId)).toMatchObject({ name: '팬텀', image: `${KO_IMAGES}/SV/SV2a/SV2a_094.webp` });
  });

  it('старая корейская карта «как есть» читается как раньше: без каталога, с напечатанным', () => {
    const printed = { name: '팬텀', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a' };
    const owned = ownedFromDoc('x-ko-SV2A-94', { setId: 'SV2A', count: 2, lang: 'ko', printed });
    expect(owned).toMatchObject({ cardId: null, catalog: null, lang: 'ko', count: 2, printed });
    expect(setKey(owned)).toBe('x:ko:SV2A');
  });
});

describe('цена корейской карты', () => {
  const view = (patch: Partial<CardView>): CardView =>
    ({
      docId: 'x',
      cardId: null,
      catalog: null,
      setId: '',
      lang: 'ko',
      count: 1,
      printed: null,
      addedAt: null,
      updatedAt: null,
      name: '',
      englishName: null,
      localId: '',
      thumb: null,
      setName: '',
      printedTotal: null,
      releaseDate: null,
      price: null,
      approximate: false,
      limitless: null,
      ...patch,
    }) as CardView;

  it('японская цена из JustTCG корейской карте не достаётся', () => {
    const refs = japaneseRefs([
      view({ docId: 'SV2a-094_ja', cardId: 'SV2a-094', catalog: 'ja', lang: 'ja', setId: 'SV2a', localId: '094' }),
      view({ docId: 'SV2a-094_ko', cardId: 'SV2a-094', catalog: 'ko', setId: 'SV2a', localId: '094' }),
      view({
        docId: 'x-ko-SV2A-94',
        setId: 'SV2A',
        printed: { name: '팬텀', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a' },
      }),
    ]);
    expect(refs.map((ref) => ref.key)).toEqual(['SV2a-094_ja']);
  });

  it('список сетов pokepolio: код по сканам, без сканов — только название', () => {
    const { sets, pages } = parsePokepolioList(LIST_HTML);
    expect(pages).toBe(1);
    expect(sets).toEqual([
      { uuid: '11111111-1111-1111-1111-111111111111', code: 'SV2a', name: '스칼렛&바이올렛 강화 확장팩 「포켓몬 카드 151」' },
      { uuid: '22222222-2222-2222-2222-222222222222', code: null, name: 'MEGA 확장팩 「30th CELEBRATION」' },
    ]);
    expect(pokepolioSetFor(sets, 'sv2a', null)?.uuid).toBe('11111111-1111-1111-1111-111111111111');
    expect(pokepolioSetFor(sets, 'M6a', 'MEGA 확장팩 「30th CELEBRATION」')?.uuid).toBe('22222222-2222-2222-2222-222222222222');
    expect(pokepolioSetFor(sets, 'M6a', null)).toBeNull();
  });

  it('страница сета: цена только без грейда, обычная печать раньше зеркальной', () => {
    const cards = parsePokepolioSet(SET_HTML);
    expect(cards.map((card) => [card.name, card.number, card.total, card.rarity, card.krw, card.mirror])).toEqual([
      ['팬텀', '094', '165', 'R', 3000, false],
      ['팬텀', '094', '165', 'R', 9000, true],
      ['근육몬', '095', '165', 'C', null, false],
      ['이상해씨', '001', '165', 'C', null, false],
    ]);
    expect(matchPokepolio(cards, { localId: '94', name: '팬텀' })?.krw).toBe(3000);
    expect(matchPokepolio(cards, { localId: '094', name: '피카츄' })).toBeNull();
    expect(usdFrom(3000, 0.0007)).toBe(2.1);
    expect(usdFrom(null, 0.0007)).toBeNull();
  });

  it('цены освежаются тем же путём, что у TCGdex: в долларах, без евро; без сделки — null', async () => {
    const prices = await refreshKoPrices(['SV2a-094', 'SV2a-095', 'M6a-136']);
    expect(Object.fromEntries(prices)).toEqual({
      'SV2a-094': { u: 2.1, e: null },
      'SV2a-095': { u: null, e: null },
      // Сет pokepolio узнан по названию, но страницы нет: цена остаётся вчерашней
    });
    const fresh = await refreshTcgdexPrices('ko', ['SV2a-094'], '2026-11-21');
    expect(fresh.updates).toEqual({ 'SV2a-094': { u: 2.1, e: null, d: '2026-11-21' } });
    expect(fresh.history).toEqual({ 'SV2a-094': { '21': { u: 2.1, e: null } } });
    expect(fresh.details.get('SV2a-094')?.name).toBe('팬텀');
  });

  it('pokepolio не ответил — цен нет, ничего не ломается', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('pokepolio')) throw new TypeError('Failed to fetch');
      return server(url);
    });
    expect((await refreshKoPrices(['SV2a-094'])).size).toBe(0);
  });
});
