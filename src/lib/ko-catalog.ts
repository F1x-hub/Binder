import { cacheGet, cachePut, cached } from '@/lib/kv-cache';
import { englishNameOf } from '@/lib/limitless';
import { localIdVariants, normalizeNumber, sameNumber } from '@/lib/matching';
import { CatalogError, type CardBrief, type CardDetail, type SetBrief, type SetDetail } from '@/lib/tcgdex';

/**
 * Каталог корейских карт. У TCGdex корейский каталог почти пустой (95 сетов, карты в трёх,
 * сканов нет; проверено 21 ноября 2026). Официальная база — https://pokemoncard.co.kr: страницы
 * карт отдаются обычным GET, а поиск и списки идут через их внутренний запрос, который без их
 * страницы отвечает «접근불가» (доступ запрещён). Поэтому карты берутся из двух открытых
 * выгрузок этой базы на GitHub (raw.githubusercontent.com и api.github.com отдают их с CORS *):
 *
 * - https://github.com/ce-dric/pokecard-kr — один JSON на сет (src/data/sets/{сет}.json) со всеми
 *   картами, включая секретные, ID карты на официальном сайте и японским именем. Сетов немного
 *   (с SV5a и дальше, все MEGA), но обновляется через дни после выхода сета.
 * - https://github.com/type-null/PTCG-database — data_ko/{СЕТ}/{номер}.json, по файлу на карту,
 *   264 сета с самых старых; печать «Master Ball»/«Poké Ball» — файл «{номер}-2.json» (реверс).
 *   Последний раз собиралась 16 сентября 2026: у M6a нет карт после 103-й.
 *
 * Если сет есть у ce-dric, берётся он (полный), иначе type-null. Корейские сеты повторяют
 * японские: тот же код сета, тот же номер, тот же состав (SV4K #001 — 야나프 и ヤナップ), поэтому
 * ID карты — «{код сета}-{номер}», как у японского каталога TCGdex («SV2a-094»), и английское имя
 * берётся у японской пары из Limitless. Сканы — с официального сайта (webp 70–360 КБ, без CORS:
 * картинке он не нужен). Наружу каталог выглядит как каталог TCGdex.
 */

const CEDRIC_RAW = 'https://raw.githubusercontent.com/ce-dric/pokecard-kr/main/src/data/sets';
const CEDRIC_LIST = 'https://api.github.com/repos/ce-dric/pokecard-kr/contents/src/data/sets';
const TYPENULL_RAW = 'https://raw.githubusercontent.com/type-null/PTCG-database/main/data_ko';
const TYPENULL_LIST = 'https://api.github.com/repos/type-null/PTCG-database/contents/data_ko';
/** Сканы официального сайта; старый адрес cards.image.pokemonkorea.co.kr больше не отвечает */
export const KO_IMAGES = 'https://pokemoncard.co.kr/public-assets/home/data/cards.image_www/data/wmimages';
const OLD_IMAGES = /^https?:\/\/cards\.image\.pokemonkorea\.co\.kr\/data\/wmimages\//i;

const DAY = 24 * 60 * 60 * 1000;
/** Меняется вместе с формой записей в кэше */
const VERSION = 1;

// ---- Сырые данные (только то, что читаем) ----

export type CedricCard = {
  number: string;
  printedIn?: string;
  nameKo?: string;
  nameJa?: string;
  rarity?: string;
  type?: string | null;
  category?: string;
  stage?: string;
  hp?: number | null;
  illustrator?: string | null;
  krCardId?: string;
};

export type CedricSet = {
  id: string;
  nameKo?: string;
  productNameKo?: string;
  series?: string;
  regulation?: string;
  expansionMark?: string;
  releaseDateKr?: string;
  printedTotal?: number;
  cards: CedricCard[];
};

type RawAttack = { cost?: string[]; name?: string; damage?: string | null; effect?: string | null };

