import { InviteCard } from '@/app/InviteCard';
import { usePageTitle } from '@/app/usePageTitle';
import { EmptyState } from '@/ui/EmptyState';
import styles from './Page.module.css';

export function Friends() {
  usePageTitle('Друзья');
  return (
    <>
      <h1 className={styles.title}>Друзья</h1>
      <div className={styles.split}>
        <EmptyState title="Друзей пока нет">
          Когда друзья вступят в клуб по твоему коду приглашения, здесь появятся их витрины и лента.
        </EmptyState>
        <aside className={styles.side}>
          <InviteCard />
        </aside>
      </div>
    </>
  );
}
