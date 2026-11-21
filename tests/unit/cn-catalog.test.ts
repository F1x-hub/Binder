import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Кэш IndexedDB в тестах не нужен: каждый запрос идёт в подменённый fetch
vi.mock('@/lib/kv-cache', () => ({
  cached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  cacheGet: async () => null,
  cachePut: async () => undefined,
}));

import { detailIdsFrom, twCardFrom, twImage } from '@/lib/asia-tw';
import { catalog, findCandidates } from '@/lib/catalog';
import { buildCnIndex, cnCatalog, setCnIndexForTests, type RawCnDataset } from '@/lib/cn-catalog';
import { decide, type Candidate, type DetectedCard } from '@/lib/matching';
import { decodeTurboStream, matchPikaqian, pikaqianCardsFrom, pikaqianPrice, type PikaqianCard } from '@/lib/pikaqian';
import { refreshTcgdexPrices } from '@/lib/price-refresh';
import { cardImage } from '@/lib/tcgdex';
import { toNewCard } from '@/scan/useScan';

/** Запись официальной базы в том виде, в каком её выкладывает PTCG-CHS-Datasets. */
type RawCard = RawCnDataset['collections'][number]['cards'] extends Array<infer T> | undefined ? T : never;

function record(id: number, details: Record<string, unknown>, extra: { yorenCode?: string } = {}): RawCard {
  return { id, name: String(details.cardName), yorenCode: extra.yorenCode ?? `Y${id}`, image: `img/1/${id}.png`, details: { ...details } };
}

const HAZEL = { cardName: '榛果球', collectionNumber: '001/127', cardType: '1', evolveText: '基础', hp: 70, attribute: '1' };

const RAW: RawCnDataset = {
  collections: [
    {
      commodityCode: '151C1',
      name: '收集啦151 旅',
      salesDate: '2025-07-18',
      cards: [
        // Та же карта, что и в более раннем 151C: относится к 151C
        record(500, { cardName: '妙蛙种子', collectionNumber: '001/151', cardType: '1', evolveText: '基础', rarityText: 'C', commodityList: [{ commodityCode: '151C1' }, { commodityCode: '151C' }] }),
      ],
    },
    {
      commodityCode: 'CSV1C',
      name: '补充包 亘古开来',
      salesDate: '2025-01-17',
      seriesText: '朱&紫',
      cards: [
        record(11828, { ...HAZEL, rarityText: 'C', special_shiny_type: 0, abilityItemList: [{ abilityName: '撞击', abilityText: '', abilityCost: '1,11', abilityDamage: '20' }], weaknessType: '2', weaknessFormula: '×2', retreatCost: 1, regulationMarkText: 'G', illustratorName: ['Akira Komayama'] }, { yorenCode: 'P204' }),
        record(11995, { ...HAZEL, rarityText: 'C★', special_shiny_type: 1 }, { yorenCode: 'P204' }),
        record(12108, { ...HAZEL, rarityText: 'C★★', special_shiny_type: 2 }, { yorenCode: 'P204' }),
        record(11988, { cardName: '派帕', collectionNumber: '161/127', cardType: '2', trainerType: '2', rarityText: 'SAR', ruleText: '选择自己牌库中「物品」和「宝可梦道具」各1张。|在自己的回合只可以使用1张支援者卡。' }),
        record(11900, { cardName: '基本草能量', collectionNumber: '162/127', cardType: '3', energyType: '1', rarityText: '无标记' }),
        record(11901, { cardName: '君主蛇ex', collectionNumber: '003/127', cardType: '1', evolveText: '2阶进化', hp: 320, attribute: '1', rarityText: 'RR', pokemonType: '11', cardFeatureItemList: [{ featureName: '皇家声援', featureDesc: '伤害「+20」。' }], resistanceType: '6', resistanceFormula: '-30' }),
      ],
    },
    {
      commodityCode: '151C',
      name: '收集啦151 活动包',
      salesDate: '2025-01-17',
      cards: [record(500, { cardName: '妙蛙种子', collectionNumber: '001/151', cardType: '1', evolveText: '基础', rarityText: 'C', commodityList: [{ commodityCode: '151C1' }, { commodityCode: '151C' }] })],
    },
    {
      commodityCode: 'PROMO',
      name: '特典卡',
      salesDate: '2022-10-27',
      cards: [
        record(10, { cardName: '胜利之印', collectionNumber: 'SV-P', cardType: '2', trainerType: '1' }),
        record(11, { cardName: '高级球', collectionNumber: 'SV-P', cardType: '2', trainerType: '1' }),
      ],
    },
    { commodityCode: 'bad code!', name: 'нельзя в ID', cards: [record(1, { cardName: 'x', collectionNumber: '1/1' })] },
  ],
};

