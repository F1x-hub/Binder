import { useEffect, useRef, useState } from 'react';
import { factsFromLimitless, factsFromTcgdex } from '@/lib/card-facts';
import { catalog } from '@/lib/catalog';
import { facetFromFacts, type CardFacet } from '@/lib/library-filters';
import { japaneseCardText } from '@/lib/limitless';
import { mapLimit } from '@/lib/prices';
import type { CardView } from '@/lib/useCardViews';

type Source = { docId: string; key: string; load: () => Promise<CardFacet | null> };

/** Откуда взять тип и редкость: карточка TCGdex или, у японской карты вне базы, текст Limitless. */
function sourceOf(view: CardView): Source | null {
  if (view.cardId && view.catalog && !view.approximate) {
    const { cardId, catalog: lang } = view;
    return {
      docId: view.docId,
      key: `tcgdex:${lang}:${cardId}`,
      load: async () => facetFromFacts(factsFromTcgdex(await catalog.card(cardId, lang))),
    };
  }
  // Скан Limitless у карты вне базы появляется только после сверки имени (useCardViews)
  if (view.printed && view.limitless?.region === 'jp') {
    const { set, number } = view.limitless;
    return {
      docId: view.docId,
      key: `limitless:${set}:${number}`,
      load: async () => {
        const text = await japaneseCardText(set, number);
        return text ? facetFromFacts(factsFromLimitless(text.original)) : null;
      },
    };
  }
  return null;
}

const CHUNK = 12;

/**
 * Тип и редкость карт альбома для фильтров. В сете TCGdex их нет, только в полной карточке:
 * она берётся из того же кэша IndexedDB, что и у страницы карточки (30 дней), без кэша —
 * по 4 запроса за раз. Результат приходит частями, чтобы фильтры наполнялись по ходу.
 */
export function useCardFacets(views: CardView[] | null): { facets: ReadonlyMap<string, CardFacet>; loading: boolean } {
  const known = useRef(new Map<string, CardFacet | null>());
  const [facets, setFacets] = useState<ReadonlyMap<string, CardFacet>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const sources = (views ?? []).map(sourceOf).filter((source): source is Source => source !== null);
  const key = sources
    .map((source) => `${source.docId}=${source.key}`)
    .sort()
    .join('|');

  useEffect(() => {
    let active = true;
    const publish = () => {
      const next = new Map<string, CardFacet>();
      for (const source of sources) {
        const facet = known.current.get(source.key);
        if (facet) next.set(source.docId, facet);
      }
      setFacets(next);
    };
    const missing = [...new Map(sources.filter((source) => !known.current.has(source.key)).map((s) => [s.key, s])).values()];
    publish();
    setLoading(missing.length > 0);
    if (missing.length === 0) return;
    void (async () => {
      for (let start = 0; start < missing.length && active; start += CHUNK) {
        const chunk = missing.slice(start, start + CHUNK);
        const loaded = await mapLimit(chunk, 4, async (source) => [source.key, await source.load().catch(() => null)] as const);
        // Неудача не запоминается: в следующий раз карта загрузится снова
        for (const [sourceKey, facet] of loaded) if (facet) known.current.set(sourceKey, facet);
        if (active) publish();
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // sources меняются вместе с key
  }, [key]);

  return { facets, loading };
}
