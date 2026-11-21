import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STARTING_INVITES } from '@/lib/membership';
import { MAX_PHOTO_LENGTH, saveProfile } from '@/lib/profile-edit';

// Правка своего профиля: имя и фото в members/{uid} (src/lib/profile-edit.ts).
// Остальные правила участников проверяют tests/rules/firestore.test.ts и admin.test.ts.

let env: RulesTestEnvironment;

// RULES_FILE позволяет прогнать тесты на изменённой копии правил: так проверяется, что тесты ловят дыры
const rulesFile = process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-binder',
    firestore: { rules: readFileSync(rulesFile, 'utf8') },
  });
}, 120_000);

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
}, 60_000);

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const guest = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
  });
}

async function readAsAdmin(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (context) => {
    data = (await getDoc(doc(context.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

const GOOGLE = 'https://lh3.googleusercontent.com/a/photo=s96-c';
/** Своё фото ровно заданной длины */
const ownPhoto = (length: number) => `data:image/webp;base64,${'A'.repeat(length - 23)}`;

function seedMember(uid: string, overrides: Record<string, unknown> = {}) {
  return seed(`members/${uid}`, {
    displayName: uid,
    photoURL: GOOGLE,
    joinedAt: Timestamp.now(),
    invitedBy: null,
    inviteCode: null,
    invitesLeft: STARTING_INVITES,
    lastInvite: null,
    ...overrides,
  });
}

describe('правка своего профиля', () => {
  beforeEach(async () => {
    await seedMember('alice');
    await seedMember('bob');
  });

  it('хозяин меняет имя и ставит своё фото (настоящий saveProfile)', async () => {
    const photo = ownPhoto(20_000);
    await assertSucceeds(saveProfile(as('alice'), 'alice', { displayName: '  Алиса  Ли ', photoURL: photo }));
    const data = await readAsAdmin('members/alice');
    expect(data?.displayName).toBe('Алиса Ли');
    expect(data?.photoURL).toBe(photo);
  });

  it('своё фото ровно в пределе проходит', async () => {
    await assertSucceeds(saveProfile(as('alice'), 'alice', { displayName: 'alice', photoURL: ownPhoto(MAX_PHOTO_LENGTH) }));
  });

  it('хозяин возвращает фото из Google и убирает фото', async () => {
    await seedMember('alice', { photoURL: ownPhoto(5000) });
    await assertSucceeds(saveProfile(as('alice'), 'alice', { displayName: 'alice', photoURL: GOOGLE }));
    await assertSucceeds(saveProfile(as('alice'), 'alice', { displayName: 'alice', photoURL: null }));
    expect((await readAsAdmin('members/alice'))?.photoURL).toBeNull();
  });

  it('своё фото сверх предела не проходит', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { photoURL: ownPhoto(MAX_PHOTO_LENGTH + 1) }));
  });

  it('длинная картинка не WebP и с чужими символами не проходит', async () => {
    const png = `data:image/png;base64,${'A'.repeat(5000)}`;
    const broken = `data:image/webp;base64,${'A'.repeat(5000)}"><img src=x>`;
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { photoURL: png }));
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { photoURL: broken }));
  });

  it('своё фото не пускает пустое или длинное имя и не строку', async () => {
    const photo = ownPhoto(5000);
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { displayName: '', photoURL: photo }));
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { displayName: 'я'.repeat(81), photoURL: photo }));
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { displayName: 42, photoURL: photo }));
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { photoURL: ['data:image/webp;base64,AAAA'] }));
  });

  it('чужой профиль не правится, гость тоже не может', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'members/alice'), { displayName: 'Взлом', photoURL: ownPhoto(5000) }));
    await assertFails(updateDoc(doc(guest(), 'members/alice'), { photoURL: ownPhoto(5000) }));
  });

  it('фото не меняется вместе с другими полями', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { photoURL: ownPhoto(5000), invitesLeft: 99 }));
    await assertFails(updateDoc(doc(as('alice'), 'members/alice'), { photoURL: ownPhoto(5000), role: 'admin' }));
  });

  it('при вступлении своё фото длиннее 2048 символов не записать', async () => {
    await seed('invites/AB3D-7K2Q', { createdBy: 'bob', createdAt: Timestamp.now(), usedBy: null, usedAt: null });
    const db = as('carol');
    const batch = writeBatch(db);
    batch.update(doc(db, 'invites/AB3D-7K2Q'), { usedBy: 'carol', usedAt: serverTimestamp() });
    batch.set(doc(db, 'members/carol'), {
      displayName: 'carol',
      photoURL: ownPhoto(5000),
      joinedAt: serverTimestamp(),
      invitedBy: 'bob',
      inviteCode: 'AB3D-7K2Q',
      invitesLeft: STARTING_INVITES,
      lastInvite: null,
    });
    await assertFails(batch.commit());
  });
});
