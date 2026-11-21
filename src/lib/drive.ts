/**
 * Google Drive участника: папка «Binder» и по файлу WebP на карту альбома.
 *
 * Доступ — scope drive.file: приложение видит только файлы, которые создало само, и ничего
 * больше в Drive. Право на него даётся отдельным согласием, когда участник выбирает
 * «Сохранять в мой Google Drive», а не при входе: токен с этим scope просится у
 * chrome.identity списком scopes (в манифесте его нет, иначе Drive спрашивал бы каждый вход).
 *
 * Список фото хранится в самом Drive: у файла appProperties binderDoc (ID документа альбома)
 * и show («mine» — показывать своё фото вместо скана, «scan» — скан). Так фото и выбор
 * видны в любом браузере этого участника, а Firestore и правила не меняются.
 * Друзья файлов не видят: drive.file не даёт доступа к чужим файлам, и ссылок на них
 * в общей базе нет. У друзей по-прежнему официальный скан.
 *
 * Модуль без React и без chrome.*: fetch и токен приходят снаружи, так его проверяют тесты.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Scopes входа плюс Drive: один токен на всё, согласие спрашивает только про Drive. */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  DRIVE_SCOPE,
];

export const FOLDER_NAME = 'Binder';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** Сколько файлов просить за страницу списка: больше Drive не отдаёт. */
const PAGE_SIZE = 1000;
/** Ключ и значение appProperties вместе не длиннее 124 байт (ограничение Drive). */
const APP_PROPERTY_BYTES = 124;

export type PhotoShow = 'mine' | 'scan';

/** Фото карты в Drive. */
export type DrivePhoto = {
  /** ID файла в Drive */
  id: string;
  /** ID документа альбома */
  docId: string;
  /** Время изменения файла: по нему видно, что фото заменили в другом браузере */
  modified: string;
  show: PhotoShow;
};

export type DriveErrorKind = 'consent' | 'network' | 'quota' | 'server';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** Понятная причина по-русски. */
export function driveErrorMessage(error: unknown): string {
  if (error instanceof DriveError) {
    if (error.kind === 'consent') return 'Нужно разрешить Binder доступ к Google Drive.';
    if (error.kind === 'network') return 'Нет связи с Google Drive. Проверь интернет и попробуй ещё раз.';
    if (error.kind === 'quota') return 'В Google Drive кончилось место или Google временно ограничил запросы.';
    return 'Google Drive не ответил. Попробуй ещё раз чуть позже.';
  }
  const text = String(error instanceof Error ? error.message : error);
  // chrome.identity: окно согласия закрыли или доступ не дали
  if (/canceled|cancelled|did not approve|not granted|revoked|user interaction/i.test(text)) {
    return 'Доступ к Google Drive не дан. Без него фото хранятся только для сканера.';
  }
  return 'Не получилось подключить Google Drive. Попробуй ещё раз.';
}

export type DriveDeps = {
  fetch: typeof fetch;
  /** Токен с DRIVE_SCOPES; без согласия бросает ошибку */
  token: () => Promise<string>;
  /** Забыть токен в кэше Chrome: Drive ответил 401, токен протух или отозван */
  dropToken: (token: string) => Promise<void>;
};

/** У файла Drive есть binderDoc — это наше фото карты. */
export function photoFromFile(file: unknown): DrivePhoto | null {
  const value = file as { id?: unknown; modifiedTime?: unknown; appProperties?: Record<string, unknown> } | null;
  const docId = value?.appProperties?.binderDoc;
  if (typeof value?.id !== 'string' || typeof docId !== 'string' || !docId) return null;
  return {
    id: value.id,
    docId,
    modified: typeof value.modifiedTime === 'string' ? value.modifiedTime : '',
    show: value.appProperties?.show === 'scan' ? 'scan' : 'mine',
  };
}

/** ID документа влезает в appProperties: иначе карту в Drive не найти. */
export function fitsAppProperties(docId: string): boolean {
  return new TextEncoder().encode(`binderDoc${docId}`).length <= APP_PROPERTY_BYTES;
}

/** Имя файла в Drive: по нему участник узнает карту в папке «Binder». */
export function photoFileName(docId: string): string {
  return `${docId.replace(/[\\/:*?"<>|]/g, '_')}.webp`;
}