export type TypenullCard = {
  name?: string;
  img?: string;
  card_type?: string;
  ko_id?: string;
  regulation?: string;
  set_name?: string;
  set_full_name?: string;
  number?: string;
  set_total?: string;
  rarity?: string;
  author?: string[];
  stage?: string;
  hp?: number;
  types?: string[];
  types_en?: string[];
  attacks?: RawAttack[];
  ability?: Array<{ name?: string; effect?: string }>;
  effect?: string;
  weakness?: { type?: string[]; value?: string | null };
  resistance?: { type?: string[]; value?: string | null };
  retreat?: number;
  flavor_text?: string;
};

// ---- Каталог ----

/** Карта корейского каталога: сведения в форме карточки TCGdex, чтобы их читал тот же код. */
export type KoCard = {
  id: string;
  setId: string;
  localId: string;
  name: string;
  image?: string;
  facts: Record<string, unknown>;
};

export type KoSet = { id: string; name: string; official: number; releaseDate: string | null; serie: string | null; cards: KoCard[] };

/** Сет в списке: откуда его брать. */
export type KoSetRef = { id: string; source: 'cedric' | 'typenull' };

const TYPES: Record<string, string> = {
  grass: 'Grass',
  fire: 'Fire',
  water: 'Water',
  electric: 'Lightning',
  lightning: 'Lightning',
  psychic: 'Psychic',
  fighting: 'Fighting',
  dark: 'Darkness',
  darkness: 'Darkness',
  steel: 'Metal',
  metal: 'Metal',
  fairy: 'Fairy',
  dragon: 'Dragon',
  colorless: 'Colorless',
};

const RARITIES: Record<string, string> = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  RR: 'Double Rare',
  RRR: 'Triple Rare',
  PR: 'Promo',
  TR: 'Trainer Rare',
  AR: 'Art Rare',
  SAR: 'Special Art Rare',
  SR: 'Super Rare',
  SSR: 'Shiny Super Rare',
  S: 'Shiny Rare',
  HR: 'Hyper Rare',
  UR: 'Ultra Rare',
  MUR: 'Mega Ultra Rare',
  FUR: 'Full Art Ultra Rare',
  CHR: 'Character Rare',
  CSR: 'Character Super Rare',
  K: 'Radiant Rare',
  A: 'ACE SPEC Rare',
  ACE: 'ACE SPEC Rare',
};

/** Редкости, у которых обычная печать — голо (у остальных есть обычная и реверс). */
const PLAIN_RARITIES = new Set(['', 'C', 'U', 'R']);

const STAGES: Record<string, string> = {
  basic: 'Basic',
  stage1: 'Stage1',
  stage2: 'Stage2',
  기본: 'Basic',
  '1진화': 'Stage1',
  '2진화': 'Stage2',
  BREAK진화: 'BREAK',
  복원: 'Restored',
};

