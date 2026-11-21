import { useState } from 'react';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { CARD_FORMS, DECK_FORMS, SET_FORMS, formatCardPrice, formatInteger, formatUsd, pluralWord, type WordForms } from '@/lib/format';
import { displayNames } from '@/lib/names';
import { imageFiles } from '@/lib/photo';
import { appUrl, openAppFromPopup } from '@/lib/tabs';
import { collectionTotals, newestFirst, useCardViews } from '@/lib/useCardViews';
import { useDecks } from '@/lib/useDecks';
import { BottomNav } from '@/ui/BottomNav';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { ScanIcon, SlidersIcon } from '@/ui/Icons';
import { HeaderIconButton, PopupHeader } from '@/ui/PopupHeader';
import styles from './Home.module.css';

type Props = {
  /** Открыть сканер; файлы — если фото перетащили прямо на главную */
  onScan: (files?: File[]) => void;
  onSettings: () => void;
};

export function Home({ onScan, onSettings }: Props) {
  const { cards, ready, error, retry } = useOwned();
  const views = useCardViews(cards, ready);
  const totals = collectionTotals(views ?? cards.map((card) => ({ ...card, price: null })));
  const recent = newestFirst(views ?? []).slice(0, 4);
  const auth = useAuth();
  const decks = useDecks(auth.status === 'signed-in' ? auth.user.uid : null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={cx(styles.screen, dragging && styles.dragging)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = imageFiles(event.dataTransfer.files);
        if (files.length > 0) onScan(files);
      }}
    >
      <PopupHeader
        end={
          <HeaderIconButton label="Настройки" onClick={onSettings}>
            <SlidersIcon />
          </HeaderIconButton>
        }
      />
      <main className={styles.main}>
        {error ? (
          // Альбом не загрузился: причина и «Обновить» вместо нулей и вечного «Загружаем альбом…»
          <section className={styles.error} role="alert">
            <h2 className={styles.errorTitle}>Альбом не загрузился</h2>
            <p className={styles.errorText}>{error}</p>
            <Button variant="link" onClick={retry}>
              Обновить
            </Button>
          </section>
        ) : (
          <section className={styles.value}>
            <div className={styles.label}>Стоимость коллекции</div>
            <div className={styles.amount}>{formatUsd(totals.value, true)}</div>
            {totals.euro > 0 && (
              <div className={styles.label}>и {formatCardPrice({ u: null, e: totals.euro })} по ценам Cardmarket</div>
            )}
            <div className={styles.stats}>
              <Stat n={totals.copies} forms={CARD_FORMS} />
              <span className={styles.divider} aria-hidden="true" />
              <Stat n={totals.sets} forms={SET_FORMS} />
              {/* Пока колоды не пришли, их число не показываем, чтобы не мелькал «0 колод» */}
              {decks.status === 'ready' && (
                <>
                  <span className={styles.divider} aria-hidden="true" />
                  <Stat n={decks.decks.length} forms={DECK_FORMS} />
                </>
              )}
            </div>
          </section>
        )}

        <div className={styles.scan}>
          <Button start={<ScanIcon stroke={1.9} />} onClick={() => onScan()}>
            Сканировать карточки
          </Button>
          <div className={styles.hint}>или перетащи фото прямо в это окно</div>
        </div>

        {!error && (
          <section className={styles.recent}>
            <div className={styles.recentHead}>
              <h2 className={styles.recentTitle}>Недавно добавлены</h2>
              <a
                className={styles.textLink}
                href={appUrl('/library')}
                onClick={(event) => {
                  event.preventDefault();
                  void openAppFromPopup('/library');
                }}
              >
                Открыть альбом
              </a>
            </div>
            {recent.length > 0 ? (
              <div className={styles.recentGrid}>
                {recent.map((card) => {
                  const path = `/card/${encodeURIComponent(card.docId)}`;
                  return (
                    <a
                      key={card.docId}
                      className={styles.recentCard}
                      href={appUrl(path)}
                      aria-label={`${displayNames(card.name, card.englishName).primary}: открыть карточку`}
                      onClick={(event) => {
                        event.preventDefault();
                        void openAppFromPopup(path);
                      }}
                    >
                      <CardImage
                        image={card.image}
                        limitless={card.limitless}
                        thumb={card.thumb}
                        name={displayNames(card.name, card.englishName).primary}
                        number={card.localId}
                        lang={card.lang}
                      />
                      <span className={styles.recentPrice}>{formatCardPrice(card.price)}</span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p className={styles.empty}>
                {ready ? 'Здесь появятся карточки, которые ты отсканируешь.' : 'Загружаем альбом…'}
              </p>
            )}
          </section>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

function Stat({ n, forms }: { n: number; forms: WordForms }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statNumber}>{formatInteger(n)}</span>
      <span className={styles.statWord}>{pluralWord(n, forms)}</span>
    </div>
  );
}
