import { storeDelete, storeGetMany, storePut } from '@/lib/kv-cache';

/**
 * Обложки из фото для карт, у которых в базе нет скана: японские стартовые наборы,
 * свежие японские сеты, карты вне базы. Лежат только в IndexedDB этого браузера,
 * в облако фото не уходят. Ключ — ID документа альбома.
 */
export function saveThumb(docId: string, dataUrl: string): Promise<void> {
  return storePut('thumbs', docId, dataUrl);
}

export function removeThumb(docId: string): Promise<void> {
  return storeDelete('thumbs', docId);
}

export function loadThumbs(docIds: string[]): Promise<Map<string, string>> {
  return storeGetMany<string>('thumbs', docIds);
}
