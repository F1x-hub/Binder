import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog } from '@/lib/catalog';
import { infoFromLimitless, infoFromTcgdex, unknownInfo, type DeckCardInfo, type DeckLine } from '@/lib/deck-rules';
import { japaneseCardText } from '@/lib/limitless';
import { mapLimit } from '@/lib/prices';
import type { CardView } from '@/lib/useCardViews';

/** Откуда взять категорию и стадию карты; null — неоткуда, карта считается картой без данных. */
type Source = { kind: 'tcgdex'; raw: Record<string, unknown> } | { kind: 'limitless'; raw: Record<string, unknown> } | null;

/**
 * Карта TCGdex — из её карточки (кэш 30 дней, src/lib/catalog.ts). Японская карта вне TCGdex —
 * из Limitless, но только после сверки имени (view.limitless у такой карты появляется только
 * тогда, см. useCardViews), иначе данные были бы от чужой карты. У остальных карт вне базы данных нет.
 */
function sourceKey(view: CardView): string | null {
  if (view.cardId && view.catalog) return `t:${view.catalog}:${view.cardId}`;
  if (view.printed && view.lang === 'ja' && view.limitless?.region === 'jp') return `l:${view.limitless.set}:${view.limitless.number}`;
  return null;
}

async function loadSource(view: CardView): Promise<Source> {
  if (view.cardId && view.catalog) {
    const detail = await catalog.card(view.cardId, view.catalog).catch(() => null);
    return detail ? { kind: 'tcgdex', raw: detail as unknown as Record<string, unknown> } : null;
  }
  if (view.limitless) {
    const text = await japaneseCardText(view.limitless.set, view.limitless.number).catch(() => null);
    return text ? { kind: 'limitless', raw: text.original } : null;
  }
  return null;
}

/** Имя для правила четырёх копий: английское, если известно (у японских карт — перевод или скан). */
export function ruleName(view: Pick<CardView, 'name' | 'englishName'>): string {
  return view.englishName ?? view.name;
}

function deckInfoOf(view: CardView, source: Source | undefined): DeckCardInfo {
  const name = ruleName(view);
  if (!source) return unknownInfo(name);
  return source.kind === 'tcgdex' ? infoFromTcgdex(name, source.raw) : infoFromLimitless(name, source.raw);
}

/**
 * Категория, стадия и тип энергии карт альбома для проверки колоды. Карточки TCGdex
 * запрашиваются по 6 за раз и кэшируются в браузере на 30 дней, так что открыть колоду
 * второй раз почти бесплатно. loading — пока данные пришли не по всем картам.
 */
export function useDeckInfo(views: CardView[] | null): { info: ReadonlyMap<string, DeckCardInfo>; loading: boolean } {
  const cache = useRef(new Map<string, Source>());
  const [version, setVersion] = useState(0);
  const key = (views ?? [])
    .map((view) => sourceKey(view))
    .filter((item): item is string => item !== null)
    .sort()
    .join('|');

  useEffect(() => {
    if (!views) return;
    const missing = new Map<string, CardView>();
    for (const view of views) {
      const id = sourceKey(view);
      if (id && !cache.current.has(id)) missing.set(id, view);
    }
    if (missing.size === 0) return;
    // Кэш живёт в ref: ответ, пришедший после смены состава, тоже пригодится
    void mapLimit([...missing], 6, async ([id, view]) => {
      cache.current.set(id, await loadSource(view));
    }).then(() => setVersion((value) => value + 1));
    // views меняются вместе с key: запрашиваем только новые карты
  }, [key]);

  const info = useMemo(() => {
    const map = new Map<string, DeckCardInfo>();
    for (const view of views ?? []) {
      const id = sourceKey(view);
      map.set(view.docId, deckInfoOf(view, id ? cache.current.get(id) : null));
    }
    return map;
    // version — сигнал, что в кэш пришли новые данные
  }, [views, version]);

  const loading =
    views === null ||
    views.some((view) => {
      const id = sourceKey(view);
      return id !== null && !cache.current.has(id);
    });
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
