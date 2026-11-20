import { useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useOwned } from '@/lib/collection-state';
import { CARD_FORMS, DECK_FORMS, SET_FORMS, countLabel, formatCardPrice, formatUsd } from '@/lib/format';
import { normalizeNumber } from '@/lib/matching';
import { collectionTotals, useCardViews, type CardView } from '@/lib/useCardViews';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { EmptyState } from '@/ui/EmptyState';
import { PlusIcon } from '@/ui/Icons';
import styles from './Page.module.css';
import album from './Library.module.css';

type SetGroup = { setId: string; setName: string; printedTotal: number | null; releaseDate: string | null; cards: CardView[] };

function byNumber(a: CardView, b: CardView): number {
  const left = normalizeNumber(a.localId);
  const right = normalizeNumber(b.localId);
  const numeric = Number(left) - Number(right);
  return Number.isNaN(numeric) ? left.localeCompare(right) : numeric;
}

/** Сеты от новых к старым, карты внутри по номеру. */
function groupBySet(views: CardView[]): SetGroup[] {
  const groups = new Map<string, SetGroup>();
  for (const view of views) {
    const group = groups.get(view.setId) ?? {
      setId: view.setId,
      setName: view.setName,
      printedTotal: view.printedTotal,
      releaseDate: view.releaseDate,
      cards: [],
    };
    group.cards.push(view);
    groups.set(view.setId, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, cards: group.cards.sort(byNumber) }))
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
}

/** Альбом. Пока простая сетка по сетам; разворот биндера, фильтры и графики — фаза 3. */
export function Library() {
  usePageTitle('Альбом');
  const [, navigate] = useLocation();
  const { cards, ready } = useOwned();
  const views = useCardViews(cards, ready);
  const totals = collectionTotals(views ?? cards.map((card) => ({ ...card, price: null })));
  const meta = [
    countLabel(totals.copies, CARD_FORMS),
    countLabel(totals.sets, SET_FORMS),
    countLabel(0, DECK_FORMS),
  ].join(' · ');

  return (
    <>
      <section className={album.heroRow}>
        <div className={styles.hero}>
          <div className={styles.heroLabel}>Моя коллекция</div>
          <div className={styles.heroValue}>{formatUsd(totals.value)}</div>
          <div className={styles.heroMeta}>{meta}</div>
        </div>
        <Button className={album.add} start={<PlusIcon size={16} stroke={2.2} />} onClick={() => navigate('/scan')}>
          Добавить карточки
        </Button>
      </section>

      {ready && cards.length === 0 && (
        <EmptyState title="Альбом пока пуст">
          Сфотографируй свои карточки: Binder узнает их и сложит сюда. Сканер есть и здесь, и в окне расширения.
        </EmptyState>
      )}

      {groupBySet(views ?? []).map((group) => (
        <section key={group.setId} className={album.panel}>
          <div className={album.panelHead}>
            <h2 className={album.setName}>{group.setName}</h2>
            <span className={album.muted}>
              {group.printedTotal ? `${group.cards.length} из ${group.printedTotal} карт` : countLabel(group.cards.length, CARD_FORMS)}
            </span>
          </div>
          <div className={album.grid}>
            {group.cards.map((card) => (
              <figure key={card.cardId} className={album.card}>
                <div className={album.imageWrap}>
                  <CardImage image={card.image} name={card.name} />
                  {card.count > 1 && <span className={album.count}>×{card.count}</span>}
                </div>
                <figcaption className={album.caption}>
                  <span className={album.cardName}>{card.name}</span>
                  <span className={album.price}>{formatCardPrice(card.price)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