const TRAINER_TYPES: Record<string, string> = {
  item: 'Item',
  supporter: 'Supporter',
  stadium: 'Stadium',
  tool: 'Tool',
  아이템: 'Item',
  서포트: 'Supporter',
  스타디움: 'Stadium',
  '포켓몬의 도구': 'Tool',
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function variantsOf(rarity: string, reverse: boolean): Record<string, boolean> {
  const plain = PLAIN_RARITIES.has(rarity);
  return { normal: plain, holo: !plain, reverse };
}

/** Скан ce-dric: имя файла на официальном сайте — последние три цифры ID карты там («BS2026006169» → «…_169»). */
export function cedricImage(set: Pick<CedricSet, 'series' | 'expansionMark'>, card: Pick<CedricCard, 'krCardId'>): string | undefined {
  const tail = card.krCardId?.match(/(\d{3})$/)?.[1];
  const mark = set.expansionMark;
  if (!tail || !mark || !set.series || !/^[A-Za-z0-9]+$/.test(set.series)) return undefined;
  return `${KO_IMAGES}/${set.series}/${mark}/${mark}_${tail}.webp`;
}

/** Скан type-null: старый адрес png → тот же путь на новом адресе в webp. */
export function typenullImage(img: string | undefined): string | undefined {
  if (!img || !OLD_IMAGES.test(img)) return undefined;
  return img.replace(OLD_IMAGES, `${KO_IMAGES}/`).replace(/\.png(?:\?.*)?$/i, '.webp');
}

const idPart = (value: string) => value.trim().replace(/[^A-Za-z0-9]+/g, '') || '0';

/** ID карты: «{код сета}-{номер}», как у японского каталога TCGdex. */
export function koCardId(setId: string, number: string): string {
  return `${setId}-${idPart(number)}`;
}

export function cedricFacts(set: CedricSet, card: CedricCard): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const category = card.category === 'pokemon' ? 'Pokemon' : card.category === 'trainer' ? 'Trainer' : card.category === 'energy' ? 'Energy' : undefined;
  if (category) facts.category = category;
  const type = card.type ? TYPES[card.type] : undefined;
  if (type && category === 'Pokemon') facts.types = [type];
  if (category === 'Pokemon' && card.stage && STAGES[card.stage]) facts.stage = STAGES[card.stage];
  if (category === 'Trainer' && card.stage && TRAINER_TYPES[card.stage]) facts.trainerType = TRAINER_TYPES[card.stage];
  if (card.stage === 'basic-energy') facts.energyType = 'Normal';
  else if (card.stage === 'special-energy') facts.energyType = 'Special';
  if (typeof card.hp === 'number' && card.hp > 0) facts.hp = card.hp;
  const rarity = (card.rarity ?? '').trim();
  if (rarity) facts.rarity = RARITIES[rarity] ?? rarity;
  const illustrator = text(card.illustrator);
  if (illustrator) facts.illustrator = illustrator;
  if (set.regulation && /^[A-Z]$/.test(set.regulation)) facts.regulationMark = set.regulation;
  facts.variants = variantsOf(rarity, PLAIN_RARITIES.has(rarity) && category !== 'Energy');
  return facts;
}

function typesOf(card: TypenullCard): string[] {
  return (card.types_en ?? card.types ?? []).map((type) => TYPES[type.toLowerCase()] ?? type).filter(Boolean);
}

export function typenullFacts(card: TypenullCard, reverse: boolean): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const kind = (card.card_type ?? '').trim();
  const category = kind === 'Pokémon' || kind === 'Pokemon' ? 'Pokemon' : kind.includes('에너지') ? 'Energy' : kind ? 'Trainer' : undefined;
  if (category) facts.category = category;
  if (category === 'Pokemon') {
    const types = typesOf(card);
    if (types.length > 0) facts.types = types.slice(0, 2);
    const stage = card.stage ? (STAGES[card.stage.trim()] ?? card.stage.trim()) : undefined;
    if (stage) facts.stage = stage;
    if (typeof card.hp === 'number' && card.hp > 0) facts.hp = card.hp;
    const abilities = (card.ability ?? []).flatMap((item) => (item.name ? [{ type: 'Ability', name: item.name, effect: text(item.effect) ?? '' }] : []));
    if (abilities.length > 0) facts.abilities = abilities;
    const attacks = (card.attacks ?? []).flatMap((attack) =>
      attack.name
        ? [
            {
              name: attack.name,
              cost: (attack.cost ?? []).map((type) => TYPES[type.toLowerCase()] ?? type),
              ...(text(attack.damage) ? { damage: text(attack.damage) } : {}),
              ...(text(attack.effect) ? { effect: text(attack.effect) } : {}),
            },
          ]
        : [],
    );
    if (attacks.length > 0) facts.attacks = attacks;
    const weakness = card.weakness?.type?.[0];
    if (weakness) facts.weaknesses = [{ type: TYPES[weakness.toLowerCase()] ?? weakness, value: text(card.weakness?.value) ?? null }];
    const resistance = card.resistance?.type?.[0];
    if (resistance) facts.resistances = [{ type: TYPES[resistance.toLowerCase()] ?? resistance, value: text(card.resistance?.value) ?? null }];
    if (typeof card.retreat === 'number') facts.retreat = card.retreat;
    const description = text(card.flavor_text);
    if (description) facts.description = description;
  } else if (category === 'Trainer') {
    if (TRAINER_TYPES[kind]) facts.trainerType = TRAINER_TYPES[kind];
    if (text(card.effect)) facts.effect = text(card.effect);
  } else if (category === 'Energy') {
    facts.energyType = kind.startsWith('기본') ? 'Normal' : 'Special';
    if (text(card.effect)) facts.effect = text(card.effect);
  }
  const rarity = (card.rarity ?? '').trim();
  if (rarity) facts.rarity = RARITIES[rarity] ?? rarity;
  const illustrator = (card.author ?? []).filter(Boolean).join(', ');
  if (illustrator) facts.illustrator = illustrator;
  if (card.regulation && /^[A-Z]$/.test(card.regulation)) facts.regulationMark = card.regulation;
  facts.variants = variantsOf(rarity, reverse);
  return facts;
}

