import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Кэш IndexedDB в тестах не нужен: каждый запрос идёт в подменённый fetch
vi.mock('@/lib/kv-cache', () => ({
  cached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  cacheGet: async () => null,
  cachePut: async () => undefined,
}));

import { findCandidates, findQuerySet, nameHasWords, parseCardQuery, searchCatalog } from '@/lib/catalog';
import { MAX_OPTIONS, MODEL_TRUST, decide, type Candidate, type DetectedCard } from '@/lib/matching';

/**
 * Скан промо-картинки 30th Celebration (21 ноября 2026): Pikachu ex 30th-149 и 30th-150
 * узнались как Ascended Heroes 276/217 и 277/217 «Распознано, 55%». Модель угадала номер,
 * а TCGdex перестал понимать строгий фильтр номера «localId=eq:149». Подменённый TCGdex
 * ведёт себя так же: любой запрос с фильтром номера отвечает пустым списком.
 */
const CARD = (id: string, name: string) => {
  const localId = id.slice(id.lastIndexOf('-') + 1);
  return { id, localId, name, image: `https://assets.tcgdex.net/en/x/${id}` };
};

const PIKACHU = [
  CARD('A1-096', 'Pikachu ex'), // TCG Pocket: в поиск не попадает
  CARD('sv08-238', 'Pikachu ex'),
  CARD('sv08-057', 'Pikachu ex'),
  CARD('30th-023', 'Pikachu'),
  CARD('30th-053', 'Pikachu ex'),
  CARD('30th-149', 'Pikachu ex'),
  CARD('30th-150', 'Pikachu ex'),
  CARD('me02.5-276', 'Pikachu ex'),
  CARD('me02.5-277', 'Pikachu ex'),
];

const SETS = {
  sv08: { id: 'sv08', name: 'Surging Sparks', cardCount: { official: 191, total: 252 }, releaseDate: '2024-11-08', abbreviation: { official: 'SSP' } },
  'me02.5': { id: 'me02.5', name: 'Ascended Heroes', cardCount: { official: 217, total: 295 }, releaseDate: '2026-01-30', abbreviation: { official: 'ASC' } },
  '30th': { id: '30th', name: '30th Celebration', cardCount: { official: 128, total: 160 }, releaseDate: '2026-09-16', abbreviation: { official: '30C' } },
} as const;

