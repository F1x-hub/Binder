import { useEffect, useState } from 'react';
import { loadCollectionHistory } from '@/lib/collection-history';
import { binderDb } from '@/lib/db';
import type { PricePoint } from '@/lib/price-history';
import type { CardView } from '@/lib/useCardViews';

/**
 * История стоимости альбома по дням (src/lib/collection-history.ts). Ждёт нынешних цен:
 * по ним карта попадает в долларовый или евро-ряд, и ими же кончается ряд. null — грузится
 * или views ещё нет. Пересчитывается при смене состава альбома и цен.
 */
export function useCollectionHistory(views: CardView[] | null, pricesLoading = false): PricePoint[] | null {
  const [history, setHistory] = useState<PricePoint[] | null>(null);
  const key =
    views && !pricesLoading
      ? views
          .map((view) => `${view.docId}:${view.count}:${view.price?.u ?? ''}:${view.price?.e ?? ''}`)
          .sort()
          .join('|')
      : null;

  useEffect(() => {
    if (key === null || !views) return;
    let active = true;
    void loadCollectionHistory(binderDb(), views)
      .catch((error: unknown) => {
        console.warn('[binder] история стоимости альбома недоступна', error);
        return [] as PricePoint[];
      })
      .then((points) => active && setHistory(points));
    return () => {
      active = false;
    };
    // views меняются вместе с key
  }, [key]);

  // Пока пересчитывается, виден прежний ряд: график не мигает при добавлении карты
  return history;
}
