import { energy, type CardFacts } from '@/lib/card-facts';
import { CONDITIONS, setKey, type Condition, type OwnedCard, type Variant } from '@/lib/collection';
import { pluralWord, rarityLabel, type WordForms } from '@/lib/format';
import { CARD_LANGUAGES, LANGUAGE_LABELS, type CardLanguage } from '@/lib/languages';
import { normalizeNumber } from '@/lib/matching';
import type { LimitlessRef } from '@/lib/limitless';
import type { CardPrice } from '@/lib/prices';

/**
 * Фильтры, сортировка и раскладка альбома по карманам биндера. Без интерфейса и без сети:
 * на входе карты альбома (CardView) и то, что о них известно из карточек базы (CardFacet).
 */

/** Поля карты альбома, которые нужны фильтрам. CardView подходит целиком. */
export type AlbumCard = Pick<
  OwnedCard,
  'docId' | 'cardId' | 'catalog' | 'setId' | 'lang' | 'count' | 'variant' | 'condition' | 'printed' | 'addedAt'
> & {
  name: string;
  englishName: string | null;
  localId: string;
  setName: string;
  printedTotal: number | null;
  releaseDate: string | null;
  price: CardPrice | null;
};

/**
 * Тип и редкость карты. Их нет в сете TCGdex, только в полной карточке, поэтому они
 * подгружаются отдельно (src/lib/useCardFacets.ts). types — ключи энергий («fire»),
 * у тренеров и энергий вместо типа — «trainer» и «energy».
 */
export type CardFacet = { types: string[]; rarity: string | null };

export const TRAINER_TYPE = 'trainer';
export const ENERGY_TYPE = 'energy';

export function facetFromFacts(facts: Pick<CardFacts, 'category' | 'types' | 'rarity'>): CardFacet {
  const types =
    facts.category === 'trainer' ? [TRAINER_TYPE] : facts.category === 'energy' ? [ENERGY_TYPE] : facts.types.map((type) => type.type);
  const rarity = rarityLabel(facts.rarity ?? undefined);
  return { types: [...new Set(types)], rarity: rarity && rarity.toLowerCase() !== 'none' ? rarity : null };
}

export type PriceFilter = 'any' | 'priced' | 'unpriced';

export type LibraryFilters = {
  /** Поиск по имени: английскому, напечатанному, а цифрами — по номеру */
  query: string;
  /** setKey группы альбома */
  set: string | null;
  lang: CardLanguage | null;
  /** Ключ энергии или TRAINER_TYPE / ENERGY_TYPE */
  type: string | null;
  rarity: string | null;
  /** Печать: обычная, голо, реверс. Карта без поля — обычная */
  finish: Variant | null;
  /** Карта без поля — Near Mint */
  condition: Condition | null;
  price: PriceFilter;
};

export const NO_FILTERS: LibraryFilters = {
  query: '',
  set: null,
  lang: null,
  type: null,
  rarity: null,
  finish: null,
  condition: null,
  price: 'any',
};

export type LibrarySort = 'number' | 'price-desc' | 'price-asc' | 'added-desc' | 'added-asc';

export const SORT_LABELS: Record<LibrarySort, string> = {
  number: 'По номеру',
  'price-desc': 'Сначала дорогие',
  'price-asc': 'Сначала дешёвые',
  'added-desc': 'Сначала новые',
  'added-asc': 'Сначала старые',
};

/** Сколько фильтров включено; ignoreSet — не считать сет (для разворота сета с пустыми карманами). */
export function activeFilterCount(filters: LibraryFilters, { ignoreSet = false } = {}): number {
  return [
    filters.query.trim() !== '',
    !ignoreSet && filters.set !== null,
    filters.lang !== null,
    filters.type !== null,
    filters.rarity !== null,
    filters.finish !== null,
    filters.condition !== null,
    filters.price !== 'any',
  ].filter(Boolean).length;
}

