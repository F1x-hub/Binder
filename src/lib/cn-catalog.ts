import { cached } from '@/lib/kv-cache';
import { normalizeNumber, sameNumber, searchName } from '@/lib/matching';
import { englishNameFrom, pikaqianNames } from '@/lib/pikaqian';
import { CatalogError, type CardBrief, type CardDetail, type SetBrief, type SetDetail } from '@/lib/tcgdex';

/**
 * Каталог китайских карт для КНР (упрощённые иероглифы). У TCGdex такого каталога нет:
 * сеты есть, а карт в них нет (проверено 21 ноября 2026). Своего сайта с базой у издания
 * тоже нет: официальная база живёт в мини-программе WeChat «宝可梦卡牌会员». Её выгрузку
 * выкладывает открытый набор данных https://github.com/duanxr/PTCG-CHS-Datasets: один JSON
 * на 28 МБ (по сети 4 МБ в gzip), все карты со сканами, обновляется через несколько дней
 * после выхода сета. raw.githubusercontent.com отдаёт его с CORS *, прав в манифесте не нужно.
 *
 * Браузер скачивает JSON раз в неделю, сжимает до нужного (buildCnIndex) и хранит в IndexedDB:
 * так новые сеты приходят сами, без новой сборки расширения. Наружу каталог выглядит
 * как каталог TCGdex (сеты, карты, карточки), поэтому сканер, альбом, колоды и страница
 * карточки работают с ним так же, как с японским или тайваньским каталогом.
 */

const REPO = 'https://raw.githubusercontent.com/duanxr/PTCG-CHS-Datasets/main';
export const CN_DATASET_URL = `${REPO}/ptcg_chs_infos.json`;
const DAY = 24 * 60 * 60 * 1000;
/** Набор обновляется раз в несколько дней; чаще недели скачивать 4 МБ незачем */
export const CN_INDEX_MAX_AGE = 7 * DAY;
/** Меняется вместе с формой CnIndex: старый кэш тогда не читается */
const INDEX_VERSION = 1;

// ---- Сырой набор (только то, что мы читаем) ----

type RawDict = { dictCode: string; dictValue: string };

type RawAbility = { abilityName?: string; abilityText?: string; abilityCost?: string; abilityDamage?: string };

type RawDetails = {
  cardName?: string;
  collectionNumber?: string;
  rarityText?: string;
  hp?: number;
  attribute?: string;
  cardType?: string;
  evolveText?: string;
  pokemonType?: string;
  regulationMarkText?: string;
  abilityItemList?: RawAbility[];
  cardFeatureItemList?: Array<{ featureName?: string; featureDesc?: string }>;
  skills?: Array<{ name?: string; desc?: string; related?: string }>;
  ruleText?: string;
  weaknessType?: string;
  weaknessFormula?: string;
  resistanceType?: string;
  resistanceFormula?: string;
  retreatCost?: number;
  illustratorName?: string[];
  commodityList?: Array<{ commodityCode?: string }>;
  trainerType?: string;
  energyType?: string;
  specialCard?: string;
  pokedexText?: string;
  special_shiny_type?: number;
};

type RawCard = { id: number; name?: string; yorenCode?: string; image?: string; details?: RawDetails };

type RawCollection = { commodityCode: string; name?: string; salesDate?: string; seriesText?: string; series?: string; cards?: RawCard[] };

export type RawCnDataset = { dict?: Record<string, RawDict[]>; collections: RawCollection[] };

// ---- Сжатый каталог ----

/** Печать карты: o — ID карты в официальной базе (он же we_chat_id у PikaQian), s — блеск (0 — обычная), i — путь к скану. */
export type CnPrint = { o: number; s: number; i: string };

/** Карта каталога. Сведения лежат в форме карточки TCGdex, чтобы их читал тот же код. */
export type CnCard = {
  id: string;
  localId: string;
  /** Номер как напечатан: «161/127», «030/SV-P», «GRA» */
  number: string;
  name: string;
  prints: CnPrint[];
  facts: Record<string, unknown>;
};

