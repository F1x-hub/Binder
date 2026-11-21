import { useState, type ReactNode } from 'react';
import { LANGUAGE_LABELS, type CardLanguage } from '@/lib/languages';
import { limitlessImage, type LimitlessRef } from '@/lib/limitless';
import { usePrefersPhoto } from '@/lib/my-photos';
import { cardImage } from '@/lib/tcgdex';
import { cx } from '@/ui/cx';
import styles from './CardImage.module.css';

type Props = {
  /** Адрес скана в TCGdex без размера и формата */
  image?: string;
  /** Где взять скан в Limitless TCG, если в TCGdex его нет или он не загрузился */
  limitless?: LimitlessRef | null;
  /**
   * Своё фото: вырезка из фото сканера или фото из Google Drive участника. Показывается,
   * если скана нет ни в одной базе, или вместо скана, если для этой карты выбрано «Моё фото».
   */
  thumb?: string | null;
  name: string;
  /** Номер для текстовой заглушки */
  number?: string;
  /** Язык карты: у неанглийских — значок в углу, английские без значка (их в альбоме большинство) */
  lang?: CardLanguage;
  quality?: 'low' | 'high';
  /** Что показать вместо таблички с именем, если скана нет ни в одной базе (недостающая карта в биндере) */
  fallback?: ReactNode;
  className?: string;
};

/**
 * Карта: официальный скан из TCGdex, потом скан из Limitless TCG, потом своё фото,
 * а если нет и его (карта друга, другой браузер) — табличка с именем и номером.
 * Если для карты выбрано «Моё фото» (src/lib/my-photos.ts), своё фото идёт первым.
 */
export function CardImage({ image, limitless, thumb, name, number, lang, quality = 'low', fallback, className }: Props) {
  const mine = usePrefersPhoto(thumb);
  const sources = [
    mine ? thumb : null,
    cardImage(image, quality),
    limitless ? limitlessImage(limitless, quality === 'high' ? 'LG' : 'SM') : null,
  ].filter((source): source is string => Boolean(source));
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = sources.find((source) => !failed.has(source)) ?? null;
  if (!src && !thumb && fallback !== undefined) return <>{fallback}</>;
  return (
    <div className={cx(styles.frame, className)}>
      {src ? (
        <img
          key={src}
          src={src}
          alt={name}
          loading="lazy"
          className={cx(styles.image, src === thumb && styles.photo)}
          onError={() => setFailed((previous) => new Set(previous).add(src))}
        />
      ) : thumb ? (
        <img src={thumb} alt={name} className={cx(styles.image, styles.photo)} />
      ) : (
        <div className={styles.text} role="img" aria-label={number ? `${name}, ${number}` : name}>
          <span className={styles.textName}>{name}</span>
          {number && <span className={styles.textNumber}>{number}</span>}
        </div>
      )}
      {lang && lang !== 'en' && (
        <span className={styles.badge} title={LANGUAGE_LABELS[lang].card}>
          {LANGUAGE_LABELS[lang].short}
        </span>
      )}
    </div>
  );
}
