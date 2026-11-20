import { describe, expect, it } from 'vitest';
import { isMessage } from '@/lib/messages';

describe('isMessage', () => {
  it('принимает известные сообщения', () => {
    expect(isMessage({ type: 'app/open', path: '/library' })).toBe(true);
    expect(isMessage({ type: 'auth/token' })).toBe(true);
  });

  it('отклоняет чужое и неполное', () => {
    expect(isMessage({ type: 'app/open' })).toBe(false);
    expect(isMessage({ type: 'something/else' })).toBe(false);
    expect(isMessage('auth/token')).toBe(false);
    expect(isMessage(null)).toBe(false);
  });
});