export type CnSet = {
  id: string;
  name: string;
  releaseDate: string | null;
  serie: string | null;
  official: number;
  cards: CnCard[];
};

export type CnIndex = { version: number; sets: CnSet[] };

const TYPES: Record<string, string> = {
  '1': 'Grass',
  '2': 'Fire',
  '3': 'Water',
  '4': 'Lightning',
  '5': 'Psychic',
  '6': 'Fighting',
  '7': 'Darkness',
  '8': 'Metal',
  '9': 'Fairy',
  '10': 'Dragon',
  '11': 'Colorless',
};

const TRAINER_TYPES: Record<string, string> = { '1': 'Item', '2': 'Supporter', '3': 'Stadium', '4': 'Tool' };

/** Редкости официальной базы. «★» в конце — блестящая печать той же карты, а не редкость. */
const RARITIES: Record<string, string> = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  PR: 'Promo',
  RR: 'Double Rare',
  RRR: 'Triple Rare',
  S: 'Shiny Rare',
  SR: 'Super Rare',
  SSR: 'Shiny Super Rare',
  CHR: 'Character Rare',
  CSR: 'Character Super Rare',
  A: 'ACE SPEC Rare',
  AR: 'Art Rare',
  SAR: 'Special Art Rare',
  K: 'Radiant Rare',
  HR: 'Hyper Rare',
  UR: 'Ultra Rare',
  FUR: 'Full Art Ultra Rare',
  '●': 'Common',
  '◆': 'Uncommon',
};

/** Редкости, у которых обычная печать — голо. */
const HOLO_RARITIES = new Set(['RR', 'RRR', 'SR', 'SSR', 'CHR', 'CSR', 'AR', 'SAR', 'K', 'HR', 'UR', 'FUR', 'S', 'A']);

