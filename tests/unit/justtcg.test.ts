import { afterEach, describe, expect, it, vi } from 'vitest';
import { jpPriceDocId, priceFor } from '@/lib/jp-prices';
import {
  BATCH_LIMIT,
  JusttcgError,
  cardNumber,
  checkJusttcgKey,
  findJusttcgCard,
  findSet,
  pickPrice,
  printingPrices,
  productName,
  refreshJusttcgCards,
  setCodeOf,
} from '@/lib/justtcg';
import { japaneseRefs, mergePrice, type CardView } from '@/lib/useCardViews';

/** Ответы API в том виде, как их описывает https://justtcg.com/docs/swagger.json. */
const SETS = {
  data: [
    { id: 'mbg-mega-starter-set-mega-gengar-ex-pokemon-japan', name: 'MBG: MEGA Starter Set Mega Gengar ex', game_id: 'pokemon-japan' },
    { id: 'sv2a-pokemon-card-151-pokemon-japan', name: 'SV2a: Pokemon Card 151', game_id: 'pokemon-japan' },
    { id: 'promo-pokemon-japan', name: 'Promo Cards', game_id: 'pokemon-japan' },
  ],
};

const MEGA_GENGAR = {
  id: 'pokemon-japan-mbg-mega-gengar-ex-double-rare',
  name: 'Mega Gengar ex - 003/021',
  set: 'mbg-mega-starter-set-mega-gengar-ex-pokemon-japan',
  number: '003/021',
  variants: [
    { condition: 'Near Mint', printing: 'Holofoil', price: 5.81, priceStatus: 'current' },
    { condition: 'Lightly Played', printing: 'Holofoil', price: 4.9, priceStatus: 'current' },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('сеты JustTCG', () => {
  it('код сета берётся из начала названия TCGplayer', () => {
    expect(setCodeOf('MBG: MEGA Starter Set Mega Gengar ex')).toBe('MBG');
    expect(setCodeOf('SV2a: Pokemon Card 151')).toBe('SV2A');
    expect(setCodeOf('Promo Cards')).toBeNull();
  });

  it('сет находится по коду без учёта регистра', () => {
    expect(findSet(SETS.data, 'mBG')?.id).toBe('mbg-mega-starter-set-mega-gengar-ex-pokemon-japan');
    expect(findSet(SETS.data, 'SV2a')?.id).toBe('sv2a-pokemon-card-151-pokemon-japan');
    expect(findSet(SETS.data, 'M1L')).toBeNull();
  });
});

describe('цены JustTCG', () => {
  it('берутся только Near Mint, по одной цене на печать', () => {
    expect(printingPrices(MEGA_GENGAR.variants)).toEqual({ Holofoil: 5.81 });
  });

  it('если рынок перестал сообщать цену, берётся последняя известная', () => {
    expect(printingPrices([{ condition: 'NM', printing: 'Normal', price: null, priceStatus: 'expired', lastKnownPrice: 1.25 }])).toEqual({
      Normal: 1.25,
    });
    expect(printingPrices([{ condition: 'NM', printing: 'Normal', price: null, priceStatus: 'unpriced' }])).toEqual({});
  });

  it('печать выбирается по варианту карты, а единственная подходит любой', () => {
    const both = { Normal: 0.3, Holofoil: 2, 'Reverse Holofoil': 0.9 };
    expect(pickPrice(both, 'holo')).toBe(2);
    expect(pickPrice(both, 'normal')).toBe(0.3);
    expect(pickPrice(both, 'reverse')).toBe(0.9);
    expect(pickPrice({ Holofoil: 5.81 }, 'normal')).toBe(5.81);
    expect(pickPrice({ Normal: 0.3, 'Reverse Holofoil': 0.9 }, 'holo')).toBeNull();
    expect(pickPrice({}, 'holo')).toBeNull();
  });

  it('номер и имя товара без пометок', () => {
    expect(cardNumber('003/021')).toBe('3');
    expect(cardNumber('230')).toBe('230');
    expect(cardNumber(undefined)).toBeNull();
    expect(productName('Mega Gengar ex - 003/021')).toBe('Mega Gengar ex');
    expect(productName('Gengar (Secret) - 094/165')).toBe('Gengar');
  });
});

describe('запросы к JustTCG', () => {
  it('находит карту по коду сета и номеру: сначала поиск в сете по английскому имени', async () => {
    const calls: Array<{ url: string; key: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, key: new Headers(init?.headers).get('x-api-key') });
        if (url.includes('/sets?')) return json(SETS);
        return json({ data: [MEGA_GENGAR], meta: { hasMore: false } });
      }),
    );
    const found = await findJusttcgCard('tcg_test', 'mBG', '003', { englishName: 'Mega Gengar ex', total: '021' });
    expect(found).toEqual({ cardId: MEGA_GENGAR.id, name: 'Mega Gengar ex', prices: { Holofoil: 5.81 } });
    expect(calls.every((call) => call.key === 'tcg_test')).toBe(true);
    expect(calls[0]!.url).toContain('/v1/sets?game=pokemon-japan');
    expect(calls[1]!.url).toContain('set=mbg-mega-starter-set-mega-gengar-ex-pokemon-japan');
    expect(calls[1]!.url).toContain('q=Mega%20Gengar');
    expect(calls[1]!.url).toContain('condition=NM');
  });

  it('если по имени не нашлась, ищет по номеру «003/021», потом листает сет', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('/sets?')) return json(SETS);
        if (url.includes('offset=0')) return json({ data: [MEGA_GENGAR], meta: { hasMore: false } });
        return json({ data: [], meta: { hasMore: false } });
      }),
    );
    const found = await findJusttcgCard('tcg_test', 'MBG', '3', { englishName: 'Pikachu', total: '21' });
    expect(found?.cardId).toBe(MEGA_GENGAR.id);
    expect(urls[2]).toContain(`number=${encodeURIComponent('003/021')}`);
    expect(urls[3]).toContain('offset=0');
  });

  it('сета нет в JustTCG — карты нет, лишних запросов тоже', async () => {
    const fetch = vi.fn(async () => json(SETS));
    vi.stubGlobal('fetch', fetch);
    expect(await findJusttcgCard('tcg_test', 'M1L', '3', { englishName: null, total: null })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('известные карты обновляются пакетами по 20', async () => {
    const bodies: unknown[][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const items = JSON.parse(String(init?.body)) as Array<{ cardId: string }>;
        bodies.push(items);
        return json({ data: items.map((item) => ({ id: item.cardId, variants: [{ condition: 'Near Mint', printing: 'Normal', price: 1 }] })) });
      }),
    );
    const ids = Array.from({ length: 45 }, (_, index) => `card-${index}`);
    const prices = await refreshJusttcgCards('tcg_test', ids);
    expect(bodies.map((body) => body.length)).toEqual([BATCH_LIMIT, BATCH_LIMIT, 5]);
    expect(prices.size).toBe(45);
    expect(prices.get('card-44')).toEqual({ Normal: 1 });
  });

  it('ошибки ключа, лимита и связи различаются', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Invalid API key', code: 'INVALID_API_KEY' }, 401)));
    await expect(refreshJusttcgCards('bad', ['x'])).rejects.toMatchObject({ reason: 'invalid-key' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Too many requests', code: 'RATE_LIMIT' }, 429)));
    await expect(refreshJusttcgCards('tcg_test', ['x'])).rejects.toMatchObject({ reason: 'rate-limit' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(refreshJusttcgCards('tcg_test', ['x'])).rejects.toBeInstanceOf(JusttcgError);
  });

  it('проверка ключа: японские карты есть, видно остаток запросов на сегодня', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ data: [{ id: 'pokemon' }, { id: 'pokemon-japan' }], _metadata: { apiDailyLimit: 100, apiDailyRequestsUsed: 7 } }),
      ),
    );
    expect(await checkJusttcgKey('tcg_test')).toEqual({ status: 'ok', left: 93 });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'pokemon' }] })));
    expect(await checkJusttcgKey('tcg_test')).toEqual({ status: 'no-game' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'API key is required', code: 'MISSING_API_KEY' }, 401)));
    expect(await checkJusttcgKey('')).toEqual({ status: 'invalid' });
  });
});

