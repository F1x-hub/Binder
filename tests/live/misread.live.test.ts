import { describe, expect, it } from 'vitest';
import { findCandidates } from '@/lib/catalog';
import { decide, type DetectedCard } from '@/lib/matching';

/**
 * Ошибки чтения, на которых сканер уже ошибался в Chrome: npm run test:live.
 * 20 ноября 2026 модель прочитала имя «メガゲンガーex» и номер 003, но код сета не тот,
 * и сканер уверенно выдал メガフシギバナex из M1L под тем же номером.
 */
const megaGengar = (card: Partial<DetectedCard>): DetectedCard => ({
  name: 'メガゲンガーex',
  englishName: 'Mega Gengar ex',
  number: '003',
  total: '021',
  setCode: 'MBG',
  holo: true,
  language: 'ja',
  box: null,
  confidence: 0.95,
  ...card,
});

describe('ошибки чтения', () => {
  for (const setCode of ['M1L', 'M1S', 'M2', null]) {
    it(`код сета ${setCode ?? 'не прочитан'}: находится MBG #3 по имени и номеру, чужие карты отброшены`, async () => {
      const candidates = await findCandidates(megaGengar({ setCode }));
      const names = candidates.map((candidate) => `${candidate.cardId} ${candidate.name} ${candidate.score}`).join('; ');
      expect(candidates.every((candidate) => candidate.name.includes('ゲンガー')), names).toBe(true);
      expect(decide(candidates), names).toMatchObject({
        status: 'ready',
        pick: { source: 'limitless', setId: 'MBG', localId: '3', name: 'メガゲンガーex' },
      });
    });
  }

  it('с верным кодом сета MBG — тоже MBG #3', async () => {
    expect(decide(await findCandidates(megaGengar({ setCode: 'mBG' })))).toMatchObject({
      status: 'ready',
      pick: { source: 'limitless', setId: 'MBG', localId: '3', score: 1 },
    });
  });
});

/**
 * 21 ноября 2026: промо-картинка двух карт 30th Celebration (Pikachu ex 149/128 и 150/128,
 * код сета «30C», в TCGdex сет `30th`) узнана как Ascended Heroes 276/217 и 277/217
 * «Распознано, 55%». Модель угадала номер, а TCGdex перестал понимать «localId=eq:149»,
 * и поиск по имени и номеру не находил ничего ни для одной карты.
 */
const pikachu = (card: Partial<DetectedCard>): DetectedCard => ({
  name: 'Pikachu ex',
  englishName: 'Pikachu ex',
  number: '149',
  total: '128',
  setCode: null,
  holo: true,
  language: 'en',
  box: null,
  confidence: 0.9,
  ...card,
});

describe('Pikachu ex 30th Celebration', () => {
  for (const number of ['149', '150']) {
    it(`${number}/128 находится по имени и номеру`, async () => {
      expect(decide(await findCandidates(pikachu({ number })), 0.9)).toMatchObject({
        status: 'ready',
        pick: { cardId: `30th-${number}`, setName: '30th Celebration', printedTotal: 128 },
      });
    });

    it(`${number}/128 с ошибкой в имени находится по числу карт 128, но на выбор`, async () => {
      const candidates = await findCandidates(pikachu({ number, name: 'Pikahcu ex', englishName: 'Pikahcu ex' }));
      const decision = decide(candidates, 0.9);
      expect(decision.status).toBe('choose');
      expect(decision.status === 'choose' && decision.options[0]).toMatchObject({ cardId: `30th-${number}`, weak: true });
    });
  }

  it('276/217 с уверенностью 0.55 — выбор, и в вариантах обе карты 30th', async () => {
    const candidates = await findCandidates(pikachu({ number: '276', total: '217', confidence: 0.55 }));
    const decision = decide(candidates, 0.55);
    const ids = decision.status === 'choose' ? decision.options.map((option) => option.cardId) : [];
    expect(decision.status, ids.join(', ')).toBe('choose');
    expect(ids).toEqual(expect.arrayContaining(['30th-149', '30th-150']));
  });

  it('строгий фильтр номера больше не нужен: «003» не находит чужие номера', async () => {
    const candidates = await findCandidates(pikachu({ number: '003', total: null }));
    expect(candidates.every((candidate) => candidate.weak)).toBe(true);
  });
});
