import {
  collection,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type CollectionReference,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';

export type Variant = 'normal' | 'holo' | 'reverse';

/**
 * Документ members/{uid}/cards/{cardId}. Хранится только ссылка на карту в TCGdex,
 * сколько копий и вариант печати. Данные карты из справочника не дублируются.
 */
export type OwnedCard = {
  cardId: string;
  setId: string;
  count: number;
  variant?: Variant;
  addedAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

/** Больше копий одной карты держать незачем, правила Firestore проверяют то же число. */
export const MAX_COPIES = 999;

export function cardsOf(db: Firestore, uid: string): CollectionReference {
  return collection(db, 'members', uid, 'cards');
}

export type NewCard = { cardId: string; setId: string; variant?: Variant };

/** Добавляет карты одной записью: новые создаются, у известных растёт счётчик. */
export async function addToCollection(
  db: Firestore,
  uid: string,
  items: NewCard[],
  owned: ReadonlyMap<string, OwnedCard>,
): Promise<void> {
  const grouped = new Map<string, NewCard & { copies: number }>();
  for (const item of items) {
    const previous = grouped.get(item.cardId);
    grouped.set(item.cardId, { ...item, copies: (previous?.copies ?? 0) + 1 });
  }
  const batch = writeBatch(db);
  for (const { cardId, setId, variant, copies } of grouped.values()) {
    const ref = doc(cardsOf(db, uid), cardId);
    if (owned.has(cardId)) {
      batch.update(ref, { count: increment(copies), updatedAt: serverTimestamp() });
    } else {
      batch.set(ref, {
        setId,
        count: copies,
        ...(variant ? { variant } : {}),
        addedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }
  await batch.commit();
}
