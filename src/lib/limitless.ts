import { cacheGet, cachePut } from '@/lib/kv-cache';
import { normalizeNumber, type Candidate } from '@/lib/matching';
import { CatalogError } from '@/lib/tcgdex';

/**
 * Limitless TCG (limitlesstcg.com) — база карт турнирного сайта: английские и все японские
 * карты, включая стартовые наборы, которых нет в TCGdex, и японские карты, у которых
 * в TCGdex нет скана. Картинки лежат на их CDN по адресу из кода сета и номера.
 * Карточка в JSON отдаётся тем же адресом, которым пользуются их всплывающие подсказки
 * (CORS *, ключ не нужен, robots.txt ничего не запрещает). Это не публичный API с гарантиями,
 * поэтому запросы только при скане карты, которой нет в TCGdex, и с кэшем на 30 дней.
 */
const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';
const SITE = 'https://limitlesstcg.com';
const API = `${SITE}/api/cards`;
const DAY = 24 * 60 * 60 * 1000;

/** Карта в базе Limitless: японская (tpc) или английская (tpci), код сета и номер. */
export type LimitlessRef = { region: 'jp' | 'en'; set: string; number: string };

/** XS — 136×189 (20 КБ), SM — 274×381 (70 КБ), LG — 460×640 (175 КБ). */
export type LimitlessSize = 'XS' | 'SM' | 'LG';

/**
 * Адрес скана на CDN. У японских карт номер без ведущих нулей («MBG_3»),
 * у английских — из трёх цифр («MEP_073»). Регистр кода сета важен: «SV2a», «MBG».
 */
export function limitlessImage(ref: LimitlessRef, size: LimitlessSize): string | null {
  const set = ref.set.trim();
  const number = normalizeNumber(ref.number);
  if (!/^[A-Za-z0-9-]{1,12}$/.test(set) || !number) return null;
  if (ref.region === 'jp') return `${CDN}/tpc/${set}/${set}_${number}_R_JP_${size}.png`;
  if (!/^\d+$/.test(number)) return null;
  return `${CDN}/tpci/${set}/${set}_${number.padStart(3, '0')}_R_EN_${size}.png`;
}

/**
 * Где искать скан карты-кандидата в Limitless: японские карты — по ID сета TCGdex
 * (он совпадает с кодом Limitless: «SV2a», «M2a»), английские — по сокращению сета («MEP»).
 */
export function candidateLimitless(
  candidate: Pick<Candidate, 'source' | 'lang' | 'setId' | 'setCode' | 'localId'>,
): LimitlessRef | null {
  if (candidate.source === 'limitless' || candidate.lang === 'ja') {
    return { region: 'jp', set: candidate.setId, number: candidate.localId };
  }
  if (candidate.lang === 'en' && candidate.setCode) return { region: 'en', set: candidate.setCode, number: candidate.localId };
  return null;
}

/** Японская карта из Limitless: код сета в их записи, номер, имя по-японски и по-английски. */
export type LimitlessCard = { set: string; number: string; name: string; englishName: string | null };

type RawCard = { set?: unknown; number?: unknown; name?: unknown; translation?: unknown; [field: string]: unknown };

/** Ответ API: JSON с карточкой, а если такой карты нет — пустая страница со статусом 200. */
async function fetchCard(set: string, number: string, query: string): Promise<RawCard | null> {
  let response: Response;
  try {
    response = await fetch(`${API}/${encodeURIComponent(set)}/${encodeURIComponent(number)}?${query}`);
  } catch {
    throw new CatalogError('unavailable');
  }
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new CatalogError('unavailable');
  }
  if (!(response.headers.get('content-type') ?? '').includes('json')) return null;
  const body = (await response.json().catch(() => null)) as RawCard | null;
  return body && typeof body.name === 'string' && body.name ? body : null;
}

/**
 * Японская карта по коду сета и номеру, как они напечатаны. Регистр кода API не важен,
 * в ответе он правильный («mbg» → «MBG»), а номер нужен без ведущих нулей.
 */
export async function findJapaneseCard(setCode: string, printedNumber: string): Promise<LimitlessCard | null> {
  const set = setCode.trim();
  const number = normalizeNumber(printedNumber);
  if (!/^[A-Za-z0-9-]{1,12}$/.test(set) || !/^[A-Z0-9]{1,8}$/.test(number)) return null;
  // Найденная карта хранится 30 дней, отсутствие — сутки: новые сеты появляются в Limitless через несколько дней
  const key = `limitless:jp:${set.toUpperCase()}:${number}`;
  const known = await cacheGet<LimitlessCard>(key, 30 * DAY);
  if (known) return known;
  if (await cacheGet<boolean>(`${key}:missing`, DAY)) return null;
  const card = await fetchCard(set, number, 'lang=jp');
  if (!card) {
    void cachePut(`${key}:missing`, true);
    return null;
  }
  const english = await fetchCard(set, number, 'translate').catch(() => null);
  const found: LimitlessCard = {
    set: typeof card.set === 'string' && card.set ? card.set : set,
    number: typeof card.number === 'string' && card.number ? card.number : number,
    name: card.name as string,
    englishName: typeof english?.name === 'string' && english.name ? english.name : null,
  };
  void cachePut(key, found);
  return found;
}

