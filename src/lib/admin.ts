import { deleteDoc, doc, onSnapshot, updateDoc, type Firestore } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { binderDb } from '@/lib/db';
import type { Role } from '@/lib/membership';

/**
 * Роли клуба: поле role в members/{uid} — 'admin' или 'user', без поля — обычный участник.
 * Первого админа ставят в консоли Firebase, дальше роли других участников меняет админ
 * на своей странице. Админ меняет ключи JustTCG (src/lib/club-keys.ts), выдаёт приглашения
 * и может убрать участника из клуба. Всё это проверяют правила Firestore, а не только интерфейс.
 */
export const MAX_INVITES = 99;

export function isAdminRole(role: unknown): boolean {
  return role === 'admin';
}

/**
 * null — ещё не известно, true/false — админ ли участник. Живая подписка на свой документ
 * участника для страницы админа; Firestore держит одно прослушивание на документ, лишних чтений нет.
 * Шапка вкладки берёт роль, имя и фото из MembershipProvider (та же подписка) через isAdminRole.
 */
export function useIsAdmin(uid: string | null): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!uid) {
      setAdmin(false);
      return;
    }
    setAdmin(null);
    return onSnapshot(
      doc(binderDb(), 'members', uid),
      (snapshot) => setAdmin(isAdminRole(snapshot.data()?.role)),
      () => setAdmin(false),
    );
  }, [uid]);

  return admin;
}

/** Роль другого участника. Свою роль админ не меняет: правила этого не пустят. */
export async function setRole(db: Firestore, uid: string, role: Role): Promise<void> {
  await updateDoc(doc(db, 'members', uid), { role });
}

/** Сколько приглашений осталось у участника: целое от 0 до 99. */
export async function setInvitesLeft(db: Firestore, uid: string, count: number): Promise<void> {
  const value = Math.max(0, Math.min(MAX_INVITES, Math.round(count)));
  await updateDoc(doc(db, 'members', uid), { invitesLeft: value });
}

/**
 * Убрать участника из клуба: удаляется его документ в members, и правила перестают его
 * пускать. Альбом и колоды остаются в базе, но в клубе он больше не виден.
 */
export async function removeMember(db: Firestore, uid: string): Promise<void> {
  await deleteDoc(doc(db, 'members', uid));
}
