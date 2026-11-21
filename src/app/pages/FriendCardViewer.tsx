import { useState } from 'react';
import { Link } from 'wouter';
import { formatCardPrice } from '@/lib/format';
import { LANGUAGE_LABELS, htmlLang } from '@/lib/languages';
import { displayNames } from '@/lib/names';
import type { CardView } from '@/lib/useCardViews';
import { Card3D } from '@/ui/Card3D';
import { CardViewer, type ViewMode } from '@/ui/CardViewer';
import { TiltCard } from '@/ui/TiltCard';
import { numberLabel } from './ProfileParts';
import styles from './FriendCardViewer.module.css';

type Props = {
  view: CardView | null;
  /** Чей это альбом: имя участника */
  owner: string;
  /** Такая карта есть и в своём альбоме: тогда в окне ссылка на её страницу */
  mine: boolean;
  onClose: () => void;
};

/**
 * Карта из чужого альбома во весь экран: только посмотреть, без правки. Общая для профиля
 * друга и ленты на странице «Друзья». Страница карточки (`#/card/…`) — только для своего альбома.
 */
export function FriendCardViewer({ view, owner, mine, onClose }: Props) {
  const [mode, setMode] = useState<ViewMode>('flat');
  const names = view ? displayNames(view.name, view.englishName) : null;
  const close = () => {
    setMode('flat');
    onClose();
  };
  const card = view &&
    names && {
      image: view.image,
      limitless: view.limitless,
      thumb: view.thumb,
      name: names.primary,
      number: numberLabel(view),
      holo: view.variant === 'holo' || view.variant === 'reverse',
    };
  return (
    <CardViewer
      open={view !== null}
      label={names ? `Карта ${names.primary}` : 'Карта'}
      onClose={close}
      mode={mode}
      onModeChange={setMode}
    >
      {view && names && card && (
        <>
          {mode === '3d' ? (
            <Card3D key={view.docId} {...card} className={styles.card3d} />
          ) : (
            <TiltCard key={view.docId} {...card} className={styles.card} />
          )}
          <div className={styles.text}>
            <p className={styles.name}>
              {names.primary} · {numberLabel(view)}
            </p>
            {names.secondary && (
              <p className={styles.muted} lang={htmlLang(view.lang)}>
                {names.secondary}
              </p>
            )}
            <p className={styles.muted}>{[view.setName, LANGUAGE_LABELS[view.lang].card, formatCardPrice(view.price)].join(' · ')}</p>
            <p className={styles.muted}>
              Альбом: {owner}
              {view.count > 1 ? `, копий: ${view.count}` : ''}
            </p>
            {mine && (
              <Link href={`/card/${encodeURIComponent(view.docId)}`} className={styles.link}>
                Такая есть и у тебя: открыть карточку
              </Link>
            )}
          </div>
        </>
      )}
    </CardViewer>
  );
}
