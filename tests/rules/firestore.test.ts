import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addToCollection, type OwnedCard } from '@/lib/collection';
import { STARTING_INVITES, createInvite, joinWithInvite, myInvites } from '@/lib/membership';

const CODE = 'AB3D-7K2Q';
const OTHER_CODE = 'ZX9C-4M2N';
const DAY = 24 * 60 * 60 * 1000;

let env: RulesTestEnvironment;

// RULES_FILE позволяет прогнать тесты на изменённой копии правил: так проверяется, что тесты ловят дыры
const rulesFile = process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-binder',
    firestore: { rules: readFileSync(rulesFile, 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** Firestore от имени пользователя. rules-unit-testing отдаёт compat-объект, модульные функции его принимают. */
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

function seedInvite(code: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  return seed(`invites/${code}`, { createdBy, createdAt: Timestamp.now(), usedBy: null, usedAt: null, ...overrides });
}

/** Пакет вступления в обход проверок клиента: так проверяются именно правила. */
function joinBatch(db: Firestore, uid: string, code: string, member: Record<string, unknown> = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'invites', code), { usedBy: uid, usedAt: serverTimestamp() });
  batch.set(doc(db, 'members', uid), {
    displayName: 'Новичок',
    photoURL: null,
    joinedAt: serverTimestamp(),
    invitedBy: 'alice',
    inviteCode: code,
    invitesLeft: STARTING_INVITES,
    lastInvite: null,
    ...member,
  });
  return batch.commit();
}

/** Пакет выпуска кода в обход клиента. */
function issueBatch(
  db: Firestore,
  uid: string,
  code: string,
  invite: Record<string, unknown> = {},
  memberUpdate: Record<string, unknown> = { invitesLeft: increment(-1), lastInvite: code },
) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'invites', code), {
    createdBy: uid,
    createdAt: serverTimestamp(),
    usedBy: null,
    usedAt: null,
    ...invite,
  });
  batch.update(doc(db, 'members', uid), memberUpdate);
  return batch.commit();
}

describe('гость без входа', () => {
  it('не читает участников и коды', async () => {
    await seedMember('alice');
    await seedInvite(CODE, 'alice');
    await assertFails(getDoc(doc(guest(), 'members/alice')));
    await assertFails(getDoc(doc(guest(), `invites/${CODE}`)));
  });

  it('не может вступить', async () => {
    await seedInvite(CODE, 'alice');
    await assertFails(joinBatch(guest(), 'anon', CODE));
  });
});

