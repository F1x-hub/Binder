import { usePageTitle } from '@/app/usePageTitle';
import { EmptyState } from '@/ui/EmptyState';
import styles from './Page.module.css';

export function Decks() {
  usePageTitle('Колоды');
  return (
    <>
      <h1 className={styles.title}>Колоды</h1>
      <EmptyState title="Колод пока нет">
        Колода собирается только из карточек твоего альбома: 60 карт, не больше четырёх копий одной карты.
      </EmptyState>
    </>
  );
}
