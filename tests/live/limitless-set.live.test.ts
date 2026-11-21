import { describe, expect, it } from 'vitest';
import { limitlessImage } from '@/lib/limitless';
import { limitlessChecklist, limitlessSetCards } from '@/lib/limitless-set';

/**
 * Список японского сета вне TCGdex из Limitless для разворота биндера: npm run test:live.
 * Стартовый набор MBG (MEGA Starter Set Mega Gengar ex): 21 карта по счёту на картах и 22-я сверх него.
 * Два запроса к страницам сета и один HEAD к скану на CDN.
 */
describe('сет вне TCGdex из Limitless', () => {
  it('MBG: все номера по порядку, японские и английские имена, скан на CDN', async () => {
    const cards = await limitlessSetCards('MBG');
    expect(cards).not.toBeNull();
    const numbers = cards!.map((card) => Number(card.number));
    expect(numbers.slice(0, 21)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    const gengar = cards!.find((card) => card.number === '3');
    expect(gengar).toEqual({ set: 'MBG', number: '3', name: 'メガゲンガーex', englishName: 'Mega Gengar ex' });
    expect(cards!.find((card) => card.number === '1')?.englishName).toBe('Gastly');

    const [first] = limitlessChecklist(cards!);
    const image = limitlessImage(first!.limitless!, 'SM');
    expect(image).toBe('https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/MBG/MBG_1_R_JP_SM.png');
    const response = await fetch(image!, { method: 'HEAD' });
    expect(response.ok).toBe(true);
  }, 30_000);

  it('несуществующий сет — null', async () => {
    expect(await limitlessSetCards('ZZQ9')).toBeNull();
  }, 30_000);
});
