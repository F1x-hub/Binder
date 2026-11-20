import type { Box } from '@/lib/matching';

/** Длинная сторона фото для модели: номер карты читается, а запрос остаётся лёгким. */
const MAX_SIDE = 1600;
/** Ширина обложки из фото: хватает сетке альбома на экране с двойной плотностью. */
const THUMB_WIDTH = 300;
/** Пропорции карты: 63 × 88 мм. */
const CARD_RATIO = 63 / 88;

export class PhotoError extends Error {
  constructor() {
    super('Не получилось открыть фото. Сохрани его как JPEG или PNG.');
    this.name = 'PhotoError';
  }
}

/** Фото, готовое к распознаванию: JPEG для модели и холст, из которого режутся обложки. */
export type PreparedPhoto = { dataUrl: string; canvas: HTMLCanvasElement };

/**
 * Готовит фото к отправке: уменьшает до 1600 px по длинной стороне и сжимает в JPEG.
 * Само фото нигде не сохраняется: оно нужно только сканеру.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError();
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError();
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), canvas };
}

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Где на фото вырезать карту: по рамке от модели с запасом в 4 % на сторону.
 * Если рамки нет, а карта на фото одна, берётся середина фото в пропорциях карты.
 */
export function cropRect(width: number, height: number, box: Box | null, single: boolean): Rect | null {
  if (box) {
    const [left, top, w, h] = box;
    const x0 = Math.max(0, left - w * 0.04);
    const y0 = Math.max(0, top - h * 0.04);
    const x1 = Math.min(1, left + w * 1.04);
    const y1 = Math.min(1, top + h * 1.04);
    return {
      x: Math.round(x0 * width),
      y: Math.round(y0 * height),
      width: Math.round((x1 - x0) * width),
      height: Math.round((y1 - y0) * height),
    };
  }
  if (!single) return null;
  let w = width;
  let h = Math.round(width / CARD_RATIO);
  if (h > height) {
    h = height;
    w = Math.round(height * CARD_RATIO);
  }
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
}

/**
 * Обложка из фото для карты, у которой в базе нет скана: WebP шириной до 300 px, 20–40 КБ.
 * Хранится только в этом браузере (src/lib/thumbnails.ts).
 */
export function cropCard(canvas: HTMLCanvasElement, box: Box | null, single: boolean): string | null {
  const rect = cropRect(canvas.width, canvas.height, box, single);
  if (!rect || rect.width < 24 || rect.height < 24) return null;
  const scale = Math.min(1, THUMB_WIDTH / rect.width);
  const out = document.createElement('canvas');
  out.width = Math.round(rect.width * scale);
  out.height = Math.round(rect.height * scale);
  const context = out.getContext('2d');
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/webp', 0.82);
}

/** Только картинки из перетащенных или выбранных файлов. */
export function imageFiles(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
}
