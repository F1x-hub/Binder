import { browser } from 'wxt/browser';

/**
 * Состояние ключей JustTCG в этом браузере: какой ключ упёрся в лимит и до какого времени,
 * сколько у него осталось запросов по последнему ответу. Сами ключи общие для клуба
 * (config/justtcg, src/lib/club-keys.ts); состояние лежит только в chrome.storage.local.
 */

/** Ключ из прежних настроек, где каждый участник вводил свой */
const LEGACY_STORAGE = 'justtcgKey';
const STATE_STORAGE = 'justtcgKeyState';

/** Почему ключ отложен: минутный, дневной или месячный лимит, либо ключ не подошёл. */
export type BlockReason = 'minute' | 'day' | 'month' | 'invalid';

/**
 * Остаток запросов по последнему ответу JustTCG. day — день UTC, к которому относятся
 * дневные числа: на следующий день дневной счётчик начинается заново.
 */
export type KeyUsage = {
  day: string;
  plan: string | null;
  dayLeft: number | null;
  dayLimit: number | null;
  monthLeft: number | null;
  monthLimit: number | null;
};

export type KeyState = { block?: { reason: BlockReason; until: number }; usage?: KeyUsage };

export type KeyStates = Record<string, KeyState>;

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Ближайшая полночь UTC: в это время JustTCG сбрасывает дневной лимит. */
export function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/**
 * До какого времени ключ отложен. Месячный лимит бесплатного ключа сбрасывается в день
 * создания аккаунта, а его Binder не знает, поэтому такой ключ пробуется раз в сутки.
 * Неподошедший ключ откладывается навсегда, пока его не заменят в настройках.
 */
export function blockUntil(reason: BlockReason, now: number): number {
  if (reason === 'minute') return now + 60_000;
  if (reason === 'invalid') return Number.MAX_SAFE_INTEGER;
  return nextUtcMidnight(now);
}

/** Ключи, с которых можно слать запрос сейчас, в порядке очереди. */
export function usableKeys(keys: string[], states: KeyStates, now: number): string[] {
  return keys.filter((key) => (states[key]?.block?.until ?? 0) <= now);
}

/** Когда освободится первый из отложенных ключей; null — неподошедшие ключи сами не освободятся. */
export function soonestRelease(keys: string[], states: KeyStates): number | null {
  const times = keys
    .map((key) => states[key]?.block)
    .filter((block) => block && block.reason !== 'invalid')
    .map((block) => block!.until);
  return times.length > 0 ? Math.min(...times) : null;
}

/** Поле _metadata в ответах JustTCG v1. */
export type UsageMetadata = {
  apiPlan?: unknown;
  apiDailyLimit?: unknown;
  apiDailyRequestsUsed?: unknown;
  apiDailyRequestsRemaining?: unknown;
  apiRequestLimit?: unknown;
  apiRequestsUsed?: unknown;
  apiRequestsRemaining?: unknown;
};

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null);

/**
 * Остаток после запроса. С метаданными — из них; без метаданных (ответы v2 их не несут)
 * прежний остаток уменьшается на один запрос, а в новый день дневной счётчик полный.
 */
export function nextUsage(previous: KeyUsage | undefined, metadata: UsageMetadata | undefined, now: number): KeyUsage {
  const day = utcDay(now);
  if (metadata && (metadata.apiDailyLimit !== undefined || metadata.apiRequestsRemaining !== undefined)) {
    const dayLimit = count(metadata.apiDailyLimit);
    const dayUsed = count(metadata.apiDailyRequestsUsed);
    const dayLeft = count(metadata.apiDailyRequestsRemaining) ?? (dayLimit !== null && dayUsed !== null ? Math.max(0, dayLimit - dayUsed) : null);
    const monthLimit = count(metadata.apiRequestLimit);
    const monthUsed = count(metadata.apiRequestsUsed);
    const monthLeft = count(metadata.apiRequestsRemaining) ?? (monthLimit !== null && monthUsed !== null ? Math.max(0, monthLimit - monthUsed) : null);
    return { day, plan: typeof metadata.apiPlan === 'string' ? metadata.apiPlan : (previous?.plan ?? null), dayLeft, dayLimit, monthLeft, monthLimit };
  }
  const base: KeyUsage = previous ?? { day, plan: null, dayLeft: null, dayLimit: null, monthLeft: null, monthLimit: null };
  const sameDay = base.day === day;
  const dayLeft = sameDay ? base.dayLeft : base.dayLimit;
  return {
    ...base,
    day,
    dayLeft: dayLeft === null ? null : Math.max(0, dayLeft - 1),
    monthLeft: base.monthLeft === null ? null : Math.max(0, base.monthLeft - 1),
  };
}

function storage() {
  return browser.storage.local;
}

/** Ключ из прежней настройки, где каждый вводил свой ключ: админ может перенести его в общий список. */
export async function loadLegacyKey(): Promise<string> {
  const stored: unknown = (await storage().get(LEGACY_STORAGE))[LEGACY_STORAGE];
  return typeof stored === 'string' ? stored.trim() : '';
}

export async function forgetLegacyKey(): Promise<void> {
  await storage().remove(LEGACY_STORAGE);
}

export async function loadKeyStates(): Promise<KeyStates> {
  const stored: unknown = (await storage().get(STATE_STORAGE))[STATE_STORAGE];
  return stored && typeof stored === 'object' ? (stored as KeyStates) : {};
}

async function updateState(key: string, change: (state: KeyState) => KeyState): Promise<void> {
  const states = await loadKeyStates();
  states[key] = change(states[key] ?? {});
  await storage().set({ [STATE_STORAGE]: states });
}

/** Ключ ответил: снимаем отметку об исчерпанном лимите и пересчитываем остаток. */
export function noteSuccess(key: string, metadata: UsageMetadata | undefined, now = Date.now()): Promise<void> {
  return updateState(key, (state) => ({ usage: nextUsage(state.usage, metadata, now) }));
}

/** Ключ упёрся в лимит или не подошёл: откладываем его до сброса. */
export function noteBlock(key: string, reason: BlockReason, now = Date.now()): Promise<void> {
  return updateState(key, (state) => ({
    ...state,
    block: { reason, until: blockUntil(reason, now) },
    usage:
      reason === 'day' && state.usage
        ? { ...state.usage, day: utcDay(now), dayLeft: 0 }
        : reason === 'month' && state.usage
          ? { ...state.usage, monthLeft: 0 }
          : state.usage,
  }));
}

/** Подписка на изменения состояния ключей (из поп-апа во вкладку и обратно). */
export function onKeyStatesChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && STATE_STORAGE in changes) listener();
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