let requests: string[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const path = url.pathname.replace('/v2/en', '');
    if (path === '/sets') {
      // Список сетов TCGdex идёт по дате выхода
      return json([{ id: 'A1', name: 'Genetic Apex', cardCount: { official: 226, total: 286 } }, ...Object.values(SETS)]);
    }
    const set = /^\/sets\/(.+)$/.exec(path);
    if (set) {
      const detail = SETS[decodeURIComponent(set[1]!) as keyof typeof SETS];
      if (!detail) return new Response('{}', { status: 404 });
      const cards = PIKACHU.filter((card) => card.id.startsWith(`${detail.id}-`));
      return json({ ...detail, cards });
    }
    if (path === '/cards') {
      if (url.searchParams.has('localId')) return json([]);
      const name = (url.searchParams.get('name') ?? '').toLowerCase();
      return json(PIKACHU.filter((card) => card.name.toLowerCase().includes(name)));
    }
    return new Response('{}', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const read = (card: Partial<DetectedCard>): DetectedCard => ({
  name: 'Pikachu ex',
  englishName: 'Pikachu ex',
  number: '149',
  total: '128',
  setCode: null,
  holo: true,
  language: 'en',
  box: null,
  confidence: 0.9,
  ...card,
});

async function scan(card: Partial<DetectedCard>) {
  const detected = read(card);
  const candidates = await findCandidates(detected);
  return { candidates, decision: decide(candidates, detected.confidence) };
}

const ids = (list: Candidate[]) => list.map((candidate) => candidate.cardId);

describe('поиск по имени и номеру без строгого фильтра TCGdex', () => {
  it('верно прочитанная карта 149/128 узнаётся, хотя фильтр «localId=eq:» пустой', async () => {
    const { decision } = await scan({});
    expect(decision).toMatchObject({ status: 'ready', pick: { cardId: '30th-149', setName: '30th Celebration', printedTotal: 128 } });
    expect(requests.some((request) => request.includes('localId'))).toBe(false);
  });

  it('номер сверяется без ведущих нулей: «53» — это 30th-053', async () => {
    const { decision } = await scan({ number: '53' });
    expect(decision).toMatchObject({ status: 'ready', pick: { cardId: '30th-053' } });
  });

  it('нестрогий номер не проходит: «003» не находит 053 и 238', async () => {
    const { candidates } = await scan({ number: '003', total: null, confidence: 0.9 });
    // Номер 003 не нашёлся: предлагаются другие печати, все с пометкой «номер не подтверждён»
    expect(candidates.every((candidate) => candidate.weak)).toBe(true);
  });

  it('один запрос имени на карту, а не на каждую запись номера', async () => {
    await scan({ number: '0149' });
    expect(requests.filter((request) => request.startsWith('/v2/en/cards?'))).toHaveLength(1);
  });
});

describe('неуверенная модель — выбор, а не «Распознано»', () => {
  it('276/217 с уверенностью 0.55: на выбор, среди вариантов 30th-149 и 30th-150', async () => {
    const { decision } = await scan({ number: '276', total: '217', confidence: 0.55 });
    expect(decision.status).toBe('choose');
    const options = decision.status === 'choose' ? decision.options : [];
    // Карта под прочитанным номером — первой, дальше другие печати, свежие сеты первыми
    expect(options[0]?.cardId).toBe('me02.5-276');
    expect(ids(options)).toEqual(expect.arrayContaining(['30th-149', '30th-150']));
    expect(ids(options).indexOf('30th-149')).toBeLessThan(ids(options).indexOf('sv08-238'));
    // Простой Pikachu и карты TCG Pocket — не печати этой карты
    expect(ids(options)).not.toContain('30th-023');
    expect(ids(options)).not.toContain('A1-096');
    expect(options.length).toBeLessThanOrEqual(MAX_OPTIONS);
  });

  it('та же карта, уверенно прочитанная, узнаётся без лишних вариантов', async () => {
    const { decision, candidates } = await scan({ number: '150', confidence: 0.9 });
    expect(decision).toMatchObject({ status: 'ready', pick: { cardId: '30th-150' } });
    expect(candidates).toHaveLength(1);
  });

  it('порог доверия модели — 0.7', () => {
    expect(MODEL_TRUST).toBe(0.7);
  });
});

describe('свой поиск: «Ни одна не подходит»', () => {
  it('номер — последнее слово из цифр, дробь отрезается; «30th» и «SV2a» — не номер', () => {
    expect(parseCardQuery('Pikachu ex 149/128')).toEqual({ number: '149', words: ['Pikachu', 'ex'] });
    expect(parseCardQuery('30th 150')).toEqual({ number: '150', words: ['30th'] });
    expect(parseCardQuery('SV2a')).toEqual({ number: null, words: ['SV2a'] });
    expect(parseCardQuery('Charizard TG05')).toEqual({ number: 'TG05', words: ['Charizard'] });
  });

  it('сет по ID или по имени; слова из имени сета в имя карты не идут', () => {
    const sets = Object.values(SETS);
    expect(findQuerySet(['Pikachu', 'ex', '30th', 'Celebration'], sets)).toMatchObject({ set: { id: '30th' }, rest: ['Pikachu', 'ex'] });
    expect(findQuerySet(['Surging', 'Sparks'], sets)).toMatchObject({ set: { id: 'sv08' }, rest: [] });
    expect(findQuerySet(['Ascended', 'Pikachu'], sets)).toMatchObject({ set: null, rest: ['Ascended', 'Pikachu'] });
  });

  it('имя и номер: «Pikachu ex 150» — 30th-150', async () => {
    expect(ids(await searchCatalog('Pikachu ex 150', 'en'))).toEqual(['30th-150']);
  });

  it('сет и номер без имени: «30th 149»', async () => {
    const found = await searchCatalog('30th 149', 'en');
    expect(found).toMatchObject([{ cardId: '30th-149', setName: '30th Celebration', printedTotal: 128 }]);
  });

  it('имя без номера — все печати, свежие сеты первыми, без TCG Pocket', async () => {
    const found = ids(await searchCatalog('pikachu ex', 'en'));
    expect(found[0]?.startsWith('30th-')).toBe(true);
    expect(found).not.toContain('A1-096');
    expect(found).toContain('sv08-238');
    // «ex» в запросе — слово имени: просто Pikachu не подходит
    expect(found).not.toContain('30th-023');
  });

  it('слова запроса сверяются с именем, начало слова тоже находит', async () => {
    expect(nameHasWords('Mega Charizard X ex', 'charizard ex')).toBe(true);
    expect(nameHasWords('Charizard', 'charizard ex')).toBe(false);
    expect(nameHasWords('Pikachu ex', 'pika')).toBe(true);
    expect(nameHasWords('メガゲンガーex', 'ゲンガー')).toBe(true);
  });

  it('имя сета и имя карты: «Pikachu ex Ascended Heroes»', async () => {
    expect(ids(await searchCatalog('Pikachu ex Ascended Heroes', 'en')).sort()).toEqual(['me02.5-276', 'me02.5-277']);
  });

  it('тот же запрос второй раз не идёт в сеть', async () => {
    await searchCatalog('Pikachu ex 053', 'en');
    const before = requests.length;
    await searchCatalog('  pikachu   EX 053 ', 'en');
    expect(requests.length).toBe(before);
  });
});
