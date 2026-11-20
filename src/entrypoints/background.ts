import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { googleToken, signInWithGoogleToken } from '@/lib/auth';
import { authErrorMessage } from '@/lib/auth-errors';
import { isMessage, type Reply } from '@/lib/messages';
import { openApp } from '@/lib/tabs';

/**
 * Интерактивный вход. Вкладке и открытому поп-апу отдаём токен: в Firebase они входят сами
 * и сразу видят результат. Если поп-ап закрылся, пока Chrome показывал окно согласия,
 * входим здесь и открываем альбом во вкладке.
 */
async function handleTokenRequest(fromTab: boolean): Promise<Reply> {
  const token = await googleToken(true);
  if (fromTab) return { ok: true, token };
  const popups = await browser.runtime.getContexts({ contextTypes: [browser.runtime.ContextType.POPUP] });
  if (popups.length > 0) return { ok: true, token };
  await signInWithGoogleToken(token);
  await openApp('/library');
  return { ok: true };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse: (reply: Reply) => void) => {
    if (!isMessage(message)) return false;
    const task =
      message.type === 'app/open'
        ? openApp(message.path).then((): Reply => ({ ok: true }))
        : handleTokenRequest(Boolean(sender.tab));
    task.then(sendResponse, (error: unknown) => {
      console.warn('[binder]', error);
      const text = message.type === 'auth/token' ? authErrorMessage(error) : String(error);
      sendResponse({ ok: false, error: text });
    });
    return true; // ответ придёт асинхронно
  });
});
