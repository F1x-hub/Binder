import { cached } from '@/lib/kv-cache';
import { koCatalog, splitKoId } from '@/lib/ko-catalog';
import { fetchPokepolioSet, matchPokepolio, pokepolioSetFor, pokepolioSets, type PokepolioCard } from '@/lib/pokepolio';
import type { CardPrice } from '@/lib/price-refresh';

/**
 * Цены корейских карт: последняя сделка без грейда на корейском рынке из pokepolio
 * (src/lib/pokepolio.ts), в вонах, пересчитанная в доллары по курсу ЕЦБ на сегодня
 * (Frankfurter, https://frankfurter.dev: без ключа, CORS *). Цена ложится в u, как доллары
 * TCGplayer у остальных карт: альбом, итоги и графики читают её без отличий. Евро нет.
 * Карта, которой у pokepolio нет или у которой нет сделки без грейда, получает {u: null, e: null}.
 * Если сет не загрузился или курса нет, его карты в ответ не попадают и остаются со вчерашней ценой.
 */

const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=KRW&symbols=USD';
const DAY = 24 * 60 * 60 * 1000;

/** Сколько долларов в одной воне (около 0.0007). */
export function krwToUsd(): Promise<number> {
  return cached('fx:KRW-USD', DAY, async () => {
    const response = await fetch(FX_URL);
    if (!response.ok) throw new Error(`frankfurter ${response.status}`);
    const rate = ((await response.json()) as { rates?: { USD?: number } }).rates?.USD;
    if (typeof rate !== 'number' || !(rate > 0 && rate < 0.01)) throw new Error('frankfurter: нет курса');
    return rate;
  });
}

export function usdFrom(krw: number | null, rate: number): number | null {
  if (krw === null) return null;
  const usd = Math.round(krw * rate * 100) / 100;
  return usd > 0 ? usd : null;
}

export async function refreshKoPrices(cardIds: string[]): Promise<Map<string, CardPrice>> {
  const result = new Map<string, CardPrice>();
  if (cardIds.length === 0) return result; // все карты сегодня уже освежены: ни курса, ни сайта не нужно
  let rate: number;
  let sets: Awaited<ReturnType<typeof pokepolioSets>>;
  try {
    [rate, sets] = await Promise.all([krwToUsd(), pokepolioSets()]);
  } catch {
    return result; // нет курса или сайт недоступен: цены остаются вчерашними
  }
  const bySet = new Map<string, string[]>();
  for (const id of cardIds) {
    const parts = splitKoId(id);
    if (!parts) continue;
    bySet.set(parts.setId, [...(bySet.get(parts.setId) ?? []), id]);
  }
  for (const [setId, ids] of bySet) {
    const cards = (await Promise.all(ids.map((id) => koCatalog.card(id).catch(() => null)))).filter((card) => card !== null);
    const target = pokepolioSetFor(sets, setId, cards[0]?.set.name ?? null);
    let listed: PokepolioCard[] = [];
    if (target) {
      try {
        listed = await fetchPokepolioSet(target.uuid);
      } catch {
        continue;
      }
    }
    for (const card of cards) {
      const match = matchPokepolio(listed, card);
      result.set(card.id, { u: match ? usdFrom(match.krw, rate) : null, e: null });
    }
  }
  return result;
}
