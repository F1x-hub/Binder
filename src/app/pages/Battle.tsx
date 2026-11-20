import { usePageTitle } from '@/app/usePageTitle';
import { EmptyState } from '@/ui/EmptyState';
import styles from './Page.module.css';

/** Бои по правилам TCG ждут отдельного решения владельца проекта (см. CLAUDE.md, раздел «Игра»). */
export function Battle() {
  usePageTitle('Бой');
  return (
    <>
      <h1 className={styles.title}>Бой</h1>
      <EmptyState title="Раздел пока закрыт">Бои появятся позже, после альбома и колод.</EmptyState>
    </>
  );
}
