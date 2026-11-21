import { useEffect, useState, useSyncExternalStore } from 'react';
import { browser } from 'wxt/browser';
import type { DrivePhoto, PhotoShow } from '@/lib/drive';
import { driveFor, loadPhotoStore, watchPhotoStore, type PhotoStore } from '@/lib/drive-setup';
import { cacheGet, cachePut, storeDelete, storeGetMany, storePut } from '@/lib/kv-cache';
import type { Box } from '@/lib/matching';
import { cropRect } from '@/lib/photo';
import { mapLimit } from '@/lib/prices';

/**
 * Свои фото карт в Google Drive участника (src/lib/drive.ts) и их копии в этом браузере.
 *
 * Где что лежит:
 * - выбор «Мои фото карточек» — chrome.storage.sync (photoStore: none | drive), идёт за аккаунтом Chrome;
 * - список фото в Drive — в кэше IndexedDB на 10 минут (kv: drive:index);
 * - картинки — в IndexedDB, хранилище thumbs под ключом mine:{docId}: Drive читается один раз
 *   на фото, потом только если фото заменили в другом браузере;
 * - фото, которое ещё не ушло в Drive (поп-ап закрыли, нет связи), помечено pending
 *   и уходит при следующем открытии альбома.
 */

const INDEX_KEY = 'drive:index';
const INDEX_TTL = 10 * 60 * 1000;
const PENDING_KEY = 'drivePending';
/** Длинная сторона своего фото: на странице карточки карта крупная, а файл — 60–150 КБ. */
export const PHOTO_LONG_SIDE = 720;

/** Своё фото в этом браузере. id — файл в Drive; null — ещё не загружено. */
export type LocalPhoto = { blob: Blob; id: string | null; modified: string; show: PhotoShow };

const localKey = (docId: string) => `mine:${docId}`;
const client = () => driveFor(false);

