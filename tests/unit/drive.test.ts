import { describe, expect, it, vi } from 'vitest';
import {
  DriveError,
  driveClient,
  driveErrorMessage,
  fitsAppProperties,
  multipartBody,
  photoFileName,
  photoFromFile,
  type DrivePhoto,
} from '@/lib/drive';
import { planSync, withPending } from '@/lib/my-photos';

type Call = { url: string; init: RequestInit };

/** Поддельный Drive: отвечает по очереди заданными ответами и запоминает запросы. */
function fakeDrive(responses: Array<Response | (() => Response)>, tokens = ['t1', 't2']) {
  const calls: Call[] = [];
  const dropped: string[] = [];
  let tokenIndex = 0;
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('лишний запрос');
    return typeof next === 'function' ? next() : next;
  });
  const client = driveClient({
    fetch: fetch as unknown as typeof globalThis.fetch,
    token: async () => tokens[Math.min(tokenIndex, tokens.length - 1)]!,
    dropToken: async (token) => {
      dropped.push(token);
      tokenIndex += 1;
    },
  });
  return { client, calls, dropped };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const file = (id: string, docId: string, show = 'mine', modifiedTime = '2026-11-21T10:00:00.000Z') => ({
  id,
  modifiedTime,
  appProperties: { binder: 'card', binderDoc: docId, show },
});

describe('photoFromFile', () => {
  it('берёт только файлы с меткой Binder', () => {
    expect(photoFromFile(file('f1', 'sv03-125'))).toEqual({ id: 'f1', docId: 'sv03-125', modified: '2026-11-21T10:00:00.000Z', show: 'mine' });
    expect(photoFromFile(file('f2', 'x-ja-MBG-3', 'scan'))?.show).toBe('scan');
    expect(photoFromFile({ id: 'f3', appProperties: {} })).toBeNull();
    expect(photoFromFile({ appProperties: { binderDoc: 'a' } })).toBeNull();
    expect(photoFromFile(null)).toBeNull();
  });

  it('незнакомое значение show считается «Моё фото»', () => {
    expect(photoFromFile(file('f1', 'a', 'whatever'))?.show).toBe('mine');
  });
});

describe('имена и метаданные', () => {
  it('имя файла без символов, запрещённых в Windows', () => {
    expect(photoFileName('sv03.5-006')).toBe('sv03.5-006.webp');
    expect(photoFileName('x-ja-A/B-3')).toBe('x-ja-A_B-3.webp');
  });

  it('ID документа должен влезть в appProperties', () => {
    expect(fitsAppProperties('x-ja-MBG-3')).toBe(true);
    expect(fitsAppProperties('x'.repeat(115))).toBe(true);
    expect(fitsAppProperties('x'.repeat(116))).toBe(false);
  });

  it('multipart: метаданные JSON, потом картинка, граница в конце', async () => {
    const image = new Blob(['IMG'], { type: 'image/webp' });
    const text = await multipartBody({ name: 'a.webp' }, image, 'B').text();
    expect(text).toBe(
      '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.webp"}\r\n--B\r\nContent-Type: image/webp\r\n\r\nIMG\r\n--B--',
    );
  });
});