describe('вошёл, но не участник', () => {
  it('видит, что он не участник', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'members/bob')));
  });

  it('не читает чужие документы участников и их список', async () => {
    await seedMember('alice');
    await assertFails(getDoc(doc(as('bob'), 'members/alice')));
    await assertFails(getDocs(collection(as('bob'), 'members')));
  });

  it('не создаёт себе членство, не погасив код', async () => {
    await seedInvite(CODE, 'alice');
    await assertFails(
      setDoc(doc(as('bob'), 'members/bob'), {
        displayName: 'Боб',
        photoURL: null,
        joinedAt: serverTimestamp(),
        invitedBy: 'alice',
        inviteCode: CODE,
        invitesLeft: STARTING_INVITES,
        lastInvite: null,
      }),
    );
  });

  it('вступает по действующему коду', async () => {
    await seedMember('alice');
    await seedInvite(CODE, 'alice');
    await assertSucceeds(joinWithInvite(as('bob'), { uid: 'bob', displayName: 'Боб', photoURL: null }, CODE));
    expect(await readAsAdmin('members/bob')).toMatchObject({
      invitedBy: 'alice',
      inviteCode: CODE,
      invitesLeft: STARTING_INVITES,
    });
    expect(await readAsAdmin(`invites/${CODE}`)).toMatchObject({ usedBy: 'bob' });
  });

  it('вступает по коду, которому 13 дней', async () => {
    await seedInvite(CODE, 'alice', { createdAt: Timestamp.fromMillis(Date.now() - 13 * DAY) });
    await assertSucceeds(joinBatch(as('bob'), 'bob', CODE));
  });

  it('не вступает по использованному коду', async () => {
    await seedInvite(CODE, 'alice', { usedBy: 'carol', usedAt: Timestamp.now() });
    await assertFails(joinBatch(as('bob'), 'bob', CODE));
  });

  it('не вступает по коду старше 14 дней', async () => {
    await seedInvite(CODE, 'alice', { createdAt: Timestamp.fromMillis(Date.now() - 15 * DAY) });
    await assertFails(joinBatch(as('bob'), 'bob', CODE));
  });

  it('не вступает по выдуманному коду', async () => {
    await assertFails(joinBatch(as('bob'), 'bob', CODE));
  });

  it('не берёт себе больше трёх приглашений', async () => {
    await seedInvite(CODE, 'alice');
    await assertFails(joinBatch(as('bob'), 'bob', CODE, { invitesLeft: 100 }));
  });

  it('не подделывает того, кто пригласил', async () => {
    await seedInvite(CODE, 'alice');
    await assertFails(joinBatch(as('bob'), 'bob', CODE, { invitedBy: 'mallory' }));
  });

  it('не гасит код, не вступая', async () => {
    await seedInvite(CODE, 'alice');
    await assertFails(updateDoc(doc(as('bob'), `invites/${CODE}`), { usedBy: 'bob', usedAt: serverTimestamp() }));
  });

  it('не вступает за другого человека', async () => {
    await seedInvite(CODE, 'alice');
    await assertFails(joinBatch(as('bob'), 'carol', CODE));
  });

  it('читает код, только зная его целиком, но не список кодов', async () => {
    await seedInvite(CODE, 'alice');
    await assertSucceeds(getDoc(doc(as('bob'), `invites/${CODE}`)));
    await assertFails(getDocs(collection(as('bob'), 'invites')));
  });

  it('получает понятную причину отказа ещё до записи', async () => {
    const profile = { uid: 'bob', displayName: 'Боб', photoURL: null };
    await expect(joinWithInvite(as('bob'), profile, 'abc')).rejects.toMatchObject({ reason: 'format' });
    await expect(joinWithInvite(as('bob'), profile, CODE)).rejects.toMatchObject({ reason: 'not-found' });
    await seedInvite(CODE, 'alice', { usedBy: 'carol' });
    await expect(joinWithInvite(as('bob'), profile, CODE)).rejects.toMatchObject({ reason: 'used' });
    await seedInvite(OTHER_CODE, 'alice', { createdAt: Timestamp.fromMillis(Date.now() - 15 * DAY) });
    await expect(joinWithInvite(as('bob'), profile, OTHER_CODE)).rejects.toMatchObject({ reason: 'expired' });
  });
});

