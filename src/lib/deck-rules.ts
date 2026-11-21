import { countLabel, type WordForms } from '@/lib/format';

/**
 * Правила колоды Pokémon TCG: ровно 60 карт; не больше 4 карт с одним именем, кроме базовой
 * энергии; хотя бы один базовый покемон; не больше одной карты ACE SPEC и одного покемона Radiant. Плюс правило Binder: колода собирается из своих карт,
 * копий в ней не больше, чем в альбоме. Колода, которая не прошла проверку, всё равно хранится,
 * только считается неготовой. Здесь нет ни Firebase, ни React: всё проверяется юнит-тестами.
 */
export const DECK_SIZE = 60;
export const MAX_SAME_NAME = 4;
/** ACE SPEC и Radiant: по одной карте на колоду, какие бы они ни были */
export const MAX_ACE_SPEC = 1;
export const MAX_RADIANT = 1;

export type DeckCategory = 'pokemon' | 'trainer' | 'energy';

/** Что о карте нужно для проверки колоды. */
export type DeckCardInfo = {
  /** Имя для правила четырёх копий: английское, если оно известно */
  name: string;
  /** null — данных нет: карты нет ни в TCGdex, ни в Limitless (или они не ответили) */
  category: DeckCategory | null;
  basicPokemon: boolean;
  basicEnergy: boolean;
  /** Карта ACE SPEC (тренер или особая энергия); у карты без данных — только по однозначному имени */
  aceSpec: boolean;
  /** Покемон Radiant («Radiant Greninja», «かがやくゲッコウガ») */
  radiant: boolean;
};

/** Строка колоды: карта альбома, сколько её в колоде и сколько в альбоме. */
export type DeckLine = {
  docId: string;
  count: number;
  /** Копий в альбоме; 0 — карту из альбома уже убрали */
  owned: number;
  info: DeckCardInfo;
};

export type DeckCheckId = 'size' | 'copies' | 'basic' | 'aceSpec' | 'radiant' | 'owned';

export type DeckCheck = { id: DeckCheckId; ok: boolean; text: string };

export type DeckReport = {
  total: number;
  /** Сколько карт каждой категории; unknown — карты без данных */
  byCategory: Record<DeckCategory | 'unknown', number>;
  /**
   * Копии, базовый покемон и размер — всегда; ACE SPEC и Radiant — если такие карты в колоде есть;
   * «есть в альбоме» — только если не выполнено
   */
  checks: DeckCheck[];
  /** Причины, по которым колода не готова: тексты невыполненных проверок */
  problems: string[];
  ready: boolean;
};

const CARDS_ACCUSATIVE: WordForms = ['карту', 'карты', 'карт'];
const CARDS_GENITIVE: WordForms = ['карты', 'карт', 'карт'];
const CARDS: WordForms = ['карта', 'карты', 'карт'];
const POKEMON: WordForms = ['покемон', 'покемона', 'покемонов'];

/**
 * Ключ имени для правила четырёх копий. Правило считает карты с одинаковым именем, в том числе
 * разные печати: «Charizard ex» из двух сетов — это одно имя, а «Charizard» и «Charizard ex» — разные.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[’`]/g, "'")
    .replace(/é/gi, 'e')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Базовая энергия по имени: «Fire Energy», «Basic Fire Energy», «基本炎エネルギー».
 * Нужна для карт без данных: имён базовой энергии всего девять, спутать их не с чем.
 */
export function isBasicEnergyName(name: string): boolean {
  const key = nameKey(name);
  return (
    /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/.test(key) ||
    /^基本.{1,6}エネルギー$/.test(key)
  );
}

/**
 * ACE SPEC эпохи Scarlet & Violet и Mega Evolution (знак регуляции G и новее). В TCGdex их узнаёт
 * редкость «ACE SPEC Rare», но не всегда: у японских переизданий (SV8a) редкость «None», у Limitless
 * редкости нет. Тогда карта узнаётся по английскому имени и знаку регуляции: у «Master Ball»
 * есть старые печати без знака, они ACE SPEC не считаются. Список сверен с TCGdex 21 ноября 2026
 * (`/v2/en/cards?rarity=eq:ACE SPEC Rare`, 33 карты); новые ACE SPEC узнаются по редкости.
 */