const index = buildCnIndex(RAW);

describe('сборка каталога КНР', () => {
  it('сеты новые первыми, кривой код товара пропущен, число карт — самое частое после дроби', () => {
    // У 151C1 своих карт нет: его карты живут в более раннем 151C
    expect(index.sets.map((set) => set.id)).toEqual(['CSV1C', '151C', 'PROMO']);
    const csv1c = index.sets.find((set) => set.id === 'CSV1C')!;
    expect(csv1c.official).toBe(127);
    expect(csv1c.serie).toBe('朱&紫');
  });

  it('печати C, C★ и C★★ одной карты — одна карта с обычной и реверсом, скан обычной печати', async () => {
    const detail = await catalogCard('CSV1C-001');
    expect(detail.name).toBe('榛果球');
    expect(detail.rarity).toBe('Common');
    expect(detail.variants).toEqual({ normal: true, holo: false, reverse: true });
    expect(detail.image).toBe('https://raw.githubusercontent.com/duanxr/PTCG-CHS-Datasets/main/img/1/11828.png');
    const found = await cnCatalog.find('CSV1C-001');
    expect(found?.card.prints.map((print) => print.o)).toEqual([11828, 11995, 12108]);
  });

  it('сведения покемона в форме TCGdex: стадия, тип, атаки со стоимостью, слабость, отступление', async () => {
    const detail = (await catalogCard('CSV1C-001')) as unknown as Record<string, unknown>;
    expect(detail).toMatchObject({
      category: 'Pokemon',
      hp: 70,
      types: ['Grass'],
      stage: 'Basic',
      attacks: [{ name: '撞击', cost: ['Grass', 'Colorless'], damage: '20' }],
      weaknesses: [{ type: 'Fire', value: '×2' }],
      retreat: 1,
      regulationMark: 'G',
      illustrator: 'Akira Komayama',
    });
    const serperior = (await catalogCard('CSV1C-003')) as unknown as Record<string, unknown>;
    expect(serperior).toMatchObject({
      stage: 'Stage2',
      rarity: 'Double Rare',
      abilities: [{ type: 'Ability', name: '皇家声援' }],
      resistances: [{ type: 'Fighting', value: '-30' }],
      variants: { normal: false, holo: true, reverse: false },
    });
  });

  it('тренер и энергия: тип тренера, текст, базовая энергия', async () => {
    expect(await catalogCard('CSV1C-161')).toMatchObject({
      category: 'Trainer',
      trainerType: 'Supporter',
      rarity: 'Special Art Rare',
      effect: '选择自己牌库中「物品」和「宝可梦道具」各1张。\n在自己的回合只可以使用1张支援者卡。',
    });
    expect(await catalogCard('CSV1C-162')).toMatchObject({ category: 'Energy', energyType: 'Normal' });
  });

  it('карта из нескольких товаров живёт в самом раннем, а под одним номером разные карты различаются ID', async () => {
    expect((await catalog.set('151C', 'zh-cn')).cards.map((card) => card.id)).toEqual(['151C-001']);
    await expect(catalog.set('151C1', 'zh-cn')).rejects.toThrow();
    const promo = await catalog.set('PROMO', 'zh-cn');
    expect(promo.cards.map((card) => [card.id, card.localId, card.name])).toEqual([
      ['PROMO-SVP', 'SV-P', '胜利之印'],
      ['PROMO-SVP.11', 'SV-P', '高级球'],
    ]);
  });
});

async function catalogCard(id: string) {
  return catalog.card(id, 'zh-cn');
}

// ---- PikaQian ----

/** Кодирует значение в turbo-stream, как React Router: объекты — {"_ключ": значение}, всё по индексам. */
function encodeTurbo(value: unknown): string {
  const flat: unknown[] = [];
  const put = (item: unknown): number => {
    if (item === null) return -5;
    const index = flat.length;
    if (Array.isArray(item)) {
      flat.push(null);
      flat[index] = item.map(put);
    } else if (item && typeof item === 'object') {
      flat.push(null);
      const out: Record<string, number> = {};
      for (const [key, inner] of Object.entries(item)) {
        const keyIndex = flat.length;
        flat.push(key);
        out[`_${keyIndex}`] = put(inner);
      }
      flat[index] = out;
    } else flat.push(item);
    return index;
  };
  put(value);
  return `${JSON.stringify(flat)}\n`;
}

const pikaqianCard = (overrides: Record<string, unknown>) => ({
  id: 'uuid',
  card_set_id: 'csv1c',
  card_number: '161',
  native_card_name: '派帕',
  english_card_name: 'Arven',
  we_chat_id: 11988,
  current_price: { raw_price_cents: 7998, cardmarket_price_cents: 868, recent_sale_count: 0, updated_at: '2026-11-21T12:20:15Z' },
  ...overrides,
});

