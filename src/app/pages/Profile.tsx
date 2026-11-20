import { useParams } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { Avatar } from '@/ui/Avatar';
import { EmptyState } from '@/ui/EmptyState';
import styles from './Page.module.css';

/** Профиль участника. `/u/me` — свой профиль, чужие профили появятся вместе с друзьями. */
export function Profile() {
  const { uid } = useParams<{ uid: string }>();
  const auth = useAuth();
  const mine = uid === 'me';
  usePageTitle(mine ? 'Мой профиль' : 'Профиль');

  if (mine && auth.status === 'signed-in') {
    const { user } = auth;
    return (
      <>
        <section className={styles.person}>
          <Avatar src={user.photoURL} size={72} />
          <div className={styles.personText}>
            <h1 className={styles.title}>{user.displayName ?? 'Без имени'}</h1>
            <span className={styles.heroMeta}>{user.email}</span>
          </div>
        </section>
        <EmptyState title="Витрина пуста">Сюда попадут шесть карт, которые ты выберешь из своего альбома.</EmptyState>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Профиль</h1>
      <EmptyState title="Участник не найден">В клубе нет участника с таким адресом.</EmptyState>
    </>
  );
}
