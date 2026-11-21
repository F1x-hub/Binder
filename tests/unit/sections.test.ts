import { describe, expect, it } from 'vitest';
import { SECTIONS, sectionActive } from '@/ui/sections';

const match = (label: string) => SECTIONS.find((section) => section.label === label)!.match;
const active = (location: string, uid: string | null = 'me123') =>
  SECTIONS.filter((section) => sectionActive(section.match, location, uid)).map((section) => section.label);

describe('разделы шапки вкладки', () => {
  it('без «Боя», главная первой', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual(['Главная', 'Альбом', 'Колоды', 'Друзья']);
    expect(SECTIONS.map((section) => section.path as string)).not.toContain('/battle');
  });

  it('подсвечивает раздел страницы', () => {
    expect(active('/home')).toEqual(['Главная']);
    expect(active('/library')).toEqual(['Альбом']);
    expect(active('/card/sv03-125')).toEqual(['Альбом']);
    expect(active('/scan')).toEqual(['Альбом']);
    expect(active('/decks/abc')).toEqual(['Колоды']);
    expect(active('/friends')).toEqual(['Друзья']);
    expect(active('/u/friend42')).toEqual(['Друзья']);
  });

  it('свой профиль не подсвечивает «Друзья»', () => {
    expect(active('/u/me')).toEqual([]);
    expect(active('/u/me123')).toEqual([]);
    expect(sectionActive(match('Друзья'), '/u/me123', null)).toBe(true);
  });

  it('настройки, админ и бой — ни один раздел', () => {
    expect(active('/settings')).toEqual([]);
    expect(active('/admin')).toEqual([]);
    expect(active('/battle')).toEqual([]);
  });
});
