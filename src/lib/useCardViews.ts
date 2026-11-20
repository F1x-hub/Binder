import { useEffect, useState } from 'react';
import { catalog } from '@/lib/catalog';
import { setKey, type OwnedCard } from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { catalogFor, type TcgdexLanguage } from '@/lib/languages';
import { loadJapanesePrices, type JapaneseRef } from '@/lib/jp-prices';
import { englishNameOf, findJapaneseCard, type LimitlessRef } from '@/lib/limitless';
import { nameVerdict } from '@/lib/matching';
import { loadPrices, mapLimit, priceKey, type CardPrice } from '@/lib/prices';
import type { SetDetail } from '@/lib/tcgdex';
import { loadThumbs } from '@/lib/thumbnails';

/** Карта альбома вместе с тем, что о ней знает справочник, её ценой и обложкой из фото. */
export type CardView = OwnedCard & {
  name: string;
  /** Английское имя, если карта не на английском: у карт вне базы — из скана, у японских карт TCGdex — перевод Limitless */
  englishName: string | null;
  localId: string;
  image?: string;
  /** Обложка из фото этого браузера: показывается, если у карты нет скана в базе */
  thumb: string | null;
  setName: string;
  printedTotal: number | null;
  releaseDate: string | null;
  price: CardPrice | null;
  /** Не та же карта, а похожая из английской базы: язык карты не определён */
  approximate: boolean;
  /** Где взять скан в Limitless TCG, если в TCGdex его нет */
  limitless: LimitlessRef | null;
};

function viewOf(card: OwnedCard, set: SetDetail | null, thumb: string | null): CardView {
  const { printed } = card;
  if (printed || !card.cardId) {
    const total = printed?.total && /^\d+$/.test(printed.total) ? Number(printed.total) : null;
    return {
      ...card,
      name: printed?.name ?? card.docId,
      englishName: printed?.englishName && printed.englishName !== printed.name ? printed.englishName : null,
      localId: printed?.number ?? '',
      thumb,
      setName: printed?.setCode ?? 'Без сета',
      printedTotal: total,
      releaseDate: null,
      price: null,
      approximate: false,
      // Скан Limitless появится после сверки имени (verifiedLimitless)
      limitless: null,
    };
  }
  const brief = set?.cards.find((item) => item.id === card.cardId);
  const localId = brief?.localId ?? '';
  let limitless: LimitlessRef | null = null;
  if (localId && card.catalog === 'ja') limitless = { region: 'jp', set: card.setId, number: localId };
  if (localId && card.catalog === 'en' && set?.abbreviation?.official) {
    limitless = { region: 'en', set: set.abbreviation.official, number: localId };
  }
  return {
    ...card,
    name: brief?.name ?? card.cardId,
    englishName: null,
    localId,
    image: brief?.image,
    thumb,
    setName: set?.name ?? card.setId,
    printedTotal: set?.cardCount.official ?? null,
    releaseDate: set?.releaseDate ?? null,
    price: null,
    approximate: !catalogFor(card.lang).exact,
    limitless,
  };
}

/**
 * Скан Limitless для японской карты вне TCGdex показывается, только если под этим кодом сета
 * и номером в Limitless лежит карта с тем же именем. Карту могли добавить как есть с неверно
 * прочитанным кодом сета, и тогда по коду и номеру нашёлся бы скан чужой карты.
 */
async function verifiedLimitless(card: OwnedCard): Promise<LimitlessRef | null> {
  const { printed } = card;
  if (!printed || card.lang !== 'ja' || !printed.setCode) return null;
  const found = await findJapaneseCard(printed.setCode, printed.number).catch(() => null);
  if (!found) return null;
  const verdict = nameVerdict(
    { name: printed.name, englishName: printed.englishName, language: 'ja' },
    { name: found.name, lang: 'ja', englishName: found.englishName },
  );
  return verdict !== null && verdict >= 0.8 ? { region: 'jp', set: found.set, number: found.number } : null;
}

/**
 * Японские карты, которым нужна цена в долларах из JustTCG: карты японского каталога TCGdex
 * (код сета и номер точные, английское имя для поиска — из Limitless) и карты вне базы
 * с кодом сета и английским именем (их имя сверяется: код сета мог быть прочитан неверно).
 */
export function japaneseRefs(views: CardView[]): JapaneseRef[] {
  return views.flatMap((view): JapaneseRef[] => {
    const printing = view.variant ?? 'normal';
    if (view.catalog === 'ja' && view.localId) {
      return [
        {
          key: view.docId,
          setCode: view.setId,
          number: view.localId,
          total: view.printedTotal ? String(view.printedTotal) : null,
          englishName: null,
          resolveEnglishName: () => findJapaneseCard(view.setId, view.localId).then((card) => card?.englishName ?? null),
          printing,
          verifyName: false,
        },
      ];
    }
    const { printed } = view;
    if (printed && view.lang === 'ja' && printed.setCode && printed.englishName) {
      return [
        {
          key: view.docId,
          setCode: printed.setCode,
          number: printed.number,
          total: printed.total,
          englishName: printed.englishName,
          printing,
          verifyName: true,
        },
      ];
    }
    return [];
  });
}

