import type { ReactNode } from 'react';
import { Brand } from '@/ui/Brand';
import { cx } from '@/ui/cx';
import { BackIcon } from '@/ui/Icons';
import styles from './PopupHeader.module.css';

type Props = {
  /** Заголовок экрана. Без onBack в шапке стоит знак Binder. */
  title?: string;
  onBack?: () => void;
  end?: ReactNode;
};

export function PopupHeader({ title, onBack, end }: Props) {
  return (
    <header className={cx(styles.header, onBack ? styles.withBack : styles.withBrand)}>
      {onBack ? (
        <>
          <button type="button" className={styles.iconButton} aria-label="Назад" onClick={onBack}>
            <BackIcon stroke={1.9} />
          </button>
          <span className={styles.title}>{title}</span>
        </>
      ) : (
        <Brand size="popup" />
      )}
      {end && <div className={styles.end}>{end}</div>}
    </header>
  );
}

type IconButtonProps = { label: string; onClick: () => void; children: ReactNode };

export function HeaderIconButton({ label, onClick, children }: IconButtonProps) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
