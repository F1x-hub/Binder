import { browser } from 'wxt/browser';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import { normalizeNumber, searchName } from '@/lib/matching';

/**
 * Цены японских карт в долларах из JustTCG (justtcg.com): API с данными TCGplayer,
 * японские карты — игра «pokemon-japan». Бесплатный ключ: 1000 запросов в месяц, 100 в день,
 * 10 в минуту, до 20 карт в пакетном запросе. Ключ вводит сам участник, он лежит только
 * в chrome.storage.local этого браузера. CORS у API открыт, разрешений расширению не нужно.
 * Спецификация: https://justtcg.com/docs/swagger.json.
 */
const API = 'https://api.justtcg.com/v1';
const GAME = 'pokemon-japan';
const KEY_STORAGE = 'justtcgKey';
/** На бесплатном тарифе в пакетном запросе не больше 20 карт. */
export const BATCH_LIMIT = 20;
const DAY = 24 * 60 * 60 * 1000;

export async function loadJusttcgKey(): Promise<string> {
  const stored: unknown = (await browser.storage.local.get(KEY_STORAGE))[KEY_STORAGE];
  return typeof stored === 'string' ? stored : '';
}

export async function saveJusttcgKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await browser.storage.local.set({ [KEY_STORAGE]: trimmed });
  else await browser.storage.local.remove(KEY_STORAGE);
}

export type JusttcgFailure = 'invalid-key' | 'rate-limit' | 'offline' | 'failed';

export class JusttcgError extends Error {
  readonly reason: JusttcgFailure;

  constructor(reason: JusttcgFailure) {
    super(reason);
    this.name = 'JusttcgError';
    this.reason = reason;
  }
}

type Usage = { apiDailyLimit?: number; apiDailyRequestsUsed?: number; apiRequestsRemaining?: number };

async function call<T>(key: string, path: string, body?: unknown): Promise<T & { _metadata?: Usage }> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-api-key': key.trim(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new JusttcgError('offline');
  }
  if (response.status === 401 || response.status === 403) throw new JusttcgError('invalid-key');
  if (response.status === 429) throw new JusttcgError('rate-limit');
  if (!response.ok) throw new JusttcgError('failed');
  return (await response.json()) as T & { _metadata?: Usage };
}

export type KeyCheck =
  | { status: 'ok'; left: number | null }
  | { status: 'invalid' | 'rate-limit' | 'offline' | 'no-game' };

/** Проверка ключа: список игр, один запрос из дневного лимита. Заодно видно, есть ли японские карты. */
export async function checkJusttcgKey(key: string): Promise<KeyCheck> {
  try {
    const body = await call<{ data?: Array<{ id?: unknown }> }>(key, '/games');
    if (!body.data?.some((game) => game.id === GAME)) return { status: 'no-game' };
    const usage = body._metadata;
    const left =
      typeof usage?.apiDailyLimit === 'number' && typeof usage.apiDailyRequestsUsed === 'number'
        ? Math.max(0, usage.apiDailyLimit - usage.apiDailyRequestsUsed)
        : (usage?.apiRequestsRemaining ?? null);
    return { status: 'ok', left };
  } catch (error) {
    if (!(error instanceof JusttcgError)) return { status: 'offline' };
    if (error.reason === 'invalid-key') return { status: 'invalid' };
    if (error.reason === 'rate-limit') return { status: 'rate-limit' };
    return { status: 'offline' };
  }
}

export type JusttcgSet = { id: string; name: string };

/** Код сета из названия TCGplayer: «MBG: MEGA Starter Set Mega Gengar ex» → «MBG». */
export function setCodeOf(name: string): string | null {
  const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,11}):\s/.exec(name.trim());
  return match ? match[1]!.toUpperCase() : null;
}

export function findSet(sets: JusttcgSet[], code: string): JusttcgSet | null {
  const wanted = code.trim().toUpperCase();
  return sets.find((set) => setCodeOf(set.name) === wanted) ?? null;
}

/** Все японские сеты: один запрос в неделю. */
async function japaneseSets(key: string): Promise<JusttcgSet[]> {
  const known = await cacheGet<JusttcgSet[]>('justtcg:sets', 7 * DAY);
  if (known) return known;
  const body = await call<{ data?: Array<{ id?: unknown; name?: unknown }> }>(key, `/sets?game=${GAME}`);
  const sets = (body.data ?? []).flatMap((set) =>
    typeof set.id === 'string' && typeof set.name === 'string' ? [{ id: set.id, name: set.name }] : [],
  );
  if (sets.length > 0) void cachePut('justtcg:sets', sets);
  return sets;
}

/** Вариант карты в ответе JustTCG: состояние, печать и цена в долларах. */
export type JusttcgVariant = {
  condition?: string;
  printing?: string;
  language?: string;
  price?: number | null;
  priceStatus?: string;
  lastKnownPrice?: number | null;
};

