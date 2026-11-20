import type { CSSProperties } from 'react';
import { cx } from '@/ui/cx';
import styles from './CardStub.module.css';

export type CardType = 'fire' | 'water' | 'grass' | 'electric' | 'psychic' | 'normal' | 'dark';

/** Цвета типов из макетов: фон карты, светлый и тёмный край иллюстрации. */
const PALETTES: Record<CardType, readonly [string, string, string]> = {
  fire: ['#E57A4E', '#F7B892', '#D4532B'],
  water: ['#5494DA', '#A7CCF3', '#2F6CB5'],
  grass: ['#71B56B', '#BCE3A6', '#3F8C47'],
  electric: ['#E8C24A', '#FBE9A3', '#CFA21E'],
  psychic: ['#9D7CD8', '#D6C6F4', '#6A4BB3'],
  normal: ['#B4B8C1', '#E9EAEE', '#8B909A'],
  dark: ['#50545F', '#9095A1', '#2B2E36'],
};

type Props = {
  type: CardType;
  holo?: boolean;
  className?: string;
};

/**
 * Абстрактная заглушка карты из макетов. Персонажей и оформления настоящих карт
 * здесь нет и не будет: реальные изображения придут из базы карт.
 */
export function CardStub({ type, holo = false, className }: Props) {
  const [base, light, deep] = PALETTES[type];
  const colors = { '--card-base': base, '--card-light': light, '--card-deep': deep } as CSSProperties;
  return (
    <div className={cx(styles.frame, holo && styles.holo, className)} style={colors} aria-hidden="true">
      <div className={styles.body}>
        <span className={styles.name} />
        <span className={styles.hp} />
        <span className={styles.art}>
          <span className={styles.orb} />
        </span>
        <span className={cx(styles.line, styles.line1)} />
        <span className={cx(styles.line, styles.line2)} />
        <span className={cx(styles.line, styles.line3)} />
        <span className={styles.foot} />
      </div>
    </div>
  );
}
