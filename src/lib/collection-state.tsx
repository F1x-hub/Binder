import { onSnapshot } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cardsOf, ownedFromDoc, type OwnedCard } from '@/lib/collection';
import { binderDb } from '@/lib/db';

export type CollectionState =
  | { status: 'loading' }
  | { status: 'ready'; cards: OwnedCard[]; byId: ReadonlyMap<string, OwnedCard> }
  /** code — код ошибки Firestore (`permission-denied`, `unavailable`…), если он есть */
  | { status: 'error'; message: string; code?: string };

const CollectionContext = createContext<CollectionState>({ status: 'loading' });
const RetryContext = createContext<() => void>(() => undefined);

/**
 * Альбом участника: живая подписка на members/{uid}/cards. byId — по ID документа.
 * uid null — подписки нет, альбом «загружается» (так поиск в шапке ждёт первого фокуса).
 *
 * Без связи Firestore отдаёт пустой снимок из кэша памяти, и пустой альбом выглядел бы
 * настоящим. Поэтому пустой снимок из кэша — это ошибка «нет связи»; подписка при этом
 * жива, и с появлением связи альбом придёт сам.
 */
export function CollectionProvider({ uid, children }: { uid: string | null; children: ReactNode }) {
  const [state, setState] = useState<CollectionState>({ status: 'loading' });
  // После ошибки Firestore подписку закрывает, «Обновить» открывает её заново
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    setState({ status: 'loading' });
    if (!uid) return;
    return onSnapshot(
      cardsOf(binderDb(), uid),
      (snapshot) => {
        if (snapshot.empty && snapshot.metadata.fromCache) {
          setState({ status: 'error', message: 'Offline: empty snapshot from cache', code: 'unavailable' });
          return;
        }
        const cards = snapshot.docs.map((item) => ownedFromDoc(item.id, item.data()));
        setState({ status: 'ready', cards, byId: new Map(cards.map((card) => [card.docId, card])) });
      },
      (error) => setState({ status: 'error', message: error.message, code: error.code }),
    );
  }, [uid, attempt]);

  return (
    <RetryContext.Provider value={retry}>
      <CollectionContext.Provider value={state}>{children}</CollectionContext.Provider>
    </RetryContext.Provider>
  );
}

export function useCollection(): CollectionState {
  return useContext(CollectionContext);
}

/** Понятная причина по-русски, почему альбом не загрузился. */
export function albumErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Нет связи с базой Binder. Проверь интернет и обнови альбом.';
    case 'permission-denied':
      return 'База не пустила к альбому. Обнови его, а если не поможет, напиши админу клуба.';
    case 'unauthenticated':
      return 'Вход в Binder устарел. Обнови страницу, чтобы войти снова.';
    case 'resource-exhausted':
      return 'На сегодня кончился бесплатный лимит чтений базы. Он обновится в полночь по калифорнийскому времени.';
    default:
      return code
        ? `Не получилось загрузить альбом (ошибка базы: ${code}). Попробуй обновить.`
        : 'Не получилось загрузить альбом. Попробуй обновить.';
  }
}

const EMPTY: ReadonlyMap<string, OwnedCard> = new Map();

export type Owned = {
  cards: OwnedCard[];
  byId: ReadonlyMap<string, OwnedCard>;
  ready: boolean;
  /** Причина по-русски, если альбом не загрузился; null — загружается или загружен */
  error: string | null;
};

/** То, что отдаёт useOwned, без React: пока альбом грузится или не загрузился — пусто. */
export function ownedOf(state: CollectionState): Owned {
  if (state.status === 'ready') return { cards: state.cards, byId: state.byId, ready: true, error: null };
  return { cards: [], byId: EMPTY, ready: false, error: state.status === 'error' ? albumErrorMessage(state.code) : null };
}

/** Карты альбома, пока он грузится — пусто. retry открывает подписку заново после ошибки. */
export function useOwned(): Owned & { retry: () => void } {
  const retry = useContext(RetryContext);
  return { ...ownedOf(useCollection()), retry };
}
