import type { Firestore } from 'firebase/firestore';
import { catalog } from '@/lib/catalog';
import { japaneseMarketId } from '@/lib/jp-prices';
import {
  JusttcgError,
  fetchCardMarket,
  type CardLookup,
  type CardV2,
  type MarketV2,
  type Printing,
  type VariantV2,
} from '@/lib/justtcg';
import { activeClubKeys } from '@/lib/club-keys';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import type { PricePoint } from '@/lib/price-history';
import { utcDay } from '@/lib/prices';
import type { CardDetail } from '@/lib/tcgdex';
import { japaneseRefs, type CardView } from '@/lib/useCardViews';

/**
 * Рынок карты из JustTCG для страницы карточки: цена Near Mint нужной печати, история цены
 * за год, изменение за 30 дней и цены в грейде. Один запрос к бете /v2/cards на карту в сутки,
 * ответ хранится в кэше этого браузера.
 */

/** Цена карты в грейде: по продажам этого слаба за последние 90 дней. */
export type GradedPrice = {
  /** «PSA 10», «BGS 9.5 Black Label» */
  label: string;
  company: string;
  grade: number | null;
  /** Цена в долларах; у устаревшей — последняя продажа */
  price: number;
  /** false — продаж больше 90 дней не было, цена — последняя известная */
  current: boolean;
  /** Время последней продажи, мс */
  lastSale: number | null;
  /** Сколько продаж за 90 дней легло в цену */
  sales90: number | null;
};

export type CardMarket = {
  /** Цена Near Mint нужной печати, в долларах */
  price: number | null;
  /** Изменение за 30 дней: 0.08 — рост на 8 % */
  change30: number | null;
  /** Цена по дням за год, в долларах */
  history: PricePoint[];
  graded: GradedPrice[];
};

function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

/** Печать карты среди печатей JustTCG: голо, реверс или обычная; единственная подходит любой. */
export function pickPrinting(names: string[], printing: Printing): string | null {
  const unique = [...new Set(names)];
  const fits = (name: string) =>
    printing === 'reverse'
      ? /reverse/i.test(name)
      : printing === 'holo'
        ? /holo|foil/i.test(name) && !/reverse/i.test(name)
        : /^normal$/i.test(name);
  return unique.find(fits) ?? (unique.length === 1 ? unique[0]! : null);
}

/** Цена в Северной Америке: единственный регион, где у JustTCG сейчас есть данные. */
function marketOf(variant: VariantV2): MarketV2 | null {
  return variant.markets?.find((market) => market.region === 'NA') ?? variant.markets?.[0] ?? null;
}

function priceOf(market: MarketV2 | null): number | null {
  if (!market) return null;
  return money(market.price) ?? (market.price_status === 'expired' ? money(market.last_price) : null);
}

const printingName = (variant: VariantV2) => variant.printing?.trim() || 'Normal';
const isNearMint = (variant: VariantV2) => /^(near mint|nm)$/i.test(variant.condition?.trim() ?? '');

const COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'BCCG', 'BVG'];

/** Разбор ответа /v2/cards для карты этой печати. */
export function marketFromCard(card: CardV2, printing: Printing): CardMarket {
  const variants = card.variants ?? [];
  const raw = variants.filter((variant) => variant.type !== 'graded' && isNearMint(variant));
  const rawPrinting = pickPrinting(raw.map(printingName), printing);
  const nearMint = raw.find((variant) => printingName(variant) === rawPrinting) ?? null;
  const market = nearMint ? marketOf(nearMint) : null;

  const byDay = new Map<string, number>();
  for (const point of [...(market?.price_history ?? [])].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))) {
    const value = money(point.p);
    if (typeof point.t !== 'number' || value === null) continue;
    byDay.set(new Date(point.t * 1000).toISOString().slice(0, 10), value);
  }
  const history = [...byDay].map(([day, usd]) => ({ day, usd, eur: null }));
  const change = market?.periods?.['30d']?.change_pct;

  const slabs = variants.filter((variant) => variant.type === 'graded' && variant.grading);
  const slabPrinting = pickPrinting(slabs.map(printingName), printing);
  const graded = slabs
    .filter((variant) => printingName(variant) === slabPrinting)
    .flatMap((variant): GradedPrice[] => {
      const slab = marketOf(variant);
      const price = priceOf(slab);
      const grading = variant.grading!;
      if (price === null || !grading.company) return [];
      return [
        {
          label: grading.canonical?.trim() || [grading.company, grading.grade].filter((part) => part !== null && part !== undefined).join(' '),
          company: grading.company,
          grade: typeof grading.grade === 'number' ? grading.grade : null,
          price,
          current: slab?.price_status !== 'expired',
          lastSale: typeof slab?.last_sale_at === 'number' ? slab.last_sale_at * 1000 : null,
          sales90: slab?.periods?.['90d']?.sales_count ?? null,
        },
      ];
    })
    .sort((a, b) => {
      const company = (name: string) => (COMPANIES.includes(name) ? COMPANIES.indexOf(name) : COMPANIES.length);
      return company(a.company) - company(b.company) || (b.grade ?? -1) - (a.grade ?? -1) || a.label.localeCompare(b.label);
    });

  return {
    price: priceOf(market),
    change30: typeof change === 'number' && Number.isFinite(change) ? change / 100 : null,
    history,
    graded,
  };
}

