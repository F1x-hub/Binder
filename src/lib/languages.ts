/**
 * Язык карты. От него зависит, в каком каталоге TCGdex её искать и есть ли у неё цена.
 * Международные издания (английское и европейские) делят ID и номера с английским,
 * у японских, тайваньских, индонезийских и тайских свои сеты и номера.
 * Китайских изданий для КНР и корейских в TCGdex нет вообще.
 */
export const CARD_LANGUAGES = ['en', 'fr', 'de', 'it', 'es', 'pt', 'ja', 'zh-tw', 'zh-cn', 'ko', 'id', 'th', 'other'] as const;

export type CardLanguage = (typeof CARD_LANGUAGES)[number];

/** Языки каталогов TCGdex, в которых мы ищем карты. */
export type TcgdexLanguage = 'en' | 'ja' | 'zh-tw' | 'id' | 'th';

export const LANGUAGE_LABELS: Record<CardLanguage, { short: string; name: string }> = {
  en: { short: 'EN', name: 'английская' },
  fr: { short: 'FR', name: 'французская' },
  de: { short: 'DE', name: 'немецкая' },
  it: { short: 'IT', name: 'итальянская' },
  es: { short: 'ES', name: 'испанская' },
  pt: { short: 'PT', name: 'португальская' },
  ja: { short: 'JP', name: 'японская' },
  'zh-tw': { short: 'TW', name: 'китайская, традиционная' },
  'zh-cn': { short: 'CN', name: 'китайская, упрощённая' },
  ko: { short: 'KR', name: 'корейская' },
  id: { short: 'ID', name: 'индонезийская' },
  th: { short: 'TH', name: 'тайская' },
  other: { short: '?', name: 'язык не определён' },
};

export function isCardLanguage(value: unknown): value is CardLanguage {
  return typeof value === 'string' && (CARD_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Где искать карту: tcgdex — язык каталога, exact — найдётся ли там именно эта карта.
 * Для китайских (КНР) и корейских карт ищется английский аналог: номер у них другой.
 */
export function catalogFor(lang: CardLanguage): { tcgdex: TcgdexLanguage; exact: boolean } {
  switch (lang) {
    case 'ja':
    case 'zh-tw':
    case 'id':
    case 'th':
      return { tcgdex: lang, exact: true };
    case 'zh-cn':
    case 'ko':
    case 'other':
      return { tcgdex: 'en', exact: false };
    default:
      return { tcgdex: 'en', exact: true };
  }
}

/** Цены TCGplayer и Cardmarket есть только у международных изданий. */
export function hasPrices(lang: CardLanguage): boolean {
  return ['en', 'fr', 'de', 'it', 'es', 'pt'].includes(lang);
}

/** ID документа в альбоме: у английской карты — её ID в TCGdex, у остальных — с языком через «_». */
export function albumDocId(cardId: string, lang: CardLanguage): string {
  return lang === 'en' ? cardId : `${cardId}_${lang}`;
}

/** ID карты в каталоге по ID документа альбома. */
export function catalogIdOf(docId: string, lang: CardLanguage): string {
  const suffix = `_${lang}`;
  return lang !== 'en' && docId.endsWith(suffix) ? docId.slice(0, -suffix.length) : docId;
}
