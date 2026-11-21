import { updateDoc, type Firestore } from 'firebase/firestore';
import { memberRef } from '@/lib/membership';

/*
 * Правка своего профиля: имя и фото в members/{uid}.
 *
 * Firebase Storage нет (нужен тариф Blaze), поэтому своё фото хранится прямо в photoURL:
 * квадрат 192 px в WebP как data URL, до 32 000 символов (около 24 КБ). Так аватар
 * показывается везде, где уже показывается photoURL, без отдельного поля. Документ участника
 * читают все при каждом заходе на «Друзья», поэтому фото держится маленьким: 192 px хватает
 * самой большой аватарке (88 px) на экране с двойной плотностью.
 */

/** Сторона своего фото в пикселях. */
export const PROFILE_PHOTO_SIDE = 192;
/** Предел длины своего фото (data URL). Должно совпадать с ownPhoto в firestore.rules. */
export const MAX_PHOTO_LENGTH = 32_000;
/** Предел ссылки на фото (фото из Google). Должно совпадать с validProfile в firestore.rules. */
export const MAX_PHOTO_URL = 2048;
/** Предел длины имени. Должно совпадать с validProfile в firestore.rules. */
export const MAX_NAME = 80;

const OWN_PHOTO_PREFIX = 'data:image/webp;base64,';
const OWN_PHOTO = /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/;

export class ProfilePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfilePhotoError';
  }
}

/** Своё фото, загруженное в Binder (а не ссылка на фото из Google). */
export function isOwnPhoto(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(OWN_PHOTO_PREFIX);
}

/** Имя для записи: без пробелов по краям и двойных пробелов; пустое — null. */
export function normalizeName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  return name ? name : null;
}

/** Почему имя не подходит; null — подходит. */
export function nameProblem(raw: string): string | null {
  const name = normalizeName(raw);
  if (!name) return 'Напиши имя: так тебя видят друзья.';
  if (name.length > MAX_NAME) return `Имя длиннее ${MAX_NAME} символов.`;
  return null;
}

/** Можно ли записать это фото: нет фото, ссылка до 2048 символов или своё фото в пределах. */
export function photoAllowed(url: string | null): boolean {
  if (url === null) return true;
  if (isOwnPhoto(url)) return url.length <= MAX_PHOTO_LENGTH && OWN_PHOTO.test(url);
  return url.length <= MAX_PHOTO_URL;
}

export type ProfileDraft = { displayName: string; photoURL: string | null };

/** Записывает имя и фото одной записью; правила проверяют то же самое. */
export async function saveProfile(db: Firestore, uid: string, draft: ProfileDraft): Promise<void> {
  const problem = nameProblem(draft.displayName);
  if (problem) throw new Error(problem);
  if (!photoAllowed(draft.photoURL)) throw new ProfilePhotoError('Фото слишком большое. Выбери другое.');
  await updateDoc(memberRef(db, uid), { displayName: normalizeName(draft.displayName), photoURL: draft.photoURL });
}

/** Качество WebP по очереди: первое, что влезло в предел. */
const QUALITIES = [0.86, 0.76, 0.64, 0.5, 0.36];

/**
 * Своё фото из файла: середина картинки квадратом, 192 × 192, WebP. Если файл не картинка
 * или браузер не умеет WebP — ProfilePhotoError с объяснением.
 */
export async function makeProfilePhoto(file: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ProfilePhotoError('Не получилось открыть фото. Выбери JPEG, PNG или WebP.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = PROFILE_PHOTO_SIDE;
  canvas.height = PROFILE_PHOTO_SIDE;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new ProfilePhotoError('Не получилось обработать фото.');
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    PROFILE_PHOTO_SIDE,
    PROFILE_PHOTO_SIDE,
  );
  bitmap.close();
  for (const quality of QUALITIES) {
    const url = canvas.toDataURL('image/webp', quality);
    if (!isOwnPhoto(url)) throw new ProfilePhotoError('Этот браузер не умеет сжимать фото в WebP.');
    if (url.length <= MAX_PHOTO_LENGTH) return url;
  }
  throw new ProfilePhotoError('Фото не получилось сжать. Выбери другое.');
}
