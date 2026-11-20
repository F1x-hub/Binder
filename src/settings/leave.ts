import { signOutOfBinder } from '@/lib/auth';

/**
 * Выход из вкладки (меню аккаунта и страница настроек): та же функция, что в поп-апе.
 * После выхода AuthGate сам покажет экран входа, адрес страницы не меняется.
 */
export function leaveBinder(): void {
  void signOutOfBinder().catch((error: unknown) => console.warn('[binder] выход', error));
}
