import { useMemo } from 'react';
import { factsFromLimitless, factsFromTcgdex } from '@/lib/card-facts';
import type { CardDetail } from '@/lib/card-details';
import { facetFromFacts, type CardFacet } from '@/lib/library-filters';
import { useCardDetails } from '@/lib/useCardDetails';
import type { CardView } from '@/lib/useCardViews';

/** Разбор карточки дорогой (атаки, способности): у одной карточки — один раз. */
const facetCache = new WeakMap<CardDetail, CardFacet>();

function facetOf(detail: CardDetail): CardFacet {
  let facet = facetCache.get(detail);
  if (!facet) {
    facet = facetFromFacts(detail.kind === 'tcgdex' ? factsFromTcgdex(detail.raw) : factsFromLimitless(detail.raw));
    facetCache.set(detail, facet);
  }
  return facet;
}

/** У похожей карты (язык не определён) тип и редкость были бы от другой карты. */
const notApproximate = (view: CardView) => !view.approximate;

/**
 * Тип и редкость карт альбома для фильтров. В сете TCGdex их нет, только в полной карточке:
 * она приходит из общего загрузчика (src/lib/useCardDetails.ts) — того же кэша, что у страницы
 * карточки и колод. Результат приходит частями, чтобы фильтры наполнялись по ходу.
 */
export function useCardFacets(views: CardView[] | null): { facets: ReadonlyMap<string, CardFacet>; loading: boolean } {
  const { details, loading } = useCardDetails(views, notApproximate);
  const facets = useMemo(() => {
    const map = new Map<string, CardFacet>();
    for (const [docId, detail] of details) map.set(docId, facetOf(detail));
    return map;
  }, [details]);
  // Пока альбом не разложен, загружать нечего: фильтры не показывают загрузку
  return { facets, loading: views !== null && loading };
}
