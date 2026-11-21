import { findTwCard, searchTwCandidates } from '@/lib/asia-tw';
import { cnCatalog } from '@/lib/cn-catalog';
import { koCatalog, type KoHit } from '@/lib/ko-catalog';
import { cached } from '@/lib/kv-cache';
import { catalogFor, type CardLanguage, type TcgdexLanguage } from '@/lib/languages';
import { englishNameOf, findJapaneseCard, searchJapaneseCards, type LimitlessCard } from '@/lib/limitless';
import {
  NAME_FLOOR,
  READY_SCORE,
  decide,
  lastWord,
  nameScore,
  nameVerdict,
  normalizeNumber,
  sameNumber,
  scoreCandidate,
  scriptOf,
  searchName,
  type Candidate,
  type DetectedCard,
} from '@/lib/matching';
import {
  isPocketCard,
  isPocketId,
  setIdOf,
  tcgdexApi,
  type CardBrief,
  type CardDetail,
  type SetBrief,
  type SetDetail,
} from '@/lib/tcgdex';

const DAY = 24 * 60 * 60 * 1000;

/** Ключ кэша: у английского каталога ключи прежние, у остальных — с языком каталога. */
function cacheKey(lang: TcgdexLanguage, kind: string, id: string): string {
  return lang === 'en' ? `tcgdex:${kind}:${id}` : `tcgdex:${lang}:${kind}:${id}`;
}

/** Ключ карточки TCGdex в кэше: цены (src/lib/prices.ts) кладут туда свежие ответы. */
export function cardCacheKey(id: string, lang: TcgdexLanguage): string {
  return cacheKey(lang, 'card', id);
}

/**
 * Справочник карт поверх TCGdex с кэшем в IndexedDB. В Firestore справочник не храним:
 * это экономит десятки тысяч записей при заливке и чтения при каждом скане.
 * Китайский каталог для КНР (zh-cn) не из TCGdex: он целиком лежит в IndexedDB
 * (src/lib/cn-catalog.ts), поэтому отдельного кэша на сет и карту ему не нужно.
 */
export const catalog = {
  sets: (lang: TcgdexLanguage = 'en'): Promise<SetBrief[]> =>
    lang === 'zh-cn'
      ? cnCatalog.sets()
      : lang === 'ko'
        ? koCatalog.sets()
        : cached(lang === 'en' ? 'tcgdex:sets' : `tcgdex:${lang}:sets`, 7 * DAY, () => tcgdexApi.sets(lang)),
  set: (id: string, lang: TcgdexLanguage = 'en'): Promise<SetDetail> =>
    lang === 'zh-cn'
      ? cnCatalog.set(id)
      : lang === 'ko'
        ? koCatalog.set(id)
        : cached(cacheKey(lang, 'set', id), 7 * DAY, () => tcgdexApi.set(id, lang)),
  card: (id: string, lang: TcgdexLanguage = 'en'): Promise<CardDetail> =>
    lang === 'zh-cn'
      ? cnCatalog.card(id)
      : lang === 'ko'
        ? koCatalog.card(id)
        : cached(cardCacheKey(id, lang), 30 * DAY, () => tcgdexApi.card(id, lang)),
  /**
   * Все печати карт с этим словом в имени (TCGdex), без карт TCG Pocket. Ключ «prints» новый:
   * под старым «find» лежат пустые ответы строгого фильтра номера, который TCGdex перестал понимать.
   */
  prints: (name: string, lang: TcgdexLanguage = 'en'): Promise<CardBrief[]> =>
    lang === 'zh-cn' || lang === 'ko'
      ? Promise.resolve([])
      : cached(cacheKey(lang, 'prints', name.toLowerCase()), 7 * DAY, () => tcgdexApi.searchName(name, lang)).then((cards) =>
          cards.filter((card) => !isPocketCard(card)),
        ),
  /**
   * Карты с этим словом в имени и этим номером. Номер сверяется здесь, без учёта ведущих нулей:
   * TCGdex строгого фильтра номера больше не понимает, а нестрогий находит чужие номера.
   * В корейском каталоге поиска по имени нет: у выгрузок нет общего списка карт (см. koCandidates)
   */
  search: async (name: string, localId: string, lang: TcgdexLanguage = 'en'): Promise<CardBrief[]> =>
    lang === 'zh-cn'
      ? cnCatalog.search(name, localId)
      : (await catalog.prints(name, lang)).filter((card) => sameNumber(card.localId, localId)),
};