describe('участник клуба', () => {
  it('видит других участников', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await assertSucceeds(getDoc(doc(as('alice'), 'members/bob')));
    await assertSucceeds(getDocs(collection(as('alice'), 'members')));
  });

  it('меняет своё имя и фото', async () => {
    await seedMember('alice');
    await assertSucceeds(
      updateDoc(doc(as('alice'), 'members/alice'), { displayName: 'Алиса', photoURL: 'https://example.com/a.png' }),
    );
  });

  it('не меняет чужой профиль', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await assertFails(updateDoc(doc(as('alice'), 'members/bob'), { displayName: 'Не Боб' }));
  });

  it('не поднимает себе счётчик и не трогает служебные поля', async () => {
    await seedMember('alice');
    const me = doc(as('alice'), 'members/alice');
    await assertFails(updateDoc(me, { invitesLeft: 10 }));
    await assertFails(updateDoc(me, { inviteCode: OTHER_CODE }));
    await assertFails(updateDoc(me, { joinedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { displayName: '' }));
  });

  it('выпускает код, и счётчик уменьшается', async () => {
    await seedMember('alice');
    const code = await assertSucceeds(createInvite(as('alice'), 'alice'));
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(await readAsAdmin('members/alice')).toMatchObject({ invitesLeft: STARTING_INVITES - 1, lastInvite: code });
    expect(await readAsAdmin(`invites/${code}`)).toMatchObject({ createdBy: 'alice', usedBy: null });
  });

  it('не выпускает код сверх лимита', async () => {
    await seedMember('alice', { invitesLeft: 0 });
    await assertFails(createInvite(as('alice'), 'alice'));
  });

  it('не выпускает код, не списав приглашение', async () => {
    await seedMember('alice');
    await assertFails(
      setDoc(doc(as('alice'), `invites/${CODE}`), {
        createdBy: 'alice',
        createdAt: serverTimestamp(),
        usedBy: null,
        usedAt: null,
      }),
    );
  });

  it('не выпускает код от чужого имени', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await assertFails(issueBatch(as('alice'), 'alice', CODE, { createdBy: 'bob' }));
  });

  it('не выпускает код неверного вида', async () => {
    await seedMember('alice');
    await assertFails(issueBatch(as('alice'), 'alice', 'abc'));
  });

  it('не перезаписывает чужой существующий код', async () => {
    await seedMember('alice');
    await seedInvite(CODE, 'bob');
    await assertFails(issueBatch(as('alice'), 'alice', CODE));
  });

  it('видит список только своих кодов', async () => {
    await seedMember('alice');
    await seedInvite(CODE, 'alice');
    await seedInvite(OTHER_CODE, 'bob');
    const mine = await assertSucceeds(myInvites(as('alice'), 'alice'));
    expect(mine.map((invite) => invite.code)).toEqual([CODE]);
  });

  it('не вступает второй раз по чужому коду', async () => {
    await seedMember('alice');
    await seedInvite(CODE, 'bob');
    await assertFails(joinBatch(as('alice'), 'alice', CODE));
  });

  it('не удаляет ни себя, ни коды', async () => {
    await seedMember('alice');
    await seedInvite(CODE, 'alice');
    await assertFails(deleteDoc(doc(as('alice'), 'members/alice')));
    await assertFails(deleteDoc(doc(as('alice'), `invites/${CODE}`)));
  });
});

describe('удалённый из клуба', () => {
  it('теряет доступ к данным участников', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore() as unknown as Firestore, 'members/bob'));
    });
    await assertFails(getDoc(doc(as('bob'), 'members/alice')));
    await assertFails(getDocs(collection(as('bob'), 'members')));
  });
});

/** Документ карты в альбоме, как его пишет приложение. */
function cardData(overrides: Record<string, unknown> = {}) {
  return { setId: 'sv03', count: 1, variant: 'holo', addedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides };
}

