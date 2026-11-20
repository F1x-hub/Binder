import type { User } from 'firebase/auth/web-extension';
import { useCallback, useEffect, useRef, useState } from 'react';
import { binderDb } from '@/lib/db';
import { formatInviteInput } from '@/lib/invite-code';
import { joinErrorMessage } from '@/lib/join-errors';
import { joinWithInvite, profileFrom } from '@/lib/membership';
import { takeInvite } from '@/lib/pending-invite';

/**
 * Форма вступления по коду для поп-апа и вкладки. Если код ввели ещё на экране входа,
 * он подставляется и отправляется сам, один раз.
 */
export function useJoin(user: User) {
  const [code, setCodeRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  const join = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        await joinWithInvite(binderDb(), profileFrom(user), value);
        // Экран сменится сам: подписка на members увидит новый документ
      } catch (failure) {
        setError(joinErrorMessage(failure));
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    void takeInvite()
      .then((pending) => {
        if (!pending) return;
        setCodeRaw(formatInviteInput(pending));
        void join(pending);
      })
      .catch(() => {});
  }, [join]);

  return {
    code,
    setCode: (value: string) => setCodeRaw(formatInviteInput(value)),
    busy,
    error,
    submit: () => join(code),
  };
}
