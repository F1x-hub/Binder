import { describe, expect, it } from 'vitest';
import { findCandidates } from '@/lib/catalog';
import { candidateLimitless, limitlessImage } from '@/lib/limitless';
import { decide, type DetectedCard } from '@/lib/matching';

/**
 * Корейские карты на настоящих TCGdex и Limitless: npm run test:live.
 * Корейские издания повторяют японские сеты и номера, поэтому карта ищется в японском
 * каталоге как похожая, а английское имя для сверки берётся из перевода Limitless.
 */
const korean = (card: Partial<DetectedCard>): DetectedCard => ({
  name: '',
  englishName: null,
  number: '',
  total: null,
  setCode: null,
  holo: false,
  language: 'ko',
  box: null,
  confidence: 0.9,
  ...card,
});

describe('корейские карты', () => {
  it('팬텀 094/165 SV2a — японский Gengar из 151, похожий, со сканом Limitless', async () => {
    const candidates = await findCandidates(korean({ name: '팬텀', englishName: 'Gengar', number: '094', total: '165', setCode: 'SV2a' }));
    const first = candidates[0];
    expect(first, JSON.stringify(candidates)).toMatchObject({
      cardId: 'SV2a-094',
      setId: 'SV2a',
      lang: 'ja',
      approximate: true,
      source: 'tcgdex',
      englishName: 'Gengar',
      printedTotal: 165,
    });
    expect(first!.score).toBeGreaterThanOrEqual(0.9);
    expect(decide(candidates).status).toBe('choose');
    const scan = limitlessImage(candidateLimitless(first!)!, 'XS');
    expect(scan).toBe('https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/SV2a/SV2a_94_R_JP_XS.png');
    expect((await fetch(scan!, { method: 'HEAD' })).ok).toBe(true);
  });

  it('неверное английское имя под тем же кодом и номером — чужая карта отброшена', async () => {
    const candidates = await findCandidates(korean({ name: '피카츄', englishName: 'Pikachu', number: '094', total: '165', setCode: 'SV2a' }));
    expect(candidates.map((candidate) => candidate.cardId)).not.toContain('SV2a-094');
  });
});
