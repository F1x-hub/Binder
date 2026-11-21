import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from '@/ui/Icons';
import styles from './CardViewer.module.css';

export type ViewMode = 'flat' | '3d';

type Props = {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Плоский просмотр или карта в 3D (src/ui/Card3D.tsx); без onModeChange переключателя нет */
  mode?: ViewMode;
  onModeChange?: (mode: ViewMode) => void;
};

/**
 * Просмотр карты во весь экран: нативный модальный dialog. Фокус уходит в окно и возвращается
 * на карту после закрытия, Esc закрывает сам браузер. Клик мимо карты тоже закрывает:
 * closedby="any" в Chrome 134+ и запасной обработчик клика по подложке для остальных.
 * Пока окно открыто, страница под ним не прокручивается. Если передан onModeChange, слева
 * вверху переключатель «Плоско / В 3D»: что показывать в каждом виде, решает тот, кто открыл окно.
 */
export function CardViewer({ open, label, onClose, children, mode = 'flat', onModeChange }: Props) {
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
      data-mode={mode}
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
      {onModeChange && (
        <div role="group" aria-label="Как смотреть карту" className={styles.modes}>
          <button type="button" aria-pressed={mode === 'flat'} onClick={() => onModeChange('flat')}>
            Плоско
          </button>
          <button type="button" aria-pressed={mode === '3d'} onClick={() => onModeChange('3d')}>
            В 3D
          </button>
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </dialog>
  );
}
