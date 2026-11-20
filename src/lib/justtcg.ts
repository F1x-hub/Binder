import {
  blockUntil,
  loadKeyStates,
  nextUsage,
  noteBlock,
  noteSuccess,
  soonestRelease,
  usableKeys,
  type BlockReason,
  type UsageMetadata,
} from '@/lib/justtcg-keys';
import { cacheGet, cachePut } from '@/lib/kv-cache';
import { normalizeNumber, searchName } from '@/lib/matching';

/**
 * JustTCG (justtcg.com): API с данными TCGplayer. Отсюда доллары японских карт (игра
 * «pokemon-japan»), а на странице карточки — история цены за год и цены в грейде (бета /v2/cards).
 * Бесплатный ключ: 1000 запросов в месяц, 100 в день, 10 в минуту, до 20 карт в пакетном
 * запросе. Ключи общие для клуба (config/justtcg, src/lib/club-keys.ts), их добавляет админ;
 * какой ключ упёрся в лимит, помнит каждый браузер (src/lib/justtcg-keys.ts). CORS у API
 * открыт, разрешений расширению не нужно. Спецификация: https://justtcg.com/docs/swagger.json.
 */
const API = 'https://api.justtcg.com';
const GAME = 'pokemon-japan';
/** На бесплатном тарифе в пакетном запросе не больше 20 карт. */
export const BATCH_LIMIT = 20;
const DAY = 24 * 60 * 60 * 1000;

export type JusttcgFailure = 'invalid-key' | 'rate-limit' | 'no-key' | 'not-found' | 'offline' | 'failed';

export class JusttcgError extends Error {
  readonly reason: JusttcgFailure;
  /** Какой лимит кончился: у rate-limit */
  readonly window: BlockReason | null;
  /** Когда освободится первый ключ; null — неизвестно */
  readonly until: number | null;

  constructor(reason: JusttcgFailure, window: BlockReason | null = null, until: number | null = null) {
    super(reason);
    this.name = 'JusttcgError';
    this.reason = reason;
    this.window = window;
    this.until = until;
  }
}

/**
 * Чем подписан запрос: один ключ (проверка ключа в настройках, тесты) или ключи этого
 * браузера по очереди. У очереди запрос идёт с первого ключа, чей лимит не исчерпан.
 */
export type JusttcgAuth = string | string[];

type WithUsage<T> = T & { _metadata?: UsageMetadata };

async function quietly(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    // Состояние ключей — подсказка для настроек и очереди, без него запрос всё равно работает
  }
}

