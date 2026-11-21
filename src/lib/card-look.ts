/**
 * Сходство карты на фото с обложками кандидатов: какая печать больше всего похожа на саму карту.
 *
 * Обе картинки сводятся к сетке 16 × 22 (пропорции карты), в каждой клетке — яркость и два
 * цветовых канала (красный–зелёный, жёлтый–синий). Каждый канал отдельно приводится к среднему 0
 * и разбросу 1: так свет, баланс белого и экспозиция фото почти не влияют, а сравнивается рисунок.
 * Сходство — корреляция каналов (яркость весит половину), от −1 до 1. Рамку карты модель даёт
 * неточно, а карта на фото бывает под углом, поэтому вырезка из фото берётся в нескольких
 * вариантах (чуть шире, уже, со сдвигом), и считается лучший.
 *
 * Проверено на фото владельца (две Pikachu ex 30th Celebration, рамки от модели): нужная печать
 * набрала 0.68 и 0.83, все остальные печати Pikachu ex — не больше 0.32.
 *
 * Без интерфейса; чистые функции (lookFromPixels, lookSimilarity, rankByLook, lookVerdict)
 * проверяются в тестах, холст и загрузка картинок — только в браузере.
 */

import { candidateLimitless, limitlessImage } from '@/lib/limitless';
import type { Box, Candidate } from '@/lib/matching';
import { cropRect } from '@/lib/photo';
import { cardImage } from '@/lib/tcgdex';

export const LOOK_WIDTH = 16;
export const LOOK_HEIGHT = 22;
const CELLS = LOOK_WIDTH * LOOK_HEIGHT;

/** Отпечаток картинки: три канала по 16 × 22, каждый нормирован. */
export type Look = Float32Array;

/** Вес каналов: яркость, красный–зелёный, жёлтый–синий. */
const WEIGHTS = [0.5, 0.25, 0.25] as const;
/**
 * Нижняя граница разброса канала (в единицах 0–255): у почти серой картинки цветовые каналы —
 * шум, и без границы нормировка раздула бы его до рисунка.
 */
const MIN_SPREAD = 8;

/**
 * Отпечаток из пикселей RGBA (как у ImageData). Картинка любого размера не меньше сетки:
 * клетка — среднее пикселей, которые в неё попали.
 */
export function lookFromPixels(data: ArrayLike<number>, width: number, height: number): Look {
  const sums = new Float64Array(CELLS * 3);
  const counts = new Float64Array(CELLS);
  for (let y = 0; y < height; y++) {
    const row = Math.min(LOOK_HEIGHT - 1, Math.floor((y * LOOK_HEIGHT) / height));
    for (let x = 0; x < width; x++) {
      const cell = row * LOOK_WIDTH + Math.min(LOOK_WIDTH - 1, Math.floor((x * LOOK_WIDTH) / width));
      const at = (y * width + x) * 4;
      const r = data[at]!;
      const g = data[at + 1]!;
      const b = data[at + 2]!;
      sums[cell]! += 0.299 * r + 0.587 * g + 0.114 * b;
      sums[CELLS + cell]! += r - g;
      sums[2 * CELLS + cell]! += (r + g) / 2 - b;
      counts[cell]! += 1;
    }
  }
  const look = new Float32Array(CELLS * 3);
  for (let channel = 0; channel < 3; channel++) {
    const offset = channel * CELLS;
    let mean = 0;
    for (let cell = 0; cell < CELLS; cell++) {
      const value = counts[cell] ? sums[offset + cell]! / counts[cell]! : 0;
      look[offset + cell] = value;
      mean += value;
    }
    mean /= CELLS;
    let spread = 0;
    for (let cell = 0; cell < CELLS; cell++) spread += (look[offset + cell]! - mean) ** 2;
    const divisor = Math.max(Math.sqrt(spread / CELLS), MIN_SPREAD);
    for (let cell = 0; cell < CELLS; cell++) look[offset + cell] = (look[offset + cell]! - mean) / divisor;
  }
  return look;
}

/** Сходство двух отпечатков от −1 до 1: 1 — тот же рисунок, около 0 — ничего общего. */
export function lookSimilarity(a: Look, b: Look): number {
  let total = 0;
  for (let channel = 0; channel < 3; channel++) {
    const offset = channel * CELLS;
    let sum = 0;
    for (let cell = 0; cell < CELLS; cell++) sum += a[offset + cell]! * b[offset + cell]!;
    total += WEIGHTS[channel]! * (sum / CELLS);
  }
  return Math.round(total * 1000) / 1000;
}

/** Сходство карты на фото (несколько вариантов вырезки) с обложкой: лучший вариант. */
export function bestSimilarity(photo: readonly Look[], cover: Look): number {
  return photo.reduce((best, look) => Math.max(best, lookSimilarity(look, cover)), -1);
}

/** Ниже этого обложка на карту не похожа: такие варианты идут после вариантов без обложки. */
export const LOOK_FLOOR = 0.35;
/** С этого сходства и с отрывом LOOK_LEAD от второго вариант помечается «Похоже больше всего». */
export const LOOK_LIKELY = 0.45;
export const LOOK_LEAD = 0.12;
/**
 * С этого сходства и с отрывом LOOK_SURE_LEAD печать выбирается сама («Узнано по картинке»),
 * сменить её можно. На фото владельца нужная печать набрала 0.68 и 0.83 против 0.32 у остальных.
 */
export const LOOK_SURE = 0.55;
export const LOOK_SURE_LEAD = 0.2;