/** Строка для поиска: без регистра, диакритики («Pokémon» = «pokemon») и полуширинной каны. */
export function searchKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_TERM = /^#?(\w{1,8})(?:\/\w{1,8})?$/;
/** Слово из одних цифр («151», «#25», «3/21») — это номер карты, а не имя сета. */
const DIGITS_TERM = /^#?\d+(?:\/\d+)?$/;

/** Слова запроса: без регистра и диакритики. */
export function queryTerms(query: string): string[] {
  return searchKey(query).split(' ').filter(Boolean);
}

/** Имена карты для поиска: показанное, английское и напечатанное. */
export function cardNames(card: Pick<AlbumCard, 'name' | 'englishName' | 'printed'>): string[] {
  return [card.name, card.englishName, card.printed?.name, card.printed?.englishName]
    .filter((name): name is string => Boolean(name))
    .map(searchKey);
}

/**
 * Каждое слово запроса должно найтись в одном из имён карты или в сете (имя или код:
 * «Surging Sparks», «SV2a», «MBG»). Слово с цифрами («125», «#125», «125/197») ещё и
 * сверяется с номером карты; слово из одних цифр в сете не ищется, иначе «151» нашло бы
 * весь сет «151», а не карту № 151.
 */
export function matchesQuery(card: AlbumCard, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  const haystack = cardNames(card).join(' | ');
  const sets = [card.setName, card.setId, card.printed?.setCode]
    .filter((name): name is string => Boolean(name))
    .map(searchKey)
    .join(' | ');
  const number = card.localId ? normalizeNumber(card.localId) : null;
  return terms.every((term) => {
    if (haystack.includes(term)) return true;
    const numeric = /\d/.test(term) ? NUMBER_TERM.exec(term) : null;
    if (numeric && number && normalizeNumber(numeric[1]!) === number) return true;
    return !DIGITS_TERM.test(term) && sets.includes(term);
  });
}

export function hasPrice(price: CardPrice | null | undefined): boolean {
  return price?.u != null || price?.e != null;
}

export function matchesFilters(card: AlbumCard, facet: CardFacet | undefined, filters: LibraryFilters): boolean {
  if (filters.set !== null && setKey(card) !== filters.set) return false;
  if (filters.lang !== null && card.lang !== filters.lang) return false;
  if (filters.finish !== null && (card.variant ?? 'normal') !== filters.finish) return false;
  if (filters.condition !== null && (card.condition ?? 'NM') !== filters.condition) return false;
  if (filters.price === 'priced' && !hasPrice(card.price)) return false;
  if (filters.price === 'unpriced' && hasPrice(card.price)) return false;
  // Пока тип и редкость не известны, карта под эти фильтры не подходит
  if (filters.type !== null && !facet?.types.includes(filters.type)) return false;
  if (filters.rarity !== null && facet?.rarity !== filters.rarity) return false;
  return matchesQuery(card, filters.query);
}

export function filterCards<T extends AlbumCard>(
  cards: readonly T[],
  facets: ReadonlyMap<string, CardFacet>,
  filters: LibraryFilters,
): T[] {
  return cards.filter((card) => matchesFilters(card, facets.get(card.docId), filters));
}