/** ID товара TCGplayer из карточки TCGdex: он у всех печатей один. */
export function tcgplayerProductId(card: Pick<CardDetail, 'pricing'> | null): string | null {
  for (const value of Object.values(card?.pricing?.tcgplayer ?? {})) {
    const id = (value as { productId?: unknown } | null)?.productId;
    if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) return String(id);
  }
  return null;
}

/**
 * Почему рынка нет или он не свежий. unsupported — карту не к чему привязать (похожая
 * карта, карта вне базы без JustTCG, каталоги без долларов); not-found — в JustTCG её нет.
 */
export type MarketProblem = 'unsupported' | 'not-found' | 'no-key' | 'invalid-key' | 'limit' | 'offline';

export type MarketResult = {
  /** Последний известный рынок карты: сегодняшний или из кэша за прошлые дни */
  market: CardMarket | null;
  /** День UTC, за который получен рынок */
  day: string | null;
  problem: MarketProblem | null;
  /** У limit: когда освободится первый ключ, мс */
  until: number | null;
};

/** Как найти карту в JustTCG; null — никак. */
async function lookupFor(db: Firestore, view: CardView): Promise<CardLookup | null | 'not-found'> {
  if (view.approximate) return null;
  if (view.catalog === 'en' && view.cardId) {
    const id = tcgplayerProductId(await catalog.card(view.cardId, 'en'));
    return id ? { tcgplayerId: id } : 'not-found';
  }
  // Японские карты: ID в JustTCG появляется, когда их цену находит loadJapanesePrices
  const [ref] = japaneseRefs([view]);
  if (ref) {
    const id = await japaneseMarketId(db, ref);
    return id ? { cardId: id } : 'not-found';
  }
  return null;
}

type Cached = { day: string; market: CardMarket | null };

export async function loadCardMarket(db: Firestore, view: CardView, today = utcDay()): Promise<MarketResult> {
  const empty = (problem: MarketProblem, cached?: Cached | null, until: number | null = null): MarketResult => ({
    market: cached?.market ?? null,
    day: cached?.day ?? null,
    problem,
    until,
  });

  const lookup = await lookupFor(db, view).catch(() => 'offline' as const);
  if (lookup === null) return empty('unsupported');
  if (lookup === 'offline') return empty('offline');
  if (lookup === 'not-found') return empty('not-found');

  const cacheKey = `market:${'tcgplayerId' in lookup ? `tp:${lookup.tcgplayerId}` : `jt:${lookup.cardId}`}:${view.variant ?? 'normal'}`;
  const cached = await cacheGet<Cached>(cacheKey, Number.POSITIVE_INFINITY).catch(() => null);
  if (cached?.day === today) return { market: cached.market, day: cached.day, problem: cached.market ? null : 'not-found', until: null };

  const keys = await activeClubKeys(db);
  if (keys.length === 0) return empty('no-key', cached);
  try {
    const card = await fetchCardMarket(keys, lookup);
    const market = card ? marketFromCard(card, view.variant ?? 'normal') : null;
    void cachePut<Cached>(cacheKey, { day: today, market });
    return { market, day: today, problem: market ? null : 'not-found', until: null };
  } catch (error) {
    if (!(error instanceof JusttcgError)) return empty('offline', cached);
    if (error.reason === 'rate-limit') return empty('limit', cached, error.until);
    if (error.reason === 'invalid-key') return empty('invalid-key', cached);
    if (error.reason === 'no-key') return empty('no-key', cached);
    return empty('offline', cached);
  }
}
