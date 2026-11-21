import { Link } from 'wouter';
import { BackIcon } from '@/ui/Icons';
import styles from './Crumbs.module.css';

export type Crumb = {
  label: string;
  /** Маршрут вкладки (`/library`); у текущей страницы — нет */
  href?: string;
};

/**
 * Путь до страницы над её заголовком: «‹ Альбом / Surging Sparks · 238/191».
 * Разделы со ссылкой ведут назад, у ближайшего к странице — стрелка «назад»;
 * последний пункт без ссылки — сама страница (aria-current). Один пункт — просто «‹ Альбом».
 */
export function Crumbs({ items }: { items: readonly Crumb[] }) {
  const lastLink = items.findLastIndex((item) => item.href !== undefined);
  return (
    <nav aria-label="Путь к странице" className={styles.crumbs}>
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className={styles.item}>
            {item.href !== undefined ? (
              <Link href={item.href} className={styles.link}>
                {index === lastLink && <BackIcon size={18} stroke={2} />}
                {item.label}
              </Link>
            ) : (
              <span className={styles.current} aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
