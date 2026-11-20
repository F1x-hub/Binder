import { browser } from 'wxt/browser';

/** Сообщения, которые поп-ап и вкладка отправляют service worker. */
export type Message = { type: 'app/open'; path: string } | { type: 'auth/token' };

/** token приходит в ответ на auth/token, если войти в Firebase должен тот, кто просил. */
export type Reply = { ok: true; token?: string } | { ok: false; error: string };

export function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const { type, path } = value as Record<string, unknown>;
  if (type === 'app/open') return typeof path === 'string';
  return type === 'auth/token';
}

export function send(message: Message): Promise<Reply> {
  return browser.runtime.sendMessage(message);
}
