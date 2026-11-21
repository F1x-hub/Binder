import { describe, expect, it } from 'vitest';
import {
  addBlocker,
  checkDeck,
  deckTotal,
  infoFromLimitless,
  infoFromTcgdex,
  isAceSpecName,
  isBasicEnergyName,
  isRadiantName,
  nameKey,
  readinessHint,
  unknownInfo,
  type DeckCardInfo,
  type DeckLine,
} from '@/lib/deck-rules';
import { NBSP } from '@/lib/format';

const plain = { aceSpec: false, radiant: false };
const pokemon = (name: string, basic = true): DeckCardInfo => ({ name, category: 'pokemon', basicPokemon: basic, basicEnergy: false, ...plain });
const trainer = (name: string): DeckCardInfo => ({ name, category: 'trainer', basicPokemon: false, basicEnergy: false, ...plain });
const energy = (name: string, basic = true): DeckCardInfo => ({ name, category: 'energy', basicPokemon: false, basicEnergy: basic, ...plain });
const aceSpec = (name: string): DeckCardInfo => ({ ...trainer(name), aceSpec: true });
const radiant = (name: string): DeckCardInfo => ({ ...pokemon(name), radiant: true });

const line = (docId: string, count: number, info: DeckCardInfo, owned = count): DeckLine => ({ docId, count, owned, info });

/** Готовая колода: 4 базовых, 4 эволюции, 40 тренеров по 4, 12 базовой энергии одной печати. */
function legalDeck(): DeckLine[] {
  return [
    line('sv03-4', 4, pokemon('Charmander')),
    line('sv03-26', 4, pokemon('Charmeleon', false)),
    ...Array.from({ length: 10 }, (_, index) => line(`tr-${index}`, 4, trainer(`Trainer ${index}`))),
    line('sve-002', 12, energy('Fire Energy')),
  ];
}

const check = (lines: DeckLine[], id: string) => checkDeck(lines).checks.find((item) => item.id === id);

