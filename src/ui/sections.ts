/** Разделы вкладки и маршруты, при которых раздел подсвечен. «Боя» нет, пока по игре нет решения. */
export const SECTIONS = [
  { path: '/home', label: 'Главная', match: ['/home'] },
  { path: '/library', label: 'Альбом', match: ['/library', '/card/', '/scan'] },
  { path: '/decks', label: 'Колоды', match: ['/decks'] },
  { path: '/friends', label: 'Друзья', match: ['/friends', '/u/'] },
] as const;

/**
 * Подсвечен ли раздел на этом адресе. Свой профиль (`/u/me` или `/u/<свой uid>`) открывается
 * из меню аккаунта, поэтому «Друзья» на нём не подсвечиваются.
 */
export function sectionActive(match: readonly string[], location: string, myUid: string | null): boolean {
  if (location === '/u/me' || (myUid !== null && location === `/u/${encodeURIComponent(myUid)}`)) return false;
  return match.some((prefix) => location.startsWith(prefix));
}