/**
 * Английское имя японской карты из перевода Limitless: один запрос (?translate), кэш на 30 дней,
 * отсутствие перевода — на сутки. Если карта уже искалась при скане, имя берётся из того кэша.
 */
export async function englishNameOf(setCode: string, printedNumber: string): Promise<string | null> {
  const set = setCode.trim();
  const number = normalizeNumber(printedNumber);
  if (!/^[A-Za-z0-9-]{1,12}$/.test(set) || !/^[A-Z0-9]{1,8}$/.test(number)) return null;
  const scanned = await cacheGet<LimitlessCard>(`limitless:jp:${set.toUpperCase()}:${number}`, 30 * DAY);
  if (scanned?.englishName) return scanned.englishName;
  const key = `limitless:en:${set.toUpperCase()}:${number}`;
  const known = await cacheGet<string>(key, 30 * DAY);
  if (known) return known;
  if (await cacheGet<boolean>(`${key}:missing`, DAY)) return null;
  const card = await fetchCard(set, number, 'translate');
  const name = card && Number(card.translation) !== 0 && typeof card.name === 'string' && card.name ? card.name : null;
  void cachePut(name ? key : `${key}:missing`, name ?? true);
  return name;
}

/** Полный текст японской карты: оригинал и английский перевод Limitless (если он есть). */
export type JapaneseCardText = { original: Record<string, unknown>; english: Record<string, unknown> | null };

/** Текст японской карты для страницы карточки: два запроса, кэш на 30 дней. */
export async function japaneseCardText(setCode: string, printedNumber: string): Promise<JapaneseCardText | null> {
  const set = setCode.trim();
  const number = normalizeNumber(printedNumber);
  if (!/^[A-Za-z0-9-]{1,12}$/.test(set) || !/^[A-Z0-9]{1,8}$/.test(number)) return null;
  const key = `limitless:text:${set.toUpperCase()}:${number}`;
  const known = await cacheGet<JapaneseCardText>(key, 30 * DAY);
  if (known) return known;
  const original = await fetchCard(set, number, 'lang=jp');
  if (!original) return null;
  const english = await fetchCard(set, number, 'translate').catch(() => null);
  const text: JapaneseCardText = { original, english: english && Number(english.translation) !== 0 ? english : null };
  void cachePut(key, text);
  return text;
}

/** Ссылки на карты из страницы поиска Limitless: «/cards/jp/MBG/3» → { set: 'MBG', number: '3' }. */
export function parseSearchResults(html: string): Array<{ set: string; number: string }> {
  const found = new Map<string, { set: string; number: string }>();
  for (const match of html.matchAll(/href="\/cards\/jp\/([A-Za-z0-9-]{1,12})\/([A-Za-z0-9]{1,8})"/g)) {
    const [, set, number] = match;
    found.set(`${set}/${number}`, { set: set!, number: number! });
  }
  return [...found.values()];
}

/**
 * Японские карты по имени и номеру через поиск Limitless («メガゲンガー n:3»): так карта
 * находится, даже если код сета прочитан неверно или не прочитан. Поиск отдаёт HTML без CORS,
 * поэтому у расширения есть разрешение на limitlesstcg.com (host_permissions в wxt.config.ts).
 * Ищет только японские имена; английские Limitless в японской базе не находит.
 */
export async function searchJapaneseCards(name: string, printedNumber: string): Promise<Array<{ set: string; number: string }>> {
  const number = normalizeNumber(printedNumber);
  const query = name.trim();
  if (!query || !/^[A-Z0-9]{1,8}$/.test(number)) return [];
  const key = `limitless:find:${query}:${number}`;
  const known = await cacheGet<Array<{ set: string; number: string }>>(key, 7 * DAY);
  if (known) return known;
  let response: Response;
  try {
    response = await fetch(`${SITE}/cards/jp?q=${encodeURIComponent(`${query} n:${number}`)}`);
  } catch {
    throw new CatalogError('unavailable');
  }
  if (!response.ok) throw new CatalogError('unavailable');
  const results = parseSearchResults(await response.text()).filter((card) => normalizeNumber(card.number) === number);
  if (results.length > 0) void cachePut(key, results);
  return results;
}
