/** Ошибка, текст которой уже можно показать человеку. */
export class AuthMessage extends Error {
  override name = 'AuthMessage';
}

/** Понятный текст для ошибок chrome.identity и Firebase Auth. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthMessage) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const text = error instanceof Error ? error.message : String(error);

  if (/not supported|unsupported/i.test(text)) return 'Вход через Google работает только в Google Chrome.';
  if (/did not approve|cancel|denied/i.test(text)) return 'Вход отменён.';
  if (/not signed in/i.test(text)) return 'Войди в Chrome своим Google-аккаунтом и попробуй ещё раз.';
  if (code === 'auth/operation-not-allowed') return 'Вход через Google не включён в проекте Firebase.';
  if (code === 'auth/network-request-failed' || /network|failed to fetch/i.test(text)) {
    return 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
  }
  if (code === 'auth/invalid-credential') return 'Google не подтвердил вход. Попробуй ещё раз.';
  return 'Не получилось войти. Попробуй ещё раз.';
}
