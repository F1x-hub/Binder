import type { TcgdexLanguage } from '@/lib/languages';

/**
 * Клиент TCGdex — открытой бесплатной базы карт: https://tcgdex.dev.
 * Ключ не нужен, запросы из расширения разрешены (CORS *). Сервис живёт на пожертвования,
 * поэтому всё кэшируется (src/lib/catalog.ts), а цены освежаются не чаще раза в сутки.
 * У каждого языка свой каталог: английский общий для международных изданий,
 * у японского, тайваньского, индонезийского и тайского свои сеты и номера.
 */
const API = 'https://api.tcgdex.net/v2';

export type CardCount = { official: number; total: number };

export type SetBrief = { id: string; name: string; cardCount: CardCount };

export type CardBrief = { id: string; localId: string; name: string; image?: string };

export type SetDetail = {
  id: string;
  name: string;
  cardCount: CardCount;
  releaseDate?: string;
  serie?: { id: string; name: string };
  abbreviation?: { official?: string };
  cards: CardBrief[];
};

/** Цены одного варианта карты на TCGplayer, в долларах. */
export type TcgplayerPrice = { marketPrice?: number | null; midPrice?: number | null; lowPrice?: number | null };

export type CardDetail = CardBrief & {
  rarity?: string;
  category?: string;
  types?: string[];
  variants?: { normal?: boolean; holo?: boolean; reverse?: boolean; firstEdition?: boolean };
  set: { id: string; name: string; cardCount?: CardCount };
  pricing?: {
    tcgplayer?: Record<string, unknown>;
    cardmarket?: { trend?: number | null; avg?: number | null; [key: string]: unknown };
  };
};

export type CatalogFailure = 'not-found' | 'unavailable';

export class CatalogError extends Error {
  readonly reason: CatalogFailure;

  constructor(reason: CatalogFailure) {
    super(reason === 'not-found' ? 'Карточка не найдена в базе' : 'База карт недоступна');
    this.name = 'CatalogError';
    this.reason = reason;
  }
}

async function get<T>(lang: TcgdexLanguage, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}/${lang}${path}`);
  } catch {
    throw new CatalogError('unavailable');
  }
  if (response.status === 404) throw new CatalogError('not-found');
  if (!response.ok) throw new CatalogError('unavailable');
  return (await response.json()) as T;
}

/** Поиск возвращает пустой список и на 404, и на ответ-ошибку. */
async function list(lang: TcgdexLanguage, query: string): Promise<CardBrief[]> {
  const found = await get<CardBrief[] | { error: string }>(lang, `/cards?${query}`).catch((error: unknown) => {
    if (error instanceof CatalogError && error.reason === 'not-found') return [];
    throw error;
  });
  return Array.isArray(found) ? found : [];
}

export const tcgdexApi = {
  sets: (lang: TcgdexLanguage = 'en') => get<SetBrief[]>(lang, '/sets'),
  set: (id: string, lang: TcgdexLanguage = 'en') => get<SetDetail>(lang, `/sets/${encodeURIComponent(id)}`),
  card: (id: string, lang: TcgdexLanguage = 'en') => get<CardDetail>(lang, `/cards/${encodeURIComponent(id)}`),
  /**
   * Поиск по части имени и номеру. Фильтр номера у TCGdex нестрогий («003» находит «073»),
   * поэтому точное совпадение номера проверяет вызывающий код.
   */
  search: (name: string, localId: string, lang: TcgdexLanguage = 'en') =>
    list(lang, `name=${encodeURIComponent(name)}&localId=${encodeURIComponent(localId)}`),
  /** Все печати карты с таким именем. */
  searchName: (name: string, lang: TcgdexLanguage = 'en') => list(lang, `name=${encodeURIComponent(name)}`),
};

/** Картинка карты: low — 30 КБ для миниатюр, high — 120 КБ для крупного показа. */
export function cardImage(image: string | undefined, quality: 'low' | 'high'): string | null {
  return image ? `${image}/${quality}.webp` : null;
}

/**
 * Карты TCG Pocket цифровые, в альбом настоящих карт они не попадают.
 * Их сеты: P-A, A1, A1a… B2a, картинки лежат в папке /tcgp/.
 */
export function isPocketId(id: string): boolean {
  return /^(?:P-A|[AB]\d)/.test(id);
}

export function isPocketCard(card: CardBrief): boolean {
  return isPocketId(card.id) || Boolean(card.image?.includes('/tcgp/'));
}

/** ID сета из ID карты: «sv03.5-006» → «sv03.5». */
export function setIdOf(card: CardBrief): string {
  return card.id.slice(0, card.id.length - card.localId.length - 1);
}
