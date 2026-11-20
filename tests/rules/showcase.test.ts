import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addOne, addToCollection, removeOne } from '@/lib/collection';
import { clubMember, clubMembers, loadAlbum, type AlbumCache, type CachedAlbum } from '@/lib/friends';
import { STARTING_INVITES } from '@/lib/membership';
import { MAX_SHOWCASE, saveShowcase } from '@/lib/showcase';

// Витрина (members/{uid}.showcase), список участников и чтение альбома друга.
// Остальные правила проверяет tests/rules/firestore.test.ts.

const CODE = 'AB3D-7K2Q';

let env: RulesTestEnvironment;

// RULES_FILE позволяет прогнать тесты на изменённой копии правил: так проверяется, что тесты ловят дыры
const rulesFile = process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url);

// Запас по времени: если этот файл идёт первым, он платит за прогрев эмулятора
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

function seedCard(uid: string, docId: string, count = 1) {
  return seed(`members/${uid}/cards/${docId}`, {
    setId: docId.split('-')[0]!,
    count,
    lang: 'en',
    addedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

/** Витрина в обход клиента: так проверяются именно правила. */
const writeShowcase = (db: Firestore, uid: string, showcase: unknown, extra: Record<string, unknown> = {}) =>
  updateDoc(doc(db, 'members', uid), { showcase, ...extra });

const ids = (n: number) => Array.from({ length: n }, (_, i) => `sv03-${100 + i}`);

/** Кэш альбомов в памяти вместо IndexedDB: в Node её нет. */
function memoryCache(): AlbumCache & { saved: Map<string, CachedAlbum> } {
  const saved = new Map<string, CachedAlbum>();
  return {
    saved,
    get: async (uid) => saved.get(uid),
    put: async (uid, album) => {
      saved.set(uid, album);
    },
  };
}

describe('витрина участника', { timeout: 60_000 }, () => {
  it('хозяин выбирает витрину настоящей функцией приложения, друзья её видят', async () => {
    await seedMember('alice');
    await seedMember('bob');
    for (const id of ['sv03-125', 'sv03-126', 'sv03-127']) await seedCard('alice', id);
    const owned = new Map([['sv03-125', 1], ['sv03-126', 1], ['sv03-127', 1]]);

    // Карта, которой уже нет в альбоме, в запись не попадает
    const saved = await assertSucceeds(saveShowcase(as('alice'), 'alice', ['sv03-127', 'gone-1', 'sv03-125'], owned));
    expect(saved).toEqual(['sv03-127', 'sv03-125']);
    expect((await readAsAdmin('members/alice'))?.showcase).toEqual(['sv03-127', 'sv03-125']);

    const seen = await assertSucceeds(clubMember(as('bob'), 'alice'));
    expect(seen?.showcase).toEqual(['sv03-127', 'sv03-125']);
    const club = await assertSucceeds(clubMembers(as('bob')));
    expect(club.map((member) => member.uid)).toEqual(['alice', 'bob']);

    // Очистить витрину тоже можно
    await assertSucceeds(saveShowcase(as('alice'), 'alice', [], owned));
    expect((await readAsAdmin('members/alice'))?.showcase).toEqual([]);
  });

  it('от пустой до шести карт, седьмая — нет', async () => {
    await seedMember('alice');
    const me = as('alice');
    await assertSucceeds(writeShowcase(me, 'alice', []));
    await assertSucceeds(writeShowcase(me, 'alice', ids(1)));
    await assertSucceeds(writeShowcase(me, 'alice', ids(MAX_SHOWCASE)));
    await assertSucceeds(writeShowcase(me, 'alice', ['SV2a-094_ja', 'x-ja-MBG-3', 'sv03.5-001']));
    await assertFails(writeShowcase(me, 'alice', ids(MAX_SHOWCASE + 1)));
    await assertFails(writeShowcase(me, 'alice', ids(20)));
  });

  it('только список строк-ID, и каждый из шести элементов проверяется', async () => {
    await seedMember('alice');
    const me = as('alice');
    await assertFails(writeShowcase(me, 'alice', 'sv03-125'));
    await assertFails(writeShowcase(me, 'alice', { 0: 'sv03-125' }));
    await assertFails(writeShowcase(me, 'alice', null));
    await assertFails(writeShowcase(me, 'alice', [1]));
    await assertFails(writeShowcase(me, 'alice', [null]));
    await assertFails(writeShowcase(me, 'alice', ['']));
    await assertFails(writeShowcase(me, 'alice', ['../cards/x']));
    await assertFails(writeShowcase(me, 'alice', ['с пробелом']));
    await assertFails(writeShowcase(me, 'alice', ['x'.repeat(61)]));
    await assertFails(writeShowcase(me, 'alice', [{ id: 'sv03-125' }]));
    for (let bad = 0; bad < MAX_SHOWCASE; bad++) {
      const list: unknown[] = ids(MAX_SHOWCASE);
      list[bad] = { id: 'sv03-125' };
      await assertFails(writeShowcase(me, 'alice', list));
    }
  });

  it('одна карта — один раз', async () => {
    await seedMember('alice');
    await assertFails(writeShowcase(as('alice'), 'alice', ['sv03-125', 'sv03-125']));
    await assertFails(writeShowcase(as('alice'), 'alice', ['sv03-125', 'sv03-126', 'sv03-125']));
  });

  it('чужую витрину не поменять ни участнику, ни постороннему, ни гостю', async () => {
    await seedMember('alice', { showcase: ['sv03-125'] });
    await seedMember('bob');
    await assertFails(writeShowcase(as('bob'), 'alice', ['sv03-126']));
    await assertFails(writeShowcase(as('carol'), 'alice', ['sv03-126']));
    await assertFails(writeShowcase(guest(), 'alice', ['sv03-126']));
    // Завести себе документ участника через витрину тоже нельзя
    await assertFails(setDoc(doc(as('carol'), 'members/carol'), { showcase: [] }));
    expect((await readAsAdmin('members/alice'))?.showcase).toEqual(['sv03-125']);
  });

  it('вместе с витриной не поменять другие поля участника', async () => {
    await seedMember('alice');
    const me = as('alice');
    await assertFails(writeShowcase(me, 'alice', ids(2), { invitesLeft: 10 }));
    await assertFails(writeShowcase(me, 'alice', ids(2), { inviteCode: 'ZX9C-4M2N' }));
    await assertFails(writeShowcase(me, 'alice', ids(2), { invitedBy: 'bob' }));
    await assertFails(writeShowcase(me, 'alice', ids(2), { joinedAt: serverTimestamp() }));
    await assertFails(writeShowcase(me, 'alice', ids(2), { lastInvite: 'ZX9C-4M2N' }));
    await assertFails(writeShowcase(me, 'alice', ids(2), { admin: true }));
    const stored = await readAsAdmin('members/alice');
    expect(stored?.invitesLeft).toBe(STARTING_INVITES);
    expect(stored?.showcase).toBeUndefined();
  });

  it('при вступлении витрину не записать: новичок выбирает её потом', async () => {
    await seedMember('alice');
    await seed(`invites/${CODE}`, { createdBy: 'alice', createdAt: Timestamp.now(), usedBy: null, usedAt: null });
    const join = (extra: Record<string, unknown>) => {
      const db = as('newbie');
      const batch = writeBatch(db);
      batch.update(doc(db, 'invites', CODE), { usedBy: 'newbie', usedAt: serverTimestamp() });
      batch.set(doc(db, 'members', 'newbie'), {
        displayName: 'Новичок',
        photoURL: null,
        joinedAt: serverTimestamp(),
        invitedBy: 'alice',
        inviteCode: CODE,
        invitesLeft: STARTING_INVITES,
        lastInvite: null,
        ...extra,
      });
      return batch.commit();
    };
    await assertFails(join({ showcase: ['sv03-125'] }));
    await assertSucceeds(join({}));
    await assertSucceeds(writeShowcase(as('newbie'), 'newbie', ['sv03-125']));
  });

  it('витрину и участников не видит тот, кого нет в клубе', async () => {
    await seedMember('alice', { showcase: ['sv03-125'] });
    await assertFails(getDoc(doc(as('carol'), 'members/alice')));
    await assertFails(clubMember(as('carol'), 'alice'));
    await assertFails(clubMembers(as('carol')));
    await assertFails(clubMembers(guest()));
  });
});

describe('альбом друга', { timeout: 60_000 }, () => {
  it('читается целиком один раз, потом дочитываются только изменения — настоящими функциями приложения', async () => {
    await seedMember('alice');
    await seedMember('bob');
    const alice = as('alice');
    await addToCollection(
      alice,
      'alice',
      [
        { docId: 'sv03-125', setId: 'sv03', lang: 'en' },
        { docId: 'sv03-126', setId: 'sv03', lang: 'en', variant: 'holo' },
      ],
      new Map(),
    );

    const cache = memoryCache();
    const first = await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 1_000));
    expect(first.map((card) => card.docId).sort()).toEqual(['sv03-125', 'sv03-126']);
    expect(cache.saved.get('alice')?.fullAt).toBe(1_000);

    // Новая карта и ещё одна копия: дочитывание без полного чтения
    await addToCollection(alice, 'alice', [{ docId: 'SV2a-094_ja', setId: 'SV2a', lang: 'ja' }], new Map());
    await addOne(alice, 'alice', 'sv03-125');
    const second = await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 2_000));
    expect(cache.saved.get('alice')?.fullAt).toBe(1_000);
    expect(second.map((card) => card.docId).sort()).toEqual(['SV2a-094_ja', 'sv03-125', 'sv03-126']);
    expect(second.find((card) => card.docId === 'sv03-125')?.count).toBe(2);
    expect(second.find((card) => card.docId === 'SV2a-094_ja')?.catalog).toBe('ja');
    expect(second.find((card) => card.docId === 'sv03-126')?.variant).toBe('holo');
    expect(second.every((card) => card.addedAt instanceof Timestamp)).toBe(true);

    // Удалённую карту дочитывание не видит, её выдаёт счётчик — и альбом читается заново
    await removeOne(alice, 'alice', { docId: 'sv03-126', count: 1 });
    const third = await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 3_000));
    expect(cache.saved.get('alice')?.fullAt).toBe(3_000);
    expect(third.map((card) => card.docId).sort()).toEqual(['SV2a-094_ja', 'sv03-125']);

    // Ничего не менялось: тот же альбом из кэша
    const fourth = await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 4_000));
    expect(cache.saved.get('alice')?.fullAt).toBe(3_000);
    expect(fourth.map((card) => card.docId).sort()).toEqual(['SV2a-094_ja', 'sv03-125']);
  });

  it('пустой альбом читается и дочитывается', async () => {
    await seedMember('alice');
    await seedMember('bob');
    const cache = memoryCache();
    expect(await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 1_000))).toEqual([]);
    await addToCollection(as('alice'), 'alice', [{ docId: 'sv03-125', setId: 'sv03', lang: 'en' }], new Map());
    const next = await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 2_000));
    expect(next.map((card) => card.docId)).toEqual(['sv03-125']);
  });

  it('посторонний не читает альбом даже с кэшем в браузере', async () => {
    await seedMember('alice');
    await seedMember('bob');
    await seedCard('alice', 'sv03-125');
    const cache = memoryCache();
    await assertSucceeds(loadAlbum(as('bob'), 'alice', cache, 1_000));
    await assertFails(loadAlbum(as('carol'), 'alice', cache, 2_000));
    await assertFails(loadAlbum(guest(), 'alice', memoryCache(), 2_000));
  });
});
