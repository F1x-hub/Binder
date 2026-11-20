import { THEMES, type ThemeId } from '@/theme/themes';
import { cx } from '@/ui/cx';
import styles from './ThemePicker.module.css';

type Props = {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
  labelledBy?: string;
};

/**
 * Плитки тем. Каждое превью рисуется в своей теме: атрибут data-theme
 * переключает CSS-переменные только внутри плитки.
 */
export function ThemePicker({ value, onChange, labelledBy }: Props) {
  return (
    <div className={styles.grid} role="group" aria-labelledby={labelledBy}>
      {THEMES.map(({ id, label }) => {
        const on = id === value;
        return (
          <button key={id} type="button" className={styles.tile} aria-pressed={on} onClick={() => onChange(id)}>
            <span className={styles.preview} data-theme={id}>
              <span className={styles.bar} />
              <span className={styles.line1} />
              <span className={styles.line2} />
              <span className={styles.cta} />
            </span>
            <span className={cx(styles.label, on && styles.labelOn)}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