/** Сет ce-dric в каталог. */
export function cedricSet(raw: CedricSet): KoSet {
  const id = raw.expansionMark?.trim() || raw.id;
  const seen = new Set<string>();
  const cards: KoCard[] = [];
  for (const card of raw.cards ?? []) {
    const number = card.number?.trim();
    if (!number) continue;
    const cardId = koCardId(id, number);
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    const image = cedricImage({ ...raw, expansionMark: id }, card);
    cards.push({ id: cardId, setId: id, localId: number, name: (card.nameKo ?? '').trim(), ...(image ? { image } : {}), facts: cedricFacts(raw, card) });
  }
  return {
    id,
    name: (raw.productNameKo ?? raw.nameKo ?? id).trim(),
    official: raw.printedTotal ?? cards.length,
    releaseDate: raw.releaseDateKr && /^\d{4}-\d{2}-\d{2}$/.test(raw.releaseDateKr) ? raw.releaseDateKr : null,
    serie: raw.series ?? null,
    cards,
  };
}

/** Карта type-null в карту каталога. */
export function typenullCard(setId: string, raw: TypenullCard, reverse: boolean): KoCard | null {
  const number = raw.number?.trim();
  if (!number || !raw.name) return null;
  const image = typenullImage(raw.img);
  return { id: koCardId(setId, number), setId, localId: number, name: raw.name.trim(), ...(image ? { image } : {}), facts: typenullFacts(raw, reverse) };
}

function compareNumbers(a: string, b: string): number {
  const left = Number(normalizeNumber(a));
  const right = Number(normalizeNumber(b));
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  if (Number.isFinite(left)) return -1;
  if (Number.isFinite(right)) return 1;
  return a.localeCompare(b);
}

// ---- Сеть ----

async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new CatalogError('unavailable');
  }
  if (response.status === 404) throw new CatalogError('not-found');
  if (!response.ok) throw new CatalogError('unavailable');
  return (await response.json()) as T;
}

type GithubEntry = { name: string; type: string };

let refsInMemory: Promise<KoSetRef[]> | null = null;

/**
 * Список сетов обеих выгрузок, раз в неделю (два запроса к api.github.com, лимит — 60 в час
 * на адрес). Если одна выгрузка не ответила (лимит, нет связи), берётся прежний список,
 * а без него — неполный, но такой не запоминается: иначе сеты ce-dric пропали бы на неделю.
 */
function setRefs(): Promise<KoSetRef[]> {
  refsInMemory ??= loadRefs().catch((error: unknown) => {
    refsInMemory = null;
    throw error;
  });
  return refsInMemory;
}

async function loadRefs(): Promise<KoSetRef[]> {
  const key = `ko:sets:v${VERSION}`;
  const fresh = await cacheGet<KoSetRef[]>(key, 7 * DAY);
  if (fresh) return fresh;
  const [cedric, typenull] = await Promise.all([
    getJson<GithubEntry[]>(CEDRIC_LIST).catch(() => null),
    getJson<GithubEntry[]>(TYPENULL_LIST).catch(() => null),
  ]);
  const refs = refsFrom(Array.isArray(cedric) ? cedric : [], Array.isArray(typenull) ? typenull : []);
  if (Array.isArray(cedric) && Array.isArray(typenull) && refs.length > 0) {
    void cachePut(key, refs);
    return refs;
  }
  const stale = await cacheGet<KoSetRef[]>(key, Number.POSITIVE_INFINITY);
  if (stale) return stale;
  if (refs.length === 0) throw new CatalogError('unavailable');
  // Неполный список живёт только в памяти вкладки, до следующей загрузки страницы
  return refs;
}