function pikaqianPage(cards: unknown[]): string {
  return encodeTurbo({ root: { data: { user: null } }, 'routes/sets.$setId': { data: { cards, set: { id: 'csv1c' } } } });
}

describe('PikaQian', () => {
  it('разбирает страницу сета в turbo-stream', () => {
    const cards = pikaqianCardsFrom(decodeTurboStream(pikaqianPage([pikaqianCard({}), pikaqianCard({ we_chat_id: null, current_price: null })])));
    expect(cards).toEqual([
      { weChatId: 11988, number: '161', name: '派帕', englishName: 'Arven', raw: 79.98, cardmarket: 8.68, recentSales: 0, updatedAt: '2026-11-21T12:20:15Z' },
      { weChatId: null, number: '161', name: '派帕', englishName: 'Arven', raw: null, cardmarket: null, recentSales: 0, updatedAt: null },
    ]);
    expect(pikaqianCardsFrom(decodeTurboStream(encodeTurbo({ root: {} })))).toBeNull();
  });

  it('цена — Cardmarket (свежий каждый день), без него — последняя продажа на eBay', () => {
    expect(pikaqianPrice({ raw: 79.98, cardmarket: 8.68 })).toBe(8.68);
    expect(pikaqianPrice({ raw: 79.98, cardmarket: null })).toBe(79.98);
    expect(pikaqianPrice({ raw: null, cardmarket: null })).toBeNull();
  });

  it('карту ищет по ID печати, иначе по номеру и имени; чужое имя под тем же номером не берёт', () => {
    const cards: PikaqianCard[] = [
      { weChatId: 1, number: '001', name: '榛果球', englishName: 'Pineco', raw: 1, cardmarket: null, recentSales: 0, updatedAt: null },
      { weChatId: 2, number: '161', name: '派帕', englishName: 'Arven', raw: 5, cardmarket: null, recentSales: 0, updatedAt: null },
    ];
    expect(matchPikaqian(cards, { localId: '161', name: '?', prints: [{ o: 2 }] })?.englishName).toBe('Arven');
    expect(matchPikaqian(cards, { localId: '1', name: '榛果球', prints: [{ o: 99 }] })?.englishName).toBe('Pineco');
    expect(matchPikaqian(cards, { localId: '1', name: '派帕', prints: [{ o: 99 }] })).toBeNull();
  });
});

// ---- Сканер и цены поверх каталога ----

const arven = (overrides: Partial<DetectedCard>): DetectedCard => ({
  name: '派帕',
  englishName: 'Arven',
  number: '161',
  total: '127',
  setCode: 'CSV1C',
  holo: true,
  language: 'zh-cn',
  box: null,
  confidence: 0.9,
  ...overrides,
});

let pikaqian: unknown[] | 'down' | 'missing' = [];
let requests: string[] = [];

