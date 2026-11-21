import { cnCatalog, type CnCard } from '@/lib/cn-catalog';
import { fetchPikaqianSet, matchPikaqian, pikaqianPrice, type PikaqianCard } from '@/lib/pikaqian';
import type { CardPrice } from '@/lib/price-refresh';

/**
 * Цены китайских карт для КНР: по одному запросу к PikaQian на сет (src/lib/pikaqian.ts).
 * Цена ложится в u, как доллары TCGplayer у остальных карт: альбом, итоги и графики
 * читают её без отличий. Евро (e) у этих карт нет. Карта, которой у PikaQian нет или
 * у которой нет цены, получает {u: null, e: null}: сегодня её уже спрашивали.
 * Если сет не загрузился, его карты в ответ не попадают и остаются со вчерашней ценой.
 */
export async function refreshCnPrices(cardIds: string[]): Promise<Map<string, CardPrice>> {
  const bySet = new Map<string, Array<{ id: string; card: CnCard }>>();
  for (const id of cardIds) {
    const found = await cnCatalog.find(id).catch(() => null);
    if (!found) continue;
    const list = bySet.get(found.set.id) ?? [];
    list.push({ id, card: found.card });
    bySet.set(found.set.id, list);
  }
  const result = new Map<string, CardPrice>();
  for (const [setId, cards] of bySet) {
    let fetched: PikaqianCard[] | null;
    try {
      fetched = await fetchPikaqianSet(setId);
    } catch {
      continue; // нет связи или сайт поменялся: цены этого сета остаются вчерашними
    }
    for (const { id, card } of cards) {
      const match = fetched ? matchPikaqian(fetched, card) : null;
      result.set(id, { u: match ? pikaqianPrice(match) : null, e: null });
    }
  }
  return result;
}
