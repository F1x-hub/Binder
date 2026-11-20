import { useEffect, useState } from 'react';
import { catalog } from '@/lib/catalog';
import type { OwnedCard } from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { loadPrices, type CardPrice } from '@/lib/prices';

/** Карта альбома вместе с тем, что о ней знает справочник, и её ценой. */
export type CardView = OwnedCard & {
  name: string;
  localId: string;
  image?: string;
  setName: string;
  printedTotal: number | null;
  releaseDate: string | null;
  price: CardPrice | null;
};

/**
 * Имена и картинки берутся из сетов TCGdex (один запрос на сет, с кэшем),
 * цены — из общего кэша клуба. Сначала карты показываются без цен, потом с ценами.
 */
export function useCardViews(cards: OwnedCard[], ready: boolean): CardView[] | null {
  const [views, setViews] = useState<CardView[] | null>(null);
  const key = cards
    .map((card) => `${card.cardId}:${card.count}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void (async () => {
      const setIds = [...new Set(cards.map((card) => card.setId))];
      const sets = new Map(
        await Promise.all(setIds.map(async (id) => [id, await catalog.set(id).catch(() => null)] as const)),
      );
      const base = cards.map((card): CardView => {
        const set = sets.get(card.setId) ?? null;
        const brief = set?.cards.find((item) => item.id === card.cardId);
        return {
          ...card,
          name: brief?.name ?? card.cardId,
          localId: brief?.localId ?? '',
          image: brief?.image,
          setName: set?.name ?? card.setId,
          printedTotal: set?.cardCount.official ?? null,
          releaseDate: set?.releaseDate ?? null,
          price: null,
        };
      });
      if (active) setViews(base);
      if (cards.length === 0) return;
      const prices = await loadPrices(binderDb(), cards).catch(() => new Map<string, CardPrice>());
      if (active) setViews(base.map((view) => ({ ...view, price: prices.get(view.cardId) ?? null })));
    })();
    return () => {
      active = false;
    };
    // cards меняются вместе с key: пересчитываем только при изменении состава альбома
  }, [key, ready]);

  return views;
}

/** Итоги альбома: копии, сеты и стоимость в долларах по картам, у которых есть цена. */
export function collectionTotals(cards: Array<Pick<CardView, 'setId' | 'count' | 'price'>>) {
  let copies = 0;
  let value = 0;
  for (const card of cards) {
    copies += card.count;
    value += (card.price?.u ?? 0) * card.count;
  }
  return { copies, sets: new Set(cards.map((card) => card.setId)).size, value: Math.round(value * 100) / 100 };
}

/** Новые сверху; у только что добавленных время ещё не пришло с сервера — они самые новые. */
export function newestFirst<T extends Pick<OwnedCard, 'addedAt'>>(cards: T[]): T[] {
  const time = (card: T) => card.addedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
  return [...cards].sort((a, b) => time(b) - time(a));
}
