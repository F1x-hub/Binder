import type { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { energy } from '@/lib/card-facts';
import {
  NO_FILTERS,
  activeFilterCount,
  cardPockets,
  checklistPockets,
  facetFromFacts,
  filterCards,
  filterChoices,
  groupBySet,
  matchesQuery,
  mostValuable,
  parseLibraryState,
  setCountLabel,
  setProgress,
  sortCards,
  spreadAt,
  spreadCount,
  spreadLabel,
  type AlbumCard,
  type CardFacet,
  type LibraryFilters,
} from '@/lib/library-filters';

const at = (millis: number) => ({ toMillis: () => millis }) as unknown as Timestamp;

function card(docId: string, extra: Partial<AlbumCard> = {}): AlbumCard {
  return {
    docId,
    cardId: docId,
    catalog: 'en',
    setId: 'sv03',
    lang: 'en',
    count: 1,
    printed: null,
    addedAt: at(1000),
    name: docId,
    englishName: null,
    localId: '1',
    setName: 'Obsidian Flames',
    printedTotal: 197,
    releaseDate: '2023-08-11',
    price: null,
    ...extra,
  };
}

const charizard = card('sv03-125', {
  name: 'Charizard ex',
  localId: '125',
  variant: 'holo',
  price: { u: 24.8, e: 20 },
  addedAt: at(3000),
});
const pidgey = card('sv03-162', { name: 'Pidgey', localId: '162', price: { u: 0.2, e: 0.1 }, condition: 'LP', addedAt: at(1000) });
const dracaufeu = card('sv03-125_fr', {
  cardId: 'sv03-125',
  lang: 'fr',
  name: 'Charizard ex',
  localId: '125',
  variant: 'reverse',
  price: { u: 24.8, e: 20 },
  addedAt: null,
});
const gengarJa = card('SV2a-094_ja', {
  cardId: 'SV2a-094',
  catalog: 'ja',
  setId: 'SV2a',
  lang: 'ja',
  name: 'ゲンガー',
  englishName: 'Gengar',
  localId: '094',
  setName: 'ポケモンカード151',
  printedTotal: 165,
  releaseDate: '2023-06-16',
  price: { u: null, e: 1.5 },
  addedAt: at(2000),
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
  addedAt: at(500),
});
const pokemon = card('sv03-200', { name: 'Pokémon Catcher', localId: '200', price: { u: 1, e: null } });

const album = [pidgey, charizard, gengarJa, megaGengar, dracaufeu, pokemon];

const facets = new Map<string, CardFacet>([
  ['sv03-125', { types: ['fire'], rarity: 'Double Rare' }],
  ['sv03-125_fr', { types: ['fire'], rarity: 'Double Rare' }],
  ['sv03-162', { types: ['colorless'], rarity: 'Common' }],
  ['SV2a-094_ja', { types: ['psychic'], rarity: 'Rare' }],
  ['sv03-200', { types: ['trainer'], rarity: 'Uncommon' }],
]);

const ids = (cards: AlbumCard[]) => cards.map((item) => item.docId);
const only = (filters: Partial<LibraryFilters>) => ids(filterCards(album, facets, { ...NO_FILTERS, ...filters }));

describe('поиск по имени', () => {
  it('находит по английскому имени японской карты и по напечатанному', () => {
    expect(matchesQuery(gengarJa, 'gengar')).toBe(true);
    expect(matchesQuery(gengarJa, 'ゲンガー')).toBe(true);
    expect(matchesQuery(megaGengar, 'mega gengar')).toBe(true);
    expect(matchesQuery(megaGengar, 'メガゲンガー')).toBe(true);
  });

  it('без регистра и диакритики, все слова запроса', () => {
    expect(matchesQuery(pokemon, 'POKEMON catcher')).toBe(true);
    expect(matchesQuery(pokemon, 'pokémon')).toBe(true);
    expect(matchesQuery(charizard, 'charizard vmax')).toBe(false);
  });

  it('полуширинная кана равна полной', () => {
    expect(matchesQuery(gengarJa, 'ｹﾞﾝｶﾞｰ')).toBe(true);
  });

  it('цифры сверяются с номером без ведущих нулей', () => {
    expect(matchesQuery(gengarJa, '94')).toBe(true);
    expect(matchesQuery(gengarJa, '#094')).toBe(true);
    expect(matchesQuery(megaGengar, '3/21')).toBe(true);
    expect(matchesQuery(charizard, '12')).toBe(false);
  });

  it('пустой запрос пропускает всё', () => {
    expect(matchesQuery(charizard, '   ')).toBe(true);
  });
});

describe('фильтры', () => {
  it('сет — по группе альбома: английская и французская копии в одной', () => {
    expect(only({ set: 'en:sv03' })).toEqual(['sv03-162', 'sv03-125', 'sv03-125_fr', 'sv03-200']);
    expect(only({ set: 'x:ja:MBG' })).toEqual(['x-ja-MBG-3']);
  });

  it('язык', () => {
    expect(only({ lang: 'ja' })).toEqual(['SV2a-094_ja', 'x-ja-MBG-3']);
  });

  it('печать: карта без поля считается обычной', () => {
    expect(only({ finish: 'holo' })).toEqual(['sv03-125']);
    expect(only({ finish: 'reverse' })).toEqual(['sv03-125_fr']);
    expect(only({ finish: 'normal' })).toEqual(['sv03-162', 'SV2a-094_ja', 'x-ja-MBG-3', 'sv03-200']);
  });

  it('состояние: карта без поля — Near Mint', () => {
    expect(only({ condition: 'LP' })).toEqual(['sv03-162']);
    expect(only({ condition: 'NM' })).not.toContain('sv03-162');
  });

  it('цена: евро тоже цена, карта вне базы — без цены', () => {
    expect(only({ price: 'unpriced' })).toEqual(['x-ja-MBG-3']);
    expect(only({ price: 'priced' })).toHaveLength(5);
  });

  it('тип и редкость — по карточке базы; пока она не загружена, карта не подходит', () => {
    expect(only({ type: 'fire' })).toEqual(['sv03-125', 'sv03-125_fr']);
    expect(only({ type: 'trainer' })).toEqual(['sv03-200']);
    expect(only({ rarity: 'Rare' })).toEqual(['SV2a-094_ja']);
    expect(only({ type: 'psychic', lang: 'en' })).toEqual([]);
  });

  it('фильтры складываются', () => {
    expect(only({ set: 'en:sv03', finish: 'holo', query: 'char' })).toEqual(['sv03-125']);
  });

  it('счётчик включённых фильтров', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    const filters = { ...NO_FILTERS, set: 'en:sv03', query: ' a ', price: 'priced' as const };
    expect(activeFilterCount(filters)).toBe(3);
    expect(activeFilterCount(filters, { ignoreSet: true })).toBe(2);
  });
});

