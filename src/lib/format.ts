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

/** Цена как в макетах: «$1 284» для сумм, «$24,80» для отдельных карточек. */
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
