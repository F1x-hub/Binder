import { describe, expect, it } from 'vitest';
import { MAX_SHOWCASE, pickShowcase, showcaseOf, toggleShowcase } from '@/lib/showcase';

describe('showcaseOf', () => {
  it('берёт только допустимые ID без повторов и не больше шести', () => {
    expect(showcaseOf({ showcase: ['sv03-125', 'SV2a-094_ja', 'x-ja-MBG-3'] })).toEqual(['sv03-125', 'SV2a-094_ja', 'x-ja-MBG-3']);
    expect(showcaseOf({ showcase: ['a', 'a', 'b'] })).toEqual(['a', 'b']);
    expect(showcaseOf({ showcase: ['a', 1, null, '', 'с пробелом', '../x', 'b'] })).toEqual(['a', 'b']);
    expect(showcaseOf({ showcase: ['1', '2', '3', '4', '5', '6', '7'] })).toHaveLength(MAX_SHOWCASE);
  });

  it('без поля или с полем не того вида — пустая витрина', () => {
    expect(showcaseOf({})).toEqual([]);
    expect(showcaseOf(null)).toEqual([]);
    expect(showcaseOf({ showcase: 'sv03-125' })).toEqual([]);
  });
});

describe('toggleShowcase', () => {
  it('добавляет в конец и убирает', () => {
    expect(toggleShowcase([], 'a')).toEqual(['a']);
    expect(toggleShowcase(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleShowcase(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('седьмую карту не добавляет, но убрать любую можно', () => {
    const full = ['1', '2', '3', '4', '5', '6'];
    expect(toggleShowcase(full, '7')).toEqual(full);
    expect(toggleShowcase(full, '3')).toEqual(['1', '2', '4', '5', '6']);
  });
});

describe('pickShowcase', () => {
  it('карты в порядке витрины, ушедших из альбома нет', () => {
    const cards = [{ docId: 'a' }, { docId: 'b' }, { docId: 'c' }];
    expect(pickShowcase(['c', 'gone', 'a'], cards)).toEqual([{ docId: 'c' }, { docId: 'a' }]);
    expect(pickShowcase([], cards)).toEqual([]);
  });
});
