import { describe, expect, it } from 'vitest';
import { customCard, ownedFromDoc, setKey } from '@/lib/collection';
import type { Candidate, DetectedCard } from '@/lib/matching';
import { cropRect } from '@/lib/photo';
import { printedOf, toNewCard } from '@/scan/useScan';

const detected = (card: Partial<DetectedCard>): DetectedCard => ({
  name: 'メガゲンガーex',
  englishName: 'Mega Gengar ex',
  number: '003',
  total: '021',
  setCode: 'mBG',
  holo: true,
  language: 'ja',
  box: null,
  confidence: 0.9,
  ...card,
});

const pick = (card: Partial<Candidate>): Candidate => ({
  cardId: 'SV2a-094',
  setId: 'SV2a',
  name: 'ゲンガー',
  localId: '094',
  image: 'https://assets.tcgdex.net/ja/SV/SV2a/094',
  setName: 'ポケモンカード151',
  printedTotal: 165,
  setCode: null,
  releaseDate: '2023-06-16',
  lang: 'ja',
  approximate: false,
  source: 'tcgdex',
  score: 1,
  ...card,
});

describe('документ альбома', () => {
  it('карта фазы 2 без языка — английская из английского каталога', () => {
    const card = ownedFromDoc('mep-073', { setId: 'mep', count: 1 });
    expect(card).toMatchObject({ docId: 'mep-073', cardId: 'mep-073', catalog: 'en', lang: 'en', printed: null });
  });

  it('японская карта ссылается на японский каталог', () => {
    const card = ownedFromDoc('SV2a-094_ja', { setId: 'SV2a', count: 2, lang: 'ja', variant: 'holo' });
    expect(card).toMatchObject({ cardId: 'SV2a-094', catalog: 'ja', lang: 'ja', count: 2, variant: 'holo' });
  });

  it('французская карта — та же, что в английском каталоге', () => {
    expect(ownedFromDoc('sv03-125_fr', { setId: 'sv03', count: 1, lang: 'fr' })).toMatchObject({
      cardId: 'sv03-125',
      catalog: 'en',
    });
  });

  it('карта вне базы показывается по напечатанному и в каталог не ходит', () => {
    const printed = { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'mBG' };
    const card = ownedFromDoc('x-ja-MBG-3', { setId: 'MBG', count: 1, lang: 'ja', printed });
    expect(card).toMatchObject({ cardId: null, catalog: null, printed });
  });

  it('группы альбома не смешивают каталоги и карты вне базы', () => {
    expect(setKey({ catalog: 'en', setId: 'sv03', lang: 'fr' })).toBe('en:sv03');
    expect(setKey({ catalog: 'ja', setId: 'SV3', lang: 'ja' })).toBe('ja:SV3');
    expect(setKey({ catalog: null, setId: 'MBG', lang: 'ja' })).toBe('x:ja:MBG');
  });
});

describe('карта вне базы', () => {
  it('ID из языка, кода сета и номера: повторный скан добавит копию', () => {
    expect(customCard('ja', printedOf(detected({})))).toEqual({ docId: 'x-ja-MBG-3', setId: 'MBG' });
    expect(customCard('ja', printedOf(detected({ number: '3', setCode: 'MBG' })))).toEqual({
      docId: 'x-ja-MBG-3',
      setId: 'MBG',
    });
  });

  it('без кода сета ID строится по имени и номеру', () => {
    const a = customCard('zh-cn', printedOf(detected({ setCode: null, language: 'zh-cn', englishName: 'Pikachu', number: '25' })));
    const b = customCard('zh-cn', printedOf(detected({ setCode: null, language: 'zh-cn', englishName: 'Eevee', number: '25' })));
    expect(a.docId).toMatch(/^x-zh-cn-[0-9a-z]+-25$/);
    expect(a.docId).not.toBe(b.docId);
    expect(a.setId).toBe('NOSET');
  });

  it('ID проходит проверку правил: только латиница, цифры, точка, дефис и подчёркивание', () => {
    const { docId, setId } = customCard('ja', printedOf(detected({ setCode: 'S V/2a★', number: '１２３' })));
    expect(docId).toMatch(/^[A-Za-z0-9._-]{1,60}$/);
    expect(setId).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
  });

  it('напечатанное обрезается до длин из правил', () => {
    const printed = printedOf(detected({ name: 'x'.repeat(200), number: '1'.repeat(30), setCode: 'y'.repeat(30) }));
    expect(printed.name).toHaveLength(80);
    expect(printed.number).toHaveLength(12);
    expect(printed.setCode).toHaveLength(16);
  });
});

