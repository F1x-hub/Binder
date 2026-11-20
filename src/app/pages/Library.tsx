import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { removeOne, setKey } from '@/lib/collection';
import { useOwned } from '@/lib/collection-state';
import { binderDb } from '@/lib/db';
import { CARD_FORMS, DECK_FORMS, SET_FORMS, countLabel, formatCardPrice, formatUsd } from '@/lib/format';
import { LANGUAGE_LABELS } from '@/lib/languages';
import { normalizeNumber } from '@/lib/matching';
import { displayNames } from '@/lib/names';
import { removeThumb } from '@/lib/thumbnails';
import { collectionTotals, useCardViews, type CardView } from '@/lib/useCardViews';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { MinusIcon, PlusIcon } from '@/ui/Icons';
import styles from './Page.module.css';
import album from './Library.module.css';

type SetGroup = {
  key: string;
  setName: string;
  /** Пояснение к группе карт вне базы */
  note: string | null;
  printedTotal: number | null;
  releaseDate: string | null;
  cards: CardView[];
};

function byNumber(a: CardView, b: CardView): number {
  const left = normalizeNumber(a.localId);
  const right = normalizeNumber(b.localId);
  const numeric = Number(left) - Number(right);
  return Number.isNaN(numeric) ? left.localeCompare(right) : numeric;
}

/** Сеты от новых к старым, карты вне базы в конце, внутри сета — по номеру. */
function groupBySet(views: CardView[]): SetGroup[] {
  const groups = new Map<string, SetGroup>();
  for (const view of views) {
    const key = setKey(view);
    const group = groups.get(key) ?? {
      key,
      setName: view.setName,
      note: view.catalog ? null : `${LANGUAGE_LABELS[view.lang].card.toLowerCase()}, нет в базе TCGdex`,
      printedTotal: view.printedTotal,
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

function numberLabel(card: CardView): string {
  return card.printedTotal ? `${card.localId}/${card.printedTotal}` : card.localId;
}

/** Альбом. Пока простая сетка по сетам; разворот биндера, фильтры и графики — фаза 3. */
export function Library() {
  usePageTitle('Альбом');
  const [, navigate] = useLocation();
  const auth = useAuth();
  const { cards, ready } = useOwned();
  const views = useCardViews(cards, ready);
  const totals = collectionTotals(views ?? cards.map((card) => ({ ...card, price: null })));
  const meta = [
    countLabel(totals.copies, CARD_FORMS),
    countLabel(totals.sets, SET_FORMS),
    countLabel(0, DECK_FORMS),
  ].join(' · ');
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;

  return (
    <>
      <section className={album.heroRow}>
        <div className={styles.hero}>
          <div className={styles.heroLabel}>Моя коллекция</div>
          <div className={styles.heroValue}>{formatUsd(totals.value, true)}</div>
          {totals.euro > 0 && (
            <div className={album.euro}>и {formatCardPrice({ u: null, e: totals.euro })} по ценам Cardmarket</div>
          )}
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
        <section key={group.key} className={album.panel}>
          <div className={album.panelHead}>
            <h2 className={album.setName}>{group.setName}</h2>
            <span className={album.muted}>
              {group.printedTotal && group.note === null
                ? `${group.cards.length} из ${group.printedTotal} карт`
                : countLabel(group.cards.length, CARD_FORMS)}
            </span>
            {group.note && <span className={album.muted}>{group.note}</span>}
          </div>
          <div className={album.grid}>
            {group.cards.map((card) => {
              // Английское имя — главным, напечатанное (японское) — во всплывающей подсказке
              const names = displayNames(card.name, card.englishName);
              return (
                <figure key={card.docId} className={album.card}>
                  <div className={album.imageWrap}>
                    <Link
                      href={`/card/${encodeURIComponent(card.docId)}`}
                      className={album.cardLink}
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
                    {card.count > 1 && <span className={album.count}>×{card.count}</span>}
                    {uid && <RemoveButton uid={uid} card={card} name={names.primary} />}
                  </div>
                  <figcaption className={album.caption}>
                    <span className={album.cardName} title={names.secondary ?? undefined}>
                      {names.primary}
                    </span>
                    <span className={album.price}>{formatCardPrice(card.price)}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * «−» на карте: убирает одну копию. Последнюю копию — только со второго нажатия,
 * чтобы карта не пропала из альбома от случайного клика.
 */
function RemoveButton({ uid, card, name }: { uid: string; card: CardView; name: string }) {
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
      className={cx(album.remove, confirming && album.confirming)}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => void remove()}
    >
      {confirming ? 'Убрать?' : <MinusIcon size={16} stroke={2.2} />}
    </button>
  );
}