/** Сеты от новых к старым, карты вне базы (без даты выхода) в конце. */
function bySet(a: AlbumCard, b: AlbumCard): number {
  return (
    (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') ||
    a.setName.localeCompare(b.setName) ||
    setKey(a).localeCompare(setKey(b))
  );
}

/** Номер в сете: числа по значению («9» раньше «10»), остальное («TG05», «SWSH050») по тексту. */
export function byNumber(a: Pick<AlbumCard, 'localId'>, b: Pick<AlbumCard, 'localId'>): number {
  const left = normalizeNumber(a.localId);
  const right = normalizeNumber(b.localId);
  const numeric = Number(left) - Number(right);
  return Number.isNaN(numeric) ? left.localeCompare(right, 'en', { numeric: true }) : numeric;
}

const LANGUAGE_ORDER = new Map(CARD_LANGUAGES.map((lang, index) => [lang, index]));

/** Порядок биндера: сет, номер, язык (английская копия раньше французской). */
export function albumOrder(a: AlbumCard, b: AlbumCard): number {
  return (
    bySet(a, b) ||
    byNumber(a, b) ||
    (LANGUAGE_ORDER.get(a.lang) ?? 0) - (LANGUAGE_ORDER.get(b.lang) ?? 0) ||
    a.docId.localeCompare(b.docId)
  );
}

/**
 * Цена для сортировки. Доллары и евро не сравниваются между собой (курса в Binder нет):
 * сначала карты с ценой TCGplayer, потом с ценой только Cardmarket, карты без цены — всегда в конце.
 */
function priceRank(price: CardPrice | null): { tier: number; value: number } {
  if (price?.u != null) return { tier: 0, value: price.u };
  if (price?.e != null) return { tier: 1, value: price.e };
  return { tier: 2, value: 0 };
}

/** Время добавления; только что добавленные ещё без времени с сервера — они самые новые. */
function addedTime(card: AlbumCard): number {
  return card.addedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
}

export function sortCards<T extends AlbumCard>(cards: readonly T[], sort: LibrarySort): T[] {
  const sorted = [...cards];
  switch (sort) {
    case 'number':
      return sorted.sort(albumOrder);
    case 'price-desc':
    case 'price-asc': {
      const sign = sort === 'price-desc' ? -1 : 1;
      return sorted.sort((a, b) => {
        const left = priceRank(a.price);
        const right = priceRank(b.price);
        return left.tier - right.tier || sign * (left.value - right.value) || albumOrder(a, b);
      });
    }
    case 'added-desc':
      return sorted.sort((a, b) => addedTime(b) - addedTime(a) || albumOrder(a, b));
    case 'added-asc':
      return sorted.sort((a, b) => addedTime(a) - addedTime(b) || albumOrder(a, b));
  }
}

export type SetGroup<T extends AlbumCard> = {
  key: string;
  setName: string;
  /** Пояснение к группе карт вне базы */
  note: string | null;
  printedTotal: number | null;
  cards: T[];
};

/** Группы по сетам в порядке первого появления карт: на входе уже отсортированные карты. */
export function groupBySet<T extends AlbumCard>(cards: readonly T[]): SetGroup<T>[] {
  const groups = new Map<string, SetGroup<T>>();
  for (const card of cards) {
    const key = setKey(card);
    const group = groups.get(key) ?? {
      key,
      setName: card.setName,
      note: card.catalog ? null : `${LANGUAGE_LABELS[card.lang].card.toLowerCase()}, нет в базе TCGdex`,
      printedTotal: card.printedTotal,
      cards: [],
    };
    group.cards.push(card);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Сколько разных карт сета есть: номера от 1 до официального числа карт, без секретных. */
export function ownedInSet(cards: readonly AlbumCard[], total: number): number {
  const numbers = new Set<number>();
  for (const card of cards) {
    const number = Number(normalizeNumber(card.localId));
    if (Number.isInteger(number) && number >= 1 && number <= total) numbers.add(number);
  }
  return numbers.size;
}

/**
 * Сколько разных секретных карт сета есть: номер больше официального числа карт (149/128)
 * или не число («TG05»). В «N из M» они не входят — их показывают отдельно, «+N секретных».
 */
export function secretInSet(cards: readonly AlbumCard[], total: number): number {
  const ids = new Set<string>();
  for (const card of cards) {
    if (!card.localId) continue;
    const number = Number(normalizeNumber(card.localId));
    if (!(Number.isInteger(number) && number >= 1 && number <= total)) ids.add(card.localId.toUpperCase());
  }
  return ids.size;
}

/** «0 из 128 карт · +2 секретных»: подпись сета в развороте и сетке. */
export function setCountLabel(cards: readonly AlbumCard[], total: number): string {
  const secret = secretInSet(cards, total);
  return `${ownedInSet(cards, total)} из ${total} карт` + (secret > 0 ? ` · +${secret} ${pluralWord(secret, SECRET_FORMS)}` : '');
}

const SECRET_FORMS: WordForms = ['секретная', 'секретных', 'секретных'];

export type SetProgress = { key: string; setName: string; owned: number; secret: number; total: number };

/** Прогресс сетов для боковой панели: только сеты, у которых известно число карт. */
export function setProgress(cards: readonly AlbumCard[]): SetProgress[] {
  return groupBySet(sortCards(cards, 'number')).flatMap((group) =>
    group.printedTotal
      ? [
          {
            key: group.key,
            setName: group.setName,
            owned: ownedInSet(group.cards, group.printedTotal),
            secret: secretInSet(group.cards, group.printedTotal),
            total: group.printedTotal,
          },
        ]
      : [],
  );
}

/** Самые дорогие карты: доллары TCGplayer, потом евро Cardmarket. */
export function mostValuable<T extends AlbumCard>(cards: readonly T[], limit: number): T[] {
  return sortCards(
    cards.filter((card) => hasPrice(card.price)),
    'price-desc',
  ).slice(0, limit);
}

/* ---------- Варианты для выпадающих списков ---------- */

export type FilterOption<T extends string> = { value: T; label: string };

/** Язык во множественном числе, как пункт фильтра. */
export const LANGUAGE_FILTER_LABELS: Record<CardLanguage, string> = {
  en: 'Английские',
  fr: 'Французские',
  de: 'Немецкие',
  it: 'Итальянские',
  es: 'Испанские',
  pt: 'Португальские',
  ru: 'Русские',
  ja: 'Японские',
  'zh-tw': 'Китайские, традиционные',
  'zh-cn': 'Китайские, упрощённые',
  ko: 'Корейские',
  id: 'Индонезийские',
  th: 'Тайские',
  other: 'Язык не определён',
};

export const FINISH_LABELS: Record<Variant, string> = { normal: 'Обычные', holo: 'Голо', reverse: 'Реверс' };

const TYPE_ORDER = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
  'fairy',
  'dragon',
  'colorless',
  TRAINER_TYPE,
  ENERGY_TYPE,
];

export function typeLabel(type: string): string {
  if (type === TRAINER_TYPE) return 'Тренер';
  if (type === ENERGY_TYPE) return 'Энергия';
  return energy(type).label;
}

/** Редкости от простых к редким; незнакомые — после, по алфавиту. */
const RARITY_ORDER = [
  'common',
  'uncommon',
  'rare',
  'rare holo',
  'double rare',
  'triple rare',
  'ace spec rare',
  'illustration rare',
  'art rare',
  'ultra rare',
  'super rare',
  'special illustration rare',
  'special art rare',
  'hyper rare',
  'shiny rare',
  'shiny ultra rare',
  'shiny super rare',
  'character rare',
  'character super rare',
  'mega ultra rare',
  'promo',
];

function ordered(values: Iterable<string>, order: readonly string[]): string[] {
  const rank = (value: string) => {
    const index = order.indexOf(value.toLowerCase());
    return index === -1 ? order.length : index;
  };
  return [...new Set(values)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export type FilterChoices = {
  sets: FilterOption<string>[];
  langs: FilterOption<CardLanguage>[];
  types: FilterOption<string>[];
  rarities: FilterOption<string>[];
  finishes: FilterOption<Variant>[];
  conditions: FilterOption<Condition>[];
  /** Сколько карт с ценой и без: если всё по одну сторону, фильтр цены не нужен */
  priced: number;
  unpriced: number;
};

/** Что вообще есть в альбоме: из этого строятся пункты фильтров. */
export function filterChoices(cards: readonly AlbumCard[], facets: ReadonlyMap<string, CardFacet>): FilterChoices {
  const sets = groupBySet(sortCards(cards, 'number')).map((group) => {
    const card = group.cards[0]!;
    const suffix = !card.catalog ? ' (вне базы)' : card.catalog !== 'en' ? ` · ${LANGUAGE_LABELS[card.lang].short}` : '';
    return { value: group.key, label: `${group.setName}${suffix}` };
  });
  const langs = CARD_LANGUAGES.filter((lang) => cards.some((card) => card.lang === lang)).map((lang) => ({
    value: lang,
    label: LANGUAGE_FILTER_LABELS[lang],
  }));
  const known = cards.map((card) => facets.get(card.docId)).filter((facet): facet is CardFacet => Boolean(facet));
  const types = ordered(
    known.flatMap((facet) => facet.types),
    TYPE_ORDER,
  ).map((type) => ({ value: type, label: typeLabel(type) }));
  const rarities = ordered(
    known.flatMap((facet) => (facet.rarity ? [facet.rarity] : [])),
    RARITY_ORDER,
  ).map((rarity) => ({ value: rarity, label: rarity }));
  const finishes = (['normal', 'holo', 'reverse'] as const)
    .filter((finish) => cards.some((card) => (card.variant ?? 'normal') === finish))
    .map((finish) => ({ value: finish, label: FINISH_LABELS[finish] }));
  const conditions = CONDITIONS.filter((condition) => cards.some((card) => (card.condition ?? 'NM') === condition)).map(
    (condition) => ({ value: condition, label: condition }),
  );
  const priced = cards.filter((card) => hasPrice(card.price)).length;
  return { sets, langs, types, rarities, finishes, conditions, priced, unpriced: cards.length - priced };
}

/* ---------- Карманы биндера ---------- */

/** Страница биндера — девять карманов, 3 × 3; разворот — две страницы. */
export const POCKETS_PER_PAGE = 9;
export const PAGES_PER_SPREAD = 2;

export type Pocket<T> =
  | { kind: 'card'; key: string; card: T }
  /** Карта сета, которой нет в альбоме: её скан без цвета, а нет скана — пустой карман с номером */
  | { kind: 'missing'; key: string; number: string; name: string; image?: string; limitless?: LimitlessRef | null }
  /** Пустой карман в конце последней страницы */
  | { kind: 'blank'; key: string };

/**
 * Карта из списка сета: TCGdex или, у сетов вне TCGdex, Limitless (src/lib/limitless-set.ts).
 * image — скан TCGdex, limitless — где взять скан в Limitless; у недостающей карты он показывается без цвета.
 */
export type ChecklistCard = { id: string; localId: string; name: string; image?: string; limitless?: LimitlessRef | null };

export function cardPockets<T extends Pick<AlbumCard, 'docId'>>(cards: readonly T[]): Pocket<T>[] {
  return cards.map((card) => ({ kind: 'card', key: card.docId, card }));
}

/**
 * Разворот сета как в настоящем биндере: все карты сета по порядку, у недостающих — пустой
 * карман с номером. Копии на других языках (английская и французская) лежат рядом.
 * Карты альбома, которых в списке сета нет, — в конце.
 */
export function checklistPockets<T extends AlbumCard>(
  cards: readonly T[],
  checklist: readonly ChecklistCard[],
  /** По чему карта альбома находит своё место в списке: у сетов TCGdex — ID карты, у сетов вне базы — номер */
  idOf: (card: T) => string | null = (card) => card.cardId,
): Pocket<T>[] {
  const owned = new Map<string, T[]>();
  for (const card of [...cards].sort(albumOrder)) {
    const id = idOf(card);
    if (!id) continue;
    owned.set(id, [...(owned.get(id) ?? []), card]);
  }
  const placed = new Set<string>();
  const pockets: Pocket<T>[] = [];
  for (const item of checklist) {
    const copies = owned.get(item.id);
    if (!copies) {
      pockets.push({
        kind: 'missing',
        key: `missing:${item.id}`,
        number: item.localId,
        name: item.name,
        ...(item.image ? { image: item.image } : {}),
        ...(item.limitless ? { limitless: item.limitless } : {}),
      });
      continue;
    }
    for (const card of copies) {
      placed.add(card.docId);
      pockets.push({ kind: 'card', key: card.docId, card });
    }
  }
  const rest = cards.filter((card) => !placed.has(card.docId)).sort(albumOrder);
  return [...pockets, ...cardPockets(rest)];
}

export function pageCount(pockets: number): number {
  return Math.max(1, Math.ceil(pockets / POCKETS_PER_PAGE));
}

export function spreadCount(pockets: number): number {
  return Math.ceil(pageCount(pockets) / PAGES_PER_SPREAD);
}

export type Spread<T> = {
  pages: Pocket<T>[][];
  /** Номера страниц разворота, с единицы; у последнего разворота страница может быть одна */
  first: number;
  last: number;
  totalPages: number;
};

/** Разворот номер index (с нуля): две страницы по девять карманов, недостающие — пустые. */
export function spreadAt<T>(pockets: readonly Pocket<T>[], index: number): Spread<T> {
  const totalPages = pageCount(pockets.length);
  const spread = Math.min(Math.max(0, index), spreadCount(pockets.length) - 1);
  const pages = Array.from({ length: PAGES_PER_SPREAD }, (_, side) => {
    const page = spread * PAGES_PER_SPREAD + side;
    const start = page * POCKETS_PER_PAGE;
    const filled = pockets.slice(start, start + POCKETS_PER_PAGE);
    const blanks = Array.from(
      { length: POCKETS_PER_PAGE - filled.length },
      (_, slot): Pocket<T> => ({ kind: 'blank', key: `blank:${page}:${slot}` }),
    );
    return [...filled, ...blanks];
  });
  const first = spread * PAGES_PER_SPREAD + 1;
  return { pages, first, last: Math.min(first + PAGES_PER_SPREAD - 1, totalPages), totalPages };
}

export function spreadLabel({ first, last, totalPages }: Pick<Spread<unknown>, 'first' | 'last' | 'totalPages'>): string {
  return first === last ? `Страница ${first} из ${totalPages}` : `Страницы ${first}–${last} из ${totalPages}`;
}

/* ---------- Сохранённое состояние альбома ---------- */

export type LibraryView = 'binder' | 'grid' | 'list';

export type LibraryState = { view: LibraryView; filters: LibraryFilters; sort: LibrarySort; spread: number };

export const DEFAULT_LIBRARY_STATE: LibraryState = { view: 'binder', filters: NO_FILTERS, sort: 'number', spread: 0 };

const VIEWS: readonly LibraryView[] = ['binder', 'grid', 'list'];
const SORTS = Object.keys(SORT_LABELS) as LibrarySort[];
const FINISHES: readonly Variant[] = ['normal', 'holo', 'reverse'];
const PRICE_FILTERS: readonly PriceFilter[] = ['any', 'priced', 'unpriced'];

const short = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : null;
}

/**
 * Поиск из шапки вкладки: альбом открывается с этим запросом и без остальных фильтров
 * (иначе старый фильтр сета или цены спрятал бы найденное), с первого разворота. Вид и
 * сортировка остаются.
 */
export function withSearch(state: LibraryState, query: string): LibraryState {
  return { ...state, filters: { ...NO_FILTERS, query: query.trim().slice(0, 80) }, spread: 0 };
}

/** Состояние альбома из sessionStorage: всё непонятное заменяется значением по умолчанию. */
export function parseLibraryState(raw: unknown): LibraryState {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const filters = (data.filters && typeof data.filters === 'object' ? data.filters : {}) as Record<string, unknown>;
  const spread = typeof data.spread === 'number' && Number.isInteger(data.spread) && data.spread >= 0 ? data.spread : 0;
  return {
    view: pick(data.view, VIEWS) ?? DEFAULT_LIBRARY_STATE.view,
    sort: pick(data.sort, SORTS) ?? DEFAULT_LIBRARY_STATE.sort,
    spread,
    filters: {
      query: typeof filters.query === 'string' ? filters.query.slice(0, 80) : '',
      set: short(filters.set, 120),
      lang: pick(filters.lang, CARD_LANGUAGES),
      type: short(filters.type, 40),
      rarity: short(filters.rarity, 60),
      finish: pick(filters.finish, FINISHES),
      condition: pick(filters.condition, CONDITIONS),
      price: pick(filters.price, PRICE_FILTERS) ?? 'any',
    },
  };
}