describe('цена своей карты из общего кэша', () => {
  const stored = { d: '2026-11-20', j: MEGA_GENGAR.id, n: 'Mega Gengar ex', v: { Holofoil: 5.81 } };

  it('карта из базы: имя не сверяется, печать подбирается', () => {
    expect(priceFor({ englishName: null, printing: 'holo', verifyName: false }, stored)).toBe(5.81);
  });

  it('карта, добавленная как есть: цена только если английское имя совпало', () => {
    expect(priceFor({ englishName: 'Mega Gengar ex', printing: 'holo', verifyName: true }, stored)).toBe(5.81);
    // Код сета прочитан неверно, и под ним другая карта: её цена нашей не станет
    expect(priceFor({ englishName: 'Mega Venusaur ex', printing: 'holo', verifyName: true }, stored)).toBeNull();
    expect(priceFor({ englishName: null, printing: 'holo', verifyName: true }, stored)).toBeNull();
  });

  it('карта не нашлась в JustTCG — цены нет', () => {
    expect(priceFor({ englishName: null, printing: 'holo', verifyName: false }, { d: '2026-11-20', j: null, n: null, v: {} })).toBeNull();
    expect(priceFor({ englishName: null, printing: 'holo', verifyName: false }, undefined)).toBeNull();
  });

  it('документ общего кэша — с кодом сета', () => {
    expect(jpPriceDocId('mBG')).toBe('jt_MBG');
    expect(jpPriceDocId('SV2a')).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
  });
});

