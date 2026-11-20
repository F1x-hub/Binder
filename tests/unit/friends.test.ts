import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { byName, cardsOfAlbum, clubMemberFrom, isCachedAlbum, joinedLabel, mergeAlbum, type CachedAlbum } from '@/lib/friends';

describe('clubMemberFrom', () => {
  it('берёт имя, фото, дату и витрину из документа участника', () => {
    const joinedAt = Timestamp.fromDate(new Date(2026, 7, 14));
    const member = clubMemberFrom('nika', {
      displayName: '  Ника ',
      photoURL: 'https://example.com/n.png',
      joinedAt,
      invitesLeft: 3,
      showcase: ['sv03-125', 5],
    });
    expect(member).toEqual({
      uid: 'nika',
      displayName: 'Ника',
      photoURL: 'https://example.com/n.png',
      joinedAt,
      showcase: ['sv03-125'],
    });
  });

  it('без имени — «Участник», без даты и фото — null', () => {
    expect(clubMemberFrom('x', { displayName: ' ', joinedAt: null })).toMatchObject({
      displayName: 'Участник',
      photoURL: null,
      joinedAt: null,
      showcase: [],
    });
  });
});

describe('joinedLabel', () => {
  const now = new Date(2026, 10, 21);
  const at = (year: number, month: number) => Timestamp.fromDate(new Date(year, month, 10));

  it('месяц в родительном падеже, год — только если не этот', () => {
    expect(joinedLabel(at(2026, 7), now)).toBe('в клубе с августа');
    expect(joinedLabel(at(2026, 10), now)).toBe('в клубе с ноября');
    expect(joinedLabel(at(2025, 4), now)).toBe('в клубе с мая 2025');
  });

  it('без даты подписи нет', () => {
    expect(joinedLabel(null, now)).toBeNull();
  });
});

describe('byName', () => {
  it('сортирует по-русски, без учёта регистра', () => {
    const names = ['яна', 'Борис', 'алиса', 'Ёжик', 'Ева'].map((displayName) => ({ displayName }));
    expect(names.sort(byName).map((item) => item.displayName)).toEqual(['алиса', 'Борис', 'Ева', 'Ёжик', 'яна']);
  });
});

describe('альбом друга в кэше', () => {
  const stamp = (seconds: number, nanoseconds = 0) => new Timestamp(seconds, nanoseconds);
  const card = (count: number, updated: Timestamp) => ({ setId: 'sv03', count, lang: 'en', addedAt: stamp(100), updatedAt: updated });

  it('дочитанные карты ложатся поверх кэша, отметка — самая поздняя', () => {
    const empty: CachedAlbum = { fullAt: 1, synced: [0, 0], cards: {} };
    const first = mergeAlbum(empty, [
      { id: 'sv03-125', data: card(1, stamp(200, 5)) },
      { id: 'sv03-126', data: card(1, stamp(200, 9)) },
    ]);
    expect(first.synced).toEqual([200, 9]);
    expect(empty.cards).toEqual({});

    const second = mergeAlbum(first, [{ id: 'sv03-125', data: card(3, stamp(300)) }]);
    expect(second.synced).toEqual([300, 0]);
    expect(Object.keys(second.cards).sort()).toEqual(['sv03-125', 'sv03-126']);
    expect(first.cards['sv03-125']?.count).toBe(1);

    const cards = cardsOfAlbum(second);
    const updated = cards.find((item) => item.docId === 'sv03-125');
    expect(updated?.count).toBe(3);
    expect(updated?.cardId).toBe('sv03-125');
    expect(updated?.updatedAt?.isEqual(stamp(300))).toBe(true);
    expect(updated?.addedAt?.isEqual(stamp(100))).toBe(true);
  });

  it('битый или чужой кэш не принимается: тогда альбом читается целиком', () => {
    const good = mergeAlbum({ fullAt: 1, synced: [0, 0], cards: {} }, [{ id: 'sv03-125', data: card(1, stamp(5)) }]);
    expect(isCachedAlbum(good)).toBe(true);
    expect(isCachedAlbum({ fullAt: 1, synced: [0, 0], cards: {} })).toBe(true);
    expect(isCachedAlbum(undefined)).toBe(false);
    expect(isCachedAlbum({ fullAt: 1, cards: {} })).toBe(false);
    expect(isCachedAlbum({ fullAt: 1, synced: { seconds: 1 }, cards: {} })).toBe(false);
    expect(isCachedAlbum({ fullAt: '1', synced: [0, 0], cards: {} })).toBe(false);
    expect(isCachedAlbum({ fullAt: 1, synced: [0, 0], cards: { a: { updatedAt: { seconds: 1, nanoseconds: 0 }, addedAt: null } } })).toBe(false);
  });

  it('карта из кэша та же, что из Firestore: язык, каталог и напечатанное', () => {
    const album = mergeAlbum({ fullAt: 1, synced: [0, 0], cards: {} }, [
      { id: 'SV2a-094_ja', data: { setId: 'SV2a', count: 1, lang: 'ja', addedAt: stamp(1), updatedAt: stamp(1) } },
      {
        id: 'x-ja-MBG-3',
        data: {
          setId: 'MBG',
          count: 2,
          lang: 'ja',
          printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
          addedAt: stamp(1),
          updatedAt: stamp(2),
        },
      },
    ]);
    const [ja, custom] = cardsOfAlbum(album).sort((a, b) => a.docId.localeCompare(b.docId));
    expect(ja).toMatchObject({ catalog: 'ja', cardId: 'SV2a-094', lang: 'ja' });
    expect(custom).toMatchObject({ catalog: null, cardId: null, printed: { englishName: 'Mega Gengar ex' } });
  });
});