/** Один запрос одним ключом. Ошибка v1 — { error, code }, v2 — problem+json с тем же code. */
async function request<T>(key: string, path: string, body?: unknown): Promise<WithUsage<T>> {
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
  if (response.ok) return (await response.json()) as WithUsage<T>;
  const problem = (await response.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof problem?.code === 'string' ? problem.code : '';
  if (code === 'DAILY_LIMIT_EXCEEDED') throw new JusttcgError('rate-limit', 'day');
  if (code === 'REQUEST_LIMIT_EXCEEDED') throw new JusttcgError('rate-limit', 'month');
  if (code === 'RATE_LIMIT_EXCEEDED' || response.status === 429) throw new JusttcgError('rate-limit', 'minute');
  if (code === 'INVALID_API_KEY' || code === 'MISSING_API_KEY' || response.status === 401 || response.status === 403) {
    throw new JusttcgError('invalid-key');
  }
  if (response.status === 404) throw new JusttcgError('not-found');
  throw new JusttcgError('failed');
}

/**
 * Запрос с очередью ключей. Ключ, у которого кончился лимит или который не подошёл,
 * откладывается до сброса, и запрос повторяется со следующего. Если отложены все —
 * ошибка rate-limit со временем, когда освободится первый. Нет связи или сбой у JustTCG —
 * следующий ключ не пробуется: он ответил бы так же.
 */
async function call<T>(auth: JusttcgAuth, path: string, body?: unknown): Promise<WithUsage<T>> {
  const now = Date.now();
  const all = typeof auth === 'string' ? [auth.trim()] : auth;
  if (all.length === 0 || all.every((key) => !key)) throw new JusttcgError('no-key');
  const states = typeof auth === 'string' ? {} : await loadKeyStates().catch(() => ({}));
  const keys = usableKeys(all, states, now);
  if (keys.length === 0) {
    const until = soonestRelease(all, states);
    throw until === null ? new JusttcgError('invalid-key') : new JusttcgError('rate-limit', null, until);
  }

  const blocked: Array<{ reason: BlockReason; until: number }> = [];
  let last: JusttcgError | null = null;
  for (const key of keys) {
    try {
      const result = await request<T>(key, path, body);
      await quietly(() => noteSuccess(key, result._metadata, now));
      return result;
    } catch (error) {
      if (!(error instanceof JusttcgError)) throw error;
      if (error.reason !== 'rate-limit' && error.reason !== 'invalid-key') throw error;
      const reason: BlockReason = error.reason === 'invalid-key' ? 'invalid' : (error.window ?? 'minute');
      await quietly(() => noteBlock(key, reason, now));
      blocked.push({ reason, until: blockUntil(reason, now) });
      last = error;
    }
  }
  // Все ключи упёрлись: лимит важнее неподошедшего ключа, у него хотя бы есть время сброса
  const limits = blocked.filter((item) => item.reason !== 'invalid');
  if (limits.length > 0) {
    const first = limits.reduce((soonest, item) => (item.until < soonest.until ? item : soonest));
    throw new JusttcgError('rate-limit', first.reason, first.until);
  }
  throw last ?? new JusttcgError('failed');
}

export type KeyCheck =
  | { status: 'ok'; left: number | null }
  | { status: 'invalid' | 'rate-limit' | 'offline' | 'no-game' };

/** Проверка ключа: список игр, один запрос из дневного лимита. Заодно видно, есть ли японские карты. */
export async function checkJusttcgKey(key: string): Promise<KeyCheck> {
  try {
    const body = await call<{ data?: Array<{ id?: unknown }> }>(key, '/v1/games');
    if (!body.data?.some((game) => game.id === GAME)) return { status: 'no-game' };
    return { status: 'ok', left: nextUsage(undefined, body._metadata, Date.now()).dayLeft };
  } catch (error) {
    if (!(error instanceof JusttcgError)) return { status: 'offline' };
    if (error.reason === 'invalid-key' || error.reason === 'no-key') return { status: 'invalid' };
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
async function japaneseSets(auth: JusttcgAuth): Promise<JusttcgSet[]> {
  const known = await cacheGet<JusttcgSet[]>('justtcg:sets', 7 * DAY);
  if (known) return known;
  const body = await call<{ data?: Array<{ id?: unknown; name?: unknown }> }>(auth, `/v1/sets?game=${GAME}`);
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
  auth: JusttcgAuth,
  setCode: string,
  printedNumber: string,
  hints: { englishName: string | null; total: string | null },
): Promise<FoundCard | null> {
  const set = findSet(await japaneseSets(auth), setCode);
  if (!set) return null;
  const number = normalizeNumber(printedNumber);
  const base = `/v1/cards?game=${GAME}&set=${encodeURIComponent(set.id)}&condition=NM&include_price_history=false&limit=20`;
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
    const body = await call<{ data?: JusttcgCard[]; meta?: { hasMore?: boolean } }>(auth, attempt);
    const card = (body.data ?? []).find((item) => cardNumber(item.number) === number);
    if (card?.id) return { cardId: card.id, name: productName(card.name ?? ''), prices: printingPrices(card.variants) };
    if (attempt.includes('&offset=') && body.meta?.hasMore === false) break;
  }
  return null;
}

/** Свежие цены уже известных карт: пакетами по 20, по одному запросу на пакет. */
export async function refreshJusttcgCards(auth: JusttcgAuth, cardIds: string[]): Promise<Map<string, PrintingPrices>> {
  const result = new Map<string, PrintingPrices>();
  const unique = [...new Set(cardIds)];
  for (let start = 0; start < unique.length; start += BATCH_LIMIT) {
    const chunk = unique.slice(start, start + BATCH_LIMIT);
    const body = await call<{ data?: JusttcgCard[] }>(
      auth,
      '/v1/cards?include_price_history=false',
      chunk.map((cardId) => ({ cardId, condition: 'NM' })),
    );
    for (const card of body.data ?? []) {
      if (card.id && chunk.includes(card.id)) result.set(card.id, printingPrices(card.variants));
    }
  }
  return result;
}

/** Цена варианта в одном регионе (бета /v2/cards). Поля, которых не просили, в ответе нет. */
export type MarketV2 = {
  region?: string;
  currency?: string;
  price?: number | null;
  price_status?: string;
  last_price?: number | null;
  updated_at?: number;
  last_sale_at?: number | null;
  periods?: Record<string, { change_pct?: number | null; avg?: number | null; sales_count?: number } | undefined>;
  price_history?: Array<{ t?: number; p?: number }>;
};

export type GradingV2 = { company?: string; grade?: number | null; grade_label?: string | null; qualifier?: string | null; canonical?: string };

/** Вариант карты: без грейда (condition) или в грейде (grading). */
export type VariantV2 = {
  id?: string;
  type?: string;
  condition?: string | null;
  printing?: string | null;
  language?: string | null;
  grading?: GradingV2 | null;
  markets?: MarketV2[];
};

export type CardV2 = { id?: string; slug?: string; name?: string; number?: string | null; variants?: VariantV2[] };

/** Как найти карту: английскую — по ID товара TCGplayer из TCGdex, японскую — по ID в JustTCG. */
export type CardLookup = { tcgplayerId: string } | { cardId: string };

/**
 * Карта со всеми вариантами одним запросом: цена без грейда и в грейде, история за год
 * и изменения за 30 и 90 дней. null — такой карты в JustTCG нет.
 */
export async function fetchCardMarket(auth: JusttcgAuth, lookup: CardLookup): Promise<CardV2 | null> {
  const id =
    'tcgplayerId' in lookup ? `tcgplayer_id=${encodeURIComponent(lookup.tcgplayerId)}` : `card_id=${encodeURIComponent(lookup.cardId)}`;
  try {
    const body = await call<{ data?: CardV2 | CardV2[] }>(
      auth,
      `/v2/cards?${id}&graded=include&include=periods.30d,periods.90d,price_history.1y`,
    );
    const data = Array.isArray(body.data) ? body.data[0] : body.data;
    return data ?? null;
  } catch (error) {
    if (error instanceof JusttcgError && error.reason === 'not-found') return null;
    throw error;
  }
}