const STAGES: Record<string, string> = {
  基础: 'Basic',
  '1阶进化': 'Stage1',
  '2阶进化': 'Stage2',
  'LV.X': 'LV.X',
  传说: 'LEGEND',
  M进化: 'MEGA',
  BREAK进化: 'BREAK',
  'V-UNION': 'V-UNION',
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function costOf(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((code) => TYPES[code.trim()])
    .filter((type): type is string => Boolean(type));
}

/** Базовая редкость печати: «C★★» → «C». */
function rarityCode(value: string | undefined): string | null {
  const code = (value ?? '').replace(/★+$/u, '').trim();
  return code && code !== '无标记' ? code : null;
}

function stageOf(details: RawDetails): string | undefined {
  const evolve = text(details.evolveText);
  if (!evolve) return undefined;
  if (evolve === 'V进化') {
    const kinds = (details.pokemonType ?? '').split('|');
    if (kinds.includes('2')) return 'VMAX';
    if (kinds.includes('3')) return 'VSTAR';
    return 'Stage1';
  }
  return STAGES[evolve] ?? evolve;
}

/** Сведения карты в форме карточки TCGdex (поля, которые читают card-facts, фильтры и колоды). */
export function factsOf(details: RawDetails, prints: CnPrint[]): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const category = details.cardType === '1' ? 'Pokemon' : details.cardType === '2' ? 'Trainer' : details.cardType === '3' ? 'Energy' : undefined;
  if (category) facts.category = category;
  if (typeof details.hp === 'number' && details.hp > 0) facts.hp = details.hp;
  const type = details.attribute ? TYPES[details.attribute] : undefined;
  if (type && category === 'Pokemon') facts.types = [type];
  const stage = category === 'Pokemon' ? stageOf(details) : undefined;
  if (stage) facts.stage = stage;

  const code = rarityCode(details.rarityText);
  const kinds = (details.pokemonType ?? '').split('|');
  let rarity = code ? (RARITIES[code] ?? code) : undefined;
  if (details.specialCard === '9') rarity = 'ACE SPEC Rare';
  else if (kinds.includes('7')) rarity = 'Radiant Rare';
  if (rarity) facts.rarity = rarity;

  const abilities = [
    ...(details.cardFeatureItemList ?? []).flatMap((item) =>
      item.featureName ? [{ type: 'Ability', name: item.featureName, effect: text(item.featureDesc) ?? '' }] : [],
    ),
    ...(details.skills ?? []).flatMap((item) =>
      item.name ? [{ type: item.related === 'vstar' ? 'VSTAR Power' : 'Ability', name: item.name, effect: text(item.desc) ?? '' }] : [],
    ),
  ];
  if (abilities.length > 0) facts.abilities = abilities;
  const rules = (details.ruleText ?? '').split('|').map((part) => part.trim()).filter(Boolean);
  if (category === 'Pokemon') {
    const attacks = (details.abilityItemList ?? []).flatMap((attack) => {
      if (!attack.abilityName) return [];
      const damage = attack.abilityDamage && attack.abilityDamage !== 'none' ? attack.abilityDamage : undefined;
      return [{ name: attack.abilityName, cost: costOf(attack.abilityCost), ...(damage ? { damage } : {}), ...(text(attack.abilityText) ? { effect: text(attack.abilityText) } : {}) }];
    });
    if (attacks.length > 0) facts.attacks = attacks;
  } else if (rules.length > 0) {
    // У тренера и энергии первая часть — текст карты, вторая — общее правило («можно сыграть 1 помощника»)
    facts.effect = rules.join('\n');
  }
  const weakness = details.weaknessType ? TYPES[details.weaknessType] : undefined;
  if (weakness) facts.weaknesses = [{ type: weakness, value: text(details.weaknessFormula) ?? null }];
  const resistance = details.resistanceType ? TYPES[details.resistanceType] : undefined;
  if (resistance) facts.resistances = [{ type: resistance, value: text(details.resistanceFormula) ?? null }];
  if (typeof details.retreatCost === 'number') facts.retreat = details.retreatCost;
  if (details.trainerType && TRAINER_TYPES[details.trainerType]) facts.trainerType = TRAINER_TYPES[details.trainerType];
  if (details.energyType === '1') facts.energyType = 'Normal';
  else if (details.energyType === '2') facts.energyType = 'Special';
  const illustrator = (details.illustratorName ?? []).filter(Boolean).join(', ');
  if (illustrator) facts.illustrator = illustrator;
  const mark = text(details.regulationMarkText);
  if (mark && /^[A-Z]$/.test(mark)) facts.regulationMark = mark;
  const description = text(details.pokedexText);
  if (description) facts.description = description;

  const holo = Boolean(code && HOLO_RARITIES.has(code));
  facts.variants = {
    normal: !holo && prints.some((print) => print.s === 0),
    holo: holo,
    reverse: prints.some((print) => print.s > 0),
  };
  return facts;
}

/** Номер для поиска и ID: «161/127» → «161», «01 02/07» → «01 02», «GRA» → «GRA». */
export function localIdOf(collectionNumber: string | undefined): string {
  const number = (collectionNumber ?? '').trim();
  const [left] = number.split('/');
  return (left ?? '').trim() || number || '0';
}

const idPart = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '') || '0';

/** Самое частое число после дроби: столько карт в сете официально. */
function officialTotal(cards: CnCard[]): number {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const total = card.number.split('/')[1]?.trim();
    if (total && /^\d+$/.test(total)) counts.set(Number(total), (counts.get(Number(total)) ?? 0) + 1);
  }
  let best = 0;
  let seen = 0;
  for (const [total, count] of counts) if (count > seen) [best, seen] = [total, count];
  return best || cards.length;
}

/**
 * Сырой набор в каталог. Одна карта — одно имя под одним номером в сете; её печати (обычная,
 * «★», «★★») — варианты. Карта, которая лежит в нескольких товарах (сет 151 в коробках
 * 151C1…151C4), относится к самому раннему из них: ID карты не меняется с выходом новых
 * товаров. ID карты — «{код сета}-{номер}», как у TCGdex; если под одним номером в сете
 * разные карты (промо без номера), у всех, кроме самой ранней, в конце «.{ID в базе}».
 */
