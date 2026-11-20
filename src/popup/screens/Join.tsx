import type { User } from 'firebase/auth/web-extension';
import { useJoin } from '@/lib/useJoin';
import { Brand } from '@/ui/Brand';
import { Button } from '@/ui/Button';
import { ArrowRightIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './Welcome.module.css';

/** Вошёл через Google, но ещё не участник: нужен код приглашения. */
export function Join({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const { code, setCode, busy, error, submit } = useJoin(user);

  return (
    <div className={styles.screen}>
      <Brand size="welcome" />
      <h1 className={styles.title}>Нужен код приглашения</h1>
      <p className={styles.lead}>
        Ты вошёл как {user.email}. Клуб закрытый: вступить можно по коду от друга, который уже в клубе.
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
          className={styles.code}
        />
        <Button type="submit" disabled={busy || code.length === 0} end={<ArrowRightIcon size={18} stroke={2} />}>
          {busy ? 'Проверяем код…' : 'Вступить в клуб'}
        </Button>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : (
          <p className={styles.hint}>Код выглядит так: XXXX-XXXX.</p>
        )}
        <Button variant="link" className={styles.switchAccount} onClick={onSignOut}>
          Выйти и войти другим аккаунтом
        </Button>
      </form>
    </div>
  );
}