export type JusttcgCard = { id?: string; name?: string; number?: string; set?: string; variants?: JusttcgVariant[] };

/** Цены Near Mint по печатям: { "Holofoil": 5.81 }. Цена, которую рынок перестал сообщать, — последняя известная. */
export type PrintingPrices = Record<string, number>;

export type Printing = 'holo' | 'normal' | 'reverse';

function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

export function printingPrices(variants: JusttcgVariant[] | undefined): PrintingPrices {
  const prices: PrintingPrices = {};
  for (const variant of variants ?? []) {
    if (variant.condition && !/^(near mint|nm)$/i.test(variant.condition.trim())) continue;
    const price = money(variant.price) ?? (variant.priceStatus === 'expired' ? money(variant.lastKnownPrice) : null);
    const printing = variant.printing?.trim() || 'Normal';
    if (price !== null && !(printing in prices)) prices[printing] = price;
  }
  return prices;
}

/** Цена нужной печати; если у карты печать одна (голо-карта бывает только голо), — её цена. */
export function pickPrice(prices: PrintingPrices, printing: Printing): number | null {
  const entries = Object.entries(prices);
  const fits = (name: string) =>
    printing === 'reverse'
      ? /reverse/i.test(name)
      : printing === 'holo'
        ? /holo|foil/i.test(name) && !/reverse/i.test(name)
        : /^normal$/i.test(name);
  const exact = entries.find(([name]) => fits(name));
  if (exact) return exact[1];
  return entries.length === 1 ? entries[0]![1] : null;
}

/** Номер карты в ответе: «003/021» → «3». */
export function cardNumber(value: string | undefined): string | null {
  const head = value?.split('/')[0]?.trim();
  return head ? normalizeNumber(head) : null;
}

/** Имя товара TCGplayer без пометок в скобках и номера в конце: «Mega Gengar ex - 003/021» → «Mega Gengar ex». */
export function productName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+-\s+[A-Za-z]*\d+(?:\/\d+)?\s*$/, '')
    .trim();
}

/** Карта JustTCG под этим кодом сета и номером: её ID для пакетных обновлений, имя и цены по печатям. */
export type FoundCard = { cardId: string; name: string; prices: PrintingPrices };

/** Номер с нулями, как печатают на японских картах: «3» → «003». */
const padded = (value: string) => normalizeNumber(value).padStart(3, '0');

/**
 * Карта по коду сета и номеру, по одному запросу на попытку: поиск в сете по английскому имени,
 * фильтр по номеру «003/021», потом первые три страницы сета. Имя не проверяется: под кодом
 * и номером лежит одна карта, и чья она, решает вызывающий код. ID карты потом хранится
 * в общем кэше, и этот поиск для карты больше не нужен.
 */
export async function findJusttcgCard(
  key: string,
  setCode: string,
  printedNumber: string,
  hints: { englishName: string | null; total: string | null },
): Promise<FoundCard | null> {
  const set = findSet(await japaneseSets(key), setCode);
  if (!set) return null;
  const number = normalizeNumber(printedNumber);
  const base = `/cards?game=${GAME}&set=${encodeURIComponent(set.id)}&condition=NM&include_price_history=false&limit=20`;
  const attempts = [
    ...(hints.englishName ? [`${base}&q=${encodeURIComponent(searchName(hints.englishName))}`] : []),
    ...(hints.total && /^\d+$/.test(hints.total.trim())
      ? [`${base}&number=${encodeURIComponent(`${padded(number)}/${padded(hints.total)}`)}`]
      : []),
    `${base}&offset=0`,
    `${base}&offset=20`,
    `${base}&offset=40`,
  ];
  for (const attempt of attempts) {
    const body = await call<{ data?: JusttcgCard[]; meta?: { hasMore?: boolean } }>(key, attempt);
    const card = (body.data ?? []).find((item) => cardNumber(item.number) === number);
    if (card?.id) return { cardId: card.id, name: productName(card.name ?? ''), prices: printingPrices(card.variants) };
    if (attempt.includes('&offset=') && body.meta?.hasMore === false) break;
  }
  return null;
}

/** Свежие цены уже известных карт: пакетами по 20, по одному запросу на пакет. */
export async function refreshJusttcgCards(key: string, cardIds: string[]): Promise<Map<string, PrintingPrices>> {
  const result = new Map<string, PrintingPrices>();
  const unique = [...new Set(cardIds)];
  for (let start = 0; start < unique.length; start += BATCH_LIMIT) {
    const chunk = unique.slice(start, start + BATCH_LIMIT);
    const body = await call<{ data?: JusttcgCard[] }>(
      key,
      '/cards?include_price_history=false',
      chunk.map((cardId) => ({ cardId, condition: 'NM' })),
    );
    for (const card of body.data ?? []) {
      if (card.id && chunk.includes(card.id)) result.set(card.id, printingPrices(card.variants));
    }
  }
  return result;
}