const ACE_SPEC_SV = new Set(
  [
    'Amulet of Hope', 'Awakening Drum', 'Brilliant Blender', 'Dangerous Laser', 'Deluxe Bomb', 'Energy Search Pro',
    'Enriching Energy', 'Grand Tree', "Hero's Cape", 'Hyper Aroma', 'Legacy Energy', 'Master Ball', 'Max Rod',
    'Maximum Belt', 'Megaton Blower', 'Miracle Headset', 'Neo Upper Energy', 'Neutralization Zone', 'Poké Vital A',
    'Precious Trolley', 'Prime Catcher', 'Reboot Pod', 'Scoop Up Cyclone', 'Scramble Switch', 'Secret Box',
    'Sparkling Crystal', 'Survival Brace', 'Treasure Tracker', 'Unfair Stamp',
  ].map(nameKey),
);

/** ACE SPEC эпохи Black & White (сеты bw7–bw11): в TCGdex у них обычная редкость «Rare». */
const ACE_SPEC_BW = new Set(
  [
    'Computer Search', 'Crystal Edge', 'Crystal Wall', 'Dowsing Machine', 'G Booster', 'G Scope', 'Gold Potion',
    'Life Dew', 'Master Ball', 'Rock Guard', 'Scoop Up Cyclone', 'Scramble Switch', 'Victory Piece',
  ].map(nameKey),
);

/** Имена, у которых есть печати не ACE SPEC («Master Ball» из 2000-х, «Computer Search» из Base Set). */
const ACE_SPEC_AMBIGUOUS = new Set(['Master Ball', 'Computer Search'].map(nameKey));

/** ACE SPEC по одному имени, без сведений о печати: только однозначные имена. */
export function isAceSpecName(name: string): boolean {
  const key = nameKey(name);
  return (ACE_SPEC_SV.has(key) || ACE_SPEC_BW.has(key)) && !ACE_SPEC_AMBIGUOUS.has(key);
}

