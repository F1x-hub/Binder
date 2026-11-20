import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_KINDS, PHOTO_SLOTS, gradeCondition, parseGrade } from '@/lib/grading';

afterEach(() => vi.unstubAllGlobals());

const ANSWER = {
  condition: 'lp',
  confidence: 0.82,
  aspects: { corners: 'Лёгкое побеление на двух углах', edges: 'Края ровные', surface: 'Пара мелких царапин под светом', centering: '55/45' },
  summary: 'Карта в хорошем состоянии, но не идеальна',
  missing: ['corners', 'unknown'],
  sameCard: true,
};

describe('ответ модели об оценке', () => {
  it('состояние по шкале TCGplayer, заметки, недостающие ракурсы', () => {
    expect(parseGrade(JSON.stringify(ANSWER))).toEqual({
      condition: 'LP',
      confidence: 0.82,
      aspects: ANSWER.aspects,
      summary: ANSWER.summary,
      missing: ['corners'],
      sameCard: true,
    });
  });

  it('без понятного состояния оценки нет', () => {
    expect(parseGrade(JSON.stringify({ ...ANSWER, condition: 'Mint' }))).toBeNull();
    expect(parseGrade('не JSON')).toBeNull();
  });

  it('уверенность в пределах 0–1, разные карты на фото замечаются', () => {
    const grade = parseGrade(JSON.stringify({ ...ANSWER, confidence: 7, sameCard: false, aspects: null }))!;
    expect(grade.confidence).toBe(1);
    expect(grade.sameCard).toBe(false);
    expect(grade.aspects).toEqual({ corners: null, edges: null, surface: null, centering: null });
  });
});

describe('запрос оценки', () => {
  it('обязательны лицо, рубашка и лицо под углом; углы — по желанию', () => {
    expect(PHOTO_KINDS.filter((kind) => PHOTO_SLOTS[kind].required)).toEqual(['front', 'back', 'angled']);
  });

  it('фото уходят одним запросом, каждое подписано ракурсом', async () => {
    let body: { messages: Array<{ role: string; content: unknown }>; response_format: unknown } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const grade = await gradeCondition('sk-test', 'Mega Gengar ex', [
      { kind: 'front', dataUrl: 'data:image/jpeg;base64,AAA' },
      { kind: 'back', dataUrl: 'data:image/jpeg;base64,BBB' },
      { kind: 'angled', dataUrl: 'data:image/jpeg;base64,CCC' },
    ]);
    expect(grade?.condition).toBe('LP');
    const parts = body!.messages[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url!.url)).toEqual([
      'data:image/jpeg;base64,AAA',
      'data:image/jpeg;base64,BBB',
      'data:image/jpeg;base64,CCC',
    ]);
    expect(parts.map((part) => part.text ?? '').join(' ')).toContain('Photo 3: front at an angle under light');
    expect(body!.response_format).toEqual({ type: 'json_object' });
  });
});
