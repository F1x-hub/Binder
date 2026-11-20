import styles from './NothingFound.module.css';

/** Под фильтры не подошла ни одна карта. */
export function NothingFound({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.box}>
      <p className={styles.text}>Под эти фильтры ни одна карточка не подходит.</p>
      <button type="button" className={styles.reset} onClick={onReset}>
        Сбросить фильтры
      </button>
    </div>
  );
}
