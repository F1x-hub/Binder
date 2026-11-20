import { updateDoc, type Firestore } from 'firebase/firestore';
import { memberRef } from '@/lib/membership';

/**
 * Витрина — до шести карт своего альбома, которые участник показывает клубу в профиле.
 * Хранится полем showcase в members/{uid}: список ID документов альбома в выбранном порядке.
 * Должно совпадать с firestore.rules (функция updatesShowcase).
 */
export const MAX_SHOWCASE = 6;

/** Та же проверка ID, что validId в firestore.rules: ID документов альбома такие и есть. */
const DOC_ID = /^[A-Za-z0-9._-]{1,60}$/;

/** Витрина из документа участника: только допустимые ID, без повторов, не больше шести. */
export function showcaseOf(data: { showcase?: unknown } | null | undefined): string[] {
  const raw: unknown[] = Array.isArray(data?.showcase) ? data.showcase : [];
  const ids = raw.filter((id): id is string => typeof id === 'string' && DOC_ID.test(id));
  return [...new Set(ids)].slice(0, MAX_SHOWCASE);
}

/** Карта входит в витрину (в конец) или выходит из неё. Седьмая не добавляется. */
export function toggleShowcase(list: readonly string[], docId: string): string[] {
  if (list.includes(docId)) return list.filter((id) => id !== docId);
  if (list.length >= MAX_SHOWCASE) return [...list];
  return [...list, docId];
}

/**
 * Карты витрины в её порядке. Карты, которые уже ушли из альбома, пропускаются:
 * витрина не правится сама, когда хозяин убирает карту.
 */
export function pickShowcase<T extends { docId: string }>(list: readonly string[], cards: readonly T[]): T[] {
  const byId = new Map(cards.map((card) => [card.docId, card]));
  return list.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

/** Сохраняет витрину. В запись идут только карты, которые сейчас есть в альбоме. */
export async function saveShowcase(
  db: Firestore,
  uid: string,
  list: readonly string[],
  owned: ReadonlyMap<string, unknown>,
): Promise<string[]> {
  const clean = showcaseOf({ showcase: list.filter((id) => owned.has(id)) });
  await updateDoc(memberRef(db, uid), { showcase: clean });
  return clean;
}