describe('тип и редкость из карточки', () => {
  it('у покемона — типы, у тренера и энергии — категория', () => {
    expect(facetFromFacts({ category: 'pokemon', types: [energy('Fire'), energy('Fire')], rarity: 'Double rare' })).toEqual({
      types: ['fire'],
      rarity: 'Double Rare',
    });
    expect(facetFromFacts({ category: 'trainer', types: [], rarity: 'Uncommon' }).types).toEqual(['trainer']);
    expect(facetFromFacts({ category: 'energy', types: [], rarity: 'None' })).toEqual({ types: ['energy'], rarity: null });
  });
});

describe('сортировка', () => {
  it('по номеру: сеты от новых к старым, карты вне базы в конце, английская копия раньше французской', () => {
    expect(ids(sortCards(album, 'number'))).toEqual(['sv03-125', 'sv03-125_fr', 'sv03-162', 'sv03-200', 'SV2a-094_ja', 'x-ja-MBG-3']);
  });

  it('номера сравниваются как числа', () => {
    const cards = [card('a', { localId: '10' }), card('b', { localId: '9' }), card('c', { localId: 'TG05' }), card('d', { localId: '009' })];
    expect(ids(sortCards(cards, 'number'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('по цене: доллары, потом только евро, без цены — всегда в конце', () => {
    expect(ids(sortCards(album, 'price-desc'))).toEqual(['sv03-125', 'sv03-125_fr', 'sv03-200', 'sv03-162', 'SV2a-094_ja', 'x-ja-MBG-3']);
    expect(ids(sortCards(album, 'price-asc'))).toEqual(['sv03-162', 'sv03-200', 'sv03-125', 'sv03-125_fr', 'SV2a-094_ja', 'x-ja-MBG-3']);
  });

  it('по дате: только что добавленная (без времени с сервера) — самая новая', () => {
    expect(ids(sortCards(album, 'added-desc'))).toEqual(['sv03-125_fr', 'sv03-125', 'SV2a-094_ja', 'sv03-162', 'sv03-200', 'x-ja-MBG-3']);
    expect(ids(sortCards(album, 'added-asc'))[0]).toBe('x-ja-MBG-3');
  });

  it('не меняет исходный массив', () => {
    const copy = [...album];
    sortCards(album, 'price-desc');
    expect(album).toEqual(copy);
  });
});

describe('сеты', () => {
  it('группы в порядке карт и пояснение у карт вне базы', () => {
    const groups = groupBySet(sortCards(album, 'number'));
    expect(groups.map((group) => group.key)).toEqual(['en:sv03', 'ja:SV2a', 'x:ja:MBG']);
    expect(groups[2]!.note).toBe('японская карта, нет в базе TCGdex');
    expect(groups[0]!.note).toBeNull();
  });

  it('прогресс сета: разные номера до официального числа карт', () => {
    const secret = card('sv03-210', { localId: '210' });
    expect(setProgress([...album, secret])).toEqual([
      { key: 'en:sv03', setName: 'Obsidian Flames', owned: 2, secret: 2, total: 197 },
      { key: 'ja:SV2a', setName: 'ポケモンカード151', owned: 1, secret: 0, total: 165 },
      { key: 'x:ja:MBG', setName: 'MBG', owned: 1, secret: 0, total: 21 },
    ]);
  });

  it('подпись сета: секретные карты отдельно', () => {
    const first = card('sv03-210', { localId: '210' });
    const second = card('sv03-211', { localId: '211' });
    expect(setCountLabel([first, second], 197)).toBe('0 из 197 карт · +2 секретных');
    expect(setCountLabel([first], 197)).toBe('0 из 197 карт · +1 секретная');
    expect(setCountLabel([], 197)).toBe('0 из 197 карт');
  });

  it('дороже всего — только карты с ценой', () => {
    expect(ids(mostValuable(album, 3))).toEqual(['sv03-125', 'sv03-125_fr', 'sv03-200']);
    expect(mostValuable([megaGengar], 3)).toEqual([]);
  });
});

describe('пункты фильтров', () => {
  it('только то, что есть в альбоме', () => {
    const choices = filterChoices(album, facets);
    expect(choices.sets).toEqual([
      { value: 'en:sv03', label: 'Obsidian Flames' },
      { value: 'ja:SV2a', label: 'ポケモンカード151 · JP' },
      { value: 'x:ja:MBG', label: 'MBG (вне базы)' },
    ]);
    expect(choices.langs.map((option) => option.value)).toEqual(['en', 'fr', 'ja']);
    expect(choices.types.map((option) => option.label)).toEqual(['Огонь', 'Психика', 'Бесцветная', 'Тренер']);
    expect(choices.rarities.map((option) => option.value)).toEqual(['Common', 'Uncommon', 'Rare', 'Double Rare']);
    expect(choices.finishes.map((option) => option.value)).toEqual(['normal', 'holo', 'reverse']);
    expect(choices.conditions.map((option) => option.value)).toEqual(['NM', 'LP']);
    expect([choices.priced, choices.unpriced]).toEqual([5, 1]);
  });
});

describe('карманы биндера', () => {
  const checklist = [
    { id: 'sv03-124', localId: '124', name: 'Charmeleon' },
    { id: 'sv03-125', localId: '125', name: 'Charizard ex' },
    { id: 'sv03-126', localId: '126', name: 'Larvesta' },
  ];

  it('разворот сета: недостающие карты — пустые карманы с номером, копии рядом', () => {
    const pockets = checklistPockets([dracaufeu, charizard, pidgey], checklist);
    expect(pockets.map((pocket) => (pocket.kind === 'missing' ? `·${pocket.number}` : pocket.key))).toEqual([
      '·124',
      'sv03-125',
      'sv03-125_fr',
      '·126',
      'sv03-162',
    ]);
  });

  it('разворот — две страницы по девять карманов, хвост — пустые карманы', () => {
    const cards = Array.from({ length: 20 }, (_, index) => card(`c${index}`, { localId: String(index + 1) }));
    const pockets = cardPockets(cards);
    expect(spreadCount(pockets.length)).toBe(2);
    const second = spreadAt(pockets, 1);
    expect(second.pages.map((page) => page.length)).toEqual([9, 9]);
    expect(second.pages[0]!.filter((pocket) => pocket.kind === 'card')).toHaveLength(2);
    expect(second.pages[1]!.every((pocket) => pocket.kind === 'blank')).toBe(true);
    expect(spreadLabel(second)).toBe('Страница 3 из 3');
    expect(spreadLabel(spreadAt(pockets, 0))).toBe('Страницы 1–2 из 3');
  });

  it('номер разворота за пределами — ближайший существующий; пустой альбом — одна пустая страница', () => {
    const pockets = cardPockets([charizard]);
    expect(spreadAt(pockets, 7).first).toBe(1);
    expect(spreadLabel(spreadAt([], 0))).toBe('Страница 1 из 1');
  });
});

describe('сохранённое состояние', () => {
  it('непонятные значения заменяются значениями по умолчанию', () => {
    expect(parseLibraryState(null)).toEqual({ view: 'binder', sort: 'number', spread: 0, filters: NO_FILTERS });
    const state = parseLibraryState({
      view: 'list',
      sort: 'price-desc',
      spread: 3,
      filters: { query: 'pika', set: 'en:sv03', lang: 'xx', finish: 'gold', condition: 'LP', price: 'priced', type: 42 },
    });
    expect(state).toEqual({
      view: 'list',
      sort: 'price-desc',
      spread: 3,
      filters: { ...NO_FILTERS, query: 'pika', set: 'en:sv03', condition: 'LP', price: 'priced' },
    });
    expect(parseLibraryState({ spread: -1, view: 'cards' })).toMatchObject({ spread: 0, view: 'binder' });
  });
});