export function buildCnIndex(raw: RawCnDataset): CnIndex {
  const collections = raw.collections.filter((item) => /^[A-Za-z0-9._-]{1,30}$/.test(item.commodityCode));
  const byCode = new Map(collections.map((item, index) => [item.commodityCode, { item, index }]));
  const order = (code: string) => {
    const found = byCode.get(code);
    return found ? `${found.item.salesDate ?? '9999'}|${String(1e6 - found.index).padStart(7, '0')}` : '~';
  };
  // Дом карты: самый ранний товар, где она лежит
  const home = new Map<number, string>();
  for (const { commodityCode, cards } of collections) {
    for (const card of cards ?? []) {
      const listed = [commodityCode, ...(card.details?.commodityList ?? []).map((item) => item.commodityCode ?? '')].filter((code) => byCode.has(code));
      const earliest = listed.sort((a, b) => order(a).localeCompare(order(b)))[0]!;
      const current = home.get(card.id);
      if (!current || order(earliest) < order(current)) home.set(card.id, earliest);
    }
  }

  const sets: CnSet[] = [];
  for (const { commodityCode, name, salesDate, seriesText, cards } of collections) {
    const own = (cards ?? []).filter((card) => home.get(card.id) === commodityCode && card.details);
    own.sort((a, b) => a.id - b.id);
    // Карта — имя (yorenCode) под номером; печати — записи с тем же номером и тем же yorenCode
    const groups = new Map<string, RawCard[]>();
    for (const card of own) {
      const key = `${localIdOf(card.details!.collectionNumber)}|${card.yorenCode ?? card.details!.cardName ?? card.id}`;
      const list = groups.get(key) ?? [];
      list.push(card);
      groups.set(key, list);
    }
    const taken = new Set<string>();
    const result: CnCard[] = [];
    for (const list of groups.values()) {
      const base = [...list].sort((a, b) => (a.details!.special_shiny_type ?? 0) - (b.details!.special_shiny_type ?? 0) || a.id - b.id)[0]!;
      const details = base.details!;
      const localId = localIdOf(details.collectionNumber);
      let id = `${commodityCode}-${idPart(localId)}`;
      if (taken.has(id)) id = `${id}.${base.id}`;
      taken.add(id);
      const prints = list
        .filter((card) => card.image)
        .map((card) => ({ o: card.id, s: card.details!.special_shiny_type ?? 0, i: card.image! }))
        .sort((a, b) => a.s - b.s || a.o - b.o);
      result.push({
        id,
        localId,
        number: (details.collectionNumber ?? localId).trim(),
        name: (details.cardName ?? base.name ?? '').trim(),
        prints,
        facts: factsOf(details, prints),
      });
    }
    result.sort((a, b) => compareNumbers(a.localId, b.localId) || a.id.localeCompare(b.id));
    if (result.length === 0) continue;
    sets.push({
      id: commodityCode,
      name: (name ?? commodityCode).trim(),
      releaseDate: salesDate && /^\d{4}-\d{2}-\d{2}$/.test(salesDate) ? salesDate : null,
      serie: seriesText?.trim() || null,
      official: officialTotal(result),
      cards: result,
    });
  }
  // Новые сеты первыми, как у TCGdex в выдаче сканера это неважно, а в списках удобнее
  sets.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  return { version: INDEX_VERSION, sets };
}

function compareNumbers(a: string, b: string): number {
  const left = Number(normalizeNumber(a));
  const right = Number(normalizeNumber(b));
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  if (Number.isFinite(left)) return -1;
  if (Number.isFinite(right)) return 1;
  return a.localeCompare(b);
}

/** Адрес скана печати. */
export function cnImageUrl(path: string): string {
  return `${REPO}/${path.replace(/^\/+/, '')}`;
}

// ---- Каталог в виде TCGdex ----

/** Кратко о карте, как в сете TCGdex; setId — потому что из ID с «.{ID в базе}» сет не вывести. */
export function cnBrief(card: CnCard, setId: string): CardBrief & { setId: string } {
  const base = card.prints[0];
  return { id: card.id, localId: card.localId, name: card.name, setId, ...(base ? { image: cnImageUrl(base.i) } : {}) };
}

