import type { LimitlessText } from '@/lib/card-facts';
import { catalog } from '@/lib/catalog';
import { japaneseCardText } from '@/lib/limitless';
import { mapLimit } from '@/lib/prices';
import type { CardDetail as TcgdexCard } from '@/lib/tcgdex';
import type { CardView } from '@/lib/useCardViews';

/**
 * Полные сведения о картах альбома: то, чего нет в сете TCGdex (тип, редкость, категория,
 * стадия, тип энергии). Их берут фильтры альбома (src/lib/useCardFacets.ts) и проверка колод
 * (src/lib/useDeckInfo.ts) из одного загрузчика, без интерфейса и React.
 */

/** Карточка TCGdex или, у японской карты вне TCGdex, её текст из Limitless. */
export type CardDetail = { kind: 'tcgdex'; raw: TcgdexCard } | { kind: 'limitless'; raw: LimitlessText };

/** Что загрузить: key одинаков у копий одной карты (английская и французская копии — одна карточка). */
export type DetailRequest = { key: string; load: () => Promise<CardDetail | null> };

/**
 * Откуда взять сведения о карте; null — неоткуда. Карта TCGdex — из её карточки (кэш IndexedDB
 * на 30 дней, src/lib/catalog.ts). Японская карта вне TCGdex — из Limitless, но только после
 * сверки имени: view.limitless у такой карты появляется только тогда (useCardViews), иначе
 * сведения были бы от чужой карты. У остальных карт вне базы сведений нет.
 */
export function detailRequest(
  view: Pick<CardView, 'cardId' | 'catalog' | 'printed' | 'lang' | 'limitless'>,
): DetailRequest | null {
  const { cardId, catalog: lang } = view;
  if (cardId && lang) {
    return {
      key: `t:${lang}:${cardId}`,
      load: async () => ({ kind: 'tcgdex', raw: await catalog.card(cardId, lang) }),
    };
  }
  if (view.printed && view.lang === 'ja' && view.limitless?.region === 'jp') {
    const { set, number } = view.limitless;
    return {
      key: `l:${set}:${number}`,
      load: async () => {
        const text = await japaneseCardText(set, number);
        return text ? { kind: 'limitless', raw: text.original } : null;
      },
    };
  }
  return null;
}

export type DetailStore = {
  /** Уже загруженная карточка; неудачи не хранятся */
  get(key: string): CardDetail | undefined;
  has(key: string): boolean;
  /**
   * Загрузить недостающие, не больше limit запросов сразу. Одна и та же карточка, которую
   * просят два места одновременно, загружается один раз. onSettled — после каждой карты,
   * удачной или нет; промис завершается, когда ответили все.
   */
  load(requests: readonly DetailRequest[], options?: { limit?: number; onSettled?: () => void }): Promise<void>;
};

export function createDetailStore(): DetailStore {
  const known = new Map<string, CardDetail>();
  const pending = new Map<string, Promise<CardDetail | null>>();

  const fetchOne = (request: DetailRequest): Promise<CardDetail | null> => {
    const hit = known.get(request.key);
    if (hit) return Promise.resolve(hit);
    let task = pending.get(request.key);
    if (!task) {
      task = request
        .load()
        .catch(() => null)
        .then((detail) => {
          // Неудача не запоминается: в следующий раз карта загрузится снова
          if (detail) known.set(request.key, detail);
          pending.delete(request.key);
          return detail;
        });
      pending.set(request.key, task);
    }
    return task;
  };

  return {
    get: (key) => known.get(key),
    has: (key) => known.has(key),
    async load(requests, { limit = DETAIL_REQUESTS_AT_ONCE, onSettled } = {}) {
      const unique = [...new Map(requests.filter((request) => !known.has(request.key)).map((r) => [r.key, r])).values()];
      await mapLimit(unique, limit, async (request) => {
        await fetchOne(request);
        onSettled?.();
      });
    },
  };
}

/** Сколько карточек грузится сразу: альбом раньше брал по 4, колоды — по 6. */
export const DETAIL_REQUESTS_AT_ONCE = 6;

/** Общий кэш вкладки: из альбома в колоды и обратно карточки второй раз не грузятся. */
export const cardDetails = createDetailStore();
