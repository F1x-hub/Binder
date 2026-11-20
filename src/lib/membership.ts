import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { generateInviteCode, isInviteCode } from '@/lib/invite-code';
import { JoinError } from '@/lib/join-errors';

/** Сколько приглашений получает новый участник. Должно совпадать с firestore.rules. */
export const STARTING_INVITES = 3;
/** Сколько дней живёт код приглашения. Должно совпадать с firestore.rules. */
export const INVITE_LIFETIME_DAYS = 14;

/** Роль в клубе (src/lib/admin.ts); без поля role — обычный участник. */
export type Role = 'admin' | 'user';

/** Документ members/{uid}. */
export type Member = {
  displayName: string;
  photoURL: string | null;
  joinedAt: Timestamp | null;
  invitedBy: string | null;
  inviteCode: string | null;
  invitesLeft: number;
  lastInvite: string | null;
  /** Витрина: до шести ID документов своего альбома (src/lib/showcase.ts); поля нет, пока витрину не выбрали */
  showcase?: string[];
  /** Роль: ставят в консоли Firebase или админ на своей странице; поля нет — обычный участник */
  role?: Role;
};

/** Документ invites/{code}, код лежит в id документа. */
export type Invite = {
  code: string;
  createdBy: string;
  createdAt: Timestamp | null;
  usedBy: string | null;
  usedAt: Timestamp | null;
};

/** Что участник сообщает о себе при вступлении. */
export type Profile = { uid: string; displayName: string; photoURL: string | null };

export function memberRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, 'members', uid);
}

export function inviteRef(db: Firestore, code: string): DocumentReference {
  return doc(db, 'invites', code);
}

export function inviteExpired(createdAt: Timestamp | null, now = Date.now()): boolean {
  if (!createdAt) return false;
  return now >= createdAt.toMillis() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
}

/** Имя и фото для документа участника из аккаунта Google, в пределах, которые проверяют правила. */
export function profileFrom(user: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): Profile {
  const name = (user.displayName ?? user.email?.split('@')[0] ?? '').trim().slice(0, 80);
  const photo = user.photoURL && user.photoURL.length <= 2048 ? user.photoURL : null;
  return { uid: user.uid, displayName: name || 'Участник', photoURL: photo };
}

/**
 * Вступление по коду. Код сначала читается, чтобы объяснить отказ понятными словами.
 * Потом одна пакетная запись гасит код и создаёт участника, а решают правила Firestore.
 */
export async function joinWithInvite(db: Firestore, profile: Profile, rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  if (!isInviteCode(code)) throw new JoinError('format');

  const snapshot = await getDoc(inviteRef(db, code));
  if (!snapshot.exists()) throw new JoinError('not-found');
  const invite = snapshot.data() as Omit<Invite, 'code'>;
  if (invite.usedBy) throw new JoinError('used');
  if (inviteExpired(invite.createdAt)) throw new JoinError('expired');

  const batch = writeBatch(db);
  batch.update(inviteRef(db, code), { usedBy: profile.uid, usedAt: serverTimestamp() });
  batch.set(memberRef(db, profile.uid), {
    displayName: profile.displayName,
    photoURL: profile.photoURL,
    joinedAt: serverTimestamp(),
    invitedBy: invite.createdBy,
    inviteCode: code,
    invitesLeft: STARTING_INVITES,
    lastInvite: null,
  });
  await batch.commit();
}

/** Новый код приглашения: код создаётся, а счётчик участника уменьшается одной записью. */
export async function createInvite(db: Firestore, uid: string): Promise<string> {
  const code = generateInviteCode();
  const batch = writeBatch(db);
  batch.set(inviteRef(db, code), { createdBy: uid, createdAt: serverTimestamp(), usedBy: null, usedAt: null });
  batch.update(memberRef(db, uid), { invitesLeft: increment(-1), lastInvite: code });
  await batch.commit();
  return code;
}

/** Коды, которые выпустил участник, новые сверху. */
export async function myInvites(db: Firestore, uid: string): Promise<Invite[]> {
  const snapshot = await getDocs(query(collection(db, 'invites'), where('createdBy', '==', uid)));
  return snapshot.docs
    .map((item) => ({ ...(item.data() as Omit<Invite, 'code'>), code: item.id }))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
}
