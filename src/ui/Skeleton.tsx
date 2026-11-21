import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';
import styles from './Skeleton.module.css';

type Size = number | string;

const css = (value: Size | undefined) => (typeof value === 'number' ? `${value}px` : value);

type Props = {
  /**
   * text — одна строка окружающего текста: высота ровно в строку (1lh), поэтому заглушка внутри
   * заголовка или подписи занимает столько же места, сколько потом текст; block — прямоугольник;
   * card — карта 63 : 88 во всю ширину; circle — круг (аватар).
   */
  shape?: 'text' | 'block' | 'card' | 'circle';
  /** Число — пиксели, строка — любая длина CSS ('8em', '60%') */
  width?: Size;
  height?: Size;
  className?: string;
};

/**
 * Заглушка на месте того, что ещё грузится, в форме будущего содержимого.
 * Скринридер её не слышит: что идёт загрузка, говорит SkeletonArea вокруг.
 */
export function Skeleton({ shape = 'block', width, height, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, styles[shape], className)}
      style={width === undefined && height === undefined ? undefined : { width: css(width), height: css(height) }}
    />
  );
}

/** Область с заглушками: скринридер слышит label («Загружаю альбом…»), сами заглушки скрыты. */
export function SkeletonArea({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className} role="status">
      <span className={styles.srOnly}>{label}</span>
      {children}
    </div>
  );
}
