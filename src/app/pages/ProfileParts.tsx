import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { setKey } from '@/lib/collection';
import { formatCardPrice, formatUsd } from '@/lib/format';
import { LANGUAGE_LABELS } from '@/lib/languages';
import { normalizeNumber } from '@/lib/matching';
import { displayNames } from '@/lib/names';
import type { CardView, collectionTotals } from '@/lib/useCardViews';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import styles from './ProfileParts.module.css';

type Totals = ReturnType<typeof collectionTotals>;

/**
 * Стоимость альбома: доллары по ценам TCGplayer, а карты, у которых есть только цена
 * Cardmarket (так у японских), — отдельно в евро, как в альбоме.
 */
export function valueParts(totals: Pick<Totals, 'value' | 'euro'>): { main: string; note: string | null } {
  const euro = formatCardPrice({ u: null, e: totals.euro });
  if (totals.value === 0 && totals.euro > 0) return { main: euro, note: 'по ценам Cardmarket' };
  return { main: formatUsd(totals.value, true), note: totals.euro > 0 ? `и ${euro} по Cardmarket` : null };
}

/** Число крупно и подпись под ним, как в шапке профиля из макета. */
export function Stat({ value, label, note, small = false }: { value: ReactNode; label: string; note?: string | null; small?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={cx(styles.statValue, small && styles.statSmall)}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

/** Номер как на карте: у карты вне базы — напечатанный («003/021»), у карты из базы — из сета. */
export function numberLabel(view: CardView): string {
  if (view.printed) return view.printed.total ? `${view.printed.number}/${view.printed.total}` : view.printed.number;
  return view.printedTotal ? `${view.localId}/${view.printedTotal}` : view.localId;
}

/** Дороже — раньше; цена в евро считается вровень с долларовой, карты без цены — в конце. */
export function byPrice(a: CardView, b: CardView): number {
  const price = (view: CardView) => view.price?.u ?? view.price?.e ?? -1;
  return price(b) - price(a);
}

export type SetGroup = { key: string; setName: string; note: string | null; releaseDate: string | null; cards: CardView[] };

function byNumber(a: CardView, b: CardView): number {
  const left = normalizeNumber(a.localId);
  const right = normalizeNumber(b.localId);
  const numeric = Number(left) - Number(right);
  return Number.isNaN(numeric) ? left.localeCompare(right) : numeric;
}

/** Сеты от новых к старым, карты вне базы в конце, внутри сета — по номеру (как в альбоме). */
export function groupBySet(views: CardView[]): SetGroup[] {
  const groups = new Map<string, SetGroup>();
  for (const view of views) {
    const key = setKey(view);
    const group = groups.get(key) ?? {
      key,
      setName: view.setName,
      note: view.catalog ? null : `${LANGUAGE_LABELS[view.lang].card.toLowerCase()}, нет в базе TCGdex`,
      releaseDate: view.releaseDate,
      cards: [],
    };
    group.cards.push(view);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, cards: group.cards.sort(byNumber) }))
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
}

type TileProps = {
  view: CardView;
  /** Своя карта ведёт на страницу карточки, чужая открывает просмотр */
  href?: string;
  onOpen?: () => void;
  size?: 'normal' | 'small';
};

/** Карта в сетке профиля: скан, имя (английское главным) и цена. */
export function CardTile({ view, href, onOpen, size = 'normal' }: TileProps) {
  const names = displayNames(view.name, view.englishName);
  const label = `${names.primary}, ${numberLabel(view)}`;
  const image = (
    <CardImage
      image={view.image}
      limitless={view.limitless}
      thumb={view.thumb}
      name={names.primary}
      number={numberLabel(view)}
      lang={view.lang}
    />
  );
  return (
    <figure className={cx(styles.tile, size === 'small' && styles.small)}>
      <div className={styles.imageWrap}>
        {href ? (
          <Link href={href} className={styles.open} aria-label={`${label}: открыть карточку`}>
            {image}
          </Link>
        ) : (
          <button type="button" className={styles.open} aria-label={`${label}: рассмотреть`} onClick={onOpen}>
            {image}
          </button>
        )}
        {view.count > 1 && <span className={styles.count}>×{view.count}</span>}
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.name} title={names.secondary ?? undefined}>
          {names.primary}
        </span>
        {size === 'normal' && <span className={styles.price}>{formatCardPrice(view.price)}</span>}
      </figcaption>
    </figure>
  );
}
