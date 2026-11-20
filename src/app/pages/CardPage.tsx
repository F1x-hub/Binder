import { Link, useParams } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { EmptyState } from '@/ui/EmptyState';
import styles from './Page.module.css';

/** Страница карточки. Пока базы карт нет, любая карточка «не найдена». */
export function CardPage() {
  const { id } = useParams<{ id: string }>();
  usePageTitle('Карточка');
  return (
    <>
      <nav aria-label="Путь" className={styles.crumbs}>
        <Link href="/library" className={styles.textLink}>
          Альбом
        </Link>
        <span aria-hidden="true">/</span>
        <span>{id}</span>
      </nav>
      <EmptyState
        title="Карточка не найдена"
        action={
          <Link href="/library" className={styles.textLink}>
            Вернуться в альбом
          </Link>
        }
      >
        В альбоме нет карточки с таким адресом.
      </EmptyState>
    </>
  );
}
