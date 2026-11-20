import type { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import {
  cardSuggestions,
  isTypingTarget,
  memberSuggestions,
  moveActive,
  resultsAnnouncement,
  suggestionItems,
} from '@/lib/header-search';
import { DEFAULT_LIBRARY_STATE, NO_FILTERS, matchesQuery, withSearch, type AlbumCard } from '@/lib/library-filters';

const at = (millis: number) => ({ toMillis: () => millis }) as unknown as Timestamp;

function card(docId: string, extra: Partial<AlbumCard> = {}): AlbumCard {
  return {
    docId,
    cardId: docId,
    catalog: 'en',
    setId: 'sv08',
    lang: 'en',
    count: 1,
    printed: null,
    addedAt: at(1000),
    name: docId,
    englishName: null,
    localId: '1',
    setName: 'Surging Sparks',
    printedTotal: 191,
    releaseDate: '2024-11-08',
    price: null,
    ...extra,
  };
}

const pikachuEx = card('sv08-057', { name: 'Pikachu ex', localId: '057' });
const pikachuSir = card('sv08-238', { name: 'Pikachu ex', localId: '238' });
const zebstrika = card('sv08-063', { name: 'Zebstrika', localId: '063' });
const raichu = card('sv03.5-026', {
  setId: 'sv03.5',
  name: 'Raichu',
  localId: '026',
  setName: '151',
  releaseDate: '2023-09-22',
});
const pikachu151 = card('sv03.5-025', {
  setId: 'sv03.5',
  name: 'Pikachu',
  localId: '025',
  setName: '151',
  releaseDate: '2023-09-22',
});
const mew151 = card('sv03.5-151', { setId: 'sv03.5', name: 'Mew ex', localId: '151', setName: '151', releaseDate: '2023-09-22' });
const gengarJa = card('SV2a-094_ja', {
  cardId: 'SV2a-094',
  catalog: 'ja',
  setId: 'SV2a',
  lang: 'ja',
  name: 'ゲンガー',
  englishName: 'Gengar',
  localId: '094',
  setName: 'ポケモンカード151',
  releaseDate: '2023-06-16',
});
const megaGengar = card('x-ja-MBG-3', {
  cardId: null,
  catalog: null,
  setId: 'MBG',
  lang: 'ja',
  name: 'メガゲンガーex',
  englishName: 'Mega Gengar ex',
  localId: '003',
  setName: 'MBG',
  printedTotal: 21,
  releaseDate: null,
  printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
});

const album = [zebstrika, pikachuSir, raichu, pikachuEx, pikachu151, mew151, gengarJa, megaGengar];
const ids = (cards: AlbumCard[]) => cards.map((item) => item.docId);

describe('поиск по сету', () => {
  it('находит по имени и коду сета', () => {
    expect(matchesQuery(zebstrika, 'surging')).toBe(true);
    expect(matchesQuery(zebstrika, 'sparks zeb')).toBe(true);
    expect(matchesQuery(gengarJa, 'sv2a')).toBe(true);
    expect(matchesQuery(megaGengar, 'mbg')).toBe(true);
    expect(matchesQuery(raichu, 'surging')).toBe(false);
  });

  it('цифры — это номер карты, а не сет «151»', () => {
    expect(ids(album.filter((item) => matchesQuery(item, '151')))).toEqual(['sv03.5-151']);
    expect(matchesQuery(pikachu151, '#151')).toBe(false);
  });
});

describe('подсказки карт', () => {
  it('сначала имя с начала, потом слово имени, потом остальное; внутри — порядок биндера', () => {
    const found = cardSuggestions(album, 'pika');
    // Свежий сет раньше старого, внутри сета — по номеру
    expect(ids(found.cards)).toEqual(['sv08-057', 'sv08-238', 'sv03.5-025']);
    expect(found.total).toBe(3);
    // «gengar»: у «Gengar» имя начинается с запроса, у «Mega Gengar ex» — второе слово
    expect(ids(cardSuggestions(album, 'gengar').cards)).toEqual(['SV2a-094_ja', 'x-ja-MBG-3']);
  });

  it('совпадение по сету ниже совпадения по имени', () => {
    const found = cardSuggestions(album, 'surging');
    expect(found.total).toBe(3);
    expect(ids(cardSuggestions([...album, card('sv06-001', { name: 'Surging Bolt' })], 'surging').cards)[0]).toBe('sv06-001');
  });

  it('предел подсказок и общее число', () => {
    const many = Array.from({ length: 9 }, (_, index) => card(`sv08-${100 + index}`, { name: 'Pikachu', localId: String(100 + index) }));
    const found = cardSuggestions(many, 'pikachu', 6);
    expect(found.cards).toHaveLength(6);
    expect(found.total).toBe(9);
  });

  it('пустой запрос — пусто', () => {
    expect(cardSuggestions(album, '   ')).toEqual({ cards: [], total: 0 });
  });

  it('по номеру и по японскому имени', () => {
    expect(ids(cardSuggestions(album, '94').cards)).toEqual(['SV2a-094_ja']);
    expect(ids(cardSuggestions(album, 'ゲンガー').cards)).toEqual(['SV2a-094_ja', 'x-ja-MBG-3']);
  });
});

const members = [
  { uid: 'me', displayName: 'Алекс' },
  { uid: 'nika', displayName: 'Ника' },
  { uid: 'nikita', displayName: 'Никита Орлов' },
  { uid: 'veronika', displayName: 'Вероника' },
  { uid: 'mark', displayName: 'Марк' },
];

describe('подсказки участников', () => {
  it('без регистра; начало имени раньше середины; себя нет', () => {
    const found = memberSuggestions(members, 'НИК', { self: 'me' });
    expect(found.members.map((member) => member.uid)).toEqual(['nika', 'nikita', 'veronika']);
    expect(memberSuggestions(members, 'алекс', { self: 'me' }).total).toBe(0);
  });

  it('второе слово имени и все слова запроса', () => {
    expect(memberSuggestions(members, 'орл').members.map((member) => member.uid)).toEqual(['nikita']);
    expect(memberSuggestions(members, 'ник орл').members.map((member) => member.uid)).toEqual(['nikita']);
    expect(memberSuggestions(members, 'ник марк').total).toBe(0);
  });

  it('предел подсказок', () => {
    const found = memberSuggestions(members, 'а', { limit: 2 });
    expect(found.members).toHaveLength(2);
    // «а» есть во всех пяти именах; себя здесь не исключали
    expect(found.total).toBe(5);
  });
});

describe('список подсказок', () => {
  it('карты, «все в альбоме», если видны не все, потом участники', () => {
    const items = suggestionItems({ cards: [pikachuEx], total: 3 }, { members: [members[1]!] });
    expect(items.map((item) => item.key)).toEqual(['card:sv08-057', 'all', 'member:nika']);
    expect(suggestionItems({ cards: [pikachuEx], total: 1 }, { members: [] }).map((item) => item.kind)).toEqual(['card']);
  });

  it('стрелки ходят по кругу', () => {
    expect(moveActive(-1, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(2, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(-1, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(0, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(1, 3, 'ArrowUp')).toBe(0);
    expect(moveActive(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('строка для диктора', () => {
    expect(resultsAnnouncement(0, 0)).toBe('Ничего не нашлось');
    expect(resultsAnnouncement(3, 0)).toMatch(/^Нашлось карточек: 3\./);
    expect(resultsAnnouncement(2, 1)).toMatch(/^Нашлось карточек: 2, участников: 1\./);
  });
});

describe('горячая клавиша «/»', () => {
  it('не перехватывается в полях ввода', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('работает на кнопках, флажках и просто на странице', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('поиск из шапки в альбоме', () => {
  it('запрос в поле поиска, остальные фильтры сброшены, первый разворот; вид и сортировка остаются', () => {
    const before = {
      ...DEFAULT_LIBRARY_STATE,
      view: 'list' as const,
      sort: 'price-desc' as const,
      spread: 4,
      filters: { ...NO_FILTERS, set: 'en:sv08', price: 'priced' as const, query: 'old' },
    };
    expect(withSearch(before, '  pikachu ex ')).toEqual({
      view: 'list',
      sort: 'price-desc',
      spread: 0,
      filters: { ...NO_FILTERS, query: 'pikachu ex' },
    });
    expect(withSearch(before, 'x'.repeat(200)).filters.query).toHaveLength(80);
  });
});
