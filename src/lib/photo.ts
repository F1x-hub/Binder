/** Длинная сторона фото для модели: номер карты читается, а запрос остаётся лёгким. */
const MAX_SIDE = 1600;

export class PhotoError extends Error {
  constructor() {
    super('Не получилось открыть фото. Сохрани его как JPEG или PNG.');
    this.name = 'PhotoError';
  }
}

/**
 * Готовит фото к отправке: уменьшает до 1600 px по длинной стороне и сжимает в JPEG.
 * Само фото нигде не сохраняется: оно нужно только сканеру.
 */
export async function preparePhoto(file: Blob): Promise<string> {
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
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Только картинки из перетащенных или выбранных файлов. */
export function imageFiles(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
}