/** Тело запроса uploadType=multipart: метаданные JSON и картинка одной посылкой. */
export function multipartBody(metadata: object, image: Blob, boundary: string): Blob {
  return new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${image.type || 'image/webp'}\r\n\r\n`,
    image,
    `\r\n--${boundary}--`,
  ]);
}

/** Строка для q в files.list: апостроф и обратная черта экранируются. */
function quoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const FILE_FIELDS = 'id,modifiedTime,appProperties';

export type DriveClient = ReturnType<typeof driveClient>;

export function driveClient({ fetch: request, token, dropToken }: DriveDeps) {
  /** Запрос с токеном. На 401 токен забывается и запрос повторяется один раз с новым. */
  async function call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    let bearer: string;
    try {
      bearer = await token();
    } catch {
      throw new DriveError('consent', 'Нет токена для Google Drive');
    }
    let response: Response;
    try {
      response = await request(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` } });
    } catch {
      throw new DriveError('network', 'Google Drive недоступен');
    }
    if (response.status === 401 && retry) {
      await dropToken(bearer).catch(() => undefined);
      return call(url, init, false);
    }
    if (response.ok) return response;
    if (response.status === 401) throw new DriveError('consent', 'Google Drive не принял токен');
    const reason = await response
      .json()
      .then((body: { error?: { errors?: Array<{ reason?: string }> } }) => body.error?.errors?.[0]?.reason ?? '')
      .catch(() => '');
    // 403 без квоты — доступа к Drive не дали (Drive API выключен или scope не одобрен)
    if (/storageQuotaExceeded|rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(reason) || response.status === 429) {
      throw new DriveError('quota', `Google Drive: ${reason || response.status}`);
    }
    if (response.status === 403) throw new DriveError('consent', `Google Drive: ${reason || 'доступ запрещён'}`);
    throw new DriveError('server', `Google Drive: ${response.status} ${reason}`);
  }

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await call(url, init)).json() as Promise<T>;
  }

  /** Папка «Binder» в корне Drive: drive.file видит только ту, что создало приложение. */
  async function findFolder(): Promise<string | null> {
    const q = `name = ${quoted(FOLDER_NAME)} and mimeType = ${quoted(FOLDER_MIME)} and trashed = false`;
    const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '10', spaces: 'drive' });
    const { files } = await json<{ files?: Array<{ id: string }> }>(`${API}/files?${params}`);
    return files?.[0]?.id ?? null;
  }

  async function createFolder(): Promise<string> {
    const { id } = await json<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    return id;
  }

  /** Папка есть — её ID, нет — создаётся. */
  async function ensureFolder(): Promise<string> {
    return (await findFolder()) ?? createFolder();
  }

  /** Все фото карт, которые Binder положил в Drive, по страницам. */
  async function listPhotos(): Promise<DrivePhoto[]> {
    const photos: DrivePhoto[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: "appProperties has { key='binder' and value='card' } and trashed = false",
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: String(PAGE_SIZE),
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await json<{ files?: unknown[]; nextPageToken?: string }>(`${API}/files?${params}`);
      for (const file of page.files ?? []) {
        const photo = photoFromFile(file);
        if (photo) photos.push(photo);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return photos;
  }

  /**
   * Новое фото карты или замена старого (existing — ID файла, который уже лежит в Drive):
   * один запрос uploadType=multipart.
   */
  async function upload(folderId: string, docId: string, image: Blob, show: PhotoShow, existing?: string): Promise<DrivePhoto> {
    if (!fitsAppProperties(docId)) throw new DriveError('server', 'Слишком длинный ID карты для Google Drive');
    const boundary = `binder-${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name: photoFileName(docId),
      mimeType: image.type || 'image/webp',
      appProperties: { binder: 'card', binderDoc: docId, show },
      ...(existing ? {} : { parents: [folderId] }),
    };
    const url = existing
      ? `${UPLOAD}/files/${encodeURIComponent(existing)}?uploadType=multipart&fields=${FILE_FIELDS}`
      : `${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`;
    const file = await json<unknown>(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(metadata, image, boundary),
    });
    const photo = photoFromFile(file);
    if (!photo) throw new DriveError('server', 'Google Drive вернул файл без метки Binder');
    return photo;
  }

  /** Картинка файла. */
  async function download(id: string): Promise<Blob> {
    return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob();
  }

  /** Какое фото показывать: меняются только метаданные, картинка не перезаливается. */
  async function setShow(id: string, show: PhotoShow): Promise<DrivePhoto> {
    const file = await json<unknown>(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties: { show } }),
    });
    const photo = photoFromFile(file);
    if (!photo) throw new DriveError('server', 'Google Drive вернул файл без метки Binder');
    return photo;
  }

  /** В корзину Drive, не насовсем: участник может достать фото оттуда 30 дней. */
  async function trash(id: string): Promise<void> {
    await call(`${API}/files/${encodeURIComponent(id)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  return { ensureFolder, listPhotos, upload, download, setShow, trash };
}
