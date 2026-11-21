import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Кэш IndexedDB в тестах не нужен: каждый запрос идёт в подменённый fetch
vi.mock('@/lib/kv-cache', () => ({
  cached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  cacheGet: async () => null,
  cachePut: async () => undefined,
}));

import { findCandidates } from '@/lib/catalog';
import { ownedFromDoc, setKey } from '@/lib/collection';
import { catalogIdOf } from '@/lib/languages';
import { decide, type DetectedCard } from '@/lib/matching';
import { toNewCard } from '@/scan/useScan';
import { japaneseRefs, type CardView } from '@/lib/useCardViews';

/**
 * Корейские карты сверяются с японским каталогом TCGdex как похожие (src/lib/languages.ts).
 * Корейские карты, добавленные раньше, записаны как есть, и читаться они должны по-прежнему.
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

const JA_SETS = [
  { id: 'SV2a', name: 'ポケモンカード151', cardCount: { total: 165, official: 165 } },
  { id: 'SV4K', name: '古代の咆哮', cardCount: { total: 66, official: 66 } },
];
const JA_SV2A = {
  id: 'SV2a',
  name: 'ポケモンカード151',
  cardCount: { total: 165, official: 165 },
  releaseDate: '2023-06-16',
  cards: [
    { id: 'SV2a-094', localId: '094', name: 'ゲンガー', image: 'https://assets.tcgdex.net/ja/SV/SV2a/094' },
    { id: 'SV2a-095', localId: '095', name: 'ゲンガー' },
  ],
};
const ENGLISH: Record<string, string> = { 'SV2a/94': 'Gengar' };

let requests: string[] = [];

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://api.tcgdex.net/v2/ja/sets') return respond(JA_SETS);
    if (url === 'https://api.tcgdex.net/v2/ja/sets/SV2a') return respond(JA_SV2A);
    const limitless = url.match(/limitlesstcg\.com\/api\/cards\/([^/]+)\/([^?]+)\?translate/);
    if (limitless) {
      const name = ENGLISH[`${limitless[1]}/${limitless[2]}`];
      return name ? respond({ set: limitless[1], number: limitless[2], name, translation: 1 }) : new Response('', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('поиск корейской карты', () => {
  it('находится японская карта под тем же кодом сета и номером, похожая и с английским именем', async () => {
    const candidates = await findCandidates(gengar({}));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      cardId: 'SV2a-094',
      setId: 'SV2a',
      name: 'ゲンガー',
      englishName: 'Gengar',
      lang: 'ja',
      approximate: true,
      source: 'tcgdex',
      score: 1,
    });
    // Похожую карту выбирает человек, даже если всё совпало
    expect(decide(candidates).status).toBe('choose');
  });

  it('корейское имя в японском каталоге не ищется, в одном Limitless карта тоже не ищется', async () => {
    await findCandidates(gengar({}));
    expect(requests.some((url) => url.includes('/cards?'))).toBe(false);
    expect(requests.some((url) => url.includes('lang=jp') || url.includes('/cards/jp?q='))).toBe(false);
  });

  it('чужая карта под тем же номером отбрасывается по английскому имени', async () => {
    expect(await findCandidates(gengar({ englishName: 'Pikachu' }))).toEqual([]);
  });

  it('без кода сета карта находится по числу карт и номеру, если английское имя сошлось', async () => {
    const candidates = await findCandidates(gengar({ setCode: null }));
    expect(candidates.map((candidate) => candidate.cardId)).toEqual(['SV2a-094']);
    expect(await findCandidates(gengar({ setCode: null, englishName: 'Pikachu' }))).toEqual([]);
  });

  it('Limitless не ответил: кандидат остаётся, но без имени он слабее', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://api.tcgdex.net/v2/ja/sets') return respond(JA_SETS);
      if (url === 'https://api.tcgdex.net/v2/ja/sets/SV2a') return respond(JA_SV2A);
      throw new TypeError('Failed to fetch');
    });
    const candidates = await findCandidates(gengar({}));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ cardId: 'SV2a-094', approximate: true, score: 0.4 });
    expect(candidates[0]!.englishName).toBeUndefined();
  });

  it('китайская карта для КНР не ищется нигде', async () => {
    expect(await findCandidates(gengar({ name: '耿鬼', language: 'zh-cn', setCode: 'CSV1C' }))).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe('корейские карты в альбоме', () => {
  it('новая карта пишется ссылкой на японскую с языком ko, без напечатанного', async () => {
    const [candidate] = await findCandidates(gengar({}));
    const { card } = toNewCard({ detected: gengar({}), pick: candidate!, details: {}, thumb: null });
    expect(card).toEqual({ docId: 'SV2a-094_ko', setId: 'SV2a', lang: 'ko', variant: 'normal' });
    expect(catalogIdOf(card.docId, 'ko')).toBe('SV2a-094');
  });

  it('новый документ читается как карта японского каталога', () => {
    const owned = ownedFromDoc('SV2a-094_ko', { setId: 'SV2a', count: 1, lang: 'ko' });
    expect(owned).toMatchObject({ cardId: 'SV2a-094', catalog: 'ja', lang: 'ko', printed: null });
    // В альбоме корейская карта стоит в том же сете, что и японские, как французская рядом с английской
    expect(setKey(owned)).toBe('ja:SV2a');
  });

  it('старая корейская карта «как есть» читается как раньше: без каталога, с напечатанным', () => {
    const printed = { name: '팬텀', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a' };
    const owned = ownedFromDoc('x-ko-SV2A-94', { setId: 'SV2A', count: 2, lang: 'ko', printed });
    expect(owned).toMatchObject({ cardId: null, catalog: null, lang: 'ko', count: 2, printed });
    expect(setKey(owned)).toBe('x:ko:SV2A');
  });

  it('карта, которой нет ни в одной базе, по-прежнему добавляется как есть', () => {
    const { card } = toNewCard({ detected: gengar({ setCode: 'SV9a', number: '200' }), pick: null, details: {}, thumb: null });
    expect(card).toMatchObject({ docId: 'x-ko-SV9A-200', lang: 'ko', printed: { name: '팬텀', setCode: 'SV9a' } });
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

  it('японская цена из JustTCG не достаётся ни новой, ни старой корейской карте', () => {
    const refs = japaneseRefs([
      view({ docId: 'SV2a-094_ja', cardId: 'SV2a-094', catalog: 'ja', lang: 'ja', setId: 'SV2a', localId: '094' }),
      view({ docId: 'SV2a-094_ko', cardId: 'SV2a-094', catalog: 'ja', setId: 'SV2a', localId: '094', approximate: true }),
      view({
        docId: 'x-ko-SV2A-94',
        setId: 'SV2A',
        printed: { name: '팬텀', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a' },
      }),
    ]);
    expect(refs.map((ref) => ref.key)).toEqual(['SV2a-094_ja']);
  });
});
