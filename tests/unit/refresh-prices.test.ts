import { describe, expect, it } from 'vitest';
import { ownedFromDoc } from '@/lib/collection';
import { serverManaged } from '@/lib/price-refresh';
import type { CardDetail } from '@/lib/tcgdex';
import { japaneseTargets, memoryKeyStore } from '../../scripts/refresh-prices-core';

describe('отметка ежедневной задачи', () => {
  it('документ задачи браузер только читает, пока задача приходила не дольше двух дней назад', () => {
    expect(serverManaged({ server: '2026-11-21' }, '2026-11-21')).toBe(true);
    expect(serverManaged({ server: '2026-11-19' }, '2026-11-21')).toBe(true);
    expect(serverManaged({ server: '2026-11-18' }, '2026-11-21')).toBe(false);
    expect(serverManaged({ cards: {} }, '2026-11-21')).toBe(false);
    expect(serverManaged({ server: '' }, '2026-11-21')).toBe(false);
    expect(serverManaged(undefined, '2026-11-21')).toBe(false);
  });
});

describe('темп запросов JustTCG у задачи', () => {
  it('не больше 10 запросов с ключа за минуту: одиннадцатый ждёт, другой ключ — нет', async () => {
    let clock = 1_000_000;
    const waits: number[] = [];
    const store = memoryKeyStore({
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    for (let index = 0; index < 10; index += 1) {
      await store.pace!('tcg_a');
      clock += 1_000;
    }
    expect(waits).toEqual([]);
    await store.pace!('tcg_b');
    expect(waits).toEqual([]);
    await store.pace!('tcg_a');
    // Первый запрос был 10 секунд назад: ждём ещё 50 секунд и секунду запаса
    expect(waits).toEqual([51_000]);
  });

  it('помнит отложенный ключ и остаток запросов, как браузер', async () => {
    const store = memoryKeyStore();
    await store.success('tcg_a', { apiDailyLimit: 100, apiDailyRequestsRemaining: 42 }, Date.UTC(2026, 10, 21, 3));
    await store.block('tcg_b', 'day', Date.UTC(2026, 10, 21, 3));
    const states = await store.load();
    expect(states.tcg_a?.usage?.dayLeft).toBe(42);
    expect(states.tcg_b?.block).toEqual({ reason: 'day', until: Date.UTC(2026, 10, 22) });
  });
});

describe('японские карты задачи', () => {
  const owned = (docId: string, data: Record<string, unknown>) => ownedFromDoc(docId, { count: 1, ...data });

  it('те же карты, что у браузера: японский каталог и карты вне базы с английским именем', () => {
    const detail = { id: 'SV2a-094', localId: '094', name: 'ミュウex', set: { id: 'SV2a', name: '151', cardCount: { official: 165, total: 210 } } };
    const refs = japaneseTargets(
      [
        owned('SV2a-094_ja', { setId: 'SV2a', lang: 'ja', variant: 'holo' }),
        owned('SV2a-001_ja', { setId: 'SV2a', lang: 'ja' }),
        owned('SV2a-094_ko', { setId: 'SV2a', lang: 'ko' }),
        owned('sv03-125', { setId: 'sv03' }),
        owned('x-ja-MBG-3', {
          setId: 'MBG',
          lang: 'ja',
          variant: 'holo',
          printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
        }),
        owned('x-ja-ABC-7', { setId: 'ABC', lang: 'ja', printed: { name: 'ピカチュウ', englishName: null, number: '7', total: null, setCode: 'ABC' } }),
      ],
      new Map([['ja|SV2a-094', detail as CardDetail]]),
    );
    expect(refs.map(({ resolveEnglishName: _, ...ref }) => ref)).toEqual([
      { key: 'SV2a-094_ja', setCode: 'SV2a', number: '094', total: '165', englishName: null, printing: 'holo', verifyName: false },
      // Карточка TCGdex не пришла: номер — из ID карты, числа карт нет
      { key: 'SV2a-001_ja', setCode: 'SV2a', number: '001', total: null, englishName: null, printing: 'normal', verifyName: false },
      { key: 'x-ja-MBG-3', setCode: 'MBG', number: '003', total: '021', englishName: 'Mega Gengar ex', printing: 'holo', verifyName: true },
    ]);
  });
});
