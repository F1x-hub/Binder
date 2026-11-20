import { describe, expect, it } from 'vitest';
import { createDetailStore, detailRequest, type CardDetail, type DetailRequest } from '@/lib/card-details';

const tcgdex = (id: string): CardDetail => ({ kind: 'tcgdex', raw: { id, localId: '1', name: id } as never });

function request(key: string, result: () => Promise<CardDetail | null>, log: string[]): DetailRequest {
  return {
    key,
    load: () => {
      log.push(key);
      return result();
    },
  };
}

describe('откуда брать сведения о карте', () => {
  const base = { cardId: null, catalog: null, printed: null, lang: 'en' as const, limitless: null };

  it('карта TCGdex — по каталогу и ID; копии на разных языках одного каталога — одна карточка', () => {
    expect(detailRequest({ ...base, cardId: 'sv03-125', catalog: 'en' })?.key).toBe('t:en:sv03-125');
    expect(detailRequest({ ...base, cardId: 'sv03-125', catalog: 'en', lang: 'fr' })?.key).toBe('t:en:sv03-125');
    expect(detailRequest({ ...base, cardId: 'SV2a-094', catalog: 'ja', lang: 'ja' })?.key).toBe('t:ja:SV2a-094');
  });

  it('японская карта вне базы — из Limitless, только после сверки имени', () => {
    const printed = { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' };
    expect(detailRequest({ ...base, lang: 'ja', printed })).toBeNull();
    expect(
      detailRequest({ ...base, lang: 'ja', printed, limitless: { region: 'jp', set: 'MBG', number: '3' } })?.key,
    ).toBe('l:MBG:3');
    // Корейская карта вне базы: сведений нет
    expect(detailRequest({ ...base, lang: 'ko', printed })).toBeNull();
  });
});

describe('общий загрузчик карточек', () => {
  it('одна карточка — один запрос, даже если её просят два места сразу', async () => {
    const store = createDetailStore();
    const log: string[] = [];
    const a = request('t:en:a', async () => tcgdex('a'), log);
    await Promise.all([store.load([a, a]), store.load([a])]);
    expect(log).toEqual(['t:en:a']);
    expect(store.get('t:en:a')).toEqual(tcgdex('a'));
    await store.load([a]);
    expect(log).toEqual(['t:en:a']);
  });

  it('неудача и пустой ответ не запоминаются: в следующий раз карта грузится снова', async () => {
    const store = createDetailStore();
    const log: string[] = [];
    let calls = 0;
    const flaky = request(
      't:en:b',
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('TCGdex молчит');
        return tcgdex('b');
      },
      log,
    );
    const absent = request('l:MBG:99', async () => null, log);
    let settled = 0;
    await store.load([flaky, absent], { onSettled: () => (settled += 1) });
    expect(settled).toBe(2);
    expect(store.has('t:en:b')).toBe(false);
    expect(store.has('l:MBG:99')).toBe(false);
    await store.load([flaky, absent]);
    expect(store.get('t:en:b')).toEqual(tcgdex('b'));
    expect(log).toEqual(['t:en:b', 'l:MBG:99', 't:en:b', 'l:MBG:99']);
  });

  it('не больше limit запросов сразу', async () => {
    const store = createDetailStore();
    let running = 0;
    let peak = 0;
    const requests = Array.from({ length: 10 }, (_, index) => ({
      key: `t:en:${index}`,
      load: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return tcgdex(String(index));
      },
    }));
    await store.load(requests, { limit: 3 });
    expect(peak).toBe(3);
    expect(requests.every((item) => store.has(item.key))).toBe(true);
  });
});
