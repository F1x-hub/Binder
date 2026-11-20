import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { DECK_SIZE } from '@/lib/deck-rules';

/**
 * Колода: members/{uid}/decks/{deckId}. В cards — ID документа альбома и сколько копий
 * этой карты в колоде; данные карт не дублируются, они берутся из альбома и TCGdex.
 * Колоды видны всем участникам, менять свои может только хозяин.
 */
export type Deck = {
  id: string;
  name: string;
  cards: Record<string, number>;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

/**
 * Ограничения те же, что в правилах Firestore. У записи — до 60 копий, а не до 4: базовой
 * энергии одной печати в колоде обычно больше четырёх. Правило четырёх копий проверяет
 * checkDeck (src/lib/deck-rules.ts), а колода с нарушением хранится как неготовая.
 */
export const DECK_LIMITS = { name: 60, entries: 60, copies: DECK_SIZE } as const;

export function decksOf(db: Firestore, uid: string): CollectionReference {
  return collection(db, 'members', uid, 'decks');
}

const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= DECK_LIMITS.copies;

export function deckFromDoc(id: string, data: DocumentData): Deck {
  const raw = data.cards && typeof data.cards === 'object' ? (data.cards as Record<string, unknown>) : {};
  const cards: Record<string, number> = {};
  for (const [docId, count] of Object.entries(raw)) if (validCount(count)) cards[docId] = count;
  return {
    id,
    name: typeof data.name === 'string' && data.name ? data.name : 'Колода',
    cards,
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
    updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
  };
}

/** Имя без лишних пробелов и не длиннее, чем пускают правила. */
export function cleanDeckName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, DECK_LIMITS.name).trim();
}

/** «Новая колода», а если такая уже есть — «Новая колода 2», «Новая колода 3»… */
export function defaultDeckName(existing: ReadonlyArray<Pick<Deck, 'name'>>): string {
  const names = new Set(existing.map((deck) => deck.name));
  if (!names.has('Новая колода')) return 'Новая колода';
  let index = 2;
  while (names.has(`Новая колода ${index}`)) index++;
  return `Новая колода ${index}`;
}

/** Новый состав колоды: count 0 убирает карту. */
export function withCount(cards: Readonly<Record<string, number>>, docId: string, count: number): Record<string, number> {
  const next = { ...cards };
  if (count > 0) next[docId] = count;
  else delete next[docId];
  return next;
}

/** Создаёт колоду (пустую или сразу с картами, как со страницы карточки) и возвращает её ID. */
export async function createDeck(db: Firestore, uid: string, name: string, cards: Record<string, number> = {}): Promise<string> {
  const ref = doc(decksOf(db, uid));
  await setDoc(ref, {
    name: cleanDeckName(name) || 'Новая колода',
    cards,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameDeck(db: Firestore, uid: string, deckId: string, name: string): Promise<void> {
  const clean = cleanDeckName(name);
  if (!clean) throw new Error('Пустое имя колоды');
  await updateDoc(doc(decksOf(db, uid), deckId), { name: clean, updatedAt: serverTimestamp() });
}

/**
 * Состав колоды записывается целиком. ID карт альбома бывают с точкой («sv03.5-006»),
 * а в updateDoc точка в имени поля значила бы вложенное поле: целая карта этого не боится.
 */
export async function setDeckCards(db: Firestore, uid: string, deckId: string, cards: Record<string, number>): Promise<void> {
  await updateDoc(doc(decksOf(db, uid), deckId), { cards, updatedAt: serverTimestamp() });
}

export async function deleteDeck(db: Firestore, uid: string, deckId: string): Promise<void> {
  await deleteDoc(doc(decksOf(db, uid), deckId));
}
