import { Link } from 'wouter';
import { CONDITION_LABELS, type Variant } from '@/lib/collection';
import { CARD_FORMS, countLabel, formatCardPrice } from '@/lib/format';
import { LANGUAGE_LABELS, htmlLang } from '@/lib/languages';
import { SORT_LABELS, type LibrarySort } from '@/lib/library-filters';
import type { CardView } from '@/lib/useCardViews';
import { CardImage } from '@/ui/CardImage';
import { RemoveButton, cardHref, nameLang, namesOf, numberLabel } from './AlbumCard';
import styles from './CardList.module.css';
import { NothingFound } from './NothingFound';

const FINISH: Record<Variant, string> = { normal: 'Обычная', holo: 'Голо', reverse: 'Реверс' };

type Props = { cards: CardView[]; sort: LibrarySort; uid: string | null; onReset: () => void };

/** Список: карта, сет, язык, печать, состояние, копии и цена — по строке на карту. */
export function CardList({ cards, sort, uid, onReset }: Props) {
  return (
    <section className={styles.panel} aria-label="Список карточек">
      <div className={styles.head}>
        <h2 className={styles.title}>{SORT_LABELS[sort]}</h2>
        <span className={styles.muted}>{countLabel(cards.length, CARD_FORMS)}</span>
      </div>
      {cards.length === 0 ? (
        <NothingFound onReset={onReset} />
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Карта</th>
                <th scope="col">Сет</th>
                <th scope="col">Язык</th>
                <th scope="col">Печать</th>
                <th scope="col">Состояние</th>
                <th scope="col" className={styles.numeric}>
                  Копии
                </th>
                <th scope="col" className={styles.numeric}>
                  Цена
                </th>
                {uid && (
                  <th scope="col">
                    <span className={styles.srOnly}>Убрать</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => {
                const names = namesOf(card);
                const condition = card.condition ?? 'NM';
                return (
                  <tr key={card.docId}>
                    <td>
                      <div className={styles.cardCell}>
                        <div className={styles.thumb} aria-hidden="true">
                          <CardImage
                            image={card.image}
                            limitless={card.limitless}
                            thumb={card.thumb}
                            name={names.primary}
                            number={numberLabel(card)}
                          />
                        </div>
                        <div className={styles.cardText}>
                          <Link href={cardHref(card)} className={styles.name} lang={nameLang(card)}>
                            {names.primary}
                          </Link>
                          <span className={styles.sub}>
                            {numberLabel(card)}
                            {names.secondary && (
                              <>
                                {' · '}
                                {/* Второе имя — напечатанное, на языке карты */}
                                <span lang={htmlLang(card.lang)}>{names.secondary}</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className={styles.set}>{card.setName}</td>
                    <td title={LANGUAGE_LABELS[card.lang].card}>{LANGUAGE_LABELS[card.lang].short}</td>
                    <td>{FINISH[card.variant ?? 'normal']}</td>
                    <td title={CONDITION_LABELS[condition]}>{condition}</td>
                    <td className={styles.numeric}>{card.count}</td>
                    <td className={styles.numeric}>{formatCardPrice(card.price)}</td>
                    {uid && (
                      <td className={styles.action}>
                        <RemoveButton uid={uid} card={card} name={names.primary} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
