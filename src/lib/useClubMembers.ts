import { useEffect, useState } from 'react';
import { binderDb } from '@/lib/db';
import { clubMembers, type ClubMember } from '@/lib/friends';

export type ClubMembersState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; members: ClubMember[] }
  | { status: 'error' };

/** Список участников стоит одно чтение на участника: во вкладке он читается не чаще раза в 10 минут. */
const FRESH_MS = 10 * 60 * 1000;

let shared: { at: number; task: Promise<ClubMember[]> } | null = null;

function membersOnce(): Promise<ClubMember[]> {
  if (shared && Date.now() - shared.at < FRESH_MS) return shared.task;
  const task = clubMembers(binderDb());
  const entry = { at: Date.now(), task };
  shared = entry;
  // Неудача не запоминается: следующий фокус в поиске попробует снова
  task.catch(() => {
    if (shared === entry) shared = null;
  });
  return task;
}

/**
 * Участники клуба для поиска в шапке. Пока enabled ложно, ничего не читается. Каждый раз, когда
 * enabled становится истинным (фокус в поле поиска), список берётся из памяти, а если он старше
 * 10 минут — перечитывается. На каждую букву запроса чтений нет.
 */
export function useClubMembers(enabled: boolean): ClubMembersState {
  const [state, setState] = useState<ClubMembersState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }));
    membersOnce().then(
      (members) => active && setState({ status: 'ready', members }),
      () => active && setState((previous) => (previous.status === 'ready' ? previous : { status: 'error' })),
    );
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
