import { useState } from 'react';
import { cardImage } from '@/lib/tcgdex';
import { CardStub } from '@/ui/CardStub';
import { cx } from '@/ui/cx';
import styles from './CardImage.module.css';

type Props = { image?: string; name: string; quality?: 'low' | 'high'; className?: string };

/** Официальный скан карты из TCGdex. Пока он грузится или если его нет — заглушка из макетов. */
export function CardImage({ image, name, quality = 'low', className }: Props) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : cardImage(image, quality);
  return (
    <div className={cx(styles.frame, className)}>
      {src ? (
        <img src={src} alt={name} loading="lazy" className={styles.image} onError={() => setBroken(true)} />
      ) : (
        <CardStub type="normal" />
      )}
    </div>
  );
}