describe('driveClient', () => {
  it('папка «Binder»: находит существующую и не создаёт вторую', async () => {
    const { client, calls } = fakeDrive([json({ files: [{ id: 'folder1' }] })]);
    expect(await client.ensureFolder()).toBe('folder1');
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]!.url).searchParams.get('q');
    expect(q).toContain("name = 'Binder'");
    expect(q).toContain('application/vnd.google-apps.folder');
    expect(q).toContain('trashed = false');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });

  it('папки нет — создаётся', async () => {
    const { client, calls } = fakeDrive([json({ files: [] }), json({ id: 'new-folder' })]);
    expect(await client.ensureFolder()).toBe('new-folder');
    expect(calls[1]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ name: 'Binder', mimeType: 'application/vnd.google-apps.folder' });
  });

  it('список фото листается по страницам и отбрасывает чужие файлы', async () => {
    const { client, calls } = fakeDrive([
      json({ files: [file('f1', 'a'), { id: 'junk' }], nextPageToken: 'p2' }),
      json({ files: [file('f2', 'b', 'scan')] }),
    ]);
    const photos = await client.listPhotos();
    expect(photos.map((photo) => [photo.id, photo.docId, photo.show])).toEqual([
      ['f1', 'a', 'mine'],
      ['f2', 'b', 'scan'],
    ]);
    expect(new URL(calls[1]!.url).searchParams.get('pageToken')).toBe('p2');
    expect(new URL(calls[0]!.url).searchParams.get('q')).toContain("appProperties has { key='binder' and value='card' }");
  });

  it('новое фото: POST multipart в папку с меткой карты', async () => {
    const { client, calls } = fakeDrive([json(file('f9', 'sv03-125'))]);
    const photo = await client.upload('folder1', 'sv03-125', new Blob(['x'], { type: 'image/webp' }), 'mine');
    expect(photo.id).toBe('f9');
    const { url, init } = calls[0]!;
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/related; boundary=binder-/);
    const body = await (init.body as Blob).text();
    const metadata = JSON.parse(body.split('\r\n\r\n')[1]!.split('\r\n--')[0]!);
    expect(metadata).toEqual({
      name: 'sv03-125.webp',
      mimeType: 'image/webp',
      appProperties: { binder: 'card', binderDoc: 'sv03-125', show: 'mine' },
      parents: ['folder1'],
    });
  });

  it('замена фото: PATCH того же файла, без parents', async () => {
    const { client, calls } = fakeDrive([json(file('f9', 'a'))]);
    await client.upload('folder1', 'a', new Blob(['x'], { type: 'image/webp' }), 'mine', 'f9');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('/upload/drive/v3/files/f9?uploadType=multipart');
    expect(await (calls[0]!.init.body as Blob).text()).not.toContain('parents');
  });

  it('слишком длинный ID карты не уходит в Drive', async () => {
    const { client, calls } = fakeDrive([]);
    await expect(client.upload('f', 'x'.repeat(200), new Blob(['x']), 'mine')).rejects.toBeInstanceOf(DriveError);
    expect(calls).toHaveLength(0);
  });

  it('выбор «скан / моё фото» меняет только метаданные', async () => {
    const { client, calls } = fakeDrive([json(file('f1', 'a', 'scan'))]);
    const photo = await client.setShow('f1', 'scan');
    expect(photo.show).toBe('scan');
    expect(calls[0]!.url).toContain('/drive/v3/files/f1?');
    expect(calls[0]!.url).not.toContain('/upload/');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ appProperties: { show: 'scan' } });
  });

  it('удаление — в корзину, не насовсем', async () => {
    const { client, calls } = fakeDrive([json({ id: 'f1' })]);
    await client.trash('f1');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ trashed: true });
  });

  it('401: токен забывается, запрос повторяется один раз с новым', async () => {
    const { client, calls, dropped } = fakeDrive([new Response('', { status: 401 }), new Response('IMG')]);
    const blob = await client.download('f1');
    expect(await blob.text()).toBe('IMG');
    expect(dropped).toEqual(['t1']);
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer t2');
    expect(calls[1]!.url).toContain('/files/f1?alt=media');
  });

  it('второй 401 подряд — нужно согласие', async () => {
    const { client } = fakeDrive([new Response('', { status: 401 }), new Response('', { status: 401 })]);
    await expect(client.download('f1')).rejects.toMatchObject({ kind: 'consent' });
  });

  it('кончилось место — quota, Drive API выключен — consent, сеть — network', async () => {
    const quota = fakeDrive([json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403)]);
    await expect(quota.client.trash('f')).rejects.toMatchObject({ kind: 'quota' });
    const disabled = fakeDrive([json({ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 403)]);
    await expect(disabled.client.trash('f')).rejects.toMatchObject({ kind: 'consent' });
    const offline = fakeDrive([
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    await expect(offline.client.trash('f')).rejects.toMatchObject({ kind: 'network' });
  });

  it('без токена запроса нет', async () => {
    const fetch = vi.fn();
    const client = driveClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      token: async () => {
        throw new Error('OAuth2 not granted or revoked.');
      },
      dropToken: async () => {},
    });
    await expect(client.listPhotos()).rejects.toMatchObject({ kind: 'consent' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('driveErrorMessage', () => {
  it('объясняет по-русски', () => {
    expect(driveErrorMessage(new DriveError('quota', ''))).toMatch(/место/);
    expect(driveErrorMessage(new Error('The user did not approve access.'))).toMatch(/не дан/);
    expect(driveErrorMessage(new Error('что-то ещё'))).toMatch(/Не получилось/);
  });
});

describe('planSync', () => {
  const remote = (id: string, docId: string, modified = 'm1'): DrivePhoto => ({ id, docId, modified, show: 'mine' });

  it('новое в Drive скачивается, известное — нет', () => {
    const local = new Map([['a', { id: 'f1', modified: 'm1' }]]);
    const plan = planSync(['a', 'b'], local, [remote('f1', 'a'), remote('f2', 'b')]);
    expect(plan.download.map((photo) => photo.docId)).toEqual(['b']);
    expect(plan.drop).toEqual([]);
  });

  it('фото заменили в другом браузере — скачивается снова', () => {
    const local = new Map([['a', { id: 'f1', modified: 'm1' }]]);
    expect(planSync(['a'], local, [remote('f1', 'a', 'm2')]).download).toHaveLength(1);
  });

  it('файла больше нет в Drive — копия убирается; неотправленная — остаётся', () => {
    const local = new Map([
      ['a', { id: 'f1', modified: 'm1' }],
      ['b', { id: null, modified: '' }],
    ]);
    expect(planSync(['a', 'b'], local, [])).toEqual({ download: [], drop: ['a'] });
  });

  it('неотправленная копия новее файла в Drive — не перезаписывается', () => {
    const local = new Map([['a', { id: null, modified: '' }]]);
    expect(planSync(['a'], local, [remote('f1', 'a')]).download).toEqual([]);
  });

  it('смотрит только на запрошенные карты', () => {
    expect(planSync(['a'], new Map(), [remote('f1', 'a'), remote('f2', 'z')]).download.map((photo) => photo.docId)).toEqual(['a']);
  });
});

describe('withPending', () => {
  it('без повторов, порядок сохраняется', () => {
    expect(withPending(['a', 'b'], ['b', 'c', 'a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });
});
