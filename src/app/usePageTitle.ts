import { useEffect } from 'react';

/** Заголовок вкладки браузера: «Альбом · Binder». */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Binder`;
  }, [title]);
}
