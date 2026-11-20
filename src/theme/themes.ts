/** Темы в порядке показа в настройках. Значения токенов лежат в tokens.css. */
export const THEMES = [
  { id: 'mono', label: 'Монохром' },
  { id: 'light', label: 'Светлая' },
  { id: 'poke', label: 'Покемон' },
  { id: 'retro', label: 'Ретро' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'mono';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}
