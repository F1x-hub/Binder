import type { User } from 'firebase/auth/web-extension';
import { useState, type ReactNode } from 'react';
import { usePageTitle } from '@/app/usePageTitle';
import { signInWithGoogle, signOutOfBinder } from '@/lib/auth';
import { authErrorMessage } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth-state';
import { CollectionProvider } from '@/lib/collection-state';
import { MembershipProvider, useMembership } from '@/lib/membership-state';
import { useJoin } from '@/lib/useJoin';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ArrowRightIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './AuthGate.module.css';

/** Страницы вкладки видны только участникам клуба: сначала вход, потом членство. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return null;
  if (auth.status === 'unavailable') return <EmptyState title="Firebase не настроен">{auth.message}</EmptyState>;
  if (auth.status === 'signed-out') return <SignIn />;
  return (
    <MembershipProvider uid={auth.user.uid}>
      <MemberGate user={auth.user}>{children}</MemberGate>
    </MembershipProvider>
  );
}

function MemberGate({ user, children }: { user: User; children: ReactNode }) {
  const membership = useMembership();
  if (membership.status === 'loading') return null;
  if (membership.status === 'error') {
    return <EmptyState title="Не получилось проверить членство">{membership.message}</EmptyState>;
  }
  if (membership.status === 'not-member') return <JoinPanel user={user} />;
  return <CollectionProvider uid={user.uid}>{children}</CollectionProvider>;
}

function SignIn() {
  usePageTitle('Вход');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EmptyState
      title="Войди, чтобы открыть альбом"
      action={
        <div className={styles.actions}>
          <Button
            className={styles.button}
            disabled={busy}
            onClick={() => void signIn()}
            end={<ArrowRightIcon size={18} stroke={2} />}
          >
            {busy ? 'Входим…' : 'Войти через Google'}
          </Button>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      }
    >
      Binder — закрытый клуб коллекционеров. Вход идёт через тот Google-аккаунт, под которым открыт Chrome.
    </EmptyState>
  );
}

function JoinPanel({ user }: { user: User }) {
  usePageTitle('Вступление в клуб');
  const { code, setCode, busy, error, submit } = useJoin(user);

  return (
    <EmptyState
      title="Нужен код приглашения"
      action={
        <form
          className={styles.join}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={styles.joinRow}>
            <div className={styles.codeField}>
              <TextField
                label="Код приглашения"
                placeholder="XXXX-XXXX"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={styles.code}
              />
            </div>
            <Button type="submit" className={styles.button} disabled={busy || code.length === 0}>
              {busy ? 'Проверяем код…' : 'Вступить в клуб'}
            </Button>
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <Button
            variant="link"
            className={styles.signOut}
            onClick={() => void signOutOfBinder().catch((failure: unknown) => console.warn('[binder] выход', failure))}
          >
            Выйти и войти другим аккаунтом
          </Button>
        </form>
      }
    >
      Ты вошёл как {user.email}. Клуб закрытый: вступить можно по коду от друга, который уже в клубе.
    </EmptyState>
  );
}
