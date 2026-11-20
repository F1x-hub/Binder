import { browser } from 'wxt/browser';
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@/theme/themes';

const THEME_KEY = 'theme';
/** Копия темы для public/theme-boot.js: он читает её синхронно, до первой отрисовки. */
const THEME_MIRROR = 'binder:theme';

function syncArea() {
  return browser?.storage?.sync;
}

/** Тема, которая сейчас стоит на <html>. */
export function currentTheme(): ThemeId {
  const id = document.documentElement.dataset.theme;
  return isThemeId(id) ? id : DEFAULT_THEME;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_MIRROR, id);
  } catch {
    // Без копии тема просто применится чуть позже, после чтения chrome.storage.
  }
}

/** Тема из chrome.storage.sync: она общая для всех окон и следует за аккаунтом Chrome. */
export async function loadTheme(): Promise<ThemeId> {
  const area = syncArea();
  if (!area) return currentTheme();
  const stored: unknown = (await area.get(THEME_KEY))[THEME_KEY];
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

export async function saveTheme(id: ThemeId): Promise<void> {
  applyTheme(id);
  await syncArea()?.set({ [THEME_KEY]: id });
}

/** Подписка на смену темы в других окнах. Возвращает функцию отписки. */
export function watchTheme(onChange: (id: ThemeId) => void): () => void {
  const storage = browser?.storage;
  if (!storage) return () => {};
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const next = changes[THEME_KEY]?.newValue;
    if (area === 'sync' && isThemeId(next)) onChange(next);
  };
  storage.onChanged.addListener(listener);
  return () => storage.onChanged.removeListener(listener);
}
