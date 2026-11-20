import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

type Props = {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
};

/** Панель для разделов, где данных пока нет. */
export function EmptyState({ title, children, action }: Props) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </section>
  );
}
