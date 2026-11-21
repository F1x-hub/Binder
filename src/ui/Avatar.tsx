import { useState, type CSSProperties } from 'react';
import { cx } from '@/ui/cx';
import { UserIcon } from '@/ui/Icons';
import styles from './Avatar.module.css';

type Props = {
  src?: string | null;
  /** Имя участника: если фото нет, на аватарке его первая буква, а не значок */
  name?: string | null;
  size: number;
};

/** С этого размера буква набирается шрифтом заголовков, как большая аватарка в макете профиля. */
const LARGE = 64;

const graphemes = new Intl.Segmenter('ru', { granularity: 'grapheme' });

/** Первая буква имени заглавной (целым знаком, не половиной эмодзи); у пустого имени — null. */
export function initialOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const first = graphemes.segment(trimmed)[Symbol.iterator]().next().value?.segment;
  return first ? first.toLocaleUpperCase('ru') : null;
}

/**
 * Круглая аватарка: фото из аккаунта Google. Если фото нет или оно не загрузилось —
 * первая буква имени, а без имени значок.
 */
export function Avatar({ src, name, size }: Props) {
  // Запоминаем, какое фото не загрузилось: новое фото той же аватарки пробуется снова
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const photo = src && src !== brokenSrc ? src : null;
  const initial = initialOf(name);
  const style = { width: size, height: size, '--avatar-size': `${size}px` } as CSSProperties;
  return (
    <span className={cx(styles.avatar, size >= LARGE && styles.large)} style={style} aria-hidden="true">
      {photo ? (
        <img src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBrokenSrc(photo)} />
      ) : initial ? (
        <span className={styles.initial}>{initial}</span>
      ) : (
        <UserIcon size={Math.round(size / 2)} />
      )}
    </span>
  );
}
