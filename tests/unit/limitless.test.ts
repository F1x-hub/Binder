import { describe, expect, it } from 'vitest';
import { candidateLimitless, limitlessImage, parseSearchResults } from '@/lib/limitless';

describe('страница поиска Limitless', () => {
  it('достаёт код сета и номер из ссылок на карты, без повторов', () => {
    const html = `
      <tr><td><a href="/cards/jp/MBG/3">メガゲンガーex</a></td><td><a href="/cards/jp/MBG/3"><img></a></td></tr>
      <tr><td><a href="/cards/jp/SV2a/94">ゲンガー</a></td></tr>
      <a href="/cards/jp">Japanese</a><a href="/cards/MEP/73">Mega Gengar ex</a>`;
    expect(parseSearchResults(html)).toEqual([
      { set: 'MBG', number: '3' },
      { set: 'SV2a', number: '94' },
    ]);
  });
});

const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';

describe('адрес скана в Limitless', () => {
  it('у японской карты номер без ведущих нулей', () => {
    expect(limitlessImage({ region: 'jp', set: 'MBG', number: '003' }, 'SM')).toBe(`${CDN}/tpc/MBG/MBG_3_R_JP_SM.png`);
    expect(limitlessImage({ region: 'jp', set: 'SV2a', number: '094' }, 'LG')).toBe(`${CDN}/tpc/SV2a/SV2a_94_R_JP_LG.png`);
  });

  it('у английской — номер из трёх цифр', () => {
    expect(limitlessImage({ region: 'en', set: 'MEP', number: '73' }, 'SM')).toBe(`${CDN}/tpci/MEP/MEP_073_R_EN_SM.png`);
    expect(limitlessImage({ region: 'en', set: 'OBF', number: '125' }, 'XS')).toBe(`${CDN}/tpci/OBF/OBF_125_R_EN_XS.png`);
  });

  it('странный код сета или буквенный английский номер — без адреса', () => {
    expect(limitlessImage({ region: 'jp', set: '../etc', number: '1' }, 'SM')).toBeNull();
    expect(limitlessImage({ region: 'jp', set: 'MBG', number: '' }, 'SM')).toBeNull();
    expect(limitlessImage({ region: 'en', set: 'ASR', number: 'TG05' }, 'SM')).toBeNull();
  });
});

describe('где искать скан кандидата', () => {
  it('японская карта TCGdex — по ID сета, он совпадает с кодом Limitless', () => {
    expect(candidateLimitless({ source: 'tcgdex', lang: 'ja', setId: 'M2a', setCode: null, localId: '230' })).toEqual({
      region: 'jp',
      set: 'M2a',
      number: '230',
    });
  });

  it('английская — по сокращению сета', () => {
    expect(candidateLimitless({ source: 'tcgdex', lang: 'en', setId: 'mep', setCode: 'MEP', localId: '073' })).toEqual({
      region: 'en',
      set: 'MEP',
      number: '073',
    });
  });

  it('тайваньской карты в Limitless нет', () => {
    expect(candidateLimitless({ source: 'tcgdex', lang: 'zh-tw', setId: 'SV2a', setCode: null, localId: '1' })).toBeNull();
  });
});
