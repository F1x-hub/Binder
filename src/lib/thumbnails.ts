import { storeDelete, storeGetMany, storePut } from '@/lib/kv-cache';
import { loadMyPhotos, removeMyPhoto } from '@/lib/my-photos';

/**
 * Обложки карт из фото. Два вида:
 * - вырезка 300 px для карт, у которых в базе нет скана (японские стартовые наборы, карты вне базы):
 *   только в IndexedDB этого браузера, ключ — ID документа альбома;
 * - своё фото 720 px, если участник хранит фото в Google Drive (src/lib/my-photos.ts):
 *   оно главнее вырезки, а «Моё фото» показывает его и вместо официального скана.
 */
export function saveThumb(docId: string, dataUrl: string): Promise<void> {
  return storePut('thumbs', docId, dataUrl);
}

/** Карта ушла из альбома: вырезка и своё фото удаляются (файл в Drive — в корзину). */
export async function removeThumb(docId: string): Promise<void> {
  await Promise.all([storeDelete('thumbs', docId), removeMyPhoto(docId).catch(() => undefined)]);
}

export async function loadThumbs(docIds: string[]): Promise<Map<string, string>> {
  const [crops, photos] = await Promise.all([
    storeGetMany<string>('thumbs', docIds),
    loadMyPhotos(docIds).catch(() => new Map<string, string>()),
  ]);
  for (const [docId, url] of photos) crops.set(docId, url);
  return crops;
}
