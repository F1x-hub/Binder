import { describe, expect, it } from 'vitest';
import {
  CARD_LANGUAGES,
  LANGUAGE_LABELS,
  albumDocId,
  catalogFor,
  catalogIdOf,
  languageFromScript,
  normalizeLanguage,
} from '@/lib/languages';

describe('каталог для языка карты', () => {
  it('международные издания сверяются с английским каталогом как та же карта', () => {
    for (const lang of ['en', 'fr', 'de', 'it', 'es', 'pt', 'ru'] as const) {
      expect(catalogFor(lang)).toEqual({ tcgdex: 'en', exact: true });
    }
  });

  it('у японских, тайваньских, индонезийских и тайских карт свой каталог', () => {
    for (const lang of ['ja', 'zh-tw', 'id', 'th'] as const) {
      expect(catalogFor(lang)).toEqual({ tcgdex: lang, exact: true });
    }
  });

  it('китайские для КНР не привязаны ни к одному каталогу: их сеты свои', () => {
    expect(catalogFor('zh-cn')).toEqual({ tcgdex: null, exact: false });
  });

  it('корейская карта — похожая из японского каталога: те же сеты и номера, другая печать', () => {
    expect(catalogFor('ko')).toEqual({ tcgdex: 'ja', exact: false });
  });

  it('неизвестный язык — только подсказки из английской базы', () => {
    expect(catalogFor('other')).toEqual({ tcgdex: 'en', exact: false });
  });

  it('у каждого языка есть значок и подпись', () => {
    for (const lang of CARD_LANGUAGES) {
      expect(LANGUAGE_LABELS[lang].short.length).toBeGreaterThan(0);
      expect(LANGUAGE_LABELS[lang].card.length).toBeGreaterThan(0);
    }
  });
});

describe('ID документа альбома', () => {
  it('у английской карты ID как в TCGdex: старые записи фазы 2 остаются на месте', () => {
    expect(albumDocId('sv03-125', 'en')).toBe('sv03-125');
    expect(catalogIdOf('sv03-125', 'en')).toBe('sv03-125');
  });

  it('у остальных — с языком, и ID карты из него достаётся обратно', () => {
    expect(albumDocId('sv03-125', 'fr')).toBe('sv03-125_fr');
    expect(albumDocId('SV2a-094', 'ja')).toBe('SV2a-094_ja');
    expect(catalogIdOf('SV2a-094_ja', 'ja')).toBe('SV2a-094');
    expect(catalogIdOf('SV2a-094_zh-tw', 'zh-tw')).toBe('SV2a-094');
  });
});

describe('язык по письменности', () => {
  it('узнаёт кану, хангыль, тайский и кириллицу', () => {
    expect(languageFromScript('メガゲンガーex')).toBe('ja');
    expect(languageFromScript('ふしぎだね')).toBe('ja');
    expect(languageFromScript('피카츄')).toBe('ko');
    expect(languageFromScript('พิคาชู')).toBe('th');
    expect(languageFromScript('Пикачу')).toBe('ru');
  });

  it('по латинице и одним иероглифам язык не угадывает', () => {
    expect(languageFromScript('Pikachu')).toBeNull();
    expect(languageFromScript('皮卡丘')).toBeNull();
  });
});

describe('normalizeLanguage', () => {
  it('принимает наши коды и частые другие записи', () => {
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(normalizeLanguage(' Japanese ')).toBe('ja');
    expect(normalizeLanguage('zh-HK')).toBe('zh-tw');
    expect(normalizeLanguage('zh')).toBe('zh-cn');
    expect(normalizeLanguage('es-MX')).toBe('es');
  });

  it('незнакомое — null', () => {
    expect(normalizeLanguage('xx')).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });
});
