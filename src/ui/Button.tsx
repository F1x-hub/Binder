import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/ui/cx';
import styles from './Button.module.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'link';
  /** Иконка перед текстом */
  start?: ReactNode;
  /** Иконка после текста */
  end?: ReactNode;
};

export function Button({ variant = 'primary', start, end, className, children, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={cx(styles.button, styles[variant], className)} {...rest}>
      {start}
      {children}
      {end}
    </button>
  );
}