/** Выбор «Мои фото карточек»; null — ещё читается. Следит за сменой в других окнах. */
export function usePhotoStore(): PhotoStore | null {
  const [store, setStore] = useState<PhotoStore | null>(null);
  useEffect(() => {
    let active = true;
    void loadPhotoStore()
      .catch(() => 'none' as const)
      .then((value) => active && setStore(value));
    const stop = watchPhotoStore(setStore);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return store;
}

/* ---------- Какое фото показывать: «Официальный скан» или «Моё фото» ---------- */

/** Адрес картинки → выбор. CardImage спрашивает по адресу: в CardView есть только thumb. */
const choices = new Map<string, PhotoShow>();
const urls = new Map<string, { blob: Blob; url: string }>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Своё фото по этому адресу выбрано вместо скана. */
export function prefersPhoto(url: string | null | undefined): boolean {
  return Boolean(url && choices.get(url) === 'mine');
}

/** То же, но перерисовывает компонент, когда выбор поменяли (на странице карточки). */
export function usePrefersPhoto(url: string | null | undefined): boolean {
  useSyncExternalStore(subscribe, () => version);
  return prefersPhoto(url);
}

/** Одна object URL на картинку: альбом и страница карточки не плодят копий. */
function urlOf(docId: string, photo: LocalPhoto): string {
  const known = urls.get(docId);
  if (known && known.blob === photo.blob) {
    if (choices.get(known.url) !== photo.show) {
      choices.set(known.url, photo.show);
      changed();
    }
    return known.url;
  }
  if (known) {
    URL.revokeObjectURL(known.url);
    choices.delete(known.url);
  }
  const url = URL.createObjectURL(photo.blob);
  urls.set(docId, { blob: photo.blob, url });
  choices.set(url, photo.show);
  changed();
  return url;
}

/* ---------- Сверка с Drive ---------- */

/**
 * Что сделать, чтобы копии в браузере совпали с Drive: скачать новые и заменённые фото,
 * убрать копии файлов, которых в Drive больше нет. Ещё не загруженные (id null) не трогаются.
 */
export function planSync(
  docIds: string[],
  local: ReadonlyMap<string, Pick<LocalPhoto, 'id' | 'modified'>>,
  index: readonly DrivePhoto[],
): { download: DrivePhoto[]; drop: string[] } {
  const wanted = new Set(docIds);
  const remote = new Map(index.filter((photo) => wanted.has(photo.docId)).map((photo) => [photo.docId, photo]));
  const download: DrivePhoto[] = [];
  const drop: string[] = [];
  for (const docId of docIds) {
    const mine = local.get(docId);
    const there = remote.get(docId);
    if (there && (!mine || mine.id !== there.id || mine.modified !== there.modified)) {
      // Копия, ещё не ушедшая в Drive, новее того, что там лежит
      if (mine && mine.id === null) continue;
      download.push(there);
    } else if (!there && mine?.id) {
      drop.push(docId);
    }
  }
  return { download, drop };
}

/** Выбор поменяли в другом браузере, а картинка та же: качать не нужно, только show. */
function sameFile(mine: LocalPhoto | undefined, there: DrivePhoto): boolean {
  return Boolean(mine && mine.id === there.id && mine.modified === there.modified);
}

let indexTask: Promise<DrivePhoto[]> | null = null;

/** Список фото в Drive: из кэша на 10 минут, одновременные запросы склеиваются. */
async function driveIndex(): Promise<DrivePhoto[]> {
  const fresh = await cacheGet<DrivePhoto[]>(INDEX_KEY, INDEX_TTL);
  if (fresh) return fresh;
  indexTask ??= client()
    .listPhotos()
    .then((photos) => {
      void cachePut(INDEX_KEY, photos);
      return photos;
    })
    .finally(() => {
      indexTask = null;
    });
  return indexTask;
}

/** Список в кэше поправить после своей записи, чтобы через минуту не скачать своё же фото. */
async function patchIndex(change: (photos: DrivePhoto[]) => DrivePhoto[]): Promise<void> {
  const known = await cacheGet<DrivePhoto[]>(INDEX_KEY, INDEX_TTL);
  if (known) await cachePut(INDEX_KEY, change(known));
}

/**
 * Свои фото для этих карт: адреса картинок по ID документа. Из браузера сразу; если Drive
 * включён — сверка со списком в Drive (новое и заменённое докачивается) и отправка того,
 * что ещё не ушло. Без Drive, без связи или без согласия — только то, что уже есть в браузере.
 */
export async function loadMyPhotos(docIds: string[]): Promise<Map<string, string>> {
  const keys = docIds.map(localKey);
  const stored = await storeGetMany<LocalPhoto>('thumbs', keys).catch(() => new Map<string, LocalPhoto>());
  const local = new Map<string, LocalPhoto>();
  for (const docId of docIds) {
    const photo = stored.get(localKey(docId));
    if (photo) local.set(docId, photo);
  }

  if ((await loadPhotoStore().catch(() => 'none')) === 'drive') {
    void flushPending();
    try {
      const index = await driveIndex();
      const { download, drop } = planSync(docIds, local, index);
      for (const docId of drop) {
        local.delete(docId);
        await storeDelete('thumbs', localKey(docId)).catch(() => undefined);
      }
      const drive = client();
      await mapLimit(download, 4, async (there) => {
        try {
          const blob = await drive.download(there.id);
          const photo: LocalPhoto = { blob, id: there.id, modified: there.modified, show: there.show };
          local.set(there.docId, photo);
          await storePut('thumbs', localKey(there.docId), photo).catch(() => undefined);
        } catch {
          // Не скачалось — покажем, что есть
        }
      });
      // Выбор «скан / моё фото» могли поменять в другом браузере, не трогая картинку
      for (const there of index) {
        const mine = local.get(there.docId);
        if (mine && sameFile(mine, there) && mine.show !== there.show) {
          const photo = { ...mine, show: there.show };
          local.set(there.docId, photo);
          await storePut('thumbs', localKey(there.docId), photo).catch(() => undefined);
        }
      }
    } catch {
      // Drive недоступен или согласия нет: копий в браузере достаточно
    }
  }

  const result = new Map<string, string>();
  for (const [docId, photo] of local) result.set(docId, urlOf(docId, photo));
  return result;
}

/* ---------- Отправка в Drive ---------- */

async function pendingList(): Promise<string[]> {
  const stored: unknown = (await browser.storage.local.get(PENDING_KEY))[PENDING_KEY];
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
}

async function setPending(list: string[]): Promise<void> {
  if (list.length === 0) await browser.storage.local.remove(PENDING_KEY);
  else await browser.storage.local.set({ [PENDING_KEY]: list });
}

/** Добавить в очередь без повторов, сохранив порядок. */
export function withPending(list: readonly string[], docIds: readonly string[]): string[] {
  return [...new Set([...list, ...docIds])];
}

let flushing: Promise<void> | null = null;

/** Отправить в Drive всё из очереди. Одна отправка за раз; что не ушло — остаётся в очереди. */
export function flushPending(): Promise<void> {
  flushing ??= (async () => {
    try {
      const queue = await pendingList();
      if (queue.length === 0) return;
      const drive = client();
      const folder = await drive.ensureFolder();
      const index = await driveIndex().catch(() => [] as DrivePhoto[]);
      const stored = await storeGetMany<LocalPhoto>('thumbs', queue.map(localKey));
      const done: string[] = [];
      for (const docId of queue) {
        const photo = stored.get(localKey(docId));
        if (!photo) {
          done.push(docId);
          continue;
        }
        try {
          const existing = photo.id ?? index.find((item) => item.docId === docId)?.id;
          const uploaded = await drive.upload(folder, docId, photo.blob, photo.show, existing);
          await storePut('thumbs', localKey(docId), { ...photo, id: uploaded.id, modified: uploaded.modified });
          await patchIndex((photos) => [...photos.filter((item) => item.docId !== docId), uploaded]);
          done.push(docId);
        } catch {
          break; // нет связи или места: попробуем при следующем открытии
        }
      }
      if (done.length > 0) {
        const left = (await pendingList()).filter((docId) => !done.includes(docId));
        await setPending(left);
      }
    } catch {
      // Drive недоступен: очередь подождёт
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Сохранить свои фото новых карт: сразу в браузер (альбом покажет их без ожидания) и в очередь
 * на отправку в Drive. Без Drive не делает ничего.
 */
export async function queuePhotos(photos: Array<{ docId: string; dataUrl: string; show: PhotoShow }>): Promise<void> {
  if (photos.length === 0 || (await loadPhotoStore()) !== 'drive') return;
  const existing = await storeGetMany<LocalPhoto>('thumbs', photos.map((photo) => localKey(photo.docId))).catch(
    () => new Map<string, LocalPhoto>(),
  );
  for (const { docId, dataUrl, show } of photos) {
    const blob = await (await fetch(dataUrl)).blob();
    // id остаётся: новое фото той же карты заменит файл в Drive, а не ляжет рядом
    const id = existing.get(localKey(docId))?.id ?? null;
    await storePut<LocalPhoto>('thumbs', localKey(docId), { blob, id, modified: '', show });
  }
  await setPending(withPending(await pendingList(), photos.map((photo) => photo.docId)));
  void flushPending();
}

/**
 * «Официальный скан» или «Моё фото» на странице карточки: сразу в этом браузере, потом
 * в метаданные файла в Drive, чтобы выбор был виден и в других браузерах участника.
 */
export async function setPhotoChoice(docId: string, show: PhotoShow): Promise<void> {
  const photo = (await storeGetMany<LocalPhoto>('thumbs', [localKey(docId)])).get(localKey(docId));
  if (!photo) return;
  const next = { ...photo, show };
  await storePut('thumbs', localKey(docId), next);
  urlOf(docId, next);
  if (!photo.id || (await loadPhotoStore()) !== 'drive') return;
  try {
    const updated = await client().setShow(photo.id, show);
    await storePut('thumbs', localKey(docId), { ...next, modified: updated.modified });
    await patchIndex((photos) => photos.map((item) => (item.docId === docId ? updated : item)));
  } catch {
    // Выбор останется в этом браузере; в Drive уйдёт со следующей заменой фото
  }
}

/** Карта ушла из альбома: копия в браузере удаляется, файл в Drive — в корзину. */
export async function removeMyPhoto(docId: string): Promise<void> {
  const photo = (await storeGetMany<LocalPhoto>('thumbs', [localKey(docId)])).get(localKey(docId));
  await storeDelete('thumbs', localKey(docId));
  await setPending((await pendingList()).filter((item) => item !== docId));
  const known = urls.get(docId);
  if (known) {
    URL.revokeObjectURL(known.url);
    choices.delete(known.url);
    urls.delete(docId);
    changed();
  }
  if (!photo?.id || (await loadPhotoStore()) !== 'drive') return;
  const id = photo.id;
  await client()
    .trash(id)
    .then(() => patchIndex((photos) => photos.filter((item) => item.id !== id)))
    .catch(() => undefined);
}

/* ---------- Вырезка ---------- */

/** Своё фото карты из фото сканера: WebP, длинная сторона до 720 px. */
export function cropPhoto(canvas: HTMLCanvasElement, box: Box | null, single: boolean): string | null {
  const rect = cropRect(canvas.width, canvas.height, box, single);
  if (!rect || rect.width < 48 || rect.height < 48) return null;
  const scale = Math.min(1, PHOTO_LONG_SIDE / Math.max(rect.width, rect.height));
  const out = document.createElement('canvas');
  out.width = Math.round(rect.width * scale);
  out.height = Math.round(rect.height * scale);
  const context = out.getContext('2d');
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/webp', 0.85);
}