/** Только для тестов: забыть список сетов в памяти. */
export function resetKoCatalogForTests(): void {
  refsInMemory = null;
}

function refsFrom(cedric: GithubEntry[], typenull: GithubEntry[]): KoSetRef[] {
  const refs = new Map<string, KoSetRef>();
  // У type-null папки названы кодом сета как на карте («SV2a»), у ce-dric файлы — в нижнем регистре
  for (const entry of typenull) {
    if (entry.type === 'dir' && /^[A-Za-z0-9._+-]{1,30}$/.test(entry.name)) refs.set(entry.name.toLowerCase(), { id: entry.name, source: 'typenull' });
  }
  for (const entry of cedric) {
    const match = entry.type === 'file' ? entry.name.match(/^([A-Za-z0-9._-]{1,30})\.json$/) : null;
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    refs.set(key, { id: refs.get(key)?.id ?? match[1]!, source: 'cedric' });
  }
  return [...refs.values()];
}

async function findRef(setId: string): Promise<KoSetRef | null> {
  const wanted = setId.trim().toLowerCase();
  return (await setRefs()).find((ref) => ref.id.toLowerCase() === wanted) ?? null;
}

function loadCedric(ref: KoSetRef): Promise<KoSet> {
  return cached(`ko:cedric:v${VERSION}:${ref.id.toLowerCase()}`, 7 * DAY, async () =>
    cedricSet(await getJson<CedricSet>(`${CEDRIC_RAW}/${encodeURIComponent(ref.id.toLowerCase())}.json`)),
  );
}

/** Одна карта type-null: файл «{номер}.json» в папке сета. Не нашлась — null (помнится, как и найденная, 30 дней: выгрузка обновляется редко). */
function typenullFile(setId: string, file: string): Promise<TypenullCard | null> {
  return cached(`ko:tn:v${VERSION}:${setId}/${file}`, 30 * DAY, () =>
    getJson<TypenullCard>(`${TYPENULL_RAW}/${encodeURIComponent(setId)}/${encodeURIComponent(file)}.json`).catch((error: unknown) => {
      if (error instanceof CatalogError && error.reason === 'not-found') return null;
      throw error;
    }),
  );
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}

/** Сет type-null целиком: список файлов (один запрос к api.github.com) и по запросу на карту, по 6 за раз. */
function loadTypenull(ref: KoSetRef): Promise<KoSet> {
  return cached(`ko:tnset:v${VERSION}:${ref.id}`, 30 * DAY, async () => {
    const files = (await getJson<GithubEntry[]>(`${TYPENULL_LIST}/${encodeURIComponent(ref.id)}`))
      .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -5));
    const bases = files.filter((name) => !/-\d+$/.test(name));
    const mirrored = new Set(files.filter((name) => /-\d+$/.test(name)).map((name) => name.replace(/-\d+$/, '')));
    const raws = await mapLimit(bases, 6, (file) => typenullFile(ref.id, file).catch(() => null));
    const cards: KoCard[] = [];
    let name = ref.id;
    let official = 0;
    for (const [index, raw] of raws.entries()) {
      if (!raw) continue;
      const card = typenullCard(ref.id, raw, mirrored.has(bases[index]!));
      if (!card) continue;
      cards.push(card);
      name = raw.set_full_name?.trim() || name;
      const total = Number(normalizeNumber(raw.set_total ?? ''));
      if (Number.isFinite(total) && total > official) official = total;
    }
    if (cards.length === 0) throw new CatalogError('unavailable');
    cards.sort((a, b) => compareNumbers(a.localId, b.localId));
    return { id: ref.id, name, official: official || cards.length, releaseDate: null, serie: null, cards };
  });
}

