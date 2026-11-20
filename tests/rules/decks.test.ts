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
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDeck, deckFromDoc, deleteDeck, renameDeck, setDeckCards } from '@/lib/decks';

/**
 * Правила колод members/{uid}/decks/{deckId}. Общие хелперы повторены из firestore.test.ts:
 * файлы гоняются по очереди (fileParallelism: false), у каждого своё тестовое окружение.
 */
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

function seedMember(uid: string) {
  return seed(`members/${uid}`, {
    displayName: uid,
    photoURL: null,
    joinedAt: Timestamp.now(),
    invitedBy: null,
    inviteCode: null,
    invitesLeft: 3,
    lastInvite: null,
  });
}

const DECK = 'deck1';

function seedDeck(uid: string, id = DECK, cards: Record<string, number> = { 'sv03-4': 4 }) {
  return seed(`members/${uid}/decks/${id}`, { name: 'Огненный шторм', cards, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
}

/** Запись колоды в обход клиента: так проверяются именно правила. */
function writeDeck(db: Firestore, uid: string, id: string, data: Record<string, unknown> = {}) {
  return setDoc(doc(db, 'members', uid, 'decks', id), {
    name: 'Огненный шторм',
    cards: { 'sv03-4': 4, 'sve-002': 12 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...data,
  });
}

/** 60 разных карт по одной копии. */
const manyCards = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, index) => [`sv03-${index + 1}`, 1]));

describe('колоды: чтение', () => {
  beforeEach(async () => {
    await seedMember('alice');
    await seedMember('bob');
    await seedDeck('alice');
  });

  it('участники видят колоды друг друга', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), `members/alice/decks/${DECK}`)));
    await assertSucceeds(getDocs(collection(as('bob'), 'members/alice/decks')));
    await assertSucceeds(getDocs(collection(as('alice'), 'members/alice/decks')));
  });

  it('гость и вошедший без членства не видят колоды', async () => {
    await assertFails(getDoc(doc(guest(), `members/alice/decks/${DECK}`)));
    await assertFails(getDocs(collection(as('mallory'), 'members/alice/decks')));
    await assertFails(getDoc(doc(as('mallory'), `members/alice/decks/${DECK}`)));
  });
});

describe('колоды: создание', () => {
  beforeEach(async () => {
    await seedMember('alice');
    await seedMember('bob');
  });

  it('createDeck: хозяин создаёт пустую колоду', async () => {
    const id = await assertSucceeds(createDeck(as('alice'), 'alice', '  Огненный   шторм '));
    const stored = await readAsAdmin(`members/alice/decks/${id}`);
    expect(stored?.name).toBe('Огненный шторм');
    expect(stored?.cards).toEqual({});
    expect(deckFromDoc(id, stored!)).toMatchObject({ id, name: 'Огненный шторм', cards: {} });
  });

  it('полная колода с базовой энергией больше четырёх копий', async () => {
    await assertSucceeds(writeDeck(as('alice'), 'alice', DECK, { cards: { 'sv03-4': 4, 'sve-002': 60 } }));
  });

  it('60 разных карт можно, 61 — нет', async () => {
    await assertSucceeds(writeDeck(as('alice'), 'alice', 'd60', { cards: manyCards(60) }));
    await assertFails(writeDeck(as('alice'), 'alice', 'd61', { cards: manyCards(61) }));
  });

  it('нельзя создать колоду в чужом профиле', async () => {
    await assertFails(writeDeck(as('bob'), 'alice', DECK));
    await assertFails(createDeck(as('bob'), 'alice', 'Чужая'));
  });

  it('нельзя без членства в клубе, даже себе', async () => {
    await assertFails(writeDeck(as('mallory'), 'mallory', DECK));
    await assertFails(writeDeck(guest(), 'alice', DECK));
  });

  it('проверяется имя', async () => {
    await assertFails(writeDeck(as('alice'), 'alice', DECK, { name: '' }));
    await assertFails(writeDeck(as('alice'), 'alice', DECK, { name: 'x'.repeat(61) }));
    await assertFails(writeDeck(as('alice'), 'alice', DECK, { name: 42 }));
    await assertFails(writeDeck(as('alice'), 'alice', DECK, { name: null }));
    await assertSucceeds(writeDeck(as('alice'), 'alice', DECK, { name: 'x'.repeat(60) }));
  });

  it('проверяется число копий у каждой записи', async () => {
    await assertFails(writeDeck(as('alice'), 'alice', 'a', { cards: { 'sv03-4': 0 } }));
    await assertFails(writeDeck(as('alice'), 'alice', 'b', { cards: { 'sv03-4': 61 } }));
    await assertFails(writeDeck(as('alice'), 'alice', 'c', { cards: { 'sv03-4': -1 } }));
    await assertFails(writeDeck(as('alice'), 'alice', 'd', { cards: { 'sv03-4': 2.5 } }));
    await assertFails(writeDeck(as('alice'), 'alice', 'e', { cards: { 'sv03-4': '4' } }));
    await assertFails(writeDeck(as('alice'), 'alice', 'f', { cards: { 'sv03-4': 4, 'sv03-5': 0 } }));
    await assertFails(writeDeck(as('alice'), 'alice', 'g', { cards: { 'sv03-4': { count: 4 } } }));
  });

  it('cards — карта, а не список или строка', async () => {
    await assertFails(writeDeck(as('alice'), 'alice', 'a', { cards: [4, 4] }));
    await assertFails(writeDeck(as('alice'), 'alice', 'b', { cards: 'sv03-4' }));
    await assertFails(writeDeck(as('alice'), 'alice', 'c', { cards: null }));
  });

  it('лишние и недостающие поля, чужое время', async () => {
    await assertFails(writeDeck(as('alice'), 'alice', 'a', { ready: true }));
    await assertFails(
      setDoc(doc(as('alice'), 'members/alice/decks/b'), { name: 'Колода', cards: {}, createdAt: serverTimestamp() }),
    );
    await assertFails(writeDeck(as('alice'), 'alice', 'c', { createdAt: Timestamp.fromMillis(0) }));
    await assertFails(writeDeck(as('alice'), 'alice', 'd', { updatedAt: Timestamp.fromMillis(0) }));
  });

  it('ID колоды — без пробелов и не длиннее 40 символов', async () => {
    await assertFails(writeDeck(as('alice'), 'alice', 'deck one'));
    await assertFails(writeDeck(as('alice'), 'alice', 'd'.repeat(41)));
    await assertSucceeds(writeDeck(as('alice'), 'alice', 'd'.repeat(40)));
  });
});

