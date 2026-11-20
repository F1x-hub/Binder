import { onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { binderDb } from '@/lib/db';
import { deckFromDoc, decksOf, type Deck } from '@/lib/decks';

export type DecksState = { status: 'loading' } | { status: 'ready'; decks: Deck[] } | { status: 'error'; message: string };

/** Колоды участника: живая подписка на members/{uid}/decks, новые изменения — сверху. */
export function useDecks(uid: string | null): DecksState {
  const [state, setState] = useState<DecksState>({ status: 'loading' });

  useEffect(() => {
    if (!uid) return;
    setState({ status: 'loading' });
    return onSnapshot(
      decksOf(binderDb(), uid),
      (snapshot) => {
        const time = (deck: Deck) => deck.updatedAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
        const decks = snapshot.docs.map((item) => deckFromDoc(item.id, item.data())).sort((a, b) => time(b) - time(a));
        setState({ status: 'ready', decks });
      },
      (error) => setState({ status: 'error', message: error.message }),
    );
  }, [uid]);

  return state;
}
