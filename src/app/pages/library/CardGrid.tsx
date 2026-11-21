import { CARD_FORMS, countLabel } from '@/lib/format';
import { SORT_LABELS, groupBySet, setCountLabel, type LibrarySort } from '@/lib/library-filters';
import type { CardView } from '@/lib/useCardViews';
import { AlbumCard } from './AlbumCard';
import styles from './CardGrid.module.css';
import { NothingFound } from './NothingFound';

type Props = { cards: CardView[]; sort: LibrarySort; uid: string | null; onReset: () => void };

/**
 * Сетка: при сортировке по номеру — по сетам, как раньше; при сортировке по цене или дате
 * группы разорвали бы порядок, поэтому карты идут одной сеткой.
 */
export function CardGrid({ cards, sort, uid, onReset }: Props) {
  if (cards.length === 0) {
    return (
      <section className={styles.panel} aria-label="Карточки">
        <NothingFound onReset={onReset} />
      </section>
    );
  }
  if (sort !== 'number') {
    return (
      <section className={styles.panel} aria-label={SORT_LABELS[sort]}>
        <div className={styles.head}>
          <h2 className={styles.title}>{SORT_LABELS[sort]}</h2>
          <span className={styles.muted}>{countLabel(cards.length, CARD_FORMS)}</span>
        </div>
        <Grid cards={cards} uid={uid} />
      </section>
    );
  }
  return (
    <>
      {groupBySet(cards).map((group) => (
        <section key={group.key} className={styles.panel} aria-label={group.setName}>
          <div className={styles.head}>
            <h2 className={styles.title}>{group.setName}</h2>
            <span className={styles.muted}>
              {group.printedTotal && group.note === null
                ? setCountLabel(group.cards, group.printedTotal)
                : countLabel(group.cards.length, CARD_FORMS)}
            </span>
            {group.note && <span className={styles.muted}>{group.note}</span>}
          </div>
          <Grid cards={group.cards} uid={uid} />
        </section>
      ))}
    </>
  );
}

function Grid({ cards, uid }: { cards: CardView[]; uid: string | null }) {
  return (
    <ul className={styles.grid}>
      {cards.map((card) => (
        <li key={card.docId} className={styles.item}>
          <AlbumCard card={card} uid={uid} />
        </li>
      ))}
    </ul>
  );
}