beforeEach(() => {
  setCnIndexForTests(index);
  pikaqian = [pikaqianCard({}), pikaqianCard({ card_number: '001', native_card_name: '榛果球', english_card_name: 'Pineco', we_chat_id: 11828, current_price: { raw_price_cents: 25 } })];
  requests = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://pikaqian.com/sets/csv1c.data') {
      if (pikaqian === 'down') throw new TypeError('Failed to fetch');
      if (pikaqian === 'missing') return new Response('', { status: 404 });
      return new Response(pikaqianPage(pikaqian), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCnIndexForTests(null);
});

describe('сканер: китайская карта для КНР', () => {
  it('по коду сета и номеру узнаётся сразу, английское имя — из PikaQian, в TCGdex не ходит', async () => {
    const decision = decide(await findCandidates(arven({})));
    expect(decision.status).toBe('ready');
    if (decision.status !== 'ready') return;
    expect(decision.pick).toMatchObject({ cardId: 'CSV1C-161', setId: 'CSV1C', lang: 'zh-cn', englishName: 'Arven', approximate: false, source: 'tcgdex' });
    expect(requests.some((url) => url.includes('tcgdex'))).toBe(false);
    const { card } = toNewCard({ detected: arven({}), pick: decision.pick, details: {}, thumb: null });
    expect(card).toMatchObject({ docId: 'CSV1C-161_zh-cn', setId: 'CSV1C', lang: 'zh-cn' });
    expect(card.printed).toBeUndefined();
  });

  it('без кода сета — по имени и номеру; чужое имя под тем же номером отбрасывается', async () => {
    expect((await findCandidates(arven({ setCode: null }))).map((item) => item.cardId)).toEqual(['CSV1C-161']);
    expect(await findCandidates(arven({ name: '妙蛙种子', englishName: 'Bulbasaur' }))).toEqual([]);
  });

  it('PikaQian недоступен: карта узнаётся, только без английского имени', async () => {
    pikaqian = 'down';
    const [pick] = await findCandidates(arven({}));
    expect(pick?.cardId).toBe('CSV1C-161');
    expect(pick?.englishName).toBeUndefined();
  });
});

describe('цены китайских карт в общем кэше', () => {
  it('цена в долларах из PikaQian в той же форме, что у TCGdex; без цены — null, но сегодня уже спрошена', async () => {
    const fresh = await refreshTcgdexPrices('zh-cn', ['CSV1C-161', 'CSV1C-001', 'CSV1C-162'], '2026-11-21');
    expect(fresh.updates).toEqual({
      'CSV1C-161': { u: 8.68, e: null, d: '2026-11-21' },
      'CSV1C-001': { u: 0.25, e: null, d: '2026-11-21' },
      'CSV1C-162': { u: null, e: null, d: '2026-11-21' },
    });
    // История — только у карт с ценой; карточки — у всех, по ним задача видит, что сет освежён целиком
    expect(Object.keys(fresh.history).sort()).toEqual(['CSV1C-001', 'CSV1C-161']);
    expect(fresh.history['CSV1C-161']).toEqual({ '21': { u: 8.68, e: null } });
    expect(fresh.details.size).toBe(3);
  });

  it('PikaQian не ответил: карты сета не освежены и остаются со вчерашней ценой', async () => {
    pikaqian = 'down';
    const fresh = await refreshTcgdexPrices('zh-cn', ['CSV1C-161'], '2026-11-21');
    expect(fresh.updates).toEqual({});
    expect(fresh.details.size).toBe(0);
  });

  it('сета у PikaQian нет: цены нет, но карта сегодня уже спрошена', async () => {
    pikaqian = 'missing';
    const fresh = await refreshTcgdexPrices('zh-cn', ['CSV1C-161'], '2026-11-21');
    expect(fresh.updates).toEqual({ 'CSV1C-161': { u: null, e: null, d: '2026-11-21' } });
  });
});

// ---- Сканы и Тайвань ----

describe('сканы китайских карт', () => {
  it('готовый файл берётся как есть, у TCGdex добавляется размер', () => {
    expect(cardImage('https://raw.githubusercontent.com/x/main/img/1/2.png', 'low')).toBe('https://raw.githubusercontent.com/x/main/img/1/2.png');
    expect(cardImage(twImage(8124), 'high')).toBe('https://asia.pokemon-card.com/tw/card-img/tw00008124.png');
    expect(cardImage('https://assets.tcgdex.net/ja/SV/SV2a/094', 'low')).toBe('https://assets.tcgdex.net/ja/SV/SV2a/094/low.webp');
  });

  it('страница карты сайта Pokémon Asia: имя, номер, код сета', () => {
    const html = `<title>妙蛙種子 | 訓練家網站</title>
      <span class="collectorNumber">
                        001/165
                    </span>
      <a href="/tw/card-search/list/?expansionCodes=SV2a">強化擴充包「寶可夢卡牌151」</a>`;
    expect(twCardFrom(8124, html)).toEqual({ detailId: 8124, name: '妙蛙種子', number: '001', total: '165', setCode: 'SV2a', image: twImage(8124) });
    expect(twCardFrom(1, '<title>x</title>')).toBeNull();
    expect(detailIdsFrom('<a href="/tw/card-search/detail/8124/"></a><a href="/tw/card-search/detail/8124/"></a><a href="/tw/card-search/detail/9/">')).toEqual([8124, 9]);
  });

  it('тайваньская карта с сайта идёт в альбом как есть, с именем и кодом сета с сайта', () => {
    const pick: Candidate = {
      cardId: 'tw:19913',
      setId: 'M6a',
      name: '蛋蛋',
      localId: '001',
      image: twImage(19913),
      setName: 'M6a',
      printedTotal: 103,
      setCode: 'M6a',
      releaseDate: null,
      lang: 'zh-tw',
      approximate: false,
      source: 'asia',
      score: 0.9,
    };
    const detected: DetectedCard = { name: '蛋旦', englishName: 'Exeggcute', number: '001', total: '103', setCode: 'M6A', holo: false, language: 'zh-tw', box: null, confidence: 0.8 };
    const { card, thumb } = toNewCard({ detected, pick, details: {}, thumb: 'data:image/webp;base64,AA' });
    expect(card).toMatchObject({ docId: 'x-zh-tw-M6A-1', lang: 'zh-tw', printed: { name: '蛋蛋', setCode: 'M6a', number: '001' } });
    expect(thumb).toBe('data:image/webp;base64,AA');
  });
});