describe('запись готовой карты в альбом', () => {
  it('японская карта из базы со сканом: ссылка на каталог, обложка не нужна', () => {
    const { card, thumb } = toNewCard({ detected: detected({}), pick: pick({}), details: {}, thumb: 'data:image/webp;base64,AAAA' });
    expect(card).toEqual({ docId: 'SV2a-094_ja', setId: 'SV2a', lang: 'ja', variant: 'holo' });
    expect(thumb).toBeNull();
  });

  it('карта из базы без скана: сохраняется обложка из фото', () => {
    const { thumb } = toNewCard({ detected: detected({}), pick: pick({ image: undefined }), details: {}, thumb: 'data:x' });
    expect(thumb).toBe('data:x');
  });

  it('карта вне базы: записывается напечатанное и обложка', () => {
    const { card, thumb } = toNewCard({ detected: detected({}), pick: null, details: {}, thumb: 'data:x' });
    expect(card).toMatchObject({
      docId: 'x-ja-MBG-3',
      setId: 'MBG',
      lang: 'ja',
      printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'mBG' },
    });
    expect(thumb).toBe('data:x');
  });

  it('японская карта из Limitless: напечатанное со сверенными именем и кодом сета', () => {
    const fromLimitless = pick({
      cardId: 'lt:MBG-3',
      setId: 'MBG',
      name: 'メガゲンガーex',
      englishName: 'Mega Gengar ex',
      localId: '3',
      image: undefined,
      setName: 'MBG',
      printedTotal: 21,
      setCode: 'MBG',
      source: 'limitless',
    });
    const { card, thumb } = toNewCard({
      detected: detected({ setCode: 'mBG' }),
      pick: fromLimitless,
      details: {},
      thumb: 'data:x',
    });
    expect(card).toEqual({
      docId: 'x-ja-MBG-3',
      setId: 'MBG',
      lang: 'ja',
      variant: 'holo',
      printed: { name: 'メガゲンガーex', englishName: 'Mega Gengar ex', number: '003', total: '021', setCode: 'MBG' },
    });
    expect(thumb).toBe('data:x');
  });

  it('английская карта пишется под ID из TCGdex, как раньше', () => {
    const english = pick({ cardId: 'sv03-125', setId: 'sv03', lang: 'en' });
    const { card } = toNewCard({ detected: detected({ language: 'en', holo: null }), pick: english, details: {}, thumb: null });
    expect(card).toEqual({ docId: 'sv03-125', setId: 'sv03', lang: 'en', variant: 'normal' });
  });
});

describe('вырезка обложки из фото', () => {
  it('по рамке модели с запасом и в пределах снимка', () => {
    expect(cropRect(1000, 1000, [0.1, 0.1, 0.5, 0.8], false)).toEqual({ x: 80, y: 68, width: 540, height: 864 });
    expect(cropRect(1000, 1000, [0, 0, 1, 1], false)).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it('без рамки и с одной картой — середина фото в пропорциях карты', () => {
    expect(cropRect(1200, 1600, null, true)).toEqual({ x: 28, y: 0, width: 1145, height: 1600 });
    expect(cropRect(1600, 900, null, true)).toEqual({ x: 478, y: 0, width: 644, height: 900 });
  });

  it('без рамки и с несколькими картами — без обложки', () => {
    expect(cropRect(1000, 1000, null, false)).toBeNull();
  });
});
