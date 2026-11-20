import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { removeMember, setInvitesLeft, setRole } from '@/lib/admin';
import { readClubKeys, saveClubKeys, type ClubKey } from '@/lib/club-keys';
import { STARTING_INVITES, joinWithInvite } from '@/lib/membership';

// Роли (поле role в members/{uid}), ключи JustTCG клуба (config/justtcg) и то, что админ может
// делать с участниками. Остальные правила проверяют firestore.test.ts, showcase.test.ts и decks.test.ts.

const CODE = 'AB3D-7K2Q';

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

async function readAsSystem(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (context) => {
    data = (await getDoc(doc(context.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

function seedMember(uid: string, overrides: Record<string, unknown> = {}) {
  return seed(`members/${uid}`, {
    displayName: uid,
    photoURL: null,
    joinedAt: Timestamp.now(),
    invitedBy: null,
    inviteCode: null,
    invitesLeft: STARTING_INVITES,
    lastInvite: null,
    ...overrides,
  });
}

const key = (value: string, enabled = true): ClubKey => ({ key: value, label: '', enabled, addedAt: Timestamp.now() });

/** owner — админ (роль поставлена в консоли), ann — участник с role: 'user', bob — без поля роли. */
async function seedClub() {
  await seedMember('owner', { role: 'admin' });
  await seedMember('ann', { role: 'user' });
  await seedMember('bob');
}

describe('роли участников', () => {
  it('поставить роль себе нельзя: ни отдельно, ни вместе с именем', async () => {
    await seedClub();
    await assertFails(updateDoc(doc(as('ann'), 'members/ann'), { role: 'admin' }));
    await assertFails(updateDoc(doc(as('bob'), 'members/bob'), { role: 'admin' }));
    await assertFails(updateDoc(doc(as('bob'), 'members/bob'), { displayName: 'Боб', role: 'admin' }));
    // Обычная правка имени по-прежнему работает
    await assertSucceeds(updateDoc(doc(as('bob'), 'members/bob'), { displayName: 'Боб' }));
  });

  it('вступить сразу админом нельзя, обычное вступление проходит', async () => {
    await seedMember('owner', { role: 'admin' });
    await seed(`invites/${CODE}`, { createdBy: 'owner', createdAt: Timestamp.now(), usedBy: null, usedAt: null });
    const db = as('newbie');
    const batch = writeBatch(db);
    batch.update(doc(db, `invites/${CODE}`), { usedBy: 'newbie', usedAt: serverTimestamp() });
    batch.set(doc(db, 'members/newbie'), {
      displayName: 'Новичок',
      photoURL: null,
      joinedAt: serverTimestamp(),
      invitedBy: 'owner',
      inviteCode: CODE,
      invitesLeft: STARTING_INVITES,
      lastInvite: null,
      role: 'admin',
    });
    await assertFails(batch.commit());
    await assertSucceeds(joinWithInvite(db, { uid: 'newbie', displayName: 'Новичок', photoURL: null }, CODE));
    expect((await readAsSystem('members/newbie'))?.role).toBeUndefined();
  });

  it('админ меняет роль другого участника, только на admin или user', async () => {
    await seedClub();
    await assertSucceeds(setRole(as('owner'), 'bob', 'admin'));
    expect((await readAsSystem('members/bob'))?.role).toBe('admin');
    await assertSucceeds(setRole(as('owner'), 'bob', 'user'));
    await assertFails(updateDoc(doc(as('owner'), 'members/bob'), { role: 'owner' }));
    await assertFails(updateDoc(doc(as('owner'), 'members/bob'), { role: 'admin', displayName: 'Не Боб' }));
  });

  it('свою роль админ не меняет, обычный участник не меняет чужую', async () => {
    await seedClub();
    await assertFails(setRole(as('owner'), 'owner', 'user'));
    await assertFails(setRole(as('ann'), 'bob', 'admin'));
    await assertFails(setRole(as('bob'), 'ann', 'user'));
  });

  it('новый админ сразу получает права админа', async () => {
    await seedClub();
    await assertFails(saveClubKeys(as('bob'), 'bob', [key('tcg_first123')]));
    await setRole(as('owner'), 'bob', 'admin');
    await assertSucceeds(saveClubKeys(as('bob'), 'bob', [key('tcg_first123')]));
  });
});

describe('ключи JustTCG клуба', () => {
  it('админ сохраняет список, все участники его читают', async () => {
    await seedClub();
    await assertSucceeds(saveClubKeys(as('owner'), 'owner', [key('tcg_first123'), key('tcg_second12', false)]));
    const keys = await readClubKeys(as('bob'));
    expect(keys.map((item) => [item.key, item.enabled])).toEqual([
      ['tcg_first123', true],
      ['tcg_second12', false],
    ]);
  });

  it('чужие не читают ключи: гость, вошедший не участник', async () => {
    await seedClub();
    await saveClubKeys(as('owner'), 'owner', [key('tcg_first123')]);
    await assertFails(getDoc(doc(guest(), 'config/justtcg')));
    await assertFails(getDoc(doc(as('stranger'), 'config/justtcg')));
  });

  it('участник с ролью user или без роли ключи не меняет и не удаляет', async () => {
    await seedClub();
    await saveClubKeys(as('owner'), 'owner', [key('tcg_first123')]);
    await assertFails(saveClubKeys(as('ann'), 'ann', [key('tcg_mine1234')]));
    await assertFails(saveClubKeys(as('bob'), 'bob', [key('tcg_mine1234')]));
    await assertFails(deleteDoc(doc(as('ann'), 'config/justtcg')));
    expect((await readAsSystem('config/justtcg'))?.items).toHaveLength(1);
  });

  it('админ, которого убрали из клуба, ключи не меняет', async () => {
    await seedClub();
    await removeMember(as('owner'), 'bob');
    await seedMember('second', { role: 'admin' });
    await removeMember(as('owner'), 'second');
    await assertFails(saveClubKeys(as('second'), 'second', [key('tcg_first123')]));
  });

  it('форма документа проверяется: до десяти ключей, только нужные поля, автор и время записи', async () => {
    await seedClub();
    const db = as('owner');
    const ref = doc(db, 'config/justtcg');
    const item = { key: 'tcg_first123', label: '', enabled: true, addedAt: Timestamp.now() };
    await assertSucceeds(saveClubKeys(db, 'owner', Array.from({ length: 10 }, (_, index) => key(`tcg_key${String(index).padStart(5, '0')}`))));
    // Одиннадцатый ключ правила не пускают (saveClubKeys сам обрезает до десяти, поэтому пишем напрямую)
    await assertFails(
      setDoc(ref, { items: Array.from({ length: 11 }, (_, index) => ({ ...item, key: `tcg_key${index}abcd` })), updatedAt: serverTimestamp(), updatedBy: 'owner' }),
    );
    await assertFails(setDoc(ref, { items: [item], updatedAt: serverTimestamp(), updatedBy: 'ann' }));
    await assertFails(setDoc(ref, { items: [item], updatedAt: Timestamp.fromMillis(0), updatedBy: 'owner' }));
    await assertFails(setDoc(ref, { items: [item], updatedAt: serverTimestamp(), updatedBy: 'owner', extra: 1 }));
    await assertFails(setDoc(ref, { items: [{ ...item, key: 'с пробелом и кириллицей' }], updatedAt: serverTimestamp(), updatedBy: 'owner' }));
    await assertFails(setDoc(ref, { items: [{ ...item, enabled: 'yes' }], updatedAt: serverTimestamp(), updatedBy: 'owner' }));
    await assertFails(setDoc(ref, { items: [{ ...item, secret: 'x' }], updatedAt: serverTimestamp(), updatedBy: 'owner' }));
    // Десятый элемент проверяется так же, как первый
    const nine = Array.from({ length: 9 }, (_, index) => ({ ...item, key: `tcg_key${index}abcd` }));
    await assertFails(setDoc(ref, { items: [...nine, { ...item, label: 'x'.repeat(41) }], updatedAt: serverTimestamp(), updatedBy: 'owner' }));
  });

  it('другие документы config не открыты даже админу', async () => {
    await seedClub();
    await assertFails(setDoc(doc(as('owner'), 'config/other'), { items: [], updatedAt: serverTimestamp(), updatedBy: 'owner' }));
    await assertFails(getDoc(doc(as('ann'), 'config/other')));
  });
});

describe('админ и участники', () => {
  it('админ меняет счётчик приглашений участника, от 0 до 99', async () => {
    await seedClub();
    await assertSucceeds(setInvitesLeft(as('owner'), 'ann', 10));
    expect((await readAsSystem('members/ann'))?.invitesLeft).toBe(10);
    await assertSucceeds(setInvitesLeft(as('owner'), 'ann', 0));
    await assertFails(updateDoc(doc(as('owner'), 'members/ann'), { invitesLeft: 100 }));
    await assertFails(updateDoc(doc(as('owner'), 'members/ann'), { invitesLeft: -1 }));
    await assertFails(updateDoc(doc(as('owner'), 'members/ann'), { invitesLeft: 2.5 }));
  });

  it('другие поля участника админ не трогает', async () => {
    await seedClub();
    await assertFails(updateDoc(doc(as('owner'), 'members/ann'), { displayName: 'Не Анна' }));
    await assertFails(updateDoc(doc(as('owner'), 'members/ann'), { invitesLeft: 5, showcase: [] }));
  });

  it('обычный участник не выдаёт приглашения ни себе, ни другим', async () => {
    await seedClub();
    await assertFails(setInvitesLeft(as('ann'), 'ann', 50));
    await assertFails(setInvitesLeft(as('ann'), 'bob', 50));
  });

  it('админ убирает участника, но не себя; обычный участник не убирает никого', async () => {
    await seedClub();
    await assertFails(removeMember(as('ann'), 'bob'));
    await assertFails(removeMember(as('owner'), 'owner'));
    await assertSucceeds(removeMember(as('owner'), 'bob'));
    expect(await readAsSystem('members/bob')).toBeUndefined();
    // Убранный участник больше не читает клуб
    await assertFails(getDoc(doc(as('bob'), 'members/ann')));
  });
});
