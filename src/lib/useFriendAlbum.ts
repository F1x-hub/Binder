import { useEffect, useState } from 'react';
import type { OwnedCard } from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { clubMember, friendAlbum, friendsErrorMessage, type ClubMember } from '@/lib/friends';

export type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string };

function useLoaded<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    load().then(
      (value) => active && setState({ status: 'ready', value }),
      (error: unknown) => active && setState({ status: 'error', message: friendsErrorMessage(error) }),
    );
    return () => {
      active = false;
    };
    // load зависит только от key
  }, [key]);
  return state;
}

/** Альбом другого участника для чтения (src/lib/friends.ts: кэш браузера и дочитывание изменений). */
export function useFriendAlbum(uid: string): Loaded<OwnedCard[]> {
  return useLoaded(`album:${uid}`, () => friendAlbum(binderDb(), uid));
}

/** Документ участника; null — такого в клубе нет. */
export function useClubMember(uid: string): Loaded<ClubMember | null> {
  return useLoaded(`member:${uid}`, () => clubMember(binderDb(), uid));
}
