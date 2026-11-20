import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from '@/ui/Icons';
import styles from './CardViewer.module.css';

type Props = { open: boolean; label: string; onClose: () => void; children: ReactNode };

/**
 * Просмотр карты во весь экран: нативный модальный dialog. Фокус уходит в окно и возвращается
 * на карту после закрытия, Esc закрывает сам браузер. Клик мимо карты тоже закрывает:
 * closedby="any" в Chrome 134+ и запасной обработчик клика по подложке для остальных.
 * Пока окно открыто, страница под ним не прокручивается.
 */
export function CardViewer({ open, label, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      {...({ closedby: 'any' } as object)}
    >
      <button type="button" className={styles.close} aria-label="Закрыть" onClick={onClose} autoFocus>
        <CloseIcon size={20} stroke={2} />
      </button>
      <div className={styles.content}>{children}</div>
    </dialog>
  );
}
