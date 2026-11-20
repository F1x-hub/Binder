import { onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cardsOf, ownedFromDoc, type OwnedCard } from '@/lib/collection';
import { binderDb } from '@/lib/db';

export type CollectionState =
  | { status: 'loading' }
  | { status: 'ready'; cards: OwnedCard[]; byId: ReadonlyMap<string, OwnedCard> }
  | { status: 'error'; message: string };

const CollectionContext = createContext<CollectionState>({ status: 'loading' });

/** Альбом участника: живая подписка на members/{uid}/cards. byId — по ID документа. */
export function CollectionProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [state, setState] = useState<CollectionState>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    return onSnapshot(
      cardsOf(binderDb(), uid),
      (snapshot) => {
        const cards = snapshot.docs.map((item) => ownedFromDoc(item.id, item.data()));
        setState({ status: 'ready', cards, byId: new Map(cards.map((card) => [card.docId, card])) });
      },
      (error) => setState({ status: 'error', message: error.message }),
    );
  }, [uid]);

  return <CollectionContext.Provider value={state}>{children}</CollectionContext.Provider>;
}

export function useCollection(): CollectionState {
  return useContext(CollectionContext);
}

const EMPTY: ReadonlyMap<string, OwnedCard> = new Map();

/** Карты альбома, пока он грузится — пусто. */
export function useOwned(): { cards: OwnedCard[]; byId: ReadonlyMap<string, OwnedCard>; ready: boolean } {
  const state = useCollection();
  return state.status === 'ready'
    ? { cards: state.cards, byId: state.byId, ready: true }
    : { cards: [], byId: EMPTY, ready: false };
}
