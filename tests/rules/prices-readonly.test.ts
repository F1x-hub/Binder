import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { Timestamp, deleteDoc, doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJapanesePrices } from '@/lib/jp-prices';
import { loadPrices, pricesReadOnly, utcDay } from '@/lib/prices';
import { refreshClubPrices } from '../../scripts/refresh-prices-core';

/**
 * Цены только для чтения: пишет их ежедневная задача (Admin SDK обходит правила), участники
 * только читают. Здесь правила, поведение браузера при таких правилах и сама задача
 * (scripts/refresh-prices-core.ts) на эмуляторе с подменёнными ответами TCGdex, JustTCG и Limitless.
 */
let env: RulesTestEnvironment;
let admin: App;

const rulesFile = process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url);
const today = utcDay();
const month = today.slice(0, 7);
const dd = today.slice(8);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-binder',
    firestore: { rules: readFileSync(rulesFile, 'utf8') },
  });
  // FIRESTORE_EMULATOR_HOST задаёт firebase emulators:exec: Admin SDK пишет в эмулятор с правами владельца
  admin = initializeApp({ projectId: 'demo-binder' }, 'prices-job');
}, 120_000);

afterAll(async () => {
  await deleteApp(admin);
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const guest = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
  });
}

async function read(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (context) => {
    data = (await getDoc(doc(context.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

function seedMember(uid: string, overrides: Record<string, unknown> = {}) {
  return seed(`members/${uid}`, {
    displayName: uid,
    photoURL: null,
    joinedAt: Timestamp.now(),
    invitedBy: null,
    inviteCode: null,
    invitesLeft: 3,
    lastInvite: null,
    ...overrides,
  });
}

const card = (setId: string, extra: Record<string, unknown> = {}) => ({
  setId,
  count: 1,
  addedAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Подмена fetch: ответ по адресу, всё остальное — 404. Запросы копятся для проверок. */
function stubFetch(route: (url: URL, init?: RequestInit) => Response | undefined) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}${url.search}`);
      return route(url, init) ?? new Response('not found', { status: 404 });
    }),
  );
  return calls;
}

const SV03_125 = {
  id: 'sv03-125',
  localId: '125',
  name: 'Charizard ex',
  variants: { holo: true, normal: false },
  set: { id: 'sv03', name: 'Obsidian Flames', cardCount: { official: 197, total: 230 } },
  pricing: { tcgplayer: { holofoil: { marketPrice: 24.8 } }, cardmarket: { trend: 19.5 } },
};

const SV2A_094 = {
  id: 'SV2a-094',
  localId: '094',
  name: 'ミュウex',
  variants: { holo: true },
  set: { id: 'SV2a', name: 'ポケモンカード151', cardCount: { official: 165, total: 210 } },
  pricing: { cardmarket: { trend: 3.1 } },
};

const SETS = {
  data: [
    { id: 'mbg-mega-starter-set-mega-gengar-ex-pokemon-japan', name: 'MBG: MEGA Starter Set Mega Gengar ex' },
    { id: 'sv2a-pokemon-card-151-pokemon-japan', name: 'SV2a: Pokemon Card 151' },
  ],
};

const META = { apiPlan: 'Free Tier', apiDailyLimit: 100, apiDailyRequestsUsed: 7, apiDailyRequestsRemaining: 93 };

describe('правила: цены только для чтения', () => {
  const price = { cards: { 'sv03-125': { u: 4.88, e: 3.88, d: '2026-11-20' } } };

  it('участник читает, но не пишет цены, историю и цены JustTCG', async () => {
    await seedMember('alice');
    await seed('prices/sv03', price);
    await seed('prices/sv03/months/2026-11', { 'sv03-125': { '20': { u: 4.88, e: 3.88 } } });
    await assertSucceeds(getDoc(doc(as('alice'), 'prices/sv03')));
    await assertSucceeds(getDoc(doc(as('alice'), 'prices/sv03/months/2026-11')));
    await assertFails(setDoc(doc(as('alice'), 'prices/sv03'), price, { merge: true }));
    await assertFails(updateDoc(doc(as('alice'), 'prices/sv03'), { 'cards.x': { u: 1, e: 1, d: today } }));
    await assertFails(setDoc(doc(as('alice'), 'prices/sv04'), price));
    await assertFails(setDoc(doc(as('alice'), 'prices/sv03/months/2026-11'), { 'sv03-125': { '21': { u: 1, e: 1 } } }, { merge: true }));
    await assertFails(setDoc(doc(as('alice'), 'prices/jt_MBG'), { cards: { '3': { d: today, j: 'x', n: 'x', v: {} } } }));
  });

  it('админ клуба тоже не пишет цены: их пишет только задача', async () => {
    await seedMember('root', { role: 'admin' });
    await assertFails(setDoc(doc(as('root'), 'prices/sv03'), price));
    await assertFails(setDoc(doc(as('root'), 'prices/sv03/months/2026-11'), {}));
  });

  it('посторонний не читает и не пишет, цены не удаляются', async () => {
    await seedMember('alice');
    await seed('prices/sv03', price);
    await assertFails(getDoc(doc(as('mallory'), 'prices/sv03')));
    await assertFails(getDoc(doc(guest(), 'prices/sv03')));
    await assertFails(setDoc(doc(as('mallory'), 'prices/sv03'), price));
    await assertFails(deleteDoc(doc(as('alice'), 'prices/sv03')));
    await assertFails(deleteDoc(doc(as('alice'), 'prices/sv03/months/2026-11')));
  });
});

describe('браузер при ценах только для чтения', () => {
  it('документ задачи браузер только читает: TCGdex спрашивается лишь о карте, которой там нет', async () => {
    await seedMember('alice');
    await seed('prices/sv03', { cards: { 'sv03-125': { u: 20, e: 18, d: '2000-01-01' } }, server: today });
    const calls = stubFetch((url) => (url.pathname === '/v2/en/cards/sv03-126' ? json({ ...SV03_125, id: 'sv03-126' }) : undefined));
    const prices = await loadPrices(as('alice'), [
      { cardId: 'sv03-125', setId: 'sv03', lang: 'en' },
      { cardId: 'sv03-126', setId: 'sv03', lang: 'en' },
    ]);
    // Вчерашняя цена задачи не освежается браузером, новая карта видна сразу, но в общий кэш не пишется
    expect(prices.get('sv03-125')).toEqual({ u: 20, e: 18 });
    expect(prices.get('sv03-126')).toEqual({ u: 24.8, e: 19.5 });
    expect(calls).toEqual(['GET api.tcgdex.net/v2/en/cards/sv03-126']);
    expect((await read('prices/sv03'))?.cards).not.toHaveProperty('sv03-126');
    expect(pricesReadOnly()).toBe(false);
  });

  it('без задачи браузер показывает свежую цену, а отказ правил молча включает режим «только чтение»', async () => {
    await seedMember('alice');
    await seed('config/justtcg', { items: [{ key: 'tcg_club_key_1', label: '', enabled: true, addedAt: Timestamp.now() }] });
    await seed('prices/sv03', { cards: { 'sv03-125': { u: 20, e: 18, d: '2000-01-01' } } });
    await seed('prices/jt_MBG', { cards: { '3': { d: '2000-01-01', j: 'pokemon-japan-mbg-3', n: 'Mega Gengar ex', v: { Holofoil: 5 } } } });
    const calls = stubFetch((url) => (url.pathname === '/v2/en/cards/sv03-125' ? json(SV03_125) : undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prices = await loadPrices(as('alice'), [{ cardId: 'sv03-125', setId: 'sv03', lang: 'en' }]);
    expect(prices.get('sv03-125')).toEqual({ u: 24.8, e: 19.5 });
    expect((await read('prices/sv03'))?.cards).toEqual({ 'sv03-125': { u: 20, e: 18, d: '2000-01-01' } });
    expect(pricesReadOnly()).toBe(true);
    // Отказ правил SDK Firestore пишет в журнал сам; Binder не считает его ошибкой
    expect(warn.mock.calls.filter(([first]) => String(first).startsWith('[binder]'))).toEqual([]);

    // После отказа запросы JustTCG клуба браузер не тратит: видна последняя известная цена
    const dollars = await loadJapanesePrices(as('alice'), [
      { key: 'mine', setCode: 'MBG', number: '003', total: '021', englishName: 'Mega Gengar ex', printing: 'holo', verifyName: true },
    ]);
    expect(dollars.get('mine')).toBe(5);
    expect(calls.filter((call) => call.includes('justtcg'))).toEqual([]);
    warn.mockRestore();
  });
});

describe('ежедневная задача цен', () => {
  async function seedClub() {
    await seedMember('alice');
    await seedMember('bob');
    await seed('config/justtcg', {
      items: [
        { key: 'tcg_spent_key_1', label: 'кончился', enabled: true, addedAt: Timestamp.now() },
        { key: 'tcg_off_key_22', label: 'выключен', enabled: false, addedAt: Timestamp.now() },
        { key: 'tcg_club_key_1', label: 'основной', enabled: true, addedAt: Timestamp.now() },
      ],
      updatedAt: Timestamp.now(),
      updatedBy: 'alice',
    });
    await seed('members/alice/cards/sv03-125', card('sv03', { lang: 'en', variant: 'holo' }));
    await seed('members/bob/cards/sv03-125', card('sv03'));
    // Французская печать — та же карта английского каталога, корейская — только похожая, без цены
    await seed('members/bob/cards/sv03-125_fr', card('sv03', { lang: 'fr' }));
    await seed('members/bob/cards/SV2a-094_ko', card('SV2a', { lang: 'ko' }));
    await seed('members/alice/cards/SV2a-094_ja', card('SV2a', { lang: 'ja', variant: 'holo' }));
    await seed(
      'members/alice/cards/x-ja-MBG-3',
      card('MBG', {
        lang: 'ja',
        variant: 'holo',
        printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
      }),
    );
    // Альбом убранного из клуба участника остаётся в базе, но цены ему не нужны
    await seed('members/ghost/cards/sv04-001', card('sv04'));
    await seed('prices/jt_MBG', {
      cards: { '3': { d: '2000-01-01', j: 'pokemon-japan-mbg-mega-gengar-ex', n: 'Mega Gengar ex', v: { Holofoil: 5 } } },
    });
  }

  function jobFetch() {
    return stubFetch((url, init) => {
      if (url.host === 'api.tcgdex.net') {
        if (url.pathname === '/v2/en/cards/sv03-125') return json(SV03_125);
        if (url.pathname === '/v2/ja/cards/SV2a-094') return json(SV2A_094);
        return undefined;
      }
      if (url.host === 'limitlesstcg.com' && url.pathname === '/api/cards/SV2a/94') {
        return json({ set: 'SV2a', number: '94', name: url.search.includes('translate') ? 'Mew ex' : 'ミュウex', translation: 1 });
      }
      if (url.host !== 'api.justtcg.com') return undefined;
      const key = new Headers(init?.headers).get('x-api-key');
      if (key === 'tcg_spent_key_1') return json({ error: 'limit', code: 'DAILY_LIMIT_EXCEEDED' }, 429);
      if (key !== 'tcg_club_key_1') return json({ error: 'bad key', code: 'INVALID_API_KEY' }, 401);
      if (url.pathname === '/v1/sets') return json({ data: SETS.data, _metadata: META });
      if (url.pathname === '/v1/cards' && init?.method === 'POST') {
        return json({
          data: [
            {
              id: 'pokemon-japan-mbg-mega-gengar-ex',
              name: 'Mega Gengar ex - 003/021',
              number: '003/021',
              variants: [{ condition: 'Near Mint', printing: 'Holofoil', price: 5.81 }],
            },
          ],
          _metadata: META,
        });
      }
      if (url.pathname === '/v1/cards' && url.searchParams.get('set') === 'sv2a-pokemon-card-151-pokemon-japan') {
        return json({
          data: [
            {
              id: 'pokemon-japan-sv2a-mew-ex-094',
              name: 'Mew ex - 094/165',
              number: '094/165',
              variants: [{ condition: 'Near Mint', printing: 'Holofoil', price: 12.4 }],
            },
          ],
          _metadata: META,
        });
      }
      return undefined;
    });
  }

  it('освежает TCGdex и JustTCG и пишет те же документы, что браузер, с отметкой задачи', async () => {
    await seedClub();
    const calls = jobFetch();
    const report = await refreshClubPrices(adminFirestore(admin), { today });

    expect(report.members).toBe(2);
    expect(report.tcgdex).toEqual({ sets: 2, cards: 2, refreshed: 2, failed: 0, docs: { marked: 2, partial: 0, skipped: 0 } });
    expect(report.justtcg).toMatchObject({
      sets: 2,
      cards: 2,
      refreshed: 2,
      searched: 1,
      keys: 2,
      error: null,
      docs: { marked: 2, partial: 0, skipped: 0 },
    });

    expect(await read('prices/sv03')).toEqual({ cards: { 'sv03-125': { u: 24.8, e: 19.5, d: today } }, server: today });
    expect(await read(`prices/sv03/months/${month}`)).toEqual({ 'sv03-125': { [dd]: { u: 24.8, e: 19.5 } } });
    expect(await read('prices/ja_SV2a')).toEqual({ cards: { 'SV2a-094': { u: null, e: 3.1, d: today } }, server: today });
    expect(await read('prices/jt_MBG')).toEqual({
      cards: { '3': { d: today, j: 'pokemon-japan-mbg-mega-gengar-ex', n: 'Mega Gengar ex', v: { Holofoil: 5.81 } } },
      server: today,
    });
    expect(await read(`prices/jt_MBG/months/${month}`)).toEqual({ '3': { [dd]: { Holofoil: 5.81 } } });
    expect(await read('prices/jt_SV2A')).toEqual({
      cards: { '94': { d: today, j: 'pokemon-japan-sv2a-mew-ex-094', n: 'Mew ex', v: { Holofoil: 12.4 } } },
      server: today,
    });
    expect(await read('prices/sv04')).toBeUndefined();

    // Каждая карта TCGdex — один раз, хотя её держат двое и в двух печатях; ключ с исчерпанным
    // лимитом отложен после первого отказа, выключенный не трогается
    expect(calls.filter((call) => call.includes('tcgdex'))).toHaveLength(2);
    const justtcg = calls.filter((call) => call.includes('justtcg'));
    expect(justtcg[0]).toMatch(/^POST api\.justtcg\.com\/v1\/cards/);
    expect(justtcg.filter((call) => call.includes('/v1/sets'))).toHaveLength(1);

    // Участник читает итог задачи без единого запроса к базам
    const after = stubFetch(() => undefined);
    const prices = await loadPrices(as('alice'), [
      { cardId: 'sv03-125', setId: 'sv03', lang: 'en' },
      { cardId: 'SV2a-094', setId: 'SV2a', lang: 'ja' },
    ]);
    expect(prices.get('sv03-125')).toEqual({ u: 24.8, e: 19.5 });
    expect(prices.get('ja:SV2a-094')).toEqual({ u: null, e: 3.1 });
    const dollars = await loadJapanesePrices(as('alice'), [
      { key: 'gengar', setCode: 'MBG', number: '003', total: '021', englishName: 'Mega Gengar ex', printing: 'holo', verifyName: true },
      { key: 'mew', setCode: 'SV2a', number: '094', total: '165', englishName: null, printing: 'holo', verifyName: false },
    ]);
    expect(dollars.get('gengar')).toBe(5.81);
    expect(dollars.get('mew')).toBe(12.4);
    expect(after).toEqual([]);
  });

  it('второй запуск в тот же день ничего не спрашивает у баз и не стирает уже свежие карты', async () => {
    await seedClub();
    jobFetch();
    await refreshClubPrices(adminFirestore(admin), { today });
    const before = { sv03: await read('prices/sv03'), mbg: await read('prices/jt_MBG'), month: await read(`prices/sv03/months/${month}`) };
    const calls = jobFetch();
    const report = await refreshClubPrices(adminFirestore(admin), { today });
    expect(calls).toEqual([]);
    expect(report.tcgdex.refreshed).toBe(0);
    expect(report.justtcg.refreshed).toBe(0);
    expect(report.tcgdex.docs.marked).toBe(2);
    expect(await read('prices/sv03')).toEqual(before.sv03);
    expect(await read('prices/jt_MBG')).toEqual(before.mbg);
    expect(await read(`prices/sv03/months/${month}`)).toEqual(before.month);
  });

  it('документы, которые браузер уже освежил сегодня, остаются целыми: задача только ставит отметку', async () => {
    await seedClub();
    // Так было в binder-54fb1 21 ноября 2026: браузер освежил цены днём, а задача записала пустую карту cards
    const sv03 = { 'sv03-125': { u: 30, e: 25, d: today }, 'sv03-999': { u: 1, e: 1, d: '2026-11-01' } };
    const mbg = { '3': { d: today, j: 'pokemon-japan-mbg-mega-gengar-ex', n: 'Mega Gengar ex', v: { Holofoil: 5.81 } } };
    const history = { 'sv03-125': { '01': { u: 20, e: 18 }, [dd]: { u: 30, e: 25 } } };
    await seed('prices/sv03', { cards: sv03 });
    await seed('prices/ja_SV2a', { cards: { 'SV2a-094': { u: null, e: 3, d: today } } });
    await seed('prices/jt_MBG', { cards: mbg });
    await seed('prices/jt_SV2A', { cards: { '94': { d: today, j: 'pokemon-japan-sv2a-mew-ex-094', n: 'Mew ex', v: { Holofoil: 12 } } } });
    await seed(`prices/sv03/months/${month}`, history);
    const calls = jobFetch();
    await refreshClubPrices(adminFirestore(admin), { today });
    expect(calls).toEqual([]);
    expect(await read('prices/sv03')).toEqual({ cards: sv03, server: today });
    expect(await read('prices/jt_MBG')).toEqual({ cards: mbg, server: today });
    expect(await read(`prices/sv03/months/${month}`)).toEqual(history);
  });

  it('освежённая карта пишется точечно: соседние карты документа и прежние дни истории остаются', async () => {
    await seedClub();
    await seed('prices/sv03', { cards: { 'sv03-125': { u: 1, e: 1, d: '2026-11-01' }, 'sv03-999': { u: 2, e: 2, d: '2026-11-01' } } });
    await seed(`prices/sv03/months/${month}`, { 'sv03-125': { '01': { u: 1, e: 1 } }, 'sv03-999': { '01': { u: 2, e: 2 } } });
    jobFetch();
    await refreshClubPrices(adminFirestore(admin), { today });
    expect((await read('prices/sv03'))?.cards).toEqual({
      'sv03-125': { u: 24.8, e: 19.5, d: today },
      'sv03-999': { u: 2, e: 2, d: '2026-11-01' },
    });
    expect(await read(`prices/sv03/months/${month}`)).toEqual({
      'sv03-125': { '01': { u: 1, e: 1 }, [dd]: { u: 24.8, e: 19.5 } },
      'sv03-999': { '01': { u: 2, e: 2 } },
    });
  });

  it('без ключей JustTCG освежает TCGdex, а документы jt_* не трогает и не помечает', async () => {
    await seedClub();
    await seed('config/justtcg', { items: [], updatedAt: Timestamp.now(), updatedBy: 'alice' });
    const before = await read('prices/jt_MBG');
    const calls = jobFetch();
    const lines: string[] = [];
    const report = await refreshClubPrices(adminFirestore(admin), { today, log: (line) => lines.push(line) });
    expect(report.justtcg.error).toBe('no-key');
    expect(report.justtcg.docs).toEqual({ marked: 0, partial: 0, skipped: 2 });
    expect(calls.filter((call) => call.includes('justtcg'))).toEqual([]);
    expect(await read('prices/jt_MBG')).toEqual(before);
    expect(await read('prices/jt_SV2A')).toBeUndefined();
    expect((await read('prices/sv03'))?.server).toBe(today);
    expect(lines.some((line) => line.includes('ключей JustTCG нет — японские цены не освежены'))).toBe(true);
  });

  it('пустой ответ JustTCG не стирает известную цену и не ставит отметку', async () => {
    await seedClub();
    const before = await read('prices/jt_MBG');
    stubFetch((url) => {
      if (url.host === 'api.tcgdex.net' && url.pathname === '/v2/en/cards/sv03-125') return json(SV03_125);
      if (url.host === 'api.tcgdex.net' && url.pathname === '/v2/ja/cards/SV2a-094') return json(SV2A_094);
      if (url.host === 'api.justtcg.com') return json({ data: [], _metadata: META });
      return undefined;
    });
    const report = await refreshClubPrices(adminFirestore(admin), { today });
    expect(await read('prices/jt_MBG')).toEqual(before);
    // Новую карту JustTCG сегодня не нашёл: это свежий ответ «не нашлась» (j: null), такой документ помечается
    expect(report.justtcg.docs).toEqual({ marked: 1, partial: 0, skipped: 1 });
    expect(await read('prices/jt_SV2A')).toEqual({ cards: { '94': { d: today, j: null, n: null, v: {} } }, server: today });
  });

  it('если все ключи JustTCG упёрлись в лимит, документы jt_* остаются как были', async () => {
    await seedClub();
    const before = await read('prices/jt_MBG');
    stubFetch((url) => {
      if (url.host === 'api.tcgdex.net' && url.pathname === '/v2/en/cards/sv03-125') return json(SV03_125);
      if (url.host === 'api.justtcg.com') return json({ error: 'limit', code: 'DAILY_LIMIT_EXCEEDED' }, 429);
      return undefined;
    });
    const report = await refreshClubPrices(adminFirestore(admin), { today });
    expect(report.justtcg.error).toBe('rate-limit');
    expect(report.justtcg.docs).toEqual({ marked: 0, partial: 0, skipped: 2 });
    expect(await read('prices/jt_MBG')).toEqual(before);
    expect(await read('prices/jt_SV2A')).toBeUndefined();
  });

  it('если TCGdex не отдал карту, сет освежается без отметки задачи: браузер покажет цену сам', async () => {
    await seedClub();
    await seed('prices/sv03', { cards: { 'sv03-125': { u: 1, e: 1, d: '2026-11-01' } }, server: '2026-11-20' });
    stubFetch(() => undefined);
    const report = await refreshClubPrices(adminFirestore(admin), { today });
    expect(report.tcgdex).toMatchObject({ refreshed: 0, failed: 2, docs: { marked: 0, partial: 0, skipped: 2 } });
    expect(await read('prices/sv03')).toEqual({ cards: { 'sv03-125': { u: 1, e: 1, d: '2026-11-01' } }, server: '2026-11-20' });
    expect(await read('prices/ja_SV2a')).toBeUndefined();
  });
});