function loadSet(ref: KoSetRef): Promise<KoSet> {
  return ref.source === 'cedric' ? loadCedric(ref) : loadTypenull(ref);
}

/** Карта и сведения о её сете без загрузки всего сета (для сканера). */
export type KoHit = { card: KoCard; setName: string; official: number; releaseDate: string | null };

/**
 * Карта по коду сета и номеру. У сета ce-dric это весь сет одним файлом, у type-null — один
 * файл карты: сканеру не нужно грузить сотни файлов ради одной карты.
 */
async function findCard(setCode: string, number: string): Promise<KoHit | null> {
  const ref = await findRef(setCode);
  if (!ref) return null;
  if (ref.source === 'cedric') {
    const set = await loadCedric(ref);
    const card = set.cards.find((item) => sameNumber(item.localId, number));
    return card ? { card, setName: set.name, official: set.official, releaseDate: set.releaseDate } : null;
  }
  for (const file of localIdVariants(number)) {
    const raw = await typenullFile(ref.id, file);
    const card = raw && typenullCard(ref.id, raw, false);
    if (!card) continue;
    const total = Number(normalizeNumber(raw.set_total ?? ''));
    const mirror = await typenullFile(ref.id, `${file}-2`).catch(() => null);
    if (mirror) card.facts = typenullFacts(raw, true);
    return { card, setName: raw.set_full_name?.trim() || ref.id, official: Number.isFinite(total) && total > 0 ? total : 0, releaseDate: null };
  }
  return null;
}

/** ID карты в код сета и номер: номер — после последнего «-» (в кодах сетов дефис бывает: «S8a-G»). */
export function splitKoId(id: string): { setId: string; number: string } | null {
  const at = id.lastIndexOf('-');
  return at > 0 && at < id.length - 1 ? { setId: id.slice(0, at), number: id.slice(at + 1) } : null;
}

// ---- Каталог в виде TCGdex ----

export function koBrief(card: KoCard): CardBrief & { setId: string } {
  return { id: card.id, localId: card.localId, name: card.name, setId: card.setId, ...(card.image ? { image: card.image } : {}) };
}

export function koSetDetail(set: KoSet): SetDetail {
  return {
    id: set.id,
    name: set.name,
    cardCount: { official: set.official, total: set.cards.length },
    ...(set.releaseDate ? { releaseDate: set.releaseDate } : {}),
    ...(set.serie ? { serie: { id: set.serie, name: set.serie } } : {}),
    cards: set.cards.map(koBrief),
  };
}

export function koCardDetail(hit: KoHit): CardDetail {
  return {
    ...koBrief(hit.card),
    ...hit.card.facts,
    set: { id: hit.card.setId, name: hit.setName, cardCount: { official: hit.official, total: hit.official } },
  } as CardDetail;
}

export const koCatalog = {
  /** Сеты без числа карт: оно известно только после загрузки сета */
  sets: async (): Promise<SetBrief[]> => (await setRefs()).map((ref) => ({ id: ref.id, name: ref.id, cardCount: { official: 0, total: 0 } })),
  set: async (id: string): Promise<SetDetail> => {
    const ref = await findRef(id);
    if (!ref) throw new CatalogError('not-found');
    return koSetDetail(await loadSet(ref));
  },
  card: async (id: string): Promise<CardDetail> => {
    const parts = splitKoId(id);
    const hit = parts ? await findCard(parts.setId, parts.number) : null;
    if (!hit || hit.card.id !== id) throw new CatalogError('not-found');
    return koCardDetail(hit);
  },
  /** Карта по коду сета и номеру с названием сета и официальным числом карт; null — такой нет */
  find: findCard,
  /** Английское имя: у японской пары под тем же кодом сета и номером (перевод Limitless) */
  englishName: async (id: string): Promise<string | null> => {
    const parts = splitKoId(id);
    return parts ? englishNameOf(parts.setId, parts.number) : null;
  },
};
