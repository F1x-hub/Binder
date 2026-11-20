import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Хранилище расширения в памяти: очередь ключей пишет туда, какой ключ упёрся в лимит
const memory: Record<string, unknown> = {};
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in memory).map((key) => [key, memory[key]])),
        set: async (items: Record<string, unknown>) => void Object.assign(memory, structuredClone(items)),
        remove: async (key: string) => void delete memory[key],
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  },
}));

const { blockUntil, loadKeyStates, nextUsage, nextUtcMidnight, soonestRelease, usableKeys } = await import('@/lib/justtcg-keys');
const { JusttcgError, refreshJusttcgCards } = await import('@/lib/justtcg');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOW = Date.UTC(2026, 10, 21, 15, 30);

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('лимиты ключей', () => {
  it('дневной и месячный лимит откладывают ключ до полуночи UTC, минутный — на минуту', () => {
    expect(nextUtcMidnight(NOW)).toBe(Date.UTC(2026, 10, 22));
    expect(blockUntil('day', NOW)).toBe(Date.UTC(2026, 10, 22));
    expect(blockUntil('month', NOW)).toBe(Date.UTC(2026, 10, 22));
    expect(blockUntil('minute', NOW)).toBe(NOW + 60_000);
    expect(blockUntil('invalid', NOW)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('отложенные ключи пропускаются, пока не наступит их время', () => {
    const states = {
      a: { block: { reason: 'day' as const, until: NOW + 1000 } },
      b: { block: { reason: 'minute' as const, until: NOW - 1 } },
    };
    expect(usableKeys(['a', 'b', 'c'], states, NOW)).toEqual(['b', 'c']);
    expect(soonestRelease(['a', 'b'], states)).toBe(NOW - 1);
    expect(soonestRelease(['x'], { x: { block: { reason: 'invalid', until: Number.MAX_SAFE_INTEGER } } })).toBeNull();
  });

  it('остаток берётся из _metadata, а без неё уменьшается на один запрос', () => {
    const usage = nextUsage(undefined, { apiPlan: 'Free', apiDailyLimit: 100, apiDailyRequestsUsed: 7, apiRequestLimit: 1000, apiRequestsRemaining: 912 }, NOW);
    expect(usage).toEqual({ day: '2026-11-21', plan: 'Free', dayLeft: 93, dayLimit: 100, monthLeft: 912, monthLimit: 1000 });
    expect(nextUsage(usage, undefined, NOW)).toMatchObject({ dayLeft: 92, monthLeft: 911 });
    // Новый день: дневной счётчик снова полный, минус этот запрос
    expect(nextUsage(usage, undefined, NOW + 24 * 3600_000)).toMatchObject({ day: '2026-11-22', dayLeft: 99, monthLeft: 911 });
  });
});

describe('очередь ключей', () => {
  it('ключ с кончившимся дневным лимитом откладывается, запрос повторяется со следующего', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const used: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const key = new Headers(init?.headers).get('x-api-key')!;
        used.push(key);
        if (key === 'tcg_first1') return json({ error: 'Daily limit', code: 'DAILY_LIMIT_EXCEEDED' }, 429);
        return json({ data: [{ id: 'card-1', variants: [{ condition: 'Near Mint', printing: 'Normal', price: 2 }] }], _metadata: { apiDailyLimit: 100, apiDailyRequestsUsed: 10 } });
      }),
    );

    const prices = await refreshJusttcgCards(['tcg_first1', 'tcg_second'], ['card-1']);
    expect(prices.get('card-1')).toEqual({ Normal: 2 });
    expect(used).toEqual(['tcg_first1', 'tcg_second']);
    const states = await loadKeyStates();
    expect(states.tcg_first1?.block).toEqual({ reason: 'day', until: Date.UTC(2026, 10, 22) });
    expect(states.tcg_second?.usage?.dayLeft).toBe(90);

    // Следующий запрос сразу идёт со второго ключа: на первый не тратится ни одного
    used.length = 0;
    await refreshJusttcgCards(['tcg_first1', 'tcg_second'], ['card-1']);
    expect(used).toEqual(['tcg_second']);
  });

  it('если лимит кончился у всех, ошибка говорит, когда освободится первый ключ', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const key = new Headers(init?.headers).get('x-api-key');
        return key === 'tcg_monthly'
          ? json({ code: 'REQUEST_LIMIT_EXCEEDED' }, 429)
          : json({ code: 'RATE_LIMIT_EXCEEDED' }, 429);
      }),
    );
    const error = await refreshJusttcgCards(['tcg_monthly', 'tcg_minute1'], ['x']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JusttcgError);
    expect(error).toMatchObject({ reason: 'rate-limit', window: 'minute', until: NOW + 60_000 });

    // Пока оба отложены, запросов нет вовсе
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(refreshJusttcgCards(['tcg_monthly', 'tcg_minute1'], ['x'])).rejects.toMatchObject({ reason: 'rate-limit', until: NOW + 60_000 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('неподошедший ключ пропускается насовсем; нет связи — следующий ключ не пробуется', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const used: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const key = new Headers(init?.headers).get('x-api-key')!;
        used.push(key);
        return key === 'tcg_broken' ? json({ code: 'INVALID_API_KEY' }, 401) : json({ data: [] });
      }),
    );
    await refreshJusttcgCards(['tcg_broken', 'tcg_good12'], ['x']);
    expect((await loadKeyStates()).tcg_broken?.block?.reason).toBe('invalid');

    used.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(refreshJusttcgCards(['tcg_good12', 'tcg_other1'], ['x'])).rejects.toMatchObject({ reason: 'offline' });
  });

  it('без ключей запроса нет', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(refreshJusttcgCards([], ['x'])).rejects.toMatchObject({ reason: 'no-key' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