describe('checkDeck', () => {
  it('готовая колода проходит все проверки', () => {
    const report = checkDeck(legalDeck());
    expect(report.total).toBe(60);
    expect(report.byCategory).toEqual({ pokemon: 8, trainer: 40, energy: 12, unknown: 0 });
    expect(report.ready).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.checks.map((item) => item.id)).toEqual(['copies', 'basic', 'size']);
    expect(readinessHint(report)).toBe('Колода готова к игре');
  });

  it('меньше 60 карт: не готова, сколько не хватает', () => {
    const lines = legalDeck().slice(0, -1);
    const report = checkDeck(lines);
    expect(report.total).toBe(48);
    expect(report.ready).toBe(false);
    expect(check(lines, 'size')).toEqual({ id: 'size', ok: false, text: 'Не хватает 12 до 60' });
    expect(readinessHint(report)).toBe(`Добавь ещё 12${NBSP}карт, чтобы играть`);
    expect(readinessHint(checkDeck([line('a', 59, energy('Fire Energy'))]))).toBe(`Добавь ещё 1${NBSP}карту, чтобы играть`);
  });

  it('больше 60 карт: не готова', () => {
    const lines = [...legalDeck(), line('sve-003', 3, energy('Water Energy'))];
    expect(check(lines, 'size')).toEqual({ id: 'size', ok: false, text: 'Лишние 3: нужно ровно 60' });
    expect(readinessHint(checkDeck(lines))).toBe(`Убери 3${NBSP}карты, чтобы играть`);
  });

  it('пустая колода', () => {
    const report = checkDeck([]);
    expect(report.total).toBe(0);
    expect(report.ready).toBe(false);
    expect(report.problems).toEqual(['Нет ни одного базового покемона', 'Не хватает 60 до 60']);
  });

  it('пять копий одной карты — нарушение', () => {
    const lines = legalDeck();
    lines[0] = line('sv03-4', 5, pokemon('Charmander'));
    lines[lines.length - 1] = line('sve-002', 11, energy('Fire Energy'));
    const report = checkDeck(lines);
    expect(report.total).toBe(60);
    expect(report.ready).toBe(false);
    expect(check(lines, 'copies')).toEqual({ id: 'copies', ok: false, text: 'Больше 4 копий: Charmander — 5' });
  });

  it('копии считаются по имени: разные печати одной карты складываются', () => {
    const lines = [
      line('sv03-125', 3, pokemon('Charizard ex', false)),
      line('sv03.5-006', 2, pokemon('Charizard  EX', false)),
      line('svp-56', 2, pokemon('Charizard', false)),
    ];
    expect(check(lines, 'copies')).toMatchObject({ ok: false, text: 'Больше 4 копий: Charizard ex — 5' });
  });

  it('базовой энергии можно сколько угодно, специальной — не больше 4', () => {
    expect(check([line('sve-002', 20, energy('Fire Energy')), line('sve-010', 20, energy('Fire Energy'))], 'copies')?.ok).toBe(true);
    expect(check([line('swsh9-151', 5, energy('Double Turbo Energy', false))], 'copies')).toMatchObject({
      ok: false,
      text: 'Больше 4 копий: Double Turbo Energy — 5',
    });
  });

  it('без базового покемона не готова', () => {
    const lines = legalDeck().filter((item) => item.docId !== 'sv03-4');
    lines.push(line('sve-003', 4, energy('Water Energy')));
    const report = checkDeck(lines);
    expect(report.total).toBe(60);
    expect(report.ready).toBe(false);
    expect(check(lines, 'basic')).toEqual({ id: 'basic', ok: false, text: 'Нет ни одного базового покемона' });
  });

  it('карты без данных идут в счёт 60 карт и копий, но базовым покемоном не считаются', () => {
    const lines = [
      line('x-ja-MBG-3', 4, unknownInfo('Mega Gengar ex')),
      line('x-ja-MBG-3b', 1, unknownInfo('Mega Gengar ex')),
      ...Array.from({ length: 13 }, (_, index) => line(`tr-${index}`, 4, trainer(`Trainer ${index}`))),
      line('x-ja-MBG-20', 3, unknownInfo('Basic Darkness Energy')),
    ];
    const report = checkDeck(lines);
    expect(report.total).toBe(60);
    expect(report.byCategory.unknown).toBe(8);
    expect(check(lines, 'copies')).toMatchObject({ ok: false, text: 'Больше 4 копий: Mega Gengar ex — 5' });
    expect(check(lines, 'basic')).toEqual({ id: 'basic', ok: false, text: 'Нет базового покемона среди карт из базы' });
  });

  it('копий больше, чем осталось в альбоме: не готова', () => {
    const lines = legalDeck();
    lines[0] = line('sv03-4', 4, pokemon('Charmander'), 3);
    lines[1] = line('sv03-26', 4, pokemon('Charmeleon', false), 0);
    const report = checkDeck(lines);
    expect(report.ready).toBe(false);
    expect(report.checks.at(-1)).toEqual({ id: 'owned', ok: false, text: `В альбоме не хватает 5${NBSP}карт из колоды` });
  });

  it('карта, убранная из альбома, не прячет базового покемона', () => {
    const lines = [line('sv01-191', 4, trainer('Rare Candy')), line('gone', 2, unknownInfo('gone'), 0)];
    expect(check(lines, 'basic')?.text).toBe('Нет ни одного базового покемона');
  });

  it('строки с нулём копий не считаются', () => {
    expect(checkDeck([line('sv03-4', 0, pokemon('Charmander'))]).checks.find((item) => item.id === 'basic')?.ok).toBe(false);
  });
});

describe('addBlocker', () => {
  it('можно добавить, пока есть в альбоме и меньше четырёх', () => {
    const lines = [line('sv03-4', 2, pokemon('Charmander'), 4)];
    expect(addBlocker(lines, 'sv03-4', pokemon('Charmander'), 4)).toBeNull();
    expect(addBlocker(lines, 'sv03-26', pokemon('Charmeleon', false), 1)).toBeNull();
  });

  it('не больше копий, чем в альбоме', () => {
    const lines = [line('sv03-4', 2, pokemon('Charmander'), 2)];
    expect(addBlocker(lines, 'sv03-4', pokemon('Charmander'), 2)).toBe('Все копии из альбома уже в колоде');
    expect(addBlocker([], 'gone', pokemon('Pikachu'), 0)).toBe('Этой карты нет в альбоме');
  });

  it('не больше четырёх с одним именем, даже из разных печатей', () => {
    const lines = [line('sv03-125', 3, pokemon('Charizard ex', false), 9), line('sv03.5-006', 1, pokemon('Charizard ex', false), 9)];
    expect(addBlocker(lines, 'sv03-125', pokemon('Charizard ex', false), 9)).toBe('Уже 4 карты «Charizard ex»: больше нельзя');
    expect(addBlocker(lines, 'other', pokemon('Charizard ex', false), 1)).toBe('Уже 4 карты «Charizard ex»: больше нельзя');
  });

  it('базовой энергии — сколько есть в альбоме', () => {
    const lines = [line('sve-002', 12, energy('Fire Energy'), 20)];
    expect(addBlocker(lines, 'sve-002', energy('Fire Energy'), 20)).toBeNull();
  });

  it('не больше 60 карт', () => {
    const lines = [line('sve-002', 60, energy('Fire Energy'), 99)];
    expect(addBlocker(lines, 'sve-002', energy('Fire Energy'), 99)).toBe('В колоде уже 60 карт');
  });
});

