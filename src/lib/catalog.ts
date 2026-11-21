import { cached } from '@/lib/kv-cache';
import { catalogFor, type TcgdexLanguage } from '@/lib/languages';
import { englishNameOf, findJapaneseCard, searchJapaneseCards, type LimitlessCard } from '@/lib/limitless';
import {
  NAME_FLOOR,
  READY_SCORE,
  lastWord,
  localIdVariants,
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
 */
export const catalog = {
  sets: (lang: TcgdexLanguage = 'en'): Promise<SetBrief[]> =>
    cached(lang === 'en' ? 'tcgdex:sets' : `tcgdex:${lang}:sets`, 7 * DAY, () => tcgdexApi.sets(lang)),
  set: (id: string, lang: TcgdexLanguage = 'en'): Promise<SetDetail> =>
    cached(cacheKey(lang, 'set', id), 7 * DAY, () => tcgdexApi.set(id, lang)),
  card: (id: string, lang: TcgdexLanguage = 'en'): Promise<CardDetail> =>
    cached(cardCacheKey(id, lang), 30 * DAY, () => tcgdexApi.card(id, lang)),
  // Ключ «find» новый: старый «search» хранил ответы нестрогого поиска по номеру
  search: (name: string, localId: string, lang: TcgdexLanguage = 'en'): Promise<CardBrief[]> =>
    cached(cacheKey(lang, 'find', `${name.toLowerCase()}:${localId}`), 7 * DAY, () => tcgdexApi.search(name, localId, lang)),
};

/**
 * Карта сверяется с каталогом чужого языка: корейская — с японским. Имён на её языке там нет,
 * поэтому искать можно только по коду сета и номеру, а имя сверяется по-английски.
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

/** Поиск по имени и номеру: сначала полное имя, потом последнее слово, во всех записях номера. */
async function searchByName(detected: DetectedCard, lang: TcgdexLanguage): Promise<CardBrief[]> {
  for (const name of namesFor(detected, lang)) {
    for (const localId of localIdVariants(detected.number)) {
      const found = (await catalog.search(name, localId, lang)).filter(
        (card) => !isPocketCard(card) && sameNumber(card.localId, detected.number),
      );
      if (found.length > 0) return found;
    }
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
  const sets = (await catalog.sets(lang)).filter((set) => set.cardCount.official === total && !isPocketId(set.id));
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
 * Кандидаты для одной прочитанной карты, лучшие первыми. Ищем в каталоге языка карты,
 * японские карты, которых там нет или которые нашлись неуверенно, — ещё и в Limitless.
 * Корейская карта ищется в японском каталоге по коду сета и номеру (корейские издания
 * повторяют японские), английское имя кандидата для сверки берётся из перевода Limitless.
 * В одном Limitless корейская карта не ищется: в альбом пошло бы японское имя как напечатанное.
 * Если каталога для языка нет (китайские для КНР), кандидатов нет: такую карту добавляют
 * как есть. Если база недоступна, ошибка уходит наверх.
 */
export async function findCandidates(detected: DetectedCard): Promise<Candidate[]> {
  const { tcgdex: lang, exact } = catalogFor(detected.language);
  if (!lang) return [];

  const byCode = await searchBySetCode(detected, lang);
  const byName = await searchByName(detected, lang);
  let briefs = [...new Map([...byCode, ...byName].map((card) => [card.id, card])).values()];
  if (briefs.length === 0) briefs = await searchByTotal(detected, lang);

  const foreign = isForeignCatalog(detected, lang);
  const candidates: Candidate[] = await Promise.all(
    briefs.slice(0, 8).map(async (brief) => {
      const setId = setIdOf(brief);
      const [set, englishName] = await Promise.all([
        catalog.set(setId, lang).catch(() => null),
        // Без английского имени корейскую карту не с чем сверить: имя в каталоге японское
        foreign ? englishNameOf(setId, brief.localId).catch(() => null) : null,
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
      };
      return { ...base, score: scoreCandidate(detected, base) };
    }),
  ).then((list) =>
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
  return candidates.sort((a, b) => b.score - a.score);
}
