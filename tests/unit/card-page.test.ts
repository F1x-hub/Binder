import { describe, expect, it } from 'vitest';
import { energy, factsFromLimitless, factsFromTcgdex, stageLabel, withTranslation } from '@/lib/card-facts';
import { buildChart, historyMonths, longDate, monthsBetween, nearestPoint, shortDate, type PricePoint } from '@/lib/price-history';
import type { CardDetail } from '@/lib/tcgdex';

/** Карточка TCGdex sv03-125, как её отдаёт API (сокращено). */
const CHARIZARD = {
  id: 'sv03-125',
  localId: '125',
  name: 'Charizard ex',
  category: 'Pokemon',
  illustrator: '5ban Graphics',
  rarity: 'Double rare',
  variants: { firstEdition: false, holo: true, normal: false, reverse: false },
  hp: 330,
  types: ['Darkness'],
  evolveFrom: 'Charmeleon',
  stage: 'Stage2',
  abilities: [{ type: 'Ability', name: 'Infernal Reign', effect: 'When you play this Pokémon…' }],
  attacks: [{ cost: ['Fire', 'Fire'], name: 'Burning Darkness', effect: 'This attack does 30 more damage…', damage: '180+' }],
  weaknesses: [{ type: 'Grass', value: '×2' }],
  retreat: 2,
  regulationMark: 'G',
  legal: { standard: false, expanded: true },
  set: { id: 'sv03', name: 'Obsidian Flames' },
} as unknown as CardDetail;

/** Ответ Limitless для MBG #3: оригинал и перевод (?translate). */
const GENGAR_JP = {
  region: 'tpc',
  set: 'MBG',
  number: '3',
  regulation: 'i',
  rarity: null,
  card_type: 'pokemon',
  type: 'darkness',
  hp: 350,
  stage: 'stage2',
  a1_cost: 'dd',
  a1_dmg: '230',
  a1_name: 'ヴォイドゲイル',
  a1_effect: 'このポケモンについているエネルギーを1個選び、ベンチポケモンにつけ替える。',
  weakness: 'fighting',
  resistance: 'none',
  retreat: 2,
  language: 'jp',
  translation: 0,
  name: 'メガゲンガーex',
  ability_name: 'かげかくし',
  ability_effect: 'このポケモンがいるかぎり…',
};
const GENGAR_EN = {
  ...GENGAR_JP,
  language: 'en',
  translation: 1,
  name: 'Mega Gengar ex',
  ability_name: 'Shadow Hiding',
  ability_effect: "Whenever any of your [D] Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, that player takes 1 fewer Prize card.",
  a1_name: 'Void Gale',
  a1_effect: 'Move an Energy from this Pokémon to 1 of your Benched Pokémon.',
};

describe('текст карты из TCGdex', () => {
  it('атаки со стоимостью, способности, слабость, отступление и прочее', () => {
    const facts = factsFromTcgdex(CHARIZARD);
    expect(facts).toMatchObject({
      category: 'pokemon',
      hp: 330,
      stage: 'Стадия 2',
      evolveFrom: 'Charmeleon',
      retreat: 2,
      regulationMark: 'G',
      illustrator: '5ban Graphics',
      legal: { standard: false, expanded: true },
      variants: { holo: true, normal: false, reverse: false, firstEdition: false },
    });
    expect(facts.types.map((type) => type.label)).toEqual(['Тьма']);
    expect(facts.attacks).toEqual([
      {
        name: 'Burning Darkness',
        cost: [energy('Fire'), energy('Fire')],
        damage: '180+',
        effect: 'This attack does 30 more damage…',
      },
    ]);
    expect(facts.abilities[0]).toMatchObject({ kind: 'Ability', name: 'Infernal Reign' });
    expect(facts.weaknesses).toEqual([{ type: energy('Grass'), value: '×2' }]);
    expect(facts.resistances).toEqual([]);
  });

  it('неизвестный тип и стадия не теряются', () => {
    expect(energy('Plasma')).toMatchObject({ label: 'Plasma' });
    expect(stageLabel('VMAX')).toBe('VMAX');
    expect(stageLabel('Stage1')).toBe('Стадия 1');
    expect(stageLabel(null)).toBeNull();
  });
});