/**
 * Варианты по сходству с фото: сначала похожие (от LOOK_FLOOR) по убыванию, потом варианты,
 * которые не с чем сравнить (обложки нет или она не загрузилась), в прежнем порядке, в конце —
 * непохожие. Без сходств порядок не меняется.
 */
export function rankByLook<T extends { cardId: string }>(options: readonly T[], likeness: Readonly<Record<string, number>>): T[] {
  const indexed = options.map((option, index) => ({
    option,
    index,
    look: likeness[option.cardId],
  }));
  const group = (look: number | undefined) => (look === undefined ? 1 : look >= LOOK_FLOOR ? 0 : 2);
  return indexed
    .sort((a, b) => group(a.look) - group(b.look) || (b.look ?? 0) - (a.look ?? 0) || a.index - b.index)
    .map(({ option }) => option);
}

export type LookVerdict = {
  /** Вариант, больше всего похожий на фото, если он заметно лучше остальных */
  best: string | null;
  /** Он настолько лучше, что можно выбрать его без вопроса */
  sure: boolean;
};

/** Есть ли среди вариантов явно самый похожий на фото. */
export function lookVerdict(likeness: Readonly<Record<string, number>>): LookVerdict {
  const sorted = Object.entries(likeness).sort((a, b) => b[1] - a[1]);
  const [first, second] = sorted;
  if (!first) return { best: null, sure: false };
  const lead = first[1] - (second?.[1] ?? 0);
  if (first[1] < LOOK_LIKELY || lead < LOOK_LEAD) return { best: null, sure: false };
  return {
    best: first[0],
    sure: first[1] >= LOOK_SURE && lead >= LOOK_SURE_LEAD,
  };
}

// ---- Браузер: холст и загрузка картинок ----

/** Размер, до которого картинка уменьшается перед отпечатком: четыре пикселя на клетку. */
const SAMPLE_WIDTH = LOOK_WIDTH * 4;
const SAMPLE_HEIGHT = LOOK_HEIGHT * 4;

function sample(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Look | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  try {
    return lookFromPixels(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  } catch {
    return null; // холст «грязный» (картинка без CORS): сравнить нельзя
  }
}

/** Насколько шире или уже рамки модели взять вырезку и на сколько сдвинуть, в долях рамки. */
const GROW = [-0.08, -0.04, 0, 0.04];
const SHIFT = [-0.05, 0, 0.05];

/**
 * Отпечатки карты на фото: по рамке модели в 36 вариантах (рамка неточна, карта бывает под углом).
 * Без рамки и с одной картой на фото — середина фото в пропорциях карты. Иначе — null.
 */
export function photoLooks(canvas: HTMLCanvasElement, box: Box | null, single: boolean): Look[] | null {
  const { width, height } = canvas;
  if (!box) {
    const rect = cropRect(width, height, null, single);
    const look = rect && sample(canvas, rect.x, rect.y, rect.width, rect.height);
    return look ? [look] : null;
  }
  const [left, top, w, h] = box;
  const looks: Look[] = [];
  for (const grow of GROW) {
    for (const dx of SHIFT) {
      for (const dy of SHIFT) {
        const x0 = Math.max(0, left - w * grow + w * dx) * width;
        const y0 = Math.max(0, top - h * grow + h * dy) * height;
        const x1 = Math.min(1, left + w * (1 + grow) + w * dx) * width;
        const y1 = Math.min(1, top + h * (1 + grow) + h * dy) * height;
        if (x1 - x0 < 16 || y1 - y0 < 16) continue;
        const look = sample(canvas, x0, y0, x1 - x0, y1 - y0);
        if (look) looks.push(look);
      }
    }
  }
  return looks.length > 0 ? looks : null;
}

/**
 * Адреса обложки кандидата в том порядке, в каком их показывает CardImage: скан из каталога
 * (маленький), потом скан Limitless.
 */
export function coverUrls(candidate: Candidate): string[] {
  const limitless = candidateLimitless(candidate);
  return [cardImage(candidate.image, 'low'), limitless ? limitlessImage(limitless, 'SM') : null].filter((url): url is string =>
    Boolean(url),
  );
}

/**
 * Сходство карты на фото с каждым вариантом: ID карты → сходство. Вариант без обложки или с
 * обложкой, которая не загрузилась, в ответ не попадает. Обложки грузятся по шесть сразу.
 */
export async function likenessOf(photo: readonly Look[], options: readonly Candidate[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const queue = [...options];
  const worker = async () => {
    for (let option = queue.shift(); option; option = queue.shift()) {
      for (const url of coverUrls(option)) {
        const look = await coverLook(url);
        if (!look) continue;
        result[option.cardId] = Math.round(bestSimilarity(photo, look) * 1000) / 1000;
        break;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return result;
}

/** Отпечатки обложек на время жизни вкладки: обложка одна и та же у всех сканов. */
const covers = new Map<string, Promise<Look | null>>();

/**
 * Отпечаток обложки по адресу. Картинка берётся через fetch, а не через img: у CDN Limitless нет
 * CORS, и холст с такой картинкой нельзя прочитать; расширению fetch разрешён host_permissions.
 * Ошибка — null (обложку не с чем сравнить), она не запоминается.
 */
export function coverLook(url: string): Promise<Look | null> {
  const known = covers.get(url);
  if (known) return known;
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const bitmap = await createImageBitmap(await response.blob());
    try {
      return sample(bitmap, 0, 0, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  })().catch(() => {
    covers.delete(url);
    return null;
  });
  covers.set(url, pending);
  return pending;
}
