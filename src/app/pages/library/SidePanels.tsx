import { useState } from 'react';
import { Link } from 'wouter';
import { formatCardPrice } from '@/lib/format';
import { mostValuable, setProgress } from '@/lib/library-filters';
import type { CardView } from '@/lib/useCardViews';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { cardHref, nameLang, namesOf, numberLabel } from './AlbumCard';
import styles from './SidePanels.module.css';

const SHORT_LIST = 5;

type Props = {
  /** Весь альбом, без фильтров */
  cards: CardView[];
  activeSet: string | null;
  onPickSet: (key: string | null) => void;
};

/** Боковая колонка из макета: прогресс сетов (нажатие выбирает сет) и самые дорогие карты. */
export function SidePanels({ cards, activeSet, onPickSet }: Props) {
  const [expanded, setExpanded] = useState(false);
  const progress = setProgress(cards);
  const top = mostValuable(cards, 3);
  const visible = expanded ? progress : progress.slice(0, SHORT_LIST);

  return (
    <aside className={styles.side} aria-label="Сводка альбома">
      {progress.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Прогресс сетов</h2>
          <ul className={styles.sets}>
            {visible.map((set) => {
              const active = set.key === activeSet;
              const percent = Math.min(100, Math.round((set.owned / set.total) * 100));
              return (
                <li key={set.key}>
                  <button
                    type="button"
                    className={cx(styles.setRow, active && styles.setActive)}
                    aria-pressed={active}
                    title={active ? 'Показать все сеты' : 'Показать этот сет'}
                    onClick={() => onPickSet(active ? null : set.key)}
                  >
                    <span className={styles.setLine}>
                      <span className={styles.setName}>{set.setName}</span>
                      <span className={styles.setCount} title={set.secret > 0 ? 'Секретные — карты с номером больше числа карт сета' : undefined}>
                        {set.owned} / {set.total}
                        {set.secret > 0 && ` · +${set.secret}`}
                      </span>
                    </span>
                    <span className={styles.track} aria-hidden="true">
                      <span className={styles.fill} style={{ width: `${percent}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {progress.length > SHORT_LIST && (
            <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Свернуть' : `Все сеты (${progress.length})`}
            </button>
          )}
        </section>
      )}

      {top.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Дороже всего</h2>
          <ul className={styles.top}>
            {top.map((card) => {
              const names = namesOf(card);
              return (
                <li key={card.docId}>
                  <Link href={cardHref(card)} className={styles.topRow}>
                    <span className={styles.topThumb} aria-hidden="true">
                      <CardImage
                        image={card.image}
                        limitless={card.limitless}
                        thumb={card.thumb}
                        name={names.primary}
                        number={numberLabel(card)}
                      />
                    </span>
                    <span className={styles.topText}>
                      <span className={styles.topName} lang={nameLang(card)}>
                        {names.primary}
                      </span>
                      <span className={styles.topSet}>{card.setName}</span>
                    </span>
                    <span className={styles.topPrice}>{formatCardPrice(card.price)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
