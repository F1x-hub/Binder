import { describe, expect, it } from 'vitest';
import { memberSinceLabel } from '@/settings/account';
import { menuFocusTarget } from '@/ui/menu-keys';

describe('menuFocusTarget: клавиши в меню аккаунта', () => {
  it('Home и End ведут на первый и последний пункт всегда', () => {
    expect(menuFocusTarget('Home', 2, 3, false)).toBe(0);
    expect(menuFocusTarget('End', 0, 3, false)).toBe(2);
    expect(menuFocusTarget('Home', 2, 3, true)).toBe(0);
  });

  it('стрелки в Chrome с focusgroup оставлены браузеру', () => {
    expect(menuFocusTarget('ArrowDown', 0, 3, false)).toBeNull();
    expect(menuFocusTarget('ArrowUp', 1, 3, false)).toBeNull();
  });

  it('без focusgroup стрелки ходят по кругу', () => {
    expect(menuFocusTarget('ArrowDown', 0, 3, true)).toBe(1);
    expect(menuFocusTarget('ArrowDown', 2, 3, true)).toBe(0);
    expect(menuFocusTarget('ArrowUp', 0, 3, true)).toBe(2);
    expect(menuFocusTarget('ArrowUp', 2, 3, true)).toBe(1);
  });

  it('фокус ещё не в меню: вниз — первый пункт, вверх — последний', () => {
    expect(menuFocusTarget('ArrowDown', -1, 3, true)).toBe(0);
    expect(menuFocusTarget('ArrowUp', -1, 3, true)).toBe(2);
  });

  it('прочие клавиши и пустое меню не трогает', () => {
    expect(menuFocusTarget('Enter', 0, 3, true)).toBeNull();
    expect(menuFocusTarget('Tab', 0, 3, true)).toBeNull();
    expect(menuFocusTarget('Escape', 0, 3, true)).toBeNull();
    expect(menuFocusTarget('Home', -1, 0, true)).toBeNull();
  });
});

describe('memberSinceLabel', () => {
  it('дата вступления по-русски', () => {
    expect(memberSinceLabel(new Date('2026-11-20T12:00:00Z'))).toBe('В клубе с 20 ноября 2026 г.');
  });

  it('без даты строки нет', () => {
    expect(memberSinceLabel(null)).toBeNull();
    expect(memberSinceLabel(undefined)).toBeNull();
  });
});
