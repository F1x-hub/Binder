import { useCallback, useEffect, useId, useState } from 'react';
import { useAuth } from '@/lib/auth-state';
import { binderDb } from '@/lib/db';
import { invitesLeftLabel } from '@/lib/format';
import { inviteErrorMessage } from '@/lib/join-errors';
import { INVITE_LIFETIME_DAYS, createInvite, inviteExpired, myInvites, type Invite } from '@/lib/membership';
import { useMembership } from '@/lib/membership-state';
import { Button } from '@/ui/Button';
import { CopyIcon } from '@/ui/Icons';
import styles from './InviteCard.module.css';

const DAY = 24 * 60 * 60 * 1000;
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function inviteStatus(invite: Invite): string {
  if (invite.usedBy) return 'использован';
  if (inviteExpired(invite.createdAt)) return 'истёк';
  if (!invite.createdAt) return 'действует';
  return `действует до ${dayMonth.format(invite.createdAt.toMillis() + INVITE_LIFETIME_DAYS * DAY)}`;
}

/** Карточка «Пригласить в клуб» из макета профиля: свежий код, копирование, новый код и история. */
export function InviteCard() {
  const titleId = useId();
  const auth = useAuth();
  const membership = useMembership();
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const invitesLeft = membership.status === 'member' ? membership.member.invitesLeft : 0;

  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    if (!uid) return;
    try {
      setInvites(await myInvites(binderDb(), uid));
    } catch (failure) {
      setError(inviteErrorMessage(failure));
    }
  }, [uid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fresh = invites.find((invite) => !invite.usedBy && !inviteExpired(invite.createdAt));

  const create = async () => {
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      await createInvite(binderDb(), uid);
      await reload();
    } catch (failure) {
      setError(inviteErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Не получилось скопировать. Выдели код и скопируй вручную.');
    }
  };

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Пригласить в клуб
        </h2>
        <span className={styles.muted}>Войти можно только по коду. Код одноразовый и действует 14 дней.</span>
      </div>

      {fresh && (
        <div className={styles.codeRow}>
          <div className={styles.code}>{fresh.code}</div>
          <button type="button" className={styles.copy} aria-label="Скопировать код" onClick={() => void copy(fresh.code)}>
            <CopyIcon size={18} stroke={1.9} />
          </button>
        </div>
      )}
      {copied && (
        <span role="status" className={styles.muted}>
          Код скопирован
        </span>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {fresh ? (
        <Button variant="link" className={styles.more} disabled={busy || invitesLeft <= 0} onClick={() => void create()}>
          {busy ? 'Создаём код…' : 'Создать ещё один код'}
        </Button>
      ) : (
        <Button className={styles.create} disabled={busy || invitesLeft <= 0} onClick={() => void create()}>
          {busy ? 'Создаём код…' : 'Создать код'}
        </Button>
      )}
      <span className={styles.muted}>{invitesLeftLabel(invitesLeft)}</span>

      {invites.length > 0 && (
        <ul className={styles.history} aria-label="Выпущенные коды">
          {invites.map((invite) => (
            <li key={invite.code}>
              <span className={styles.historyCode}>{invite.code}</span>
              <span className={styles.muted}>{inviteStatus(invite)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
