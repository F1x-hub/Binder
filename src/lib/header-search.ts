import { albumOrder, cardNames, matchesQuery, queryTerms, searchKey, type AlbumCard } from '@/lib/library-filters';

/**
 * Поиск в шапке вкладки: подсказки по своему альбому и по участникам клуба. Без интерфейса
 * и без сети. Совпадение карты — тот же matchesQuery, что у поиска в альбоме: Enter в шапке
 * открывает альбом с этим запросом, и там видны те же карты.
 */

/** Сколько подсказок каждого вида видно под полем. */
export const CARD_SUGGESTIONS = 6;
export const MEMBER_SUGGESTIONS = 4;

/**
 * Насколько хорошо совпало: 0 — имя начинается с запроса, 1 — с запроса начинается слово имени,
 * 2 — всё остальное (середина слова, номер, сет).
 */
function rank(names: readonly string[], query: string): number {
  if (names.some((name) => name.startsWith(query))) return 0;
  const first = query.split(' ')[0]!;
  if (names.some((name) => name.split(/[\s\-–—'’.(]+/).some((word) => word.startsWith(first)))) return 1;
  return 2;
}

/** Карты по запросу: сначала лучшие совпадения, внутри — в порядке биндера. total — сколько всего. */
export function cardSuggestions<T extends AlbumCard>(
  cards: readonly T[],
  query: string,
  limit = CARD_SUGGESTIONS,
): { cards: T[]; total: number } {
  const key = searchKey(query);
  if (!key) return { cards: [], total: 0 };
  const found = cards
    .filter((card) => matchesQuery(card, query))
    .map((card) => ({ card, score: rank(cardNames(card), key) }))
    .sort((a, b) => a.score - b.score || albumOrder(a.card, b.card));
  return { cards: found.slice(0, limit).map(({ card }) => card), total: found.length };
}

export type SearchMember = { uid: string; displayName: string };

const collator = new Intl.Collator('ru-RU', { sensitivity: 'base' });

/** Участники по имени: каждое слово запроса — в имени. Себя не показываем, свой профиль — в меню аккаунта. */
export function memberSuggestions<T extends SearchMember>(
  members: readonly T[],
  query: string,
  { self = null, limit = MEMBER_SUGGESTIONS }: { self?: string | null; limit?: number } = {},
): { members: T[]; total: number } {
  const key = searchKey(query);
  const terms = queryTerms(query);
  if (terms.length === 0) return { members: [], total: 0 };
  const found = members
    .filter((member) => member.uid !== self)
    .map((member) => ({ member, name: searchKey(member.displayName) }))
    .filter(({ name }) => terms.every((term) => name.includes(term)))
    .map(({ member, name }) => ({ member, score: rank([name], key) }))
    .sort((a, b) => a.score - b.score || collator.compare(a.member.displayName, b.member.displayName));
  return { members: found.slice(0, limit).map(({ member }) => member), total: found.length };
}

/** Элемент списка подсказок: по нему стрелки ходят одним рядом, сверху вниз. */
export type SuggestionItem<C, M> =
  | { kind: 'card'; key: string; card: C }
  | { kind: 'all'; key: string; total: number }
  | { kind: 'member'; key: string; member: M };

/**
 * Порядок подсказок: карты, «Все найденные в альбоме» (если карт больше, чем видно),
 * потом участники.
 */
export function suggestionItems<C extends Pick<AlbumCard, 'docId'>, M extends SearchMember>(
  cards: { cards: readonly C[]; total: number },
  members: { members: readonly M[] },
): Array<SuggestionItem<C, M>> {
  return [
    ...cards.cards.map((card) => ({ kind: 'card' as const, key: `card:${card.docId}`, card })),
    ...(cards.total > cards.cards.length ? [{ kind: 'all' as const, key: 'all', total: cards.total }] : []),
    ...members.members.map((member) => ({ kind: 'member' as const, key: `member:${member.uid}`, member })),
  ];
}

/** Следующая подсказка по стрелке: по кругу; -1 — ни одна не выбрана. */
export function moveActive(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/** Куда сейчас печатают: «/» там — просто символ, а не переход к поиску. */
export function isTypingTarget(element: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (element.type ?? 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit'].includes(type);
}

/** Строка для экранного диктора: сколько нашлось. */
export function resultsAnnouncement(cards: number, members: number): string {
  if (cards === 0 && members === 0) return 'Ничего не нашлось';
  const parts: string[] = [];
  if (cards > 0) parts.push(`карточек: ${cards}`);
  if (members > 0) parts.push(`участников: ${members}`);
  const text = parts.join(', ');
  return `Нашлось ${text}. Стрелки вверх и вниз — выбор, Enter — открыть.`;
}