describe('сведения о карте', () => {
  it('из TCGdex: категория, стадия, тип энергии', () => {
    expect(infoFromTcgdex('Charmander', { category: 'Pokemon', stage: 'Basic' })).toEqual(pokemon('Charmander'));
    expect(infoFromTcgdex('Charizard ex', { category: 'Pokemon', stage: 'Stage2' })).toEqual(pokemon('Charizard ex', false));
    expect(infoFromTcgdex('Rare Candy', { category: 'Trainer', trainerType: 'Item' })).toEqual(trainer('Rare Candy'));
    expect(infoFromTcgdex('Fire Energy', { category: 'Energy', energyType: 'Normal' })).toEqual(energy('Fire Energy'));
    expect(infoFromTcgdex('Double Turbo Energy', { category: 'Energy', energyType: 'Special' })).toEqual(
      energy('Double Turbo Energy', false),
    );
    // В японском каталоге TCGdex поля те же, по-английски
    expect(infoFromTcgdex('リザードンex', { category: 'Pokemon', stage: 'Stage2' }).category).toBe('pokemon');
  });

  it('из TCGdex без категории — как карта без данных', () => {
    expect(infoFromTcgdex('Fire Energy', {})).toEqual({
      name: 'Fire Energy',
      category: null,
      basicPokemon: false,
      basicEnergy: true,
      aceSpec: false,
      radiant: false,
    });
  });

  it('из Limitless: card_type и stage', () => {
    expect(infoFromLimitless('Mega Gengar ex', { card_type: 'pokemon', stage: 'stage2' })).toEqual(pokemon('Mega Gengar ex', false));
    expect(infoFromLimitless('Gastly', { card_type: 'pokemon', stage: 'basic' })).toEqual(pokemon('Gastly'));
    expect(infoFromLimitless("Lillie's Determination", { card_type: 'trainer', type: 'supporter' })).toEqual(
      trainer("Lillie's Determination"),
    );
    expect(infoFromLimitless('基本悪エネルギー', { card_type: 'energy', type: null })).toEqual(energy('基本悪エネルギー'));
    expect(infoFromLimitless('Basic Darkness Energy', { card_type: 'energy', type: 'basic' })).toEqual(energy('Basic Darkness Energy'));
    expect(infoFromLimitless('Fire Energy', { card_type: 'energy', type: 'special' })).toEqual(energy('Fire Energy', false));
  });

  it('базовая энергия по имени', () => {
    expect(isBasicEnergyName('Fire Energy')).toBe(true);
    expect(isBasicEnergyName('Basic Psychic Energy')).toBe(true);
    expect(isBasicEnergyName('基本炎エネルギー')).toBe(true);
    expect(isBasicEnergyName('Double Turbo Energy')).toBe(false);
    expect(isBasicEnergyName('Reversal Energy')).toBe(false);
    expect(isBasicEnergyName('Fire Energy Retrieval')).toBe(false);
  });

  it('ключ имени не зависит от регистра, пробелов, апострофа и é', () => {
    expect(nameKey('  Boss’s  Orders ')).toBe(nameKey("Boss's Orders"));
    expect(nameKey('Pokémon Catcher')).toBe(nameKey('POKEMON CATCHER'));
    expect(nameKey('Charizard ex')).not.toBe(nameKey('Charizard'));
  });

  it('deckTotal', () => {
    expect(deckTotal({})).toBe(0);
    expect(deckTotal({ a: 4, b: 12 })).toBe(16);
  });
});

