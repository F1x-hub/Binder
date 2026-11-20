import { browser } from 'wxt/browser';

const KEY = 'pendingInvite';

/**
 * Код с экрана входа ждёт конца входа через Google. Лежит в chrome.storage.session:
 * если поп-ап закроется из-за окна согласия, код подхватит вкладка приложения.
 */
export async function rememberInvite(code: string): Promise<void> {
  await browser.storage.session.set({ [KEY]: code });
}

/** Забирает отложенный код (один раз). */
export async function takeInvite(): Promise<string | null> {
  const stored: unknown = (await browser.storage.session.get(KEY))[KEY];
  await browser.storage.session.remove(KEY);
  return typeof stored === 'string' && stored ? stored : null;
}

export async function forgetInvite(): Promise<void> {
  await browser.storage.session.remove(KEY);
}
