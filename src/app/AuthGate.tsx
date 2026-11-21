import type { User } from 'firebase/auth/web-extension';
import { useState, type FormEvent, type ReactNode } from 'react';
import { usePageTitle } from '@/app/usePageTitle';
import { signInWithGoogle, signOutOfBinder } from '@/lib/auth';
import { authErrorMessage } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth-state';
import { CollectionProvider } from '@/lib/collection-state';
import { formatInviteInput } from '@/lib/invite-code';
import { MembershipProvider, useMembership } from '@/lib/membership-state';
import { forgetInvite, rememberInvite } from '@/lib/pending-invite';
import { useJoin } from '@/lib/useJoin';
import { Button } from '@/ui/Button';
import { CardStub } from '@/ui/CardStub';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { ArrowRightIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './AuthGate.module.css';

/** Страницы вкладки видны только участникам клуба: сначала вход, потом членство. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return null;
  if (auth.status === 'unavailable') {
    return (
      <EmptyState variant="page" tone="error" title="Firebase не настроен">
        {auth.message}
      </EmptyState>
    );
  }
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
  if (membership.status === 'error') return <MembershipError message={membership.message} />;
  if (membership.status === 'not-member') return <JoinPanel user={user} />;
  return <CollectionProvider uid={user.uid}>{children}</CollectionProvider>;
}

function MembershipError({ message }: { message: string }) {
  usePageTitle('Ошибка входа');
  return (
    <EmptyState
      variant="page"
      tone="error"
      title="Не получилось проверить членство"
      action={
        <Button onClick={() => window.location.reload()}>Обновить страницу</Button>
      }
    >
      Binder не смог узнать, есть ли ты в клубе. Проверь интернет и обнови страницу. Ответ базы: {message}
    </EmptyState>
  );
}

/**
 * Карточка входа по центру вкладки, в духе экрана входа поп-апа:
 * слева веер карт (знак уже в шапке), справа заголовок и форма.
 */
function GateCard({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.stage}>
      <section className={styles.card} aria-labelledby="gate-title">
        <div className={styles.hero}>
          <div className={styles.fan} aria-hidden="true">
            <CardStub type="grass" className={cx(styles.fanCard, styles.left)} />
            <CardStub type="water" className={cx(styles.fanCard, styles.right)} />
            <CardStub type="fire" holo className={cx(styles.fanCard, styles.center)} />
          </div>
        </div>
        <div className={styles.body}>
          <h1 id="gate-title" className={styles.title}>
            {title}
          </h1>
          <p className={styles.lead}>{lead}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

function SignIn() {
  usePageTitle('Вход');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Как в поп-апе: код ждёт конца входа в chrome.storage.session, его подхватит экран вступления
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (code) await rememberInvite(code);
      else await forgetInvite();
      await signInWithGoogle();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateCard
      title="Закрытый клуб коллекционеров"
      lead="Оцифруй свои карточки, следи за ценами и собирай колоды из того, что у тебя есть на самом деле."
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <TextField
          label="Код приглашения"
          hint="Если ты уже в клубе, код не нужен."
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(event) => setCode(formatInviteInput(event.target.value))}
          autoComplete="off"
          spellCheck={false}
          className={styles.code}
        />
        <Button type="submit" disabled={busy} end={<ArrowRightIcon size={18} stroke={2} />}>
          {busy ? 'Входим…' : 'Войти через Google'}
        </Button>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : (
          <p className={styles.hint}>
            Вход идёт через Google-аккаунт этого профиля Chrome. Нет кода — попроси у друга, который уже в клубе.
          </p>
        )}
      </form>
    </GateCard>
  );
}

function JoinPanel({ user }: { user: User }) {
  usePageTitle('Вступление в клуб');
  const { code, setCode, busy, error, submit } = useJoin(user);

  return (
    <GateCard
      title="Нужен код приглашения"
      lead="Клуб закрытый: вступить можно по коду от друга, который уже в клубе. Код одноразовый и живёт 14 дней."
    >
      <p className={styles.account}>
        Ты вошёл как <strong className={styles.email}>{user.email}</strong>
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Код приглашения"
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className={styles.code}
        />
        <Button type="submit" disabled={busy || code.length === 0} end={<ArrowRightIcon size={18} stroke={2} />}>
          {busy ? 'Проверяем код…' : 'Вступить в клуб'}
        </Button>
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
    </GateCard>
  );
}
