const pluralRules = new Intl.PluralRules('ru-RU');
const wholeNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const withCents = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Неразрывный пробел: число и слово не разъезжаются по строкам. */
export const NBSP = String.fromCharCode(0xa0);

/** Формы слова для 1, 2 и 5: «карточка», «карточки», «карточек». */
export type WordForms = readonly [one: string, few: string, many: string];

export const CARD_FORMS: WordForms = ['карточка', 'карточки', 'карточек'];
export const SET_FORMS: WordForms = ['сет', 'сета', 'сетов'];
export const DECK_FORMS: WordForms = ['колода', 'колоды', 'колод'];
export const INVITE_FORMS: WordForms = ['приглашение', 'приглашения', 'приглашений'];

/** «Осталось 3 приглашения», а при нуле — «Приглашений не осталось». */
export function invitesLeftLabel(n: number): string {
  return n > 0 ? `Осталось ${countLabel(n, INVITE_FORMS)}` : 'Приглашений не осталось';
}

export function pluralWord(n: number, [one, few, many]: WordForms): string {
  switch (pluralRules.select(n)) {
    case 'one':
      return one;
    case 'few':
    case 'other': // дробные числа: «1,5 карточки»
      return few;
    default:
      return many;
  }
}

export function formatInteger(n: number): string {
  return wholeNumber.format(n);
}

/** «148 карточек»: число и слово через неразрывный пробел. */
export function countLabel(n: number, forms: WordForms): string {
  return `${formatInteger(n)}${NBSP}${pluralWord(n, forms)}`;
}

/**
 * Цена в долларах. Суммы коллекции и цены карт — с центами («$5,81», «$1 284,50»): владелец
 * попросил точные суммы вместо округлённых из макетов. Без центов («$1 284») — где точность не нужна.
 */
export function formatUsd(value: number, cents = false): string {
  return `$${(cents ? withCents : wholeNumber).format(value)}`;
}

/** Цена карты: доллары TCGplayer, а если их нет — евро Cardmarket, иначе прочерк. */
export function formatCardPrice(price: { u: number | null; e: number | null } | null | undefined): string {
  if (price?.u != null) return formatUsd(price.u, true);
  if (price?.e != null) return `€${withCents.format(price.e)}`;
  return '—';
}

export const SIMILAR_FORMS: WordForms = ['похожий вариант', 'похожих варианта', 'похожих вариантов'];

/** Редкость как на картах: «Double rare» → «Double Rare». */
export function rarityLabel(rarity: string | undefined): string | null {
  if (!rarity) return null;
  return rarity.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const MINUTE_FORMS: WordForms = ['минуту', 'минуты', 'минут'];
const HOUR_FORMS: WordForms = ['час', 'часа', 'часов'];
const DAY_FORMS: WordForms = ['день', 'дня', 'дней'];
const dayMonthLong = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** Сколько календарных дней (по местному времени) между двумя моментами: вчера — 1. */
function calendarDays(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  // Округление: в дни перевода часов в сутках 23 или 25 часов
  return Math.round((end - start) / (24 * HOUR_MS));
}

/**
 * Когда это было, как в макете ленты: «только что», «10 минут назад», «2 часа назад», «вчера»,
 * «3 дня назад», а дальше недели — дата («12 ноября», в другом году — «12 ноября 2025 г.»).
 * Время с сервера чуть впереди часов браузера — «только что».
 */
export function timeAgo(at: number, now = Date.now()): string {
  const diff = now - at;
  if (diff < MINUTE_MS) return 'только что';
  if (diff < HOUR_MS) return `${countLabel(Math.floor(diff / MINUTE_MS), MINUTE_FORMS)} назад`;
  const then = new Date(at);
  const today = new Date(now);
  const days = calendarDays(then, today);
  if (days <= 0) return `${countLabel(Math.floor(diff / HOUR_MS), HOUR_FORMS)} назад`;
  if (days === 1) return 'вчера';
  if (days < 7) return `${countLabel(days, DAY_FORMS)} назад`;
  return (then.getFullYear() === today.getFullYear() ? dayMonthLong : dayMonthYear).format(then);
}