/** Цена TCGdex и доллары JustTCG вместе: доллары JustTCG там, где TCGdex знает только евро. */
export function mergePrice(tcgdex: CardPrice | null, dollars: number | null): CardPrice | null {
  if (!tcgdex && dollars === null) return null;
  return { u: tcgdex?.u ?? dollars, e: tcgdex?.e ?? null };
}

/**
 * Имена и картинки берутся из сетов TCGdex (один запрос на сет, с кэшем), цены — из общего
 * кэша клуба, обложки карт без скана — из этого браузера. Сначала карты показываются без цен,
 * потом с ценами и сверенными сканами Limitless. У похожих карт и карт вне базы цены нет:
 * она была бы чужой. prices: false — без цен (поиску в шапке они не нужны, а второй
 * одновременный запрос цен удвоил бы чтения и записи общего кэша).
 */
export function useCardViews(cards: OwnedCard[], ready: boolean, { prices: withPrices = true } = {}): CardView[] | null {
  const [views, setViews] = useState<CardView[] | null>(null);
  const key = cards
    .map((card) => `${card.docId}:${card.count}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void (async () => {
      const wanted = new Map<string, { lang: TcgdexLanguage; setId: string }>();
      for (const card of cards) if (card.catalog) wanted.set(setKey(card), { lang: card.catalog, setId: card.setId });
      const [sets, thumbs] = await Promise.all([
        Promise.all(
          [...wanted].map(async ([id, { lang, setId }]) => [id, await catalog.set(setId, lang).catch(() => null)] as const),
        ).then((entries) => new Map(entries)),
        loadThumbs(cards.map((card) => card.docId)).catch(() => new Map<string, string>()),
      ]);
      const base = cards.map((card) => viewOf(card, sets.get(setKey(card)) ?? null, thumbs.get(card.docId) ?? null));
      if (active) setViews(base);

      const priced = withPrices ? base.filter((view) => view.cardId && view.catalog && !view.approximate) : [];
      const custom = base.filter((view) => view.printed && view.lang === 'ja' && view.printed.setCode);
      const japanese = withPrices ? japaneseRefs(base) : [];
      // У японских карт TCGdex имя японское: английское берём из перевода Limitless, по 4 запроса за раз
      const unnamed = base.filter((view) => view.catalog === 'ja' && view.localId && !view.englishName);
      if (priced.length === 0 && custom.length === 0 && japanese.length === 0 && unnamed.length === 0) return;
      const [prices, covers, dollars, english] = await Promise.all([
        priced.length > 0
          ? loadPrices(
              binderDb(),
              priced.map((view) => ({ cardId: view.cardId!, setId: view.setId, lang: view.catalog! })),
            ).catch(() => new Map<string, CardPrice>())
          : new Map<string, CardPrice>(),
        Promise.all(custom.map(async (view) => [view.docId, await verifiedLimitless(view)] as const)).then(
          (entries) => new Map(entries),
        ),
        loadJapanesePrices(binderDb(), japanese).catch(() => new Map<string, number>()),
        mapLimit(unnamed, 4, async (view) => [view.docId, await englishNameOf(view.setId, view.localId).catch(() => null)] as const).then(
          (entries) => new Map(entries),
        ),
      ]);
      if (!active) return;
      setViews(
        base.map((view) => {
          const tcgdex =
            view.cardId && view.catalog && !view.approximate ? (prices.get(priceKey(view.catalog, view.cardId)) ?? null) : null;
          return {
            ...view,
            englishName: view.englishName ?? english.get(view.docId) ?? null,
            price: mergePrice(tcgdex, dollars.get(view.docId) ?? null),
            limitless: covers.get(view.docId) ?? view.limitless,
          };
        }),
      );
    })();
    return () => {
      active = false;
    };
    // cards меняются вместе с key: пересчитываем только при изменении состава альбома
  }, [key, ready, withPrices]);

  return views;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * Итоги альбома: копии, сеты и стоимость. value — в долларах по картам с ценой TCGplayer,
 * euro — по картам, у которых есть только цена Cardmarket (так у японских).
 */
export function collectionTotals(cards: Array<Pick<CardView, 'catalog' | 'setId' | 'lang' | 'count' | 'price'>>) {
  let copies = 0;
  let value = 0;
  let euro = 0;
  for (const card of cards) {
    copies += card.count;
    if (card.price?.u != null) value += card.price.u * card.count;
    else if (card.price?.e != null) euro += card.price.e * card.count;
  }
  return { copies, sets: new Set(cards.map(setKey)).size, value: cents(value), euro: cents(euro) };
}

/** Новые сверху; у только что добавленных время ещё не пришло с сервера — они самые новые. */
export function newestFirst<T extends Pick<OwnedCard, 'addedAt'>>(cards: T[]): T[] {
  const time = (card: T) => card.addedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
  return [...cards].sort((a, b) => time(b) - time(a));
}