describe('альбом участника', () => {
  it('участник добавляет карты настоящей функцией приложения', async () => {
    await seedMember('alice');
    await assertSucceeds(
      addToCollection(
        as('alice'),
        'alice',
        [
          { cardId: 'sv03-125', setId: 'sv03', variant: 'holo' },
          { cardId: 'sv03-125', setId: 'sv03', variant: 'holo' },
          { cardId: 'sv03.5-006', setId: 'sv03.5' },
        ],
        new Map(),
      ),
    );
    expect(await readAsAdmin('members/alice/cards/sv03-125')).toMatchObject({ setId: 'sv03', count: 2, variant: 'holo' });
    expect(await readAsAdmin('members/alice/cards/sv03.5-006')).toMatchObject({ setId: 'sv03.5', count: 1 });
  });

  it('повторное добавление увеличивает счётчик', async () => {
    await seedMember('alice');
    await seed('members/alice/cards/sv03-125', { setId: 'sv03', count: 1, addedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    const owned = new Map<string, OwnedCard>([
      ['sv03-125', { cardId: 'sv03-125', setId: 'sv03', count: 1, addedAt: null, updatedAt: null }],
    ]);
    await assertSucceeds(addToCollection(as('alice'), 'alice', [{ cardId: 'sv03-125', setId: 'sv03' }], owned));
    expect(await readAsAdmin('members/alice/cards/sv03-125')).toMatchObject({ count: 2 });
  });

  it('альбомы видны участникам клуба, но не посторонним', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await seed('members/alice/cards/sv03-125', { setId: 'sv03', count: 1, addedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await assertSucceeds(getDocs(collection(as('bob'), 'members/alice/cards')));
    await assertFails(getDocs(collection(as('mallory'), 'members/alice/cards')));
    await assertFails(getDoc(doc(guest(), 'members/alice/cards/sv03-125')));
  });

  it('в чужой альбом писать нельзя', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await assertFails(setDoc(doc(as('bob'), 'members/alice/cards/sv03-125'), cardData()));
  });

  it('без членства свой альбом не завести', async () => {
    await assertFails(setDoc(doc(as('mallory'), 'members/mallory/cards/sv03-125'), cardData()));
  });

  it('проверяет количество, ID, вариант и лишние поля', async () => {
    await seedMember('alice');
    const card = (id: string) => doc(as('alice'), `members/alice/cards/${id}`);
    await assertFails(setDoc(card('sv03-125'), cardData({ count: 0 })));
    await assertFails(setDoc(card('sv03-125'), cardData({ count: 1000 })));
    await assertFails(setDoc(card('sv03-125'), cardData({ count: 1.5 })));
    await assertFails(setDoc(card('sv03-125'), cardData({ variant: 'gold' })));
    await assertFails(setDoc(card('sv03-125'), cardData({ price: 100 })));
    await assertFails(setDoc(card('sv03-125'), cardData({ setId: 'bad set!' })));
    await assertFails(setDoc(card('bad id!'), cardData()));
    await assertSucceeds(setDoc(card('sv03-125'), cardData({ variant: 'reverse' })));
  });

  it('хозяин меняет количество и удаляет карту, но не трогает дату добавления', async () => {
    await seedMember('alice');
    await seed('members/alice/cards/sv03-125', { setId: 'sv03', count: 1, addedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    const card = doc(as('alice'), 'members/alice/cards/sv03-125');
    await assertSucceeds(updateDoc(card, { count: 3, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(card, { addedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(card, { count: 3 }));
    await assertSucceeds(deleteDoc(card));
  });

  it('чужую карту удалить нельзя', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await seed('members/alice/cards/sv03-125', { setId: 'sv03', count: 1, addedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await assertFails(deleteDoc(doc(as('bob'), 'members/alice/cards/sv03-125')));
  });
});

describe('общий кэш цен', () => {
  const price = { cards: { 'sv03-125': { u: 4.88, e: 3.88, d: '2026-11-20' } } };

  it('участник читает и освежает цены сета и историю', async () => {
    await seedMember('alice');
    await assertSucceeds(setDoc(doc(as('alice'), 'prices/sv03'), price, { merge: true }));
    await assertSucceeds(
      setDoc(doc(as('alice'), 'prices/sv03/months/2026-11'), { 'sv03-125': { '20': { u: 4.88, e: 3.88 } } }, { merge: true }),
    );
    await assertSucceeds(getDoc(doc(as('alice'), 'prices/sv03')));
    await assertSucceeds(getDoc(doc(as('alice'), 'prices/sv03/months/2026-11')));
  });

  it('посторонний не читает и не пишет цены', async () => {
    await seed('prices/sv03', price);
    await assertFails(getDoc(doc(as('mallory'), 'prices/sv03')));
    await assertFails(setDoc(doc(as('mallory'), 'prices/sv03'), price, { merge: true }));
    await assertFails(getDoc(doc(guest(), 'prices/sv03')));
  });

  it('в документе цен только карты, а месяц записан как ГГГГ-ММ', async () => {
    await seedMember('alice');
    await assertFails(setDoc(doc(as('alice'), 'prices/sv03'), { ...price, owner: 'alice' }));
    await assertFails(setDoc(doc(as('alice'), 'prices/sv03'), { cards: 'cheap' }));
    await assertFails(setDoc(doc(as('alice'), 'prices/sv03/months/november'), { 'sv03-125': {} }));
  });

  it('цены не удаляются', async () => {
    await seedMember('alice');
    await seed('prices/sv03', price);
    await assertFails(deleteDoc(doc(as('alice'), 'prices/sv03')));
  });
});
