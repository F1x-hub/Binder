import { afterEach, describe, expect, it, vi } from 'vitest';
import { htmlLang } from '@/lib/languages';
import { englishNameOf } from '@/lib/limitless';
import { displayNames } from '@/lib/names';

afterEach(() => vi.unstubAllGlobals());

describe('имя для показа', () => {
  it('у японской карты английское имя — главное, японское — подпись', () => {
    expect(displayNames('メガゲンガーex', 'Mega Gengar ex')).toEqual({ primary: 'Mega Gengar ex', secondary: 'メガゲンガーex' });
  });

  it('у английской карты имя одно, даже если модель повторила его в английском поле', () => {
    expect(displayNames('Charizard ex', 'Charizard ex')).toEqual({ primary: 'Charizard ex', secondary: null });
    expect(displayNames('Charizard ex', 'charizard EX')).toEqual({ primary: 'Charizard ex', secondary: null });
  });

  it('без английского имени остаётся напечатанное', () => {
    expect(displayNames('ゲンガー', null)).toEqual({ primary: 'ゲンガー', secondary: null });
    expect(displayNames('ゲンガー', '  ')).toEqual({ primary: 'ゲンガー', secondary: null });
  });

  it('французская карта вне базы: английское имя главным', () => {
    expect(displayNames('Dracaufeu ex', 'Charizard ex')).toEqual({ primary: 'Charizard ex', secondary: 'Dracaufeu ex' });
  });

  it('японский текст помечается языком, чтобы браузер выбрал японский шрифт', () => {
    expect(htmlLang('ja')).toBe('ja');
    expect(htmlLang('zh-tw')).toBe('zh-Hant');
    expect(htmlLang('other')).toBeUndefined();
  });
});

describe('английское имя японской карты из Limitless', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

  it('один запрос с ?translate', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return json({ set: 'SV2a', number: '94', name: 'Gengar', translation: 1 });
      }),
    );
    expect(await englishNameOf('SV2a', '094')).toBe('Gengar');
    expect(urls).toEqual(['https://limitlesstcg.com/api/cards/SV2a/94?translate']);
  });

  it('перевода нет — имени нет, японское не выдаётся за английское', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ set: 'XX', number: '1', name: 'ゲンガー', translation: 0 })));
    expect(await englishNameOf('XX', '1')).toBeNull();
  });
});
