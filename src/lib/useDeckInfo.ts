import { useMemo } from 'react';
import type { CardDetail } from '@/lib/card-details';
import { infoFromLimitless, infoFromTcgdex, unknownInfo, type DeckCardInfo, type DeckLine } from '@/lib/deck-rules';
import { useCardDetails } from '@/lib/useCardDetails';
import type { CardView } from '@/lib/useCardViews';

/** Имя для правила четырёх копий: английское, если известно (у японских карт — перевод или скан). */
export function ruleName(view: Pick<CardView, 'name' | 'englishName'>): string {
  return view.englishName ?? view.name;
}

function deckInfoOf(view: CardView, detail: CardDetail | undefined): DeckCardInfo {
  const name = ruleName(view);
  if (!detail) return unknownInfo(name);
  return detail.kind === 'tcgdex'
    ? infoFromTcgdex(name, detail.raw as unknown as Record<string, unknown>)
    : infoFromLimitless(name, detail.raw);
}

/**
 * Категория, стадия и тип энергии карт альбома для проверки колоды. Карточки приходят из общего
 * загрузчика (src/lib/useCardDetails.ts): TCGdex — из кэша браузера на 30 дней, японские карты
 * вне TCGdex — из Limitless после сверки имени. Так что открыть колоду второй раз почти бесплатно.
 * У карт без данных — unknownInfo. loading — пока данные пришли не по всем картам.
 */
export function useDeckInfo(views: CardView[] | null): { info: ReadonlyMap<string, DeckCardInfo>; loading: boolean } {
  const { details, loading } = useCardDetails(views);
  const info = useMemo(() => {
    const map = new Map<string, DeckCardInfo>();
    for (const view of views ?? []) map.set(view.docId, deckInfoOf(view, details.get(view.docId)));
    return map;
  }, [views, details]);
  return { info, loading };
}

/**
 * Строки колоды для проверки: сколько копий в колоде, сколько в альбоме и что известно о карте.
 * Карты, которую убрали из альбома, в views нет: у неё 0 копий, а имени, кроме ID, не знаем.
 */
export function deckLines(
  cards: Readonly<Record<string, number>>,
  views: ReadonlyMap<string, CardView>,
  info: ReadonlyMap<string, DeckCardInfo>,
): DeckLine[] {
  return Object.entries(cards).map(([docId, count]) => {
    const view = views.get(docId);
    return { docId, count, owned: view?.count ?? 0, info: info.get(docId) ?? unknownInfo(view ? ruleName(view) : docId) };
  });
}
