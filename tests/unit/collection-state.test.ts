import { describe, expect, it } from 'vitest';
import type { OwnedCard } from '@/lib/collection';
import { albumErrorMessage, ownedOf } from '@/lib/collection-state';

const card = { docId: 'sv03-125', count: 1 } as OwnedCard;

describe('ownedOf: что видят страницы альбома', () => {
  it('загруженный альбом — карты, без ошибки', () => {
    const byId = new Map([[card.docId, card]]);
    expect(ownedOf({ status: 'ready', cards: [card], byId })).toEqual({ cards: [card], byId, ready: true, error: null });
  });

  it('пока грузится — пусто и без ошибки, как раньше', () => {
    const owned = ownedOf({ status: 'loading' });
    expect(owned.cards).toEqual([]);
    expect(owned.byId.size).toBe(0);
    expect(owned.ready).toBe(false);
    expect(owned.error).toBeNull();
  });

  it('ошибка не выдаёт себя за загрузку: причина по-русски, карты пустые', () => {
    const owned = ownedOf({ status: 'error', message: 'Missing or insufficient permissions.', code: 'permission-denied' });
    expect(owned.ready).toBe(false);
    expect(owned.cards).toEqual([]);
    expect(owned.error).toBe(albumErrorMessage('permission-denied'));
    expect(owned.error).not.toMatch(/Missing|permissions/);
  });

  it('ошибка без кода тоже видна', () => {
    expect(ownedOf({ status: 'error', message: 'boom' }).error).toBe(albumErrorMessage(undefined));
  });
});

describe('albumErrorMessage', () => {
  it('у частых кодов своя причина', () => {
    const codes = ['unavailable', 'permission-denied', 'unauthenticated', 'resource-exhausted'];
    const texts = new Set(codes.map(albumErrorMessage));
    expect(texts.size).toBe(codes.length);
    expect(albumErrorMessage('unavailable')).toMatch(/связи/);
    expect(albumErrorMessage('resource-exhausted')).toMatch(/лимит/);
    expect(albumErrorMessage('deadline-exceeded')).toBe(albumErrorMessage('unavailable'));
  });

  it('незнакомый код называется, чтобы его можно было сообщить', () => {
    expect(albumErrorMessage('internal')).toContain('internal');
    expect(albumErrorMessage(undefined)).not.toContain('undefined');
  });
});