/** Покемон Radiant по имени: «Radiant Charizard», японское «かがやくリザードン». */
export function isRadiantName(name: string): boolean {
  return /^radiant\s/i.test(name.trim()) || /^かがやく/.test(name.trim());
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Знак регуляции G и новее: эпоха, в которой вернулись ACE SPEC. */
const isModernRegulation = (mark: unknown) => /^[g-z]$/i.test(text(mark).trim());

function categoryOf(value: unknown): DeckCategory | null {
  const key = typeof value === 'string' ? value.toLowerCase() : '';
  if (key.startsWith('pok')) return 'pokemon';
  if (key.startsWith('trainer')) return 'trainer';
  if (key.startsWith('energy')) return 'energy';
  return null;
}

const isBasicStage = (stage: unknown) => typeof stage === 'string' && stage.replace(/[\s_-]+/g, '').toLowerCase() === 'basic';

/** Карта без данных: в счёт 60 карт и правила четырёх копий идёт, базовым покемоном не считается. */
export function unknownInfo(name: string): DeckCardInfo {
  return {
    name,
    category: null,
    basicPokemon: false,
    basicEnergy: isBasicEnergyName(name),
    aceSpec: isAceSpecName(name),
    radiant: isRadiantName(name),
  };
}

/**
 * Карточка TCGdex: category «Pokemon/Trainer/Energy», stage «Basic/Stage1/…», energyType «Normal/Special»,
 * rarity «ACE SPEC Rare» / «Radiant Rare», regulationMark «G», set.id «bw7».
 */
export function infoFromTcgdex(name: string, detail: Record<string, unknown>): DeckCardInfo {
  const category = categoryOf(detail.category);
  if (!category) return unknownInfo(name);
  const rarity = text(detail.rarity).toLowerCase();
  const key = nameKey(name);
  const setId = text((detail.set as { id?: unknown } | undefined)?.id).toLowerCase();
  const aceSpec =
    category !== 'pokemon' &&
    (rarity === 'ace spec rare' ||
      (ACE_SPEC_SV.has(key) && isModernRegulation(detail.regulationMark)) ||
      (ACE_SPEC_BW.has(key) && setId.startsWith('bw')));
  return {
    name,
    category,
    basicPokemon: category === 'pokemon' && isBasicStage(detail.stage),
    basicEnergy:
      category === 'energy' &&
      (typeof detail.energyType === 'string' ? detail.energyType.toLowerCase() === 'normal' : isBasicEnergyName(name)),
    aceSpec,
    radiant: category === 'pokemon' && (rarity === 'radiant rare' || isRadiantName(name) || isRadiantName(text(detail.name))),
  };
}

/** Карточка Limitless (японские карты вне TCGdex): card_type «pokemon/trainer/energy», stage «basic/stage1/…». */
export function infoFromLimitless(name: string, raw: Record<string, unknown>): DeckCardInfo {
  const category = categoryOf(raw.card_type);
  if (!category) return unknownInfo(name);
  const kind = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  // Редкости у японских карт Limitless нет: ACE SPEC — по английскому имени и знаку регуляции
  return {
    name,
    category,
    basicPokemon: category === 'pokemon' && isBasicStage(raw.stage),
    basicEnergy: category === 'energy' && (kind === 'basic' || (kind !== 'special' && isBasicEnergyName(name))),
    aceSpec: category !== 'pokemon' && ACE_SPEC_SV.has(nameKey(name)) && isModernRegulation(raw.regulation),
    radiant: category === 'pokemon' && (isRadiantName(name) || isRadiantName(text(raw.name))),
  };
}

export function deckTotal(cards: Readonly<Record<string, number>>): number {
  return Object.values(cards).reduce((sum, count) => sum + count, 0);
}

/** Сколько карт с этим именем уже в колоде (разные печати вместе). */
function sameNameCount(lines: readonly DeckLine[], name: string): number {
  const key = nameKey(name);
  return lines.reduce((sum, line) => (nameKey(line.info.name) === key ? sum + line.count : sum), 0);
}

const countOf = (lines: readonly DeckLine[], test: (info: DeckCardInfo) => boolean) =>
  lines.reduce((sum, line) => (line.count > 0 && test(line.info) ? sum + line.count : sum), 0);

/**
 * Почему нельзя положить ещё одну копию карты; null — можно. Порядок важен: сначала размер
 * колоды, потом альбом, потом ACE SPEC и Radiant, потом правило четырёх копий.
 */
export function addBlocker(lines: readonly DeckLine[], docId: string, info: DeckCardInfo, owned: number): string | null {
  const total = lines.reduce((sum, line) => sum + line.count, 0);
  if (total >= DECK_SIZE) return `В колоде уже ${DECK_SIZE} карт`;
  const inDeck = lines.find((line) => line.docId === docId)?.count ?? 0;
  if (inDeck >= owned) return owned === 0 ? 'Этой карты нет в альбоме' : 'Все копии из альбома уже в колоде';
  if (info.aceSpec && countOf(lines, (item) => item.aceSpec) >= MAX_ACE_SPEC) {
    return 'В колоде уже есть карта ACE SPEC — можно одну';
  }
  if (info.radiant && countOf(lines, (item) => item.radiant) >= MAX_RADIANT) {
    return 'В колоде уже есть покемон Radiant — можно одного';
  }
  if (!info.basicEnergy && sameNameCount(lines, info.name) >= MAX_SAME_NAME) {
    return `Уже ${MAX_SAME_NAME} карты «${info.name}»: больше нельзя`;
  }
  return null;
}

export function checkDeck(lines: readonly DeckLine[]): DeckReport {
  const counted = lines.filter((line) => line.count > 0);
  const byCategory = { pokemon: 0, trainer: 0, energy: 0, unknown: 0 };
  let total = 0;
  for (const line of counted) {
    total += line.count;
    byCategory[line.info.category ?? 'unknown'] += line.count;
  }

  // Порядок как в макете Deck.dc.html: копии, базовые покемоны, 60 карт
  const checks: DeckCheck[] = [];

  // Имена в том виде, в каком их видит человек: первое встреченное написание
  const byName = new Map<string, { name: string; count: number }>();
  for (const line of counted) {
    if (line.info.basicEnergy) continue;
    const key = nameKey(line.info.name);
    const entry = byName.get(key) ?? { name: line.info.name, count: 0 };
    entry.count += line.count;
    byName.set(key, entry);
  }
  const over = [...byName.values()].filter((entry) => entry.count > MAX_SAME_NAME);
  checks.push({
    id: 'copies',
    ok: over.length === 0,
    text:
      over.length === 0
        ? `Не больше ${MAX_SAME_NAME} копий одной карты`
        : `Больше ${MAX_SAME_NAME} копий: ${over.map((entry) => `${entry.name} — ${entry.count}`).join(', ')}`,
  });

  const hasBasic = counted.some((line) => line.info.basicPokemon);
  // Базовый покемон может прятаться среди карт без данных, но не среди убранных из альбома
  const unknownOwned = counted.some((line) => line.info.category === null && line.owned > 0);
  checks.push({
    id: 'basic',
    ok: hasBasic,
    text: hasBasic
      ? 'Есть базовые покемоны'
      : unknownOwned
        ? 'Нет базового покемона среди карт из базы'
        : 'Нет ни одного базового покемона',
  });

  const aceSpecs = countOf(counted, (info) => info.aceSpec);
  if (aceSpecs > 0) {
    checks.push({
      id: 'aceSpec',
      ok: aceSpecs <= MAX_ACE_SPEC,
      text: aceSpecs <= MAX_ACE_SPEC ? 'Одна карта ACE SPEC' : `В колоде ${countLabel(aceSpecs, CARDS)} ACE SPEC — можно одну`,
    });
  }

  const radiants = countOf(counted, (info) => info.radiant);
  if (radiants > 0) {
    checks.push({
      id: 'radiant',
      ok: radiants <= MAX_RADIANT,
      text: radiants <= MAX_RADIANT ? 'Один покемон Radiant' : `В колоде ${countLabel(radiants, POKEMON)} Radiant — можно одного`,
    });
  }

  checks.push({
    id: 'size',
    ok: total === DECK_SIZE,
    text:
      total === DECK_SIZE
        ? `Ровно ${DECK_SIZE} карт`
        : total < DECK_SIZE
          ? `Не хватает ${DECK_SIZE - total} до ${DECK_SIZE}`
          : `Лишние ${total - DECK_SIZE}: нужно ровно ${DECK_SIZE}`,
  });

  const missing = counted.filter((line) => line.count > line.owned);
  if (missing.length > 0) {
    const copies = missing.reduce((sum, line) => sum + line.count - line.owned, 0);
    checks.push({
      id: 'owned',
      ok: false,
      text: `В альбоме не хватает ${countLabel(copies, CARDS_GENITIVE)} из колоды`,
    });
  }

  const problems = checks.filter((check) => !check.ok).map((check) => check.text);
  return { total, byCategory, checks, problems, ready: problems.length === 0 };
}

/** «Колода готова к игре» / «Добавь ещё 18 карт, чтобы играть» / «Убери 3 карты» / «Исправь колоду». */
export function readinessHint(report: DeckReport): string {
  if (report.ready) return 'Колода готова к игре';
  if (report.total < DECK_SIZE) return `Добавь ещё ${countLabel(DECK_SIZE - report.total, CARDS_ACCUSATIVE)}, чтобы играть`;
  if (report.total > DECK_SIZE) return `Убери ${countLabel(report.total - DECK_SIZE, CARDS_ACCUSATIVE)}, чтобы играть`;
  return 'Исправь колоду, чтобы играть';
}
