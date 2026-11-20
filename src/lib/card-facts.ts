import type { CardDetail } from '@/lib/tcgdex';

/**
 * Всё, что написано на карте, в одном виде: из карточки TCGdex или из JSON Limitless
 * (у японских карт там же есть английский перевод текста). Страница карточки рисует только это.
 */
export type Energy = { type: string; label: string; color: string };

export type Attack = { name: string; cost: Energy[]; damage: string | null; effect: string | null };

export type Ability = { kind: string; name: string; effect: string };

export type CardFacts = {
  category: 'pokemon' | 'trainer' | 'energy' | null;
  hp: number | null;
  types: Energy[];
  stage: string | null;
  evolveFrom: string | null;
  abilities: Ability[];
  attacks: Attack[];
  weaknesses: Array<{ type: Energy; value: string | null }>;
  resistances: Array<{ type: Energy; value: string | null }>;
  retreat: number | null;
  /** Текст тренера или энергии */
  effect: string | null;
  trainerType: string | null;
  /** Строка из покедекса */
  description: string | null;
  rarity: string | null;
  illustrator: string | null;
  regulationMark: string | null;
  legal: { standard: boolean; expanded: boolean } | null;
  variants: { normal: boolean; holo: boolean; reverse: boolean; firstEdition: boolean } | null;
};

/** Цвета типов из макетов (CardStub) и для недостающих типов — в той же гамме. */
const ENERGIES: Record<string, { label: string; color: string }> = {
  grass: { label: 'Трава', color: '#71B56B' },
  fire: { label: 'Огонь', color: '#E57A4E' },
  water: { label: 'Вода', color: '#5494DA' },
  lightning: { label: 'Молния', color: '#E8C24A' },
  psychic: { label: 'Психика', color: '#9D7CD8' },
  fighting: { label: 'Борьба', color: '#B86B3E' },
  darkness: { label: 'Тьма', color: '#50545F' },
  metal: { label: 'Металл', color: '#8E9AA6' },
  fairy: { label: 'Фея', color: '#E58FBF' },
  dragon: { label: 'Дракон', color: '#B8962E' },
  colorless: { label: 'Бесцветная', color: '#B4B8C1' },
};

/** Буквы энергий в стоимости атак у Limitless: «dd» — две Тьмы. */
const LETTERS: Record<string, string> = {
  g: 'grass',
  r: 'fire',
  w: 'water',
  l: 'lightning',
  p: 'psychic',
  f: 'fighting',
  d: 'darkness',
  m: 'metal',
  y: 'fairy',
  n: 'dragon',
  c: 'colorless',
};

export function energy(type: string): Energy {
  const key = type.trim().toLowerCase();
  const known = ENERGIES[key];
  return known ? { type: key, ...known } : { type: key, label: type.trim(), color: '#B4B8C1' };
}

const STAGES: Record<string, string> = {
  basic: 'Базовый',
  stage1: 'Стадия 1',
  stage2: 'Стадия 2',
  vmax: 'VMAX',
  vstar: 'VSTAR',
  break: 'BREAK',
  mega: 'Мега-эволюция',
  megaex: 'Мега-эволюция',
  legend: 'LEGEND',
  restored: 'Восстановленный',
};

export function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return STAGES[stage.replace(/[\s_-]+/g, '').toLowerCase()] ?? stage;
}

const TRAINER_TYPES: Record<string, string> = {
  item: 'Предмет',
  supporter: 'Помощник',
  stadium: 'Стадион',
  tool: 'Инструмент',
  technicalmachine: 'Техническая машина',
};

export function trainerTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return TRAINER_TYPES[type.replace(/[\s_-]+/g, '').toLowerCase()] ?? type;
}

