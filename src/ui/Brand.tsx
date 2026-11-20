import { LogoIcon } from '@/ui/Icons';
import styles from './Brand.module.css';

/** Знак и название. Размеры из макетов: шапка поп-апа, экран входа, шапка страниц. */
const ICON_SIZE = { popup: 22, welcome: 26, page: 24 } as const;

export function Brand({ size }: { size: keyof typeof ICON_SIZE }) {
  return (
    <span className={`${styles.brand} ${styles[size]}`}>
      <LogoIcon size={ICON_SIZE[size]} />
      <span className={styles.name}>Binder</span>
    </span>
  );
}
