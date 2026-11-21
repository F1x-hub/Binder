import { describe, expect, it } from 'vitest';
import {
  LOOK_HEIGHT,
  LOOK_WIDTH,
  bestSimilarity,
  lookFromPixels,
  lookSimilarity,
  lookVerdict,
  rankByLook,
} from '@/lib/card-look';
import type { Candidate } from '@/lib/matching';
import { applyLikeness } from '@/scan/useScan';

type Rgb = [number, number, number];

/** Картинка RGBA из функции цвета пикселя. */
function image(width: number, height: number, color: (x: number, y: number) => Rgb): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(x / width, y / height);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return data;
}

/** «Арт» A: жёлтый круг на синем фоне, красная полоса снизу. */
const artA = (x: number, y: number): Rgb =>
  y > 0.8 ? [200, 40, 40] : (x - 0.5) ** 2 + (y - 0.4) ** 2 < 0.06 ? [240, 210, 40] : [40, 60, 180];
/** «Арт» B: зелёные диагональные полосы на сером. */
const artB = (x: number, y: number): Rgb => (Math.floor((x + y) * 6) % 2 ? [60, 170, 70] : [120, 120, 120]);
/** Тот же арт A, но под тёплым светом и темнее: так он выглядит на фото. */
const photoOfA = (x: number, y: number): Rgb => {
  const [r, g, b] = artA(x, y);
  return [Math.min(255, r * 0.8 + 30), g * 0.75 + 15, b * 0.6];
};
/** Арт A, сдвинутый на 5 % вправо: рамка модели неточна. */
const shiftedA = (x: number, y: number): Rgb => artA(x - 0.05, y);

const look = (color: (x: number, y: number) => Rgb, width = 32, height = 44) =>
  lookFromPixels(image(width, height, color), width, height);

describe('отпечаток картинки', () => {
  it('сетка 16 × 22 в трёх каналах', () => {
    expect(look(artA)).toHaveLength(LOOK_WIDTH * LOOK_HEIGHT * 3);
  });

  it('не зависит от размера картинки', () => {
    expect(lookSimilarity(look(artA, 64, 88), look(artA, 16, 22))).toBeGreaterThan(0.9);
  });

  it('одноцветная картинка не делится на ноль', () => {
    const flat = look(() => [128, 128, 128]);
    expect(Array.from(flat).every(Number.isFinite)).toBe(true);
    expect(lookSimilarity(flat, look(artA))).toBeCloseTo(0, 5);
  });
});

describe('сходство', () => {
  it('та же картинка — 1', () => {
    expect(lookSimilarity(look(artA), look(artA))).toBeCloseTo(1, 2);
  });

  it('другой свет и экспозиция почти не мешают', () => {
    expect(lookSimilarity(look(photoOfA), look(artA))).toBeGreaterThan(0.9);
  });

  it('другая картинка — около нуля', () => {
    expect(Math.abs(lookSimilarity(look(artB), look(artA)))).toBeLessThan(0.2);
  });

  it('карта на фото похожа на свою обложку больше, чем на чужую', () => {
    const photo = look(photoOfA);
    expect(lookSimilarity(photo, look(artA))).toBeGreaterThan(lookSimilarity(photo, look(artB)) + 0.5);
  });

  it('из нескольких вырезок берётся лучшая: сдвинутая рамка не портит сходство', () => {
    const variants = [look(shiftedA), look(artB), look(artA)];
    expect(bestSimilarity(variants, look(artA))).toBeCloseTo(1, 2);
    expect(bestSimilarity([look(shiftedA)], look(artA))).toBeLessThan(1);
  });
});

const option = (cardId: string, extra: Partial<Candidate> = {}): Candidate => ({
  cardId,
  setId: cardId.split('-')[0]!,
  name: 'Pikachu ex',
  localId: cardId.split('-')[1]!,
  setName: cardId,
  printedTotal: null,
  setCode: null,
  releaseDate: null,
  lang: 'en',
  approximate: false,
  source: 'tcgdex',
  weak: true,
  score: 0.6,
  ...extra,
});

/** Варианты, как их дал сканер владельца на 30th Celebration 149/128, прочитанной как 276/217. */
const OPTIONS = ['me02.5-276', 'me02.5-057', 'me02.5-277', '30th-053', '30th-054', '30th-149', '30th-150'].map((id) =>
  option(id),
);
/** Сходство обложек с картой 1 на фото владельца (замерено тем же алгоритмом). */
const CARD_ONE = { 'me02.5-276': 0.32, 'me02.5-057': 0.12, 'me02.5-277': 0.18, '30th-053': 0.1, '30th-054': 0.2, '30th-149': 0.68, '30th-150': 0.13 };

describe('порядок вариантов по сходству с фото', () => {
  it('самый похожий первым', () => {
    expect(rankByLook(OPTIONS, CARD_ONE)[0]?.cardId).toBe('30th-149');
  });

  it('варианты без обложки — после похожих, но до непохожих', () => {
    const likeness = { a: 0.7, b: 0.1, d: 0.5 };
    const ranked = rankByLook([option('b-1', { cardId: 'b' }), option('c-1', { cardId: 'c' }), option('a-1', { cardId: 'a' }), option('d-1', { cardId: 'd' })], likeness);
    expect(ranked.map((item) => item.cardId)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('без сходств порядок прежний', () => {
    expect(rankByLook(OPTIONS, {}).map((item) => item.cardId)).toEqual(OPTIONS.map((item) => item.cardId));
  });
});

describe('самый похожий вариант', () => {
  it('явный отрыв — «похоже больше всего» и выбор без вопроса', () => {
    expect(lookVerdict(CARD_ONE)).toEqual({ best: '30th-149', sure: true });
  });

  it('отрыв поменьше — только метка', () => {
    expect(lookVerdict({ a: 0.5, b: 0.36 })).toEqual({ best: 'a', sure: false });
  });

  it('два одинаково похожих (тот же арт в другом сете) — без метки', () => {
    expect(lookVerdict({ a: 0.8, b: 0.75, c: 0.2 })).toEqual({ best: null, sure: false });
  });

  it('ничего не похоже — без метки', () => {
    expect(lookVerdict({ a: 0.3, b: 0.05 })).toEqual({ best: null, sure: false });
  });

  it('пусто — без метки', () => {
    expect(lookVerdict({})).toEqual({ best: null, sure: false });
  });
});

describe('варианты в сканере после сравнения с фото', () => {
  it('явно похожая печать выбирается сама', () => {
    const next = applyLikeness({ status: 'choose', options: OPTIONS, manual: false }, CARD_ONE);
    expect(next.auto?.cardId).toBe('30th-149');
    expect(next.bestLook).toBe('30th-149');
    expect(next.options[0]?.cardId).toBe('30th-149');
  });

  it('карту, которую человек уже выбрал, сравнение не меняет', () => {
    expect(applyLikeness({ status: 'ready', options: OPTIONS, manual: true }, CARD_ONE).auto).toBeNull();
  });

  it('похожая карта (язык не узнан) сама не выбирается, только метка', () => {
    const approximate = OPTIONS.map((item) => ({ ...item, approximate: true }));
    const next = applyLikeness({ status: 'choose', options: approximate, manual: false }, CARD_ONE);
    expect(next.auto).toBeNull();
    expect(next.bestLook).toBe('30th-149');
  });
});
