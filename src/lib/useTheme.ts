import { useCallback, useEffect, useState } from 'react';
import { applyTheme, currentTheme, loadTheme, saveTheme, watchTheme } from '@/lib/settings';
import type { ThemeId } from '@/theme/themes';

/**
 * Тема окна. При старте сверяется с chrome.storage и дальше следит за сменой
 * темы в других окнах, поэтому хук нужен в корне каждого окна.
 */
export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);

  useEffect(() => {
    let active = true;
    const show = (id: ThemeId) => {
      applyTheme(id);
      setTheme(id);
    };
    void loadTheme().then((id) => {
      if (active) show(id);
    });
    const stop = watchTheme(show);
    return () => {
      active = false;
      stop();
    };
  }, []);

  const choose = useCallback((id: ThemeId) => {
    setTheme(id);
    void saveTheme(id);
  }, []);

  return [theme, choose];
}