describe('какие карты альбома спрашивают JustTCG', () => {
  const view = (patch: Partial<CardView>): CardView =>
    ({
      docId: 'x',
      cardId: null,
      catalog: null,
      setId: '',
      lang: 'ja',
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

  it('японская карта TCGdex и японская карта вне базы с английским именем — да, английская — нет', () => {
    const refs = japaneseRefs([
      view({ docId: 'SV2a-094_ja', cardId: 'SV2a-094', catalog: 'ja', setId: 'SV2a', localId: '094', printedTotal: 165 }),
      view({
        docId: 'x-ja-MBG-3',
        setId: 'MBG',
        variant: 'holo',
        printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
      }),
      view({ docId: 'x-ja-NOSET-1', printed: { name: '?', englishName: null, number: '1', total: null, setCode: null } }),
      view({ docId: 'sv03-125', cardId: 'sv03-125', catalog: 'en', lang: 'en', setId: 'sv03', localId: '125' }),
    ]);
    expect(refs.map(({ key, setCode, number, total, verifyName, printing }) => ({ key, setCode, number, total, verifyName, printing }))).toEqual([
      { key: 'SV2a-094_ja', setCode: 'SV2a', number: '094', total: '165', verifyName: false, printing: 'normal' },
      { key: 'x-ja-MBG-3', setCode: 'MBG', number: '003', total: '021', verifyName: true, printing: 'holo' },
    ]);
  });

  it('доллары JustTCG дополняют евро TCGdex, но не заменяют доллары TCGplayer из TCGdex', () => {
    expect(mergePrice({ u: null, e: 0.2 }, 1.5)).toEqual({ u: 1.5, e: 0.2 });
    expect(mergePrice(null, 5.81)).toEqual({ u: 5.81, e: null });
    expect(mergePrice({ u: 4.88, e: 3.88 }, 9)).toEqual({ u: 4.88, e: 3.88 });
    expect(mergePrice(null, null)).toBeNull();
  });
});
