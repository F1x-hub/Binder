import { describe, expect, it } from 'vitest';
import { findCandidates } from '@/lib/catalog';
import { decide, type DetectedCard } from '@/lib/matching';
import { priceFromCard } from '@/lib/prices';
import { tcgdexApi } from '@/lib/tcgdex';

/**
 * Проверка сопоставления на настоящем TCGdex (нужен интернет): npm run test:live.
 * В обычный npm test не входит, чтобы не нагружать бесплатный сервис.
 */
const read = (card: Partial<DetectedCard>): DetectedCard => ({
  name: '',
  englishName: null,
  number: '',
  total: null,
  setCode: null,
  holo: null,
  confidence: 0.9,
  ...card,
});

async function decision(card: Partial<DetectedCard>) {
  return decide(await findCandidates(read(card)));
}

describe('сопоставление с настоящим TCGdex', () => {
  it('Charizard ex 125/197 OBF узнаётся сразу', async () => {
    expect(await decision({ name: 'Charizard ex', number: '125', total: '197', setCode: 'OBF' })).toMatchObject({
      status: 'ready',
      pick: { cardId: 'sv03-125', setName: 'Obsidian Flames', printedTotal: 197 },
    });
  });

  it('опечатка в имени не мешает найти карту', async () => {
    const result = await decision({ name: 'Charizrd ex', number: '125', total: '197' });
    const first = result.status === 'ready' ? result.pick : result.status === 'choose' ? result.options[0] : null;
    expect(first?.cardId).toBe('sv03-125');
  });

  it('японская карта ищется по английскому имени', async () => {
    expect(
      await decision({ name: 'リザードンex', englishName: 'Charizard ex', number: '125', total: '197' }),
    ).toMatchObject({ status: 'ready', pick: { cardId: 'sv03-125' } });
  });

  it('номер без ведущих нулей', async () => {
    expect(await decision({ name: 'Oddish', number: '1', total: '197' })).toMatchObject({
      status: 'ready',
      pick: { cardId: 'sv03-001' },
    });
  });

  it('старая карта Base Set', async () => {
    expect(await decision({ name: 'Charizard', number: '4', total: '102' })).toMatchObject({
      status: 'ready',
      pick: { cardId: 'base1-4' },
    });
  });

  it('карты TCG Pocket в кандидаты не попадают', async () => {
    const candidates = await findCandidates(read({ name: 'Charizard ex', number: '036' }));
    expect(candidates.every((candidate) => !/^(?:P-A|[A-Z]\d)/.test(candidate.cardId))).toBe(true);
  });

  it('выдуманная карта не находится', async () => {
    expect(await decision({ name: 'Blorptastic ex', number: '999', total: '998' })).toEqual({ status: 'not-found' });
  });

  it('цена читается из карточки TCGdex', async () => {
    const price = priceFromCard(await tcgdexApi.card('sv03-125'));
    expect(price.u === null || price.u > 0).toBe(true);
    expect(price.e === null || price.e > 0).toBe(true);
    expect(price.u !== null || price.e !== null).toBe(true);
  });
});