/** Редкости японских карт у Limitless записаны кодами. */
const RARITY_CODES: Record<string, string> = {
  c: 'Common',
  u: 'Uncommon',
  r: 'Rare',
  rr: 'Double Rare',
  rrr: 'Triple Rare',
  ar: 'Art Rare',
  sr: 'Super Rare',
  sar: 'Special Art Rare',
  ur: 'Ultra Rare',
  hr: 'Hyper Rare',
  ace: 'ACE SPEC Rare',
  s: 'Shiny Rare',
  ssr: 'Shiny Super Rare',
  chr: 'Character Rare',
  csr: 'Character Super Rare',
  mur: 'Mega Ultra Rare',
  pr: 'Promo',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function category(value: unknown): CardFacts['category'] {
  const key = typeof value === 'string' ? value.toLowerCase() : '';
  if (key.startsWith('pok')) return 'pokemon';
  if (key.startsWith('trainer')) return 'trainer';
  if (key.startsWith('energy')) return 'energy';
  return null;
}

/** Карточка TCGdex: текст на языке каталога (у японских карт — по-японски). */
export function factsFromTcgdex(card: CardDetail): CardFacts {
  const raw = card as CardDetail & Record<string, unknown>;
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    category: category(raw.category),
    hp: number(raw.hp),
    types: list<string>(raw.types).map(energy),
    stage: stageLabel(text(raw.stage)),
    evolveFrom: text(raw.evolveFrom),
    abilities: list<{ type?: string; name?: string; effect?: string }>(raw.abilities).flatMap((ability) =>
      ability.name ? [{ kind: ability.type ?? 'Ability', name: ability.name, effect: ability.effect ?? '' }] : [],
    ),
    attacks: list<{ name?: string; cost?: string[]; damage?: string | number; effect?: string }>(raw.attacks).flatMap((attack) =>
      attack.name
        ? [
            {
              name: attack.name,
              cost: (attack.cost ?? []).map(energy),
              damage: attack.damage === undefined || attack.damage === '' ? null : String(attack.damage),
              effect: text(attack.effect),
            },
          ]
        : [],
    ),
    weaknesses: list<{ type?: string; value?: string }>(raw.weaknesses).flatMap((item) =>
      item.type ? [{ type: energy(item.type), value: text(item.value) }] : [],
    ),
    resistances: list<{ type?: string; value?: string }>(raw.resistances).flatMap((item) =>
      item.type ? [{ type: energy(item.type), value: text(item.value) }] : [],
    ),
    retreat: number(raw.retreat),
    effect: text(raw.effect),
    trainerType: trainerTypeLabel(text(raw.trainerType)),
    description: text(raw.description),
    rarity: text(raw.rarity),
    illustrator: text(raw.illustrator),
    regulationMark: text(raw.regulationMark),
    legal:
      raw.legal && typeof raw.legal === 'object'
        ? { standard: Boolean((raw.legal as { standard?: boolean }).standard), expanded: Boolean((raw.legal as { expanded?: boolean }).expanded) }
        : null,
    variants: card.variants
      ? {
          normal: Boolean(card.variants.normal),
          holo: Boolean(card.variants.holo),
          reverse: Boolean(card.variants.reverse),
          firstEdition: Boolean(card.variants.firstEdition),
        }
      : null,
  };
}

/** Сырой ответ Limitless: поля a1_name…a4_effect, буквы энергий, коды редкости. */
export type LimitlessText = Record<string, unknown>;

function costOf(value: unknown): Energy[] {
  return typeof value === 'string' ? [...value.toLowerCase()].flatMap((letter) => (LETTERS[letter] ? [energy(LETTERS[letter]!)] : [])) : [];
}

/** Карточка Limitless: японский текст или английский перевод (?translate). */
export function factsFromLimitless(raw: LimitlessText): CardFacts {
  const attacks: Attack[] = [];
  for (let index = 1; index <= 4; index++) {
    const name = text(raw[`a${index}_name`]);
    if (!name) continue;
    attacks.push({
      name,
      cost: costOf(raw[`a${index}_cost`]),
      damage: text(raw[`a${index}_dmg`]),
      effect: text(raw[`a${index}_effect`]),
    });
  }
  const abilities: Ability[] = [];
  const ability = text(raw.ability_name);
  if (ability) abilities.push({ kind: 'Ability', name: ability, effect: text(raw.ability_effect) ?? '' });
  const trait = text(raw.trait_name);
  if (trait) abilities.push({ kind: 'Ancient Trait', name: trait, effect: text(raw.trait_effect) ?? '' });
  const weakness = text(raw.weakness);
  const resistance = text(raw.resistance);
  const rarity = text(raw.rarity);
  const type = text(raw.type);
  return {
    category: category(raw.card_type),
    hp: number(raw.hp),
    types: type ? [energy(type)] : [],
    stage: stageLabel(text(raw.stage)),
    evolveFrom: null,
    abilities,
    attacks,
    weaknesses: weakness && weakness !== 'none' ? [{ type: energy(weakness), value: null }] : [],
    resistances: resistance && resistance !== 'none' ? [{ type: energy(resistance), value: null }] : [],
    retreat: number(raw.retreat),
    effect: text(raw.effect),
    trainerType: null,
    description: null,
    rarity: rarity ? (RARITY_CODES[rarity.toLowerCase()] ?? rarity.toUpperCase()) : null,
    illustrator: null,
    regulationMark: text(raw.regulation)?.toUpperCase() ?? null,
    legal: null,
    variants: null,
  };
}

/**
 * Перевод поверх оригинала: текст атак и способностей — из перевода, а то, чего
 * в переводе нет (художник, описание, варианты печати, легальность), — из оригинала.
 */
export function withTranslation(original: CardFacts, translated: CardFacts): CardFacts {
  return {
    ...original,
    abilities: translated.abilities.length > 0 ? translated.abilities : original.abilities,
    attacks: translated.attacks.length > 0 ? translated.attacks : original.attacks,
    effect: translated.effect ?? original.effect,
    hp: original.hp ?? translated.hp,
    types: original.types.length > 0 ? original.types : translated.types,
    stage: original.stage ?? translated.stage,
    weaknesses: original.weaknesses.length > 0 ? original.weaknesses : translated.weaknesses,
    resistances: original.resistances.length > 0 ? original.resistances : translated.resistances,
    retreat: original.retreat ?? translated.retreat,
    rarity: original.rarity ?? translated.rarity,
    regulationMark: original.regulationMark ?? translated.regulationMark,
  };
}
