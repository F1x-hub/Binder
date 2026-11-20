import { describe, expect, it } from 'vitest';
import { checkJusttcgKey, findJusttcgCard, pickPrice } from '@/lib/justtcg';

/**
 * Проверка на настоящем JustTCG. Нужен свой ключ, он не хранится в проекте:
 * JUSTTCG_KEY=tcg_… npm run test:live (в PowerShell: $env:JUSTTCG_KEY='tcg_…'; npm run test:live).
 * Прогон тратит около четырёх запросов из бесплатных 100 в день.
 */
const key = process.env.JUSTTCG_KEY ?? '';

describe.skipIf(!key)('JustTCG с настоящим ключом', () => {
  it('ключ работает, японские карты есть', async () => {
    expect(await checkJusttcgKey(key)).toMatchObject({ status: 'ok' });
  });

  it('Mega Gengar ex из стартового набора MBG находится с ценой', async () => {
    const found = await findJusttcgCard(key, 'MBG', '003', { englishName: 'Mega Gengar ex', total: '021' });
    expect(found?.name).toContain('Gengar');
    expect(pickPrice(found?.prices ?? {}, 'holo')).toBeGreaterThan(0);
  });
});
