import { GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth/web-extension';
import { browser } from 'wxt/browser';
import { AuthMessage } from '@/lib/auth-errors';
import { binderAuth } from '@/lib/firebase';
import { send } from '@/lib/messages';

/**
 * Токен Google из chrome.identity, аккаунт берётся из профиля Chrome.
 * С interactive: true Chrome может показать окно согласия, поэтому так вызывает только service worker.
 */
export async function googleToken(interactive: boolean): Promise<string> {
  const result = await browser.identity.getAuthToken({ interactive });
  if (!result.token) throw new Error('chrome.identity не вернул токен');
  return result.token;
}

/** Вход в Firebase по токену Google. */
export async function signInWithGoogleToken(token: string): Promise<void> {
  await signInWithCredential(binderAuth(), GoogleAuthProvider.credential(null, token));
}

/**
 * Вход из поп-апа или вкладки. Токен получает service worker: окно согласия забирает фокус,
 * поп-ап от этого закрывается и сам дождаться ответа не может.
 */
export async function signInWithGoogle(): Promise<void> {
  const reply = await send({ type: 'auth/token' });
  if (!reply.ok) throw new AuthMessage(reply.error);
  // Без токена ответ приходит, когда service worker уже вошёл сам
  if (reply.token) await signInWithGoogleToken(reply.token);
}

/** Выход из Binder и сброс токена в кэше Chrome. Следующий вход пройдёт без окна согласия. */
export async function signOutOfBinder(): Promise<void> {
  const cached = await browser.identity.getAuthToken({ interactive: false }).catch(() => null);
  if (cached?.token) await browser.identity.removeCachedAuthToken({ token: cached.token });
  await signOut(binderAuth());
}
