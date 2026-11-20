import { describe, expect, it } from 'vitest';
import { AuthMessage, authErrorMessage } from '@/lib/auth-errors';

const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

describe('authErrorMessage', () => {
  it('пропускает готовый текст без изменений', () => {
    expect(authErrorMessage(new AuthMessage('Вход отменён.'))).toBe('Вход отменён.');
  });

  it('узнаёт отказ в окне согласия Chrome', () => {
    expect(authErrorMessage(new Error('The user did not approve access.'))).toBe('Вход отменён.');
  });

  it('узнаёт браузер без chrome.identity', () => {
    expect(authErrorMessage(new Error('This API is not supported on Microsoft Edge.'))).toBe(
      'Вход через Google работает только в Google Chrome.',
    );
  });

  it('узнаёт Chrome без аккаунта Google', () => {
    expect(authErrorMessage(new Error('The user is not signed in.'))).toBe(
      'Войди в Chrome своим Google-аккаунтом и попробуй ещё раз.',
    );
  });

  it('узнаёт выключенный вход через Google в Firebase', () => {
    expect(authErrorMessage(firebaseError('auth/operation-not-allowed'))).toBe(
      'Вход через Google не включён в проекте Firebase.',
    );
  });

  it('узнаёт обрыв сети', () => {
    expect(authErrorMessage(firebaseError('auth/network-request-failed'))).toContain('Нет связи');
  });

  it('для остального даёт общий текст', () => {
    expect(authErrorMessage(new Error('???'))).toBe('Не получилось войти. Попробуй ещё раз.');
    expect(authErrorMessage('строка вместо ошибки')).toBe('Не получилось войти. Попробуй ещё раз.');
  });
});
