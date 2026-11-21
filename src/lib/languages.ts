/**
 * Язык карты. От него зависит, в каком каталоге её искать и откуда брать цену.
 * Международные издания (английское, европейские, русское) делят сеты и номера с английским.
 * У японских, тайваньских, индонезийских и тайских карт свои сеты и номера, и у TCGdex для
 * них свои каталоги. Корейские и китайские (КНР) каталоги у TCGdex есть, но почти пустые
 * (проверено 21 ноября 2026): у корейского 95 сетов, карты только в трёх, сканов нет;
 * у китайского своих карт со сканами тоже нет. Поэтому у обоих свои каталоги не из TCGdex
 * в том же виде, что и каталоги TCGdex. Китайские сеты для КНР свои (CSV1C, CS1aC…), их
 * каталог — выгрузка официальной базы КНР (src/lib/cn-catalog.ts). Корейские сеты повторяют
 * японские коды и номера (SV4K #001 — ヤナップ и 야나프), их каталог — выгрузки официальной
 * корейской базы (src/lib/ko-catalog.ts), а ID карты такой же, как у японской («SV2a-094»).
 */
export const CARD_LANGUAGES = [
  'en',
  'fr',
  'de',
  'it',
  'es',
  'pt',
  'ru',
  'ja',
  'zh-tw',
  'zh-cn',
  'ko',
  'id',
  'th',
  'other',
] as const;

export type CardLanguage = (typeof CARD_LANGUAGES)[number];

/**
 * Каталоги, в которых мы ищем карты: каталоги TCGdex, китайский для КНР (zh-cn) и корейский (ko),
 * которые выглядят так же, но собраны из выгрузок официальных баз (src/lib/cn-catalog.ts,
 * src/lib/ko-catalog.ts).
 */
export type TcgdexLanguage = 'en' | 'ja' | 'zh-tw' | 'zh-cn' | 'ko' | 'id' | 'th';

/** short — значок на карте, card — подпись целиком. */
export const LANGUAGE_LABELS: Record<CardLanguage, { short: string; card: string }> = {
  en: { short: 'EN', card: 'Английская карта' },
  fr: { short: 'FR', card: 'Французская карта' },
  de: { short: 'DE', card: 'Немецкая карта' },
  it: { short: 'IT', card: 'Итальянская карта' },
  es: { short: 'ES', card: 'Испанская карта' },
  pt: { short: 'PT', card: 'Португальская карта' },
  ru: { short: 'RU', card: 'Русская карта' },
  ja: { short: 'JP', card: 'Японская карта' },
  'zh-tw': { short: 'TW', card: 'Китайская карта, традиционные иероглифы' },
  'zh-cn': { short: 'CN', card: 'Китайская карта, упрощённые иероглифы' },
  ko: { short: 'KR', card: 'Корейская карта' },
  id: { short: 'ID', card: 'Индонезийская карта' },
  th: { short: 'TH', card: 'Тайская карта' },
  other: { short: '?', card: 'Язык карты не определён' },
};

const HTML_LANGS: Record<CardLanguage, string | undefined> = {
  en: 'en',
  fr: 'fr',
  de: 'de',
  it: 'it',
  es: 'es',
  pt: 'pt',
  ru: 'ru',
  ja: 'ja',
  'zh-tw': 'zh-Hant',
  'zh-cn': 'zh-Hans',
  ko: 'ko',
  id: 'id',
  th: 'th',
  other: undefined,
};

/** Атрибут lang для текста карты: японские иероглифы браузер рисует японским шрифтом, а не китайским. */
export function htmlLang(lang: CardLanguage): string | undefined {
  return HTML_LANGS[lang];
}

export function isCardLanguage(value: unknown): value is CardLanguage {
  return typeof value === 'string' && (CARD_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Где искать карту. tcgdex — язык каталога (null — каталога нет), exact — в каталоге лежит
 * именно эта карта, а не похожая. Язык «other» (модель его не узнала) сверяется
 * с английским каталогом только как подсказка: какую карту взять, решает человек.
 * Привязка документов альбома к каталогу выводится отсюда, поэтому менять её можно только
 * вместе с переносом уже записанных карт. Несколько часов 21 ноября 2026 корейские карты
 * сверялись с японским каталогом как похожие и записывались как «{японский ID}_ko»
 * («SV2a-094_ko»): ID корейской карты тот же, поэтому такие документы без переноса читаются
 * из корейского каталога (src/lib/ko-catalog.ts). Корейские карты, добавленные как есть
 * (с printed, ID «x-ko-…»), не задевает ничего: у документа с printed каталога нет при любом
 * языке. Так же и китайские карты для КНР, добавленные как есть до своего каталога («x-zh-cn-…»).
 */
export function catalogFor(lang: CardLanguage): { tcgdex: TcgdexLanguage | null; exact: boolean } {
  switch (lang) {
    case 'ja':
    case 'zh-tw':
    case 'zh-cn':
    case 'ko':
    case 'id':
    case 'th':
      return { tcgdex: lang, exact: true };
    case 'other':
      return { tcgdex: 'en', exact: false };
    default:
      return { tcgdex: 'en', exact: true };
  }
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

/**
 * Язык по письменности имени: страховка, если модель ошиблась или промолчала.
 * Кана бывает только в японском, хангыль — в корейском. По одним иероглифам
 * японскую карту от китайской не отличить, тут решает модель.
 */
export function languageFromScript(name: string): CardLanguage | null {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) return 'ja';
  if (/\p{Script=Hangul}/u.test(name)) return 'ko';
  if (/\p{Script=Thai}/u.test(name)) return 'th';
  if (/\p{Script=Cyrillic}/u.test(name)) return 'ru';
  return null;
}

const ALIASES: Record<string, CardLanguage> = {
  english: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  french: 'fr',
  german: 'de',
  italian: 'it',
  spanish: 'es',
  'es-es': 'es',
  'es-mx': 'es',
  portuguese: 'pt',
  'pt-br': 'pt',
  'pt-pt': 'pt',
  russian: 'ru',
  japanese: 'ja',
  jp: 'ja',
  jpn: 'ja',
  'zh-hant': 'zh-tw',
  'zh-hk': 'zh-tw',
  tw: 'zh-tw',
  'zh-hans': 'zh-cn',
  // Без уточнения чаще всего это издания для КНР
  zh: 'zh-cn',
  cn: 'zh-cn',
  chinese: 'zh-cn',
  korean: 'ko',
  kr: 'ko',
  'ko-kr': 'ko',
  indonesian: 'id',
  thai: 'th',
};

/** Язык из ответа модели: «JP», «zh_TW», «Japanese» и прочие записи сводятся к нашим кодам. */
export function normalizeLanguage(value: unknown): CardLanguage | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase().replace(/_/g, '-');
  if (isCardLanguage(code)) return code;
  return ALIASES[code] ?? null;
}
