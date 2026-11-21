import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useOwned } from '@/lib/collection-state';
import { binderDb } from '@/lib/db';
import { DECK_SIZE, addBlocker, deckTotal, unknownInfo, type DeckCardInfo } from '@/lib/deck-rules';
import { createDeck, defaultDeckName, setDeckCards, withCount } from '@/lib/decks';
import { useCardViews, type CardView } from '@/lib/useCardViews';
import { deckLines, ruleName, useDeckInfo } from '@/lib/useDeckInfo';
import { useDecks } from '@/lib/useDecks';
import { Select } from '@/ui/Select';
import styles from './AddToDeck.module.css';

const NEW = 'new';

type Done = { deckId: string; text: string };

/**
 * «Добавить в колоду» на странице карточки: выбор колоды и +1 копия. Здесь проверяются размер
 * колоды, копии в альбоме, четыре копии этой карты и, если карта ACE SPEC или Radiant, нет ли
 * в колоде другой такой (тогда сведения о картах колоды грузятся из того же загрузчика, без цен);
 * разные печати с одним именем вместе сводит конструктор колоды (там известны все карты колоды).
 */
export function AddToDeck({ view, uid }: { view: CardView; uid: string }) {
  const decksState = useDecks(uid);
  const decks = decksState.status === 'ready' ? decksState.decks : [];
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const one = useMemo(() => [view], [view]);
  const { info } = useDeckInfo(one);
  const cardInfo = info.get(view.docId) ?? unknownInfo(ruleName(view));

  const deckId = selected && (selected === NEW || decks.some((deck) => deck.id === selected)) ? selected : (decks[0]?.id ?? NEW);
  const deck = decks.find((item) => item.id === deckId) ?? null;
  const others = useDeckOthers(deck?.cards ?? null, view.docId, cardInfo.aceSpec || cardInfo.radiant);
  const lines = deck
    ? deckLines(deck.cards, new Map([...others.views, [view.docId, view]]), new Map([...others.info, ...info]))
    : [];
  const blocker = deck ? addBlocker(lines, view.docId, cardInfo, view.count) : null;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const add = async () => {
    if (busy) return;
    if (blocker) {
      setNotice(blocker);
      return;
    }
    setBusy(true);
    setDone(null);
    setNotice(null);
    try {
      if (deck) {
        const count = (deck.cards[view.docId] ?? 0) + 1;
        await setDeckCards(binderDb(), uid, deck.id, withCount(deck.cards, view.docId, count));
        setDone({ deckId: deck.id, text: `В колоде «${deck.name}» теперь ${count} × эта карта` });
      } else {
        const name = defaultDeckName(decks);
        const id = await createDeck(binderDb(), uid, name, { [view.docId]: 1 });
        setSelected(id);
        setDone({ deckId: id, text: `Создана колода «${name}» с этой картой` });
      }
    } catch {
      setNotice('Не получилось сохранить. Проверь интернет и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const options = [
    ...decks.map((item) => ({ value: item.id, label: `${item.name} · ${deckTotal(item.cards)} из ${DECK_SIZE}` })),
    { value: NEW, label: 'Создать новую колоду' },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {decks.length > 0 && (
          <Select
            aria-label="В какую колоду"
            className={styles.select}
            value={deckId}
            options={options}
            disabled={busy}
            onChange={(value) => {
              setSelected(value);
              setDone(null);
            }}
          />
        )}
        <button
          type="button"
          className={styles.button}
          aria-disabled={blocker ? 'true' : undefined}
          title={blocker ?? undefined}
          disabled={busy || decksState.status === 'loading' || others.loading}
          onClick={() => void add()}
        >
          {deck || decks.length > 0 ? 'Добавить в колоду' : 'Собрать колоду с этой картой'}
        </button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {notice ?? done?.text ?? blocker ?? ''}
        {!notice && done && (
          <>
            {' '}
            <Link href={`/decks/${done.deckId}`} className={styles.link}>
              Открыть колоду
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

const NO_CARDS: never[] = [];

/**
 * Остальные карты колоды с их сведениями: нужны, только если добавляемая карта ACE SPEC или
 * Radiant (правило одной такой карты на колоду). Иначе ничего не грузится.
 */
function useDeckOthers(
  cards: Readonly<Record<string, number>> | null,
  docId: string,
  needed: boolean,
): { views: ReadonlyMap<string, CardView>; info: ReadonlyMap<string, DeckCardInfo>; loading: boolean } {
  const { byId, ready } = useOwned();
  const owned = useMemo(
    () =>
      needed && cards
        ? Object.keys(cards).flatMap((id) => {
            const card = id === docId ? undefined : byId.get(id);
            return card ? [card] : [];
          })
        : NO_CARDS,
    [needed, cards, docId, byId],
  );
  const views = useCardViews(owned, ready, { prices: false });
  const { info, loading } = useDeckInfo(owned.length > 0 ? views : NO_CARDS);
  const byDoc = useMemo(() => new Map((views ?? []).map((item) => [item.docId, item])), [views]);
  return { views: byDoc, info, loading: owned.length > 0 && loading };
}
