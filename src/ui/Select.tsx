import type { SelectHTMLAttributes } from 'react';
import { cx } from '@/ui/cx';
import styles from './Select.module.css';

export type SelectOption<T extends string> = { value: T; label: string };

type Props<T extends string> = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> & {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  /** field — поле с рамкой, как текстовое; inline — значение в строке панели, рамка только при наведении и фокусе */
  variant?: 'field' | 'inline';
};

/**
 * Выпадающий список Binder: один на весь проект. Это настоящий select с appearance: base-select
 * (Chrome 135+): кнопка, список, стрелка и галочка оформлены токенами темы, а клавиатуру, фокус
 * и экранные дикторы обслуживает браузер. В браузере без base-select остаётся обычный список.
 */
export function Select<T extends string>({ value, options, onChange, variant = 'field', className, ...rest }: Props<T>) {
  return (
    <select
      {...rest}
      className={cx(styles.select, styles[variant], className)}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