describe('текст японской карты из Limitless', () => {
  it('буквы энергий и коды Limitless превращаются в понятные поля', () => {
    const facts = factsFromLimitless(GENGAR_JP);
    expect(facts).toMatchObject({ category: 'pokemon', hp: 350, stage: 'Стадия 2', retreat: 2, regulationMark: 'I' });
    expect(facts.attacks[0]).toMatchObject({ name: 'ヴォイドゲイル', damage: '230' });
    expect(facts.attacks[0]!.cost.map((item) => item.label)).toEqual(['Тьма', 'Тьма']);
    expect(facts.weaknesses.map((item) => item.type.label)).toEqual(['Борьба']);
    expect(facts.resistances).toEqual([]);
    expect(facts.abilities[0]).toMatchObject({ name: 'かげかくし' });
  });

  it('перевод заменяет текст атак и способностей, остальное остаётся из оригинала', () => {
    const original = { ...factsFromLimitless(GENGAR_JP), illustrator: '5ban Graphics' };
    const facts = withTranslation(original, factsFromLimitless(GENGAR_EN));
    expect(facts.attacks[0]).toMatchObject({ name: 'Void Gale', damage: '230' });
    expect(facts.abilities[0]).toMatchObject({ name: 'Shadow Hiding' });
    expect(facts.illustrator).toBe('5ban Graphics');
    expect(facts.hp).toBe(350);
  });

  it('коды редкости раскрываются', () => {
    expect(factsFromLimitless({ ...GENGAR_JP, rarity: 'sr' }).rarity).toBe('Super Rare');
    expect(factsFromLimitless({ ...GENGAR_JP, rarity: 'xyz' }).rarity).toBe('XYZ');
  });
});

describe('история цены', () => {
  it('месяцы и начало истории', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    // Истории до ноября 2026 нет: лишних чтений Firestore не будет
    expect(historyMonths(13, '2026-12-05')).toEqual(['2026-11', '2026-12']);
    expect(historyMonths(2, '2027-05-01')).toEqual(['2027-04', '2027-05']);
  });

  it('дата коротко, по-русски', () => {
    expect(shortDate('2026-11-21')).toBe('21 ноя');
    expect(shortDate('2027-05-02')).toBe('2 мая');
  });

  const points: PricePoint[] = [
    { day: '2026-11-20', usd: 5.0, eur: 4.1 },
    { day: '2026-11-25', usd: 5.5, eur: 4.3 },
    { day: '2026-12-10', usd: 6.0, eur: null },
  ];

  it('линия в координатах 600×200: старая цена слева внизу, новая справа вверху', () => {
    const chart = buildChart(points, '1М', '2026-12-12')!;
    expect(chart.currency).toBe('usd');
    expect(chart.line.split(' ')[0]).toBe('0,160');
    expect(chart.line.split(' ').at(-1)).toBe('600,40');
    expect(chart.area.endsWith('600,200 0,200')).toBe(true);
    expect(chart.change).toBeCloseTo(0.2);
    expect(chart.yLabels).toEqual([6, 5.5, 5]);
    expect(chart.xLabels[0]).toBe('20 ноя');
    expect(chart.xLabels.at(-1)).toBe('10 дек');
    expect(chart.endTop).toBe(20);
  });

  it('точки графика для подсказки: координаты, день и цена; под курсором — ближайшая', () => {
    const chart = buildChart(points, '1М', '2026-12-12')!;
    expect(chart.points.map((point) => [point.day, point.value])).toEqual([
      ['2026-11-20', 5],
      ['2026-11-25', 5.5],
      ['2026-12-10', 6],
    ]);
    expect(chart.points[0]).toMatchObject({ x: 0, y: 160 });
    expect(chart.points.at(-1)).toMatchObject({ x: 600, y: 40 });
    expect(nearestPoint(chart.points, 0)).toBe(0);
    expect(nearestPoint(chart.points, 160)).toBe(1);
    expect(nearestPoint(chart.points, 590)).toBe(2);
    expect(longDate('2026-11-21')).toBe('21 ноября 2026');
  });

  it('точки за пределами периода не попадают, одной точки для графика мало', () => {
    expect(buildChart(points, '1М', '2027-01-08')).toBeNull();
    expect(buildChart(points.slice(0, 1), '1Г', '2026-11-21')).toBeNull();
  });

  it('без долларов график строится в евро, ровная цена получает коридор', () => {
    const euro = buildChart(
      [
        { day: '2026-11-20', usd: null, eur: 2 },
        { day: '2026-11-21', usd: null, eur: 2 },
      ],
      '1М',
      '2026-11-22',
    )!;
    expect(euro.currency).toBe('eur');
    expect(euro.yLabels[0]).toBeCloseTo(2.2);
    expect(euro.yLabels[2]).toBeCloseTo(1.8);
    expect(euro.change).toBe(0);
  });
});
