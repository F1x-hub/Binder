import { useState, type FormEvent } from 'react';
import { signInWithGoogle } from '@/lib/auth';
import { authErrorMessage } from '@/lib/auth-errors';
import { formatInviteInput } from '@/lib/invite-code';
import { forgetInvite, rememberInvite } from '@/lib/pending-invite';
import { Brand } from '@/ui/Brand';
import { Button } from '@/ui/Button';
import { CardStub } from '@/ui/CardStub';
import { cx } from '@/ui/cx';
import { ArrowRightIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './Welcome.module.css';

export function Welcome() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Код дождётся конца входа: его подхватит экран вступления здесь или во вкладке
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
    <div className={styles.screen}>
      <Brand size="welcome" />
      <h1 className={styles.title}>Закрытый клуб коллекционеров</h1>
      <p className={styles.lead}>
        Оцифруй свои карточки, следи за ценами и играй колодой, которая у тебя есть на самом деле.
      </p>

      <div className={styles.fan} aria-hidden="true">
        <CardStub type="grass" className={cx(styles.fanCard, styles.left)} />
        <CardStub type="water" className={cx(styles.fanCard, styles.right)} />
        <CardStub type="fire" holo className={cx(styles.fanCard, styles.center)} />
      </div>

      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <TextField
          label="Код приглашения"
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
          <p className={styles.hint}>Нет кода? Попроси у друга, который уже в клубе.</p>
        )}
      </form>
    </div>
  );
}
