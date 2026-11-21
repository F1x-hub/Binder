import { cacheGet, cachePut } from '@/lib/kv-cache';
import type { ChecklistCard } from '@/lib/library-filters';
import { normalizeNumber } from '@/lib/matching';
import { CatalogError } from '@/lib/tcgdex';

/**
 * Список карт японского сета, которого нет в TCGdex (стартовые наборы вроде MBG), из Limitless TCG.
 * Страница сета в виде таблицы (`/cards/jp/MBG?display=list&show=all`) отдаёт все номера
 * и японские имена одним запросом, с `&translate=en` — английские имена. Итого два запроса
 * на сет, кэш на 30 дней. Это HTML без CORS, как у поиска Limitless: нужен доступ к limitlesstcg.com
 * (host_permissions в wxt.config.ts). Адрес их страницы может поменяться без предупреждения —
 * тогда списка нет и разворот такого сета остаётся как раньше, карты подряд.
 */
const SITE = 'https://limitlesstcg.com';
const DAY = 24 * 60 * 60 * 1000;

/** Карта сета в Limitless: код сета в их регистре («SV2a», «MBG»), номер, имя по-японски и по-английски. */
export type LimitlessSetCard = { set: string; number: string; name: string; englishName: string | null };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Строки таблицы сета: в строке карты несколько ссылок на `/cards/jp/{SET}/{N}`, у первой текст —
 * номер, у следующей — имя. Строки других сетов (на странице их нет, но мало ли) отбрасываются.
 */
export function parseSetList(html: string, setCode: string): Array<{ set: string; number: string; name: string }> {
  const wanted = setCode.toUpperCase();
  const cards = new Map<string, { set: string; number: string; name: string }>();
  for (const row of html.split(/<tr[\s>]/i).slice(1)) {
    let set: string | null = null;
    let number: string | null = null;
    let name: string | null = null;
    for (const match of row.matchAll(/<a href="\/cards\/jp\/([A-Za-z0-9-]{1,12})\/([A-Za-z0-9]{1,8})(?:\?[^"]*)?"\s*>([^<]*)<\/a>/g)) {
      const [, linkSet, linkNumber, rawText] = match;
      if (linkSet!.toUpperCase() !== wanted) continue;
      const text = decodeEntities(rawText!).replace(/\s+/g, ' ').trim();
      set ??= linkSet!;
      number ??= linkNumber!;
      if (text && text !== linkNumber && !name) name = text;
    }
    if (!set || !number || !name || cards.has(number)) continue;
    cards.set(number, { set, number, name });
  }
  return [...cards.values()];
}

async function fetchList(code: string, translate: boolean): Promise<string> {
  const url = `${SITE}/cards/jp/${encodeURIComponent(code)}?display=list&show=all${translate ? '&translate=en' : ''}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new CatalogError('unavailable');
  }
  if (response.status === 404) return '';
  if (!response.ok) throw new CatalogError('unavailable');
  return response.text();
}

/** Японские и английские имена в один список: английское — из перевода с тем же номером. */
export function mergeSetLists(
  original: ReturnType<typeof parseSetList>,
  translated: ReturnType<typeof parseSetList>,
): LimitlessSetCard[] {
  const english = new Map(translated.map((card) => [card.number, card.name]));
  return original
    .map((card) => {
      const name = english.get(card.number) ?? null;
      return { ...card, englishName: name && name !== card.name ? name : null };
    })
    .sort((a, b) => compareNumbers(a.number, b.number));
}

function compareNumbers(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return a.localeCompare(b, 'en', { numeric: true });
}

/**
 * Все карты японского сета из Limitless. Найденный список хранится 30 дней, отсутствие сета —
 * сутки (новые сеты появляются в Limitless через несколько дней). null — сета нет или Limitless
 * не ответил: тогда разворот раскладывает карты подряд.
 */
export async function limitlessSetCards(setCode: string): Promise<LimitlessSetCard[] | null> {
  const code = setCode.trim();
  if (!/^[A-Za-z0-9-]{1,12}$/.test(code) || code === 'NOSET') return null;
  const key = `limitless:set:${code.toUpperCase()}`;
  const known = await cacheGet<LimitlessSetCard[]>(key, 30 * DAY);
  if (known) return known;
  if (await cacheGet<boolean>(`${key}:missing`, DAY)) return null;
  const original = parseSetList(await fetchList(code, false), code);
  if (original.length === 0) {
    void cachePut(`${key}:missing`, true);
    return null;
  }
  // Без перевода список всё равно годится: имена будут японскими
  const translated = await fetchList(code, true)
    .then((html) => parseSetList(html, code))
    .catch(() => []);
  const cards = mergeSetLists(original, translated);
  void cachePut(key, cards);
  return cards;
}

/** Сет вне TCGdex из ключа группы альбома: «x:ja:MBG» → «MBG». Список есть только у японских сетов. */
export function outOfBaseSet(key: string | null): string | null {
  const match = key?.match(/^x:ja:([A-Za-z0-9-]{1,20})$/);
  return match && match[1] !== 'NOSET' ? match[1]! : null;
}

/**
 * Список сета для разворота: ID пункта — номер без ведущих нулей (по нему карта альбома,
 * добавленная как есть, находит свой карман), имя — английское, если оно известно,
 * скан — с CDN Limitless по коду сета в их регистре.
 */
export function limitlessChecklist(cards: readonly LimitlessSetCard[]): ChecklistCard[] {
  return cards.map((card) => ({
    id: normalizeNumber(card.number),
    localId: card.number,
    name: card.englishName ?? card.name,
    limitless: { region: 'jp', set: card.set, number: card.number },
  }));
}

/** Ключ карты альбома вне базы в таком списке: напечатанный номер без ведущих нулей. */
export function printedNumberId(card: { localId: string }): string | null {
  return card.localId ? normalizeNumber(card.localId) || null : null;
}