/** Сет карты: у китайских карт он указан явно (из ID с «.{ID в базе}» его не вывести), у TCGdex — из ID. */
function setOf(card: CardBrief): string {
  return (card as CardBrief & { setId?: string }).setId ?? setIdOf(card);
}

/**
 * Карта сверяется с каталогом чужого языка: корейская — с японским, когда ищется её японская
 * пара (koCandidates). Имён на её языке там нет, поэтому искать можно только по коду сета
 * и номеру, а имя сверяется по-английски.
 */
export function isForeignCatalog(detected: Pick<DetectedCard, 'language'>, lang: TcgdexLanguage): boolean {
  return lang !== 'en' && detected.language !== lang;
}

/** Какие имена искать: в английском каталоге — английское имя, в своём — напечатанное. */
function namesFor(detected: DetectedCard, lang: TcgdexLanguage): string[] {
  // Корейского имени в японском каталоге нет, а английские имена японский поиск TCGdex не знает
  if (isForeignCatalog(detected, lang)) return [];
  const base = searchName(lang === 'en' ? (detected.englishName ?? detected.name) : detected.name);
  return [...new Set([base, lastWord(base)].filter((name) => name.length >= 2))];
}

/**
 * Поиск по имени и номеру: сначала полное имя, потом последнее слово. Номер сверяется
 * без учёта ведущих нулей («057» и «57» — одна карта).
 */
