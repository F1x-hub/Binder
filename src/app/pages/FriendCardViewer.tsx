import { Link } from 'wouter';
import { formatCardPrice } from '@/lib/format';
import { LANGUAGE_LABELS, htmlLang } from '@/lib/languages';
import { displayNames } from '@/lib/names';
import type { CardView } from '@/lib/useCardViews';
import { CardViewer } from '@/ui/CardViewer';
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
  const names = view ? displayNames(view.name, view.englishName) : null;
  return (
    <CardViewer open={view !== null} label={names ? `Карта ${names.primary}` : 'Карта'} onClose={onClose}>
      {view && names && (
        <>
          <TiltCard
            key={view.docId}
            image={view.image}
            limitless={view.limitless}
            thumb={view.thumb}
            name={names.primary}
            number={numberLabel(view)}
            holo={view.variant === 'holo' || view.variant === 'reverse'}
            className={styles.card}
          />
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
