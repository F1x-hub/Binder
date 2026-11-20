import { onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { binderDb } from '@/lib/db';
import { memberRef, type Member } from '@/lib/membership';
import { forgetInvite } from '@/lib/pending-invite';

export type MembershipState =
  | { status: 'loading' }
  | { status: 'member'; member: Member }
  | { status: 'not-member' }
  | { status: 'error'; message: string };

const MembershipContext = createContext<MembershipState>({ status: 'loading' });

/**
 * Членство вошедшего пользователя: живая подписка на его документ в members.
 * Вступил — экран сменится сам, удалили из клуба в консоли — тоже.
 */
export function MembershipProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [state, setState] = useState<MembershipState>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    return onSnapshot(
      memberRef(binderDb(), uid),
      (snapshot) => {
        if (snapshot.exists()) {
          // Участнику отложенный код с экрана входа больше не нужен
          void forgetInvite().catch(() => {});
          setState({ status: 'member', member: snapshot.data() as Member });
        } else {
          setState({ status: 'not-member' });
        }
      },
      (error) => setState({ status: 'error', message: error.message }),
    );
  }, [uid]);

  return <MembershipContext.Provider value={state}>{children}</MembershipContext.Provider>;
}

export function useMembership(): MembershipState {
  return useContext(MembershipContext);
}
