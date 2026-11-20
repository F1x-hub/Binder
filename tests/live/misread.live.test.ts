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
