import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/ui/cx';
import styles from './TextField.module.css';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Подпись под полем */
  hint?: ReactNode;
  /** Жирная подпись, как у разделов настроек */
  emphasis?: boolean;
};

export function TextField({ label, hint, emphasis = false, id, className, ...input }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={cx(styles.label, emphasis && styles.emphasis)}>
        {label}
      </label>
      <input
        id={inputId}
        className={cx(styles.input, className)}
        aria-describedby={hint ? hintId : undefined}
        {...input}
      />
      {hint && (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      )}
    </div>
  );
}