/** Колода из 60 карт: 4 базовых, 40 тренеров по 4, 16 базовой энергии; особые карты встают вместо энергии. */
function deckWith(...special: DeckLine[]): DeckLine[] {
  const extra = special.reduce((sum, item) => sum + item.count, 0);
  return [
    line('sv03-4', 4, pokemon('Charmander')),
    ...Array.from({ length: 10 }, (_, index) => line(`tr-${index}`, 4, trainer(`Trainer ${index}`))),
    line('sve-002', 16 - extra, energy('Fire Energy')),
    ...special,
  ];
}

describe('ACE SPEC и Radiant', () => {
  it('одна карта ACE SPEC — можно, проверка видна', () => {
    const lines = deckWith(line('sv05-157', 1, aceSpec('Prime Catcher')));
    const report = checkDeck(lines);
    expect(report.ready).toBe(true);
    expect(check(lines, 'aceSpec')).toEqual({ id: 'aceSpec', ok: true, text: 'Одна карта ACE SPEC' });
    expect(report.checks.map((item) => item.id)).toEqual(['copies', 'basic', 'aceSpec', 'size']);
  });

  it('без ACE SPEC и Radiant этих проверок нет', () => {
    expect(checkDeck(legalDeck()).checks.map((item) => item.id)).toEqual(['copies', 'basic', 'size']);
  });

  it('две разные карты ACE SPEC — нарушение', () => {
    const lines = deckWith(line('sv05-157', 1, aceSpec('Prime Catcher')), line('sv05-153', 1, aceSpec('Master Ball')));
    const report = checkDeck(lines);
    expect(report.total).toBe(60);
    expect(report.ready).toBe(false);
    expect(check(lines, 'aceSpec')).toEqual({ id: 'aceSpec', ok: false, text: `В колоде 2${NBSP}карты ACE SPEC — можно одну` });
    expect(readinessHint(report)).toBe('Исправь колоду, чтобы играть');
  });

  it('две копии одной карты ACE SPEC — тоже нарушение', () => {
    const lines = deckWith(line('sv05-157', 2, aceSpec('Prime Catcher')));
    expect(check(lines, 'aceSpec')?.ok).toBe(false);
    expect(check(lines, 'copies')?.ok).toBe(true);
  });

  it('два покемона Radiant — нарушение', () => {
    const lines = deckWith(line('swsh10-046', 1, radiant('Radiant Greninja')), line('swsh10.5-011', 1, radiant('Radiant Charizard')));
    expect(check(lines, 'radiant')).toEqual({ id: 'radiant', ok: false, text: `В колоде 2${NBSP}покемона Radiant — можно одного` });
    const one = deckWith(line('swsh10-046', 1, radiant('Radiant Greninja')));
    expect(check(one, 'radiant')).toEqual({ id: 'radiant', ok: true, text: 'Один покемон Radiant' });
    expect(checkDeck(one).ready).toBe(true);
  });

  it('«+» не даёт взять вторую карту ACE SPEC или второго Radiant', () => {
    const lines = [line('sv05-157', 1, aceSpec('Prime Catcher'), 3), line('swsh10-046', 1, radiant('Radiant Greninja'), 2)];
    expect(addBlocker(lines, 'sv05-153', aceSpec('Master Ball'), 1)).toBe('В колоде уже есть карта ACE SPEC — можно одну');
    expect(addBlocker(lines, 'sv05-157', aceSpec('Prime Catcher'), 3)).toBe('В колоде уже есть карта ACE SPEC — можно одну');
    expect(addBlocker(lines, 'swsh10.5-011', radiant('Radiant Charizard'), 1)).toBe('В колоде уже есть покемон Radiant — можно одного');
    expect(addBlocker(lines, 'tr-1', trainer('Rare Candy'), 4)).toBeNull();
    expect(addBlocker([], 'sv05-157', aceSpec('Prime Catcher'), 1)).toBeNull();
    // Строка с нулём копий не считается
    expect(addBlocker([line('sv05-157', 0, aceSpec('Prime Catcher'))], 'sv05-153', aceSpec('Master Ball'), 1)).toBeNull();
  });

  it('карты без данных: ACE SPEC — только по однозначному имени, Radiant — по имени', () => {
    expect(unknownInfo('Prime Catcher').aceSpec).toBe(true);
    expect(unknownInfo('Unfair Stamp').aceSpec).toBe(true);
    // У «Master Ball» и «Computer Search» есть старые печати не ACE SPEC: без данных не узнаются
    expect(unknownInfo('Master Ball').aceSpec).toBe(false);
    expect(unknownInfo('Computer Search').aceSpec).toBe(false);
    expect(unknownInfo('プライムキャッチャー').aceSpec).toBe(false);
    expect(unknownInfo('Radiant Greninja').radiant).toBe(true);
    expect(unknownInfo('かがやくゲッコウガ').radiant).toBe(true);
    expect(unknownInfo('Greninja').radiant).toBe(false);
    // Карта без данных идёт в счёт правила, как и в остальных
    const lines = deckWith(line('x-ja-SVLS-20', 1, unknownInfo('Prime Catcher')), line('sv05-153', 1, aceSpec('Master Ball')));
    expect(check(lines, 'aceSpec')?.ok).toBe(false);
  });

  it('из TCGdex: по редкости, у переизданий без редкости — по имени и знаку регуляции', () => {
    // sv05-153 «Master Ball»: rarity «ACE SPEC Rare», regulationMark «H»
    expect(infoFromTcgdex('Master Ball', { category: 'Trainer', rarity: 'ACE SPEC Rare', regulationMark: 'H' }).aceSpec).toBe(true);
    // ja SV8a-148 «プライムキャッチャー»: rarity «None», regulationMark «H», английское имя из Limitless
    expect(
      infoFromTcgdex('Prime Catcher', { category: 'Trainer', rarity: 'None', regulationMark: 'H', name: 'プライムキャッチャー' }).aceSpec,
    ).toBe(true);
    // Старые «Master Ball» (ex16-78) — не ACE SPEC
    expect(infoFromTcgdex('Master Ball', { category: 'Trainer', rarity: 'Uncommon', set: { id: 'ex16' } }).aceSpec).toBe(false);
    // bw7-137 «Computer Search»: rarity «Rare», ACE SPEC эпохи BW; base1-71 — нет
    expect(infoFromTcgdex('Computer Search', { category: 'Trainer', rarity: 'Rare', set: { id: 'bw7' } }).aceSpec).toBe(true);
    expect(infoFromTcgdex('Computer Search', { category: 'Trainer', rarity: 'Rare', set: { id: 'base1' } }).aceSpec).toBe(false);
    // Без английского имени и без редкости японскую карту не узнать
    expect(infoFromTcgdex('プライムキャッチャー', { category: 'Trainer', rarity: 'None', regulationMark: 'H' }).aceSpec).toBe(false);

    // swsh10-046 «Radiant Greninja»: rarity «Radiant Rare», category «Pokemon», stage «Basic»
    const greninja = infoFromTcgdex('Radiant Greninja', { category: 'Pokemon', stage: 'Basic', rarity: 'Radiant Rare' });
    expect(greninja).toEqual({ ...pokemon('Radiant Greninja'), radiant: true });
    expect(infoFromTcgdex('Greninja', { category: 'Pokemon', stage: 'Basic', rarity: 'Radiant Rare' }).radiant).toBe(true);
    expect(infoFromTcgdex('Greninja', { category: 'Pokemon', stage: 'Basic', name: 'かがやくゲッコウガ' }).radiant).toBe(true);
    expect(infoFromTcgdex('Greninja ex', { category: 'Pokemon', stage: 'Stage2', rarity: 'Double rare' }).radiant).toBe(false);
  });

  it('из Limitless: редкости нет, ACE SPEC по английскому имени и знаку регуляции', () => {
    // SVHK/32 «マスターボール»: card_type trainer, regulation h, rarity null
    expect(infoFromLimitless('Master Ball', { card_type: 'trainer', type: 'item', regulation: 'h', rarity: null }).aceSpec).toBe(true);
    expect(infoFromLimitless('Master Ball', { card_type: 'trainer', type: 'item', regulation: null }).aceSpec).toBe(false);
    expect(infoFromLimitless('Rare Candy', { card_type: 'trainer', type: 'item', regulation: 'h' }).aceSpec).toBe(false);
    expect(infoFromLimitless('Greninja', { card_type: 'pokemon', stage: 'basic', name: 'かがやくゲッコウガ' }).radiant).toBe(true);
  });

  it('имена', () => {
    expect(isAceSpecName('Hero’s Cape')).toBe(true);
    expect(isAceSpecName('Poke Vital A')).toBe(true);
    expect(isAceSpecName('Rare Candy')).toBe(false);
    expect(isRadiantName('  radiant charizard')).toBe(true);
    expect(isRadiantName('Radiance Charm')).toBe(false);
  });
});