async function searchByName(detected: DetectedCard, lang: TcgdexLanguage): Promise<CardBrief[]> {
  for (const name of namesFor(detected, lang)) {
    const found = (await catalog.search(name, detected.number, lang)).filter(
      (card) => !isPocketCard(card) && sameNumber(card.localId, detected.number),
    );
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * На японских и тайваньских картах напечатан сам ID сета («SV2a», «M2a»): по нему и номеру
 * карта находится точно, даже если имя прочитано с ошибкой. На английских картах
 * напечатано сокращение («OBF»), его в списке сетов нет.
 */
async function searchBySetCode(detected: DetectedCard, lang: TcgdexLanguage): Promise<CardBrief[]> {
  const code = detected.setCode?.trim().toUpperCase();
  if (!code || lang === 'en') return [];
  const set = (await catalog.sets(lang)).find((item) => item.id.toUpperCase() === code);
  if (!set) return [];
  const detail = await catalog.set(set.id, lang);
  return detail.cards.filter((card) => sameNumber(card.localId, detected.number));
}

/**
 * Запасной путь: сеты с тем же числом карт, что напечатано после дроби, и номер в них.
 * Номер и число карт совпадают у многих сетов, поэтому без похожего имени карта отбрасывается.
 */
async function searchByTotal(detected: DetectedCard, lang: TcgdexLanguage): Promise<CardBrief[]> {
  if (!detected.total || !/^\d+$/.test(detected.total.trim())) return [];
  const total = Number(normalizeNumber(detected.total));
  const sets = (await catalog.sets(lang)).filter((set) => set.cardCount.official === total && (lang === 'zh-cn' || !isPocketId(set.id)));
  const found: CardBrief[] = [];
  for (const set of sets.slice(0, 6)) {
    const detail = await catalog.set(set.id, lang).catch(() => null);
    const card = detail?.cards.find((item) => sameNumber(item.localId, detected.number));
    if (!card) continue;
    const englishName = isForeignCatalog(detected, lang) ? await englishNameOf(set.id, card.localId).catch(() => null) : null;
    if (nameScore(detected, { name: card.name, lang, englishName }) >= NAME_FLOOR) found.push(card);
  }
  return found;
}

/** Сколько других печатей карты добавить в варианты. */
const OTHER_PRINTS = 16;

/**
 * Другие печати карты с тем же именем (вместе с «ex», «V» и т. п.), свежие сеты первыми:
 * порядок сетов — как в списке сетов каталога, он идёт по дате выхода.
 */
export async function otherPrints(detected: DetectedCard, lang: TcgdexLanguage, have: ReadonlySet<string>): Promise<CardBrief[]> {
  const [name] = namesFor(detected, lang);
  if (!name || lang === 'zh-cn' || lang === 'ko') return [];
  const same = (await catalog.prints(name, lang)).filter(
    (card) => !have.has(card.id) && (nameVerdict(detected, { name: card.name, lang }) ?? 0) >= 0.9,
  );
  if (same.length === 0) return [];
  const order = new Map((await catalog.sets(lang)).map((set, index) => [set.id, index]));
  return same
    .map((card, index) => ({ card, index, set: order.get(setOf(card)) ?? -1 }))
    .sort((a, b) => b.set - a.set || a.index - b.index)
    .slice(0, OTHER_PRINTS)
    .map(({ card }) => card);
}

/**
 * Карта из Limitless как кандидат. Номер совпадает по построению, код сета — если модель
 * прочитала его верно; решает имя. Чужая карта под тем же номером отбрасывается.
 */
function limitlessCandidate(detected: DetectedCard, card: LimitlessCard): Candidate | null {
  const verdict = nameVerdict(detected, { name: card.name, lang: 'ja', englishName: card.englishName });
  if (verdict === null || verdict < NAME_FLOOR) return null;
  const total = detected.total && /^\d+$/.test(detected.total) ? Number(normalizeNumber(detected.total)) : null;
  const sameCode = detected.setCode?.trim().toUpperCase() === card.set.toUpperCase();
  return {
    cardId: `lt:${card.set}-${card.number}`,
    setId: card.set,
    name: card.name,
    englishName: card.englishName,
    localId: card.number,
    setName: card.set,
    printedTotal: total,
    setCode: card.set,
    releaseDate: null,
    lang: 'ja',
    approximate: false,
    source: 'limitless',
    score: Math.round((0.6 * verdict + 0.3 + (sameCode ? 0.1 : 0)) * 1000) / 1000,
  };
}

/**
 * Японская карта, которой нет в TCGdex (стартовые наборы, свежие сеты) или которая нашлась
 * неуверенно, ищется в Limitless TCG: по коду сета и номеру, а если так не нашлась — по имени
 * и номеру. Код сета мелкий, модель иногда читает его неверно или угадывает (вместо MBG — M1L).
 */
async function searchLimitless(detected: DetectedCard): Promise<Candidate[]> {
  const found: Candidate[] = [];
  if (detected.setCode) {
    const card = await findJapaneseCard(detected.setCode, detected.number);
    const candidate = card && limitlessCandidate(detected, card);
    if (candidate) found.push(candidate);
  }
  // Японский поиск Limitless понимает только японские имена
  if (found.length === 0 && scriptOf(detected.name) === 'cjk') {
    for (const hit of (await searchJapaneseCards(searchName(detected.name), detected.number)).slice(0, 4)) {
      const card = await findJapaneseCard(hit.set, hit.number);
      const candidate = card && limitlessCandidate(detected, card);
      if (candidate) found.push(candidate);
    }
  }
  return found;
}

/**
 * Корейская карта ищется в корейском каталоге (src/lib/ko-catalog.ts) по коду сета и номеру:
 * общего списка карт у выгрузок нет, поиска по имени тоже. Если код не прочитан или такого
 * сета нет, японская пара ищется по числу карт после дроби и номеру (имя сверяется по-английски,
 * через перевод Limitless), и корейская карта берётся под её кодом и номером: корейские сеты
 * повторяют японские. Чужая карта под тем же номером отбрасывается по корейскому имени.
 * Если корейской печати нет ни в одной выгрузке, кандидатов нет: карту добавляют как есть.
 */
async function koCandidates(detected: DetectedCard): Promise<Candidate[]> {
  const hits: KoHit[] = [];
  if (detected.setCode?.trim()) {
    const hit = await koCatalog.find(detected.setCode, detected.number);
    if (hit) hits.push(hit);
  }
  if (hits.length === 0) {
    for (const twin of await searchByTotal(detected, 'ja')) {
      const hit = await koCatalog.find(setOf(twin), twin.localId).catch(() => null);
      if (hit && !hits.some((item) => item.card.id === hit.card.id)) hits.push(hit);
    }
  }
  const candidates = await Promise.all(
    hits.slice(0, 6).map(async ({ card, setName, official, releaseDate }) => {
      const englishName = await koCatalog.englishName(card.id).catch(() => null);
      const base = {
        cardId: card.id,
        setId: card.setId,
        name: card.name,
        localId: card.localId,
        image: card.image,
        setName,
        printedTotal: official || null,
        setCode: null,
        releaseDate,
        lang: 'ko' as const,
        approximate: false,
        source: 'tcgdex' as const,
        ...(englishName ? { englishName } : {}),
      };
      return { ...base, score: scoreCandidate(detected, base) };
    }),
  );
  return candidates
    .filter((candidate) => (nameVerdict(detected, candidate) ?? 1) >= NAME_FLOOR)
    .sort((a, b) => b.score - a.score);
}

/**
 * Кандидаты для одной прочитанной карты, лучшие первыми. Ищем в каталоге языка карты,
 * японские карты, которых там нет или которые нашлись неуверенно, — ещё и в Limitless.
 * Корейская карта ищется в корейском каталоге (koCandidates).
 * Китайская карта для КНР ищется в своём каталоге (src/lib/cn-catalog.ts) так же, по коду
 * сета, имени и номеру; английское имя для показа — из PikaQian. Если каталога для языка
 * нет, кандидатов нет: такую карту добавляют как есть. Если база недоступна, ошибка уходит наверх.
 */
export async function findCandidates(detected: DetectedCard): Promise<Candidate[]> {
  const { tcgdex: lang, exact } = catalogFor(detected.language);
  if (!lang) return [];
  if (lang === 'ko') return koCandidates(detected);

  const byCode = await searchBySetCode(detected, lang);
  const byName = await searchByName(detected, lang);
  let briefs = [...new Map([...byCode, ...byName].map((card) => [card.id, card])).values()];
  // Номер нашёлся только в сете с тем же числом карт после дроби: номер и число могли быть
  // прочитаны неверно, такую карту выбирает человек
  const weak = briefs.length === 0;
  if (weak) briefs = await searchByTotal(detected, lang);

  const foreign = isForeignCatalog(detected, lang);
  /**
   * weakNumber — номер карты не подтверждён поиском. otherPrint — другая печать того же имени:
   * у неё число карт после дроби не в счёт, оно прочитано вместе с неподтверждённым номером
   * (276/217 прибавил бы всем печатям Ascended Heroes и вытеснил нужную).
   */
  const toCandidate = async (brief: CardBrief, weakNumber: boolean, otherPrint = false): Promise<Candidate> => {
    const setId = setOf(brief);
    const [set, englishName] = await Promise.all([
      catalog.set(setId, lang).catch(() => null),
      // Без английского имени корейскую карту не с чем сверить: имя в каталоге японское.
      // У китайских карт английское имя только для показа: сверяет напечатанное
      foreign
        ? englishNameOf(setId, brief.localId).catch(() => null)
        : lang === 'zh-cn'
          ? cnCatalog.englishName(brief.id).catch(() => null)
          : null,
    ]);
    const base = {
      cardId: brief.id,
      setId,
      name: brief.name,
      localId: brief.localId,
      image: brief.image,
      setName: set?.name ?? setId,
      printedTotal: set?.cardCount.official ?? null,
      setCode: set?.abbreviation?.official ?? null,
      releaseDate: set?.releaseDate ?? null,
      lang,
      approximate: !exact,
      source: 'tcgdex' as const,
      ...(englishName ? { englishName } : {}),
      ...(weakNumber ? { weak: true } : {}),
    };
    return { ...base, score: scoreCandidate(otherPrint ? { ...detected, total: null } : detected, base) };
  };
  const candidates: Candidate[] = await Promise.all(briefs.slice(0, 8).map((brief) => toCandidate(brief, weak))).then((list) =>
    // Карта с тем же номером, но явно другим именем — чужая: например, код сета прочитан неверно
    list.filter((candidate) => (nameVerdict(detected, candidate) ?? 1) >= NAME_FLOOR),
  );
  const best = Math.max(0, ...candidates.map((candidate) => candidate.score));
  if (lang === 'ja' && !foreign && best < READY_SCORE) {
    for (const found of await searchLimitless(detected)) {
      // Та же карта есть в TCGdex (там цена): Limitless только подтверждает её имя, например английское
      const twin = candidates.find(
        (candidate) => candidate.setId.toUpperCase() === found.setId.toUpperCase() && sameNumber(candidate.localId, found.localId),
      );
      if (twin) twin.score = Math.max(twin.score, found.score);
      else candidates.push(found);
    }
  }
  // Тайваньская карта, которой нет в TCGdex (много пустых сетов) или которая нашлась неуверенно, —
  // на официальном сайте Pokémon Asia. Если та же карта есть в TCGdex, сайт только подтверждает
  // её имя и даёт скан, которого у TCGdex часто нет
  if (lang === 'zh-tw' && best < READY_SCORE) {
    for (const found of await searchTwCandidates(detected).catch(() => [])) {
      const twin = candidates.find(
        (candidate) =>
          candidate.source === 'tcgdex' &&
          candidate.setId.toUpperCase() === found.setId.toUpperCase() &&
          sameNumber(candidate.localId, found.localId),
      );
      if (twin) {
        twin.score = Math.max(twin.score, found.score);
        twin.image ??= found.image;
      } else candidates.push(found);
    }
  }
  // Сама карта не узнаётся (модель не уверена, номер не подтверждён или кандидаты спорные):
  // в варианты идут и другие печати карты с тем же именем, свежие сеты первыми. Номер мог
  // быть прочитан неверно, а имя модель читает надёжнее
  // Похожая карта (язык не узнан) сама не узнаётся никогда, но номер у неё подтверждён: лишние печати не нужны
  const sure = decide(
    candidates.map((candidate) => ({ ...candidate, approximate: false })),
    detected.confidence,
  );
  if (!foreign && sure.status !== 'ready') {
    const have = new Set(candidates.map((candidate) => candidate.cardId));
    const others = await otherPrints(detected, lang, have).catch(() => []);
    candidates.push(...(await Promise.all(others.map((brief) => toCandidate(brief, true, true)))));
  }
  candidates.sort((a, b) => b.score - a.score || (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  // Узнанная тайваньская карта TCGdex без скана (так у большинства): скан берётся с сайта
  const top = candidates[0];
  if (lang === 'zh-tw' && top && !top.image && top.source === 'tcgdex') {
    const twin = await findTwCard({ name: top.name, number: top.localId, setCode: top.setId }).catch(() => null);
    if (twin) top.image = twin.image;
  }
  return candidates;
}

// ---- Свой поиск: «Ни одна не подходит» в сканере ----

/** Разобранный запрос своего поиска: номер и остальные слова (имя карты и сет). */
export type CardQuery = { number: string | null; words: string[] };

const simple = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Номер в запросе: «149», «149/128», «TG05», «SWSH020». Слово из цифр и букв вроде «SV2a»
 * или «30th» — это код сета, не номер.
 */
const NUMBER = /^(?:\d{1,3}|[A-Z]{2,4}\d{2,3})(?:\/\d{1,3})?$/i;

/** Номер — последнее слово, похожее на номер; дробь отрезается («149/128» → «149»). */
export function parseCardQuery(query: string): CardQuery {
  const words = query.trim().split(/\s+/).filter(Boolean);
  let number: string | null = null;
  for (let index = words.length - 1; index >= 0; index--) {
    if (NUMBER.test(words[index]!)) {
      number = words[index]!.split('/')[0]!;
      words.splice(index, 1);
      break;
    }
  }
  return { number, words };
}

/**
 * Сет в запросе: слово, равное ID сета («30th», «SV2a», «sv08»), или несколько слов подряд,
 * равных имени сета («Surging Sparks») или начинающих его. Возвращает сет и оставшиеся слова —
 * имя карты. Слова, которые есть в имени найденного сета («Celebration»), из имени убираются.
 */
export function findQuerySet(words: readonly string[], sets: readonly SetBrief[]): { set: SetBrief | null; rest: string[] } {
  const byId = new Map(sets.map((set) => [set.id.toLowerCase(), set]));
  let found: SetBrief | null = null;
  let used: number[] = [];
  const at = words.findIndex((word) => byId.has(word.toLowerCase()));
  if (at >= 0) {
    found = byId.get(words[at]!.toLowerCase())!;
    used = [at];
  } else {
    // Слова подряд, длинные серии первыми: «Surging Sparks» раньше, чем «Sparks»
    search: for (let length = words.length; length >= 1; length--) {
      for (let start = 0; start + length <= words.length; start++) {
        const run = simple(words.slice(start, start + length).join(''));
        if (run.length < 4) continue;
        const set = sets.find((item) => {
          const name = simple(item.name);
          return name === run || (length >= 2 && name.startsWith(run));
        });
        if (set) {
          found = set;
          used = Array.from({ length }, (_, offset) => start + offset);
          break search;
        }
      }
    }
  }
  if (!found) return { set: null, rest: [...words] };
  const inName = new Set(found.name.split(/\s+/).map(simple));
  return {
    set: found,
    rest: words.filter((word, index) => !used.includes(index) && !inName.has(simple(word))),
  };
}

/**
 * Есть ли в имени карты все слова запроса: «Charizard ex» находит «Mega Charizard X ex», но не
 * просто «Charizard». Латинские слова сверяются целиком, слитные имена (японские, китайские) —
 * вхождением.
 */
export function nameHasWords(cardName: string, query: string): boolean {
  const words = new Set(cardName.split(/[\s-]+/).map(simple));
  const whole = simple(cardName);
  return query
    .split(/\s+/)
    .map(simple)
    .filter(Boolean)
    .every((word) => words.has(word) || ((word.length >= 4 || scriptOf(word) !== 'latin') && whole.includes(word)));
}

/** Сколько карт отдаёт свой поиск: интерфейс показывает часть и «Показать ещё». */
const SEARCH_LIMIT = 48;

/** Ответы своего поиска на время жизни вкладки: тот же запрос не ищется второй раз. */
const searches = new Map<string, Promise<Candidate[]>>();

/** Карта каталога как вариант на выбор: оценки нет, выбирает человек. */
async function briefCandidate(brief: CardBrief, lang: TcgdexLanguage, exact: boolean): Promise<Candidate> {
  const setId = setOf(brief);
  const set = await catalog.set(setId, lang).catch(() => null);
  return {
    cardId: brief.id,
    setId,
    name: brief.name,
    localId: brief.localId,
    image: brief.image,
    setName: set?.name ?? setId,
    printedTotal: set?.cardCount.official ?? null,
    setCode: set?.abbreviation?.official ?? null,
    releaseDate: set?.releaseDate ?? null,
    lang,
    approximate: !exact,
    source: 'tcgdex',
    score: 0,
  };
}

/**
 * Свой поиск по базе: имя (английское или напечатанное), номер, ID или имя сета в любом порядке —
 * «Pikachu ex 149», «30th 150», «Surging Sparks 238», «メガゲンガー MBG 3». Ищется в каталоге языка
 * карты; японские — ещё в Limitless (по коду сета и номеру или по японскому имени и номеру),
 * корейские — по коду сета и номеру (поиска по имени у корейских выгрузок нет), китайские для КНР —
 * по имени с номером или по сету. Свежие сеты первыми, не больше 48 карт. Ответ хранится на время
 * жизни вкладки; если база недоступна, ошибка уходит наверх и не запоминается.
 */
export function searchCatalog(query: string, language: CardLanguage): Promise<Candidate[]> {
  const key = `${language}|${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const known = searches.get(key);
  if (known) return known;
  const pending = runSearch(query, language);
  searches.set(key, pending);
  pending.catch(() => searches.delete(key));
  return pending;
}

async function runSearch(query: string, language: CardLanguage): Promise<Candidate[]> {
  const { tcgdex, exact } = catalogFor(language);
  const lang: TcgdexLanguage = tcgdex ?? 'en';
  const { number, words } = parseCardQuery(query);
  const sets = await catalog.sets(lang);
  const { set, rest } = findQuerySet(words, sets);
  const name = rest.join(' ');
  const matchesNumber = (card: CardBrief) => !number || sameNumber(card.localId, number);

  let briefs: CardBrief[] = [];
  if (lang === 'ko') {
    // Корейские выгрузки знают только код сета и номер
    const code = set?.id ?? words[0];
    const hit = code && number ? await koCatalog.find(code, number).catch(() => null) : null;
    if (hit) briefs = [hit.card];
  } else if (name.length >= 2 && lang === 'zh-cn') {
    briefs = number ? (await cnCatalog.search(name, number)).filter((card) => !set || setOf(card) === set.id) : [];
  } else if (name.length >= 2) {
    // TCGdex ищется по имени без механики («Charizard»), а слова запроса («ex») сверяются здесь
    const wanted = searchName(name).length >= 2 ? searchName(name) : name;
    briefs = (await catalog.prints(wanted, lang)).filter(
      (card) => matchesNumber(card) && (!set || setOf(card) === set.id) && nameHasWords(card.name, name),
    );
  } else if (set) {
    briefs = (await catalog.set(set.id, lang)).cards.filter(matchesNumber);
  }

  // Точное имя первым («Charizard ex» раньше «Mega Charizard X ex»), дальше свежие сеты первыми
  const order = new Map(sets.map((item, index) => [item.id, index]));
  const exactName = simple(name);
  const sorted = briefs
    .filter((card) => !isPocketCard(card))
    .map((card, index) => ({ card, index, set: order.get(setOf(card)) ?? -1, exact: simple(card.name) === exactName ? 1 : 0 }))
    .sort((a, b) => b.exact - a.exact || b.set - a.set || a.index - b.index)
    .slice(0, SEARCH_LIMIT)
    .map(({ card }) => card);
  const found = await Promise.all(sorted.map((brief) => briefCandidate(brief, lang, exact)));

  // Японские карты, которых нет в TCGdex (стартовые наборы, свежие сеты), — в Limitless
  if (lang === 'ja' && number) {
    const hits: Array<{ set: string; number: string }> = [];
    const code = set ? null : words.find((word) => /^[A-Za-z][A-Za-z0-9-]{1,7}$/.test(word));
    if (code) hits.push({ set: code, number });
    if (scriptOf(name) === 'cjk') hits.push(...(await searchJapaneseCards(searchName(name), number).catch(() => [])).slice(0, 6));
    for (const hit of hits) {
      if (found.some((card) => card.setId.toUpperCase() === hit.set.toUpperCase() && sameNumber(card.localId, hit.number)))
        continue;
      const card = await findJapaneseCard(hit.set, hit.number).catch(() => null);
      if (!card) continue;
      found.push({
        cardId: `lt:${card.set}-${card.number}`,
        setId: card.set,
        name: card.name,
        englishName: card.englishName,
        localId: card.number,
        setName: card.set,
        printedTotal: null,
        setCode: card.set,
        releaseDate: null,
        lang: 'ja',
        approximate: false,
        source: 'limitless',
        score: 0,
      });
    }
  }
  return found;
}
