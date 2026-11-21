import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { removeOne } from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { formatCardPrice } from '@/lib/format';
import { htmlLang } from '@/lib/languages';
import { displayNames } from '@/lib/names';
import { removeThumb } from '@/lib/thumbnails';
import type { CardView } from '@/lib/useCardViews';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { MinusIcon } from '@/ui/Icons';
import styles from './AlbumCard.module.css';

export function numberLabel(card: Pick<CardView, 'localId' | 'printedTotal'>): string {
  return card.printedTotal ? `${card.localId}/${card.printedTotal}` : card.localId;
}

export function cardHref(card: Pick<CardView, 'docId'>): string {
  return `/card/${encodeURIComponent(card.docId)}`;
}

/** Имя для показа: английское главным, напечатанное (японское) — подсказкой. */
export function namesOf(card: Pick<CardView, 'name' | 'englishName'>) {
  return displayNames(card.name, card.englishName);
}

/**
 * Язык главного имени для атрибута lang: японское имя браузер рисует японским шрифтом.
 * У карт английского каталога (и французских копий в нём) имя английское.
 */
export function nameLang(card: Pick<CardView, 'name' | 'englishName' | 'catalog' | 'lang'>): string | undefined {
  return card.catalog !== 'en' && !namesOf(card).secondary ? htmlLang(card.lang) : undefined;
}

/**
 * Карта альбома: скан открывает страницу карточки, «−» убирает копию, ×N — сколько копий.
 * Одна и та же в кармане биндера и в сетке.
 */
export function AlbumCard({ card, uid, className }: { card: CardView; uid: string | null; className?: string }) {
  // Английское имя — главным, напечатанное (японское) — во всплывающей подсказке
  const names = namesOf(card);
  return (
    <figure className={cx(styles.card, className)}>
      <div className={styles.imageWrap}>
        <Link
          href={cardHref(card)}
          className={styles.cardLink}
          aria-label={`${names.primary}, ${numberLabel(card)}: открыть карточку`}
        >
          <CardImage
            image={card.image}
            limitless={card.limitless}
            thumb={card.thumb}
            name={names.primary}
            number={numberLabel(card)}
            lang={card.lang}
          />
        </Link>
        {card.count > 1 && <span className={styles.count}>×{card.count}</span>}
        {uid && <RemoveButton uid={uid} card={card} name={names.primary} className={styles.cornerRemove} />}
      </div>
      <figcaption className={styles.caption}>
        {/* Подсказка: полное имя (в две строки влезает не всякое) и напечатанное */}
        <span
          className={styles.cardName}
          title={names.secondary ? `${names.primary} · ${names.secondary}` : names.primary}
          lang={nameLang(card)}
        >
          {names.primary}
        </span>
        <span className={styles.price}>{formatCardPrice(card.price)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * «−»: убирает одну копию. Последнюю копию — только со второго нажатия,
 * чтобы карта не пропала из альбома от случайного клика.
 */
export function RemoveButton({ uid, card, name, className }: { uid: string; card: CardView; name: string; className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = card.count === 1;

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const remove = async () => {
    if (last && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      if ((await removeOne(binderDb(), uid, card)) === 'deleted') await removeThumb(card.docId).catch(() => undefined);
    } catch (error) {
      console.warn('[binder] карта не убрана', error);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const label = confirming ? `Точно убрать ${name} из альбома` : last ? `Убрать ${name} из альбома` : `Убрать одну копию ${name}`;
  return (
    <button
      type="button"
      className={cx(styles.remove, className, confirming && styles.confirming)}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => void remove()}
    >
      {confirming ? 'Убрать?' : <MinusIcon size={14} stroke={2.4} />}
    </button>
  );
}
