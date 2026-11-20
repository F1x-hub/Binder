import { describe, expect, it } from 'vitest';
import { JoinError, inviteErrorMessage, joinErrorMessage } from '@/lib/join-errors';

const firestoreError = (code: string) => Object.assign(new Error(code), { code });

describe('joinErrorMessage', () => {
  it('объясняет отказы, найденные до записи', () => {
    expect(joinErrorMessage(new JoinError('format'))).toContain('XXXX-XXXX');
    expect(joinErrorMessage(new JoinError('not-found'))).toBe('Такого кода нет. Проверь буквы и цифры.');
    expect(joinErrorMessage(new JoinError('used'))).toContain('уже использован');
    expect(joinErrorMessage(new JoinError('expired'))).toContain('Срок кода истёк');
  });

  it('отказ правил превращает в «код не подошёл»', () => {
    expect(joinErrorMessage(firestoreError('permission-denied'))).toBe('Код не подошёл. Попроси у друга новый.');
  });

  it('узнаёт отсутствие сети', () => {
    expect(joinErrorMessage(firestoreError('unavailable'))).toContain('Нет связи');
  });

  it('для остального даёт общий текст', () => {
    expect(joinErrorMessage(new Error('???'))).toBe('Не получилось вступить. Попробуй ещё раз.');
  });
});

describe('inviteErrorMessage', () => {
  it('отказ правил при выпуске кода значит, что приглашения кончились', () => {
    expect(inviteErrorMessage(firestoreError('permission-denied'))).toBe('Приглашения закончились.');
  });

  it('для остального даёт общий текст', () => {
    expect(inviteErrorMessage(new Error('???'))).toBe('Не получилось создать код. Попробуй ещё раз.');
  });
});