describe('колоды: изменение и удаление', () => {
  beforeEach(async () => {
    await seedMember('alice');
    await seedMember('bob');
    await seedDeck('alice');
  });

  it('renameDeck и setDeckCards: хозяин меняет имя и состав, ID с точкой не ломают карту', async () => {
    await assertSucceeds(renameDeck(as('alice'), 'alice', DECK, ' Вода  и лёд '));
    await assertSucceeds(setDeckCards(as('alice'), 'alice', DECK, { 'sv03.5-006': 2, 'x-ja-MBG-3': 1, 'sve-002': 14 }));
    const stored = await readAsAdmin(`members/alice/decks/${DECK}`);
    expect(stored?.name).toBe('Вода и лёд');
    expect(stored?.cards).toEqual({ 'sv03.5-006': 2, 'x-ja-MBG-3': 1, 'sve-002': 14 });
  });

  it('пустой состав — можно', async () => {
    await assertSucceeds(setDeckCards(as('alice'), 'alice', DECK, {}));
  });

  it('чужую колоду не изменить и не удалить', async () => {
    await assertFails(renameDeck(as('bob'), 'alice', DECK, 'Моя теперь'));
    await assertFails(setDeckCards(as('bob'), 'alice', DECK, {}));
    await assertFails(deleteDeck(as('bob'), 'alice', DECK));
    await assertFails(deleteDoc(doc(as('mallory'), `members/alice/decks/${DECK}`)));
  });

  it('при изменении проверяется форма', async () => {
    const ref = doc(as('alice'), `members/alice/decks/${DECK}`);
    await assertFails(updateDoc(ref, { name: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { cards: { 'sv03-4': 0 }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { cards: manyCards(61), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { ready: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { name: 'Без времени' }));
    await assertFails(updateDoc(ref, { name: 'Старое время', updatedAt: Timestamp.fromMillis(0) }));
  });

  it('deleteDeck: хозяин удаляет свою колоду', async () => {
    await assertSucceeds(deleteDeck(as('alice'), 'alice', DECK));
    expect(await readAsAdmin(`members/alice/decks/${DECK}`)).toBeUndefined();
  });

  it('удалённый из клуба не меняет свои колоды', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore() as unknown as Firestore, 'members/alice'));
    });
    await assertFails(renameDeck(as('alice'), 'alice', DECK, 'После удаления'));
    await assertFails(deleteDeck(as('alice'), 'alice', DECK));
    await assertFails(getDoc(doc(as('alice'), `members/alice/decks/${DECK}`)));
  });
});
