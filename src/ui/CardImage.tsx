import { useState } from 'react';
import { LANGUAGE_LABELS, type CardLanguage } from '@/lib/languages';
import { limitlessImage, type LimitlessRef } from '@/lib/limitless';
import { cardImage } from '@/lib/tcgdex';
import { cx } from '@/ui/cx';
import styles from './CardImage.module.css';

type Props = {
  /** Адрес скана в TCGdex без размера и формата */
  image?: string;
  /** Где взять скан в Limitless TCG, если в TCGdex его нет или он не загрузился */
  limitless?: LimitlessRef | null;
  /** Обложка из фото этого браузера: если скана нет ни в одной базе */
  thumb?: string | null;
  name: string;
  /** Номер для текстовой заглушки */
  number?: string;
  /** Язык карты: у неанглийских — значок в углу, английские без значка (их в альбоме большинство) */
  lang?: CardLanguage;
  quality?: 'low' | 'high';
  className?: string;
};

/**
 * Карта: официальный скан из TCGdex, потом скан из Limitless TCG, потом вырезка
 * из своего фото, а если нет и её (карта друга, другой браузер) — табличка с именем и номером.
 */
export function CardImage({ image, limitless, thumb, name, number, lang, quality = 'low', className }: Props) {
  const sources = [
    cardImage(image, quality),
    limitless ? limitlessImage(limitless, quality === 'high' ? 'LG' : 'SM') : null,
  ].filter((source): source is string => Boolean(source));
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = sources.find((source) => !failed.has(source)) ?? null;
  return (
    <div className={cx(styles.frame, className)}>
      {src ? (
        <img
          key={src}
          src={src}
          alt={name}
          loading="lazy"
          className={styles.image}
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
