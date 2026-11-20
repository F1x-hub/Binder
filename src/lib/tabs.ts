import { browser } from 'wxt/browser';
import { send } from '@/lib/messages';

const APP_PAGE = '/app.html';

/**
 * Страница открыта как часть расширения. Вне его (статический предпросмотр сборки)
 * API расширения нет, и переходы работают обычными ссылками.
 */
export function inExtension(): boolean {
  return Boolean(browser?.runtime?.id);
}

/** Адрес страницы во вкладке приложения: `/library` → `.../app.html#/library`. */
export function appUrl(path: string): string {
  const route = path.startsWith('/') ? path : '/library';
  const page = inExtension() ? browser.runtime.getURL(APP_PAGE) : APP_PAGE;
  return `${page}#${route}`;
}

/**
 * Для service worker: открывает маршрут в единственной вкладке приложения.
 * Если вкладка уже есть, переключает на неё, иначе создаёт новую.
 * `runtime.getContexts` находит свои страницы без права `tabs`.
 */
export async function openApp(path: string): Promise<void> {
  const url = appUrl(path);
  const page = browser.runtime.getURL(APP_PAGE);
  const contexts = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.TAB],
  });
  const tab = contexts.find((context) => context.documentUrl?.startsWith(page) && context.tabId !== -1);
  if (!tab) {
    await browser.tabs.create({ url });
    return;
  }
  await browser.tabs.update(tab.tabId, { active: true, url });
  await browser.windows.update(tab.windowId, { focused: true });
}

/** Для поп-апа: просит service worker открыть страницу и закрывает поп-ап. */
export async function openAppFromPopup(path: string): Promise<void> {
  if (!inExtension()) {
    window.location.assign(appUrl(path));
    return;
  }
  await send({ type: 'app/open', path });
  // Если вкладка уже была активной, Chrome сам поп-ап не закроет.
  window.close();
}