export function cnSetBrief(set: CnSet): SetBrief {
  return { id: set.id, name: set.name, cardCount: { official: set.official, total: set.cards.length } };
}

export function cnSetDetail(set: CnSet): SetDetail {
  return {
    ...cnSetBrief(set),
    ...(set.releaseDate ? { releaseDate: set.releaseDate } : {}),
    ...(set.serie ? { serie: { id: set.serie, name: set.serie } } : {}),
    cards: set.cards.map((card) => cnBrief(card, set.id)),
  };
}

export function cnCardDetail(card: CnCard, set: CnSet): CardDetail {
  return {
    ...cnBrief(card, set.id),
    ...card.facts,
    set: { id: set.id, name: set.name, cardCount: { official: set.official, total: set.cards.length } },
  } as CardDetail;
}

/** Поиск по имени и номеру: имя карты содержит искомое (без «ex», «V» и т. п.), номер точный. */
export function searchCnIndex(index: CnIndex, name: string, localId: string): Array<CardBrief & { setId: string }> {
  const wanted = searchName(name).normalize('NFKC');
  if (!wanted) return [];
  const found: Array<CardBrief & { setId: string }> = [];
  for (const set of index.sets) {
    for (const card of set.cards) {
      if (sameNumber(card.localId, localId) && searchName(card.name).normalize('NFKC').includes(wanted)) found.push(cnBrief(card, set.id));
    }
  }
  return found;
}

// ---- Загрузка ----

type Lookup = { index: CnIndex; sets: Map<string, CnSet>; cards: Map<string, { card: CnCard; set: CnSet }> };

let memory: Promise<Lookup> | null = null;

function lookupOf(index: CnIndex): Lookup {
  const sets = new Map(index.sets.map((set) => [set.id, set]));
  const cards = new Map<string, { card: CnCard; set: CnSet }>();
  for (const set of index.sets) for (const card of set.cards) cards.set(card.id, { card, set });
  return { index, sets, cards };
}

async function download(): Promise<CnIndex> {
  let response: Response;
  try {
    response = await fetch(CN_DATASET_URL);
  } catch {
    throw new CatalogError('unavailable');
  }
  if (!response.ok) throw new CatalogError('unavailable');
  const raw = (await response.json()) as RawCnDataset;
  if (!Array.isArray(raw?.collections)) throw new CatalogError('unavailable');
  return buildCnIndex(raw);
}

/** Каталог из памяти вкладки, из IndexedDB (до недели) или из сети. Неудача не запоминается. */
function load(): Promise<Lookup> {
  memory ??= cached(`cn:index:v${INDEX_VERSION}`, CN_INDEX_MAX_AGE, download)
    .then(lookupOf)
    .catch((error: unknown) => {
      memory = null;
      throw error;
    });
  return memory;
}

/** Только для тестов: подложить каталог без сети. */
export function setCnIndexForTests(index: CnIndex | null): void {
  memory = index ? Promise.resolve(lookupOf(index)) : null;
}

export const cnCatalog = {
  sets: async (): Promise<SetBrief[]> => (await load()).index.sets.map(cnSetBrief),
  set: async (id: string): Promise<SetDetail> => {
    const set = (await load()).sets.get(id);
    if (!set) throw new CatalogError('not-found');
    return cnSetDetail(set);
  },
  card: async (id: string): Promise<CardDetail> => {
    const found = (await load()).cards.get(id);
    if (!found) throw new CatalogError('not-found');
    return cnCardDetail(found.card, found.set);
  },
  search: async (name: string, localId: string): Promise<CardBrief[]> => searchCnIndex((await load()).index, name, localId),
  /** Карта и её сет; null — такой карты в каталоге нет */
  find: async (id: string): Promise<{ card: CnCard; set: CnSet } | null> => (await load()).cards.get(id) ?? null,
  /** Английское имя карты из PikaQian (в официальной базе английских имён нет); null — не нашлось */
  englishName: async (id: string): Promise<string | null> => {
    const found = (await load()).cards.get(id);
    if (!found) return null;
    return englishNameFrom(await pikaqianNames(found.set.id), found.card);
  },
};
