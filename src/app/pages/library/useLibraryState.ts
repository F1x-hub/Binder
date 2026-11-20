import { useEffect, useState } from 'react';
import {
  DEFAULT_LIBRARY_STATE,
  NO_FILTERS,
  parseLibraryState,
  type LibraryFilters,
  type LibrarySort,
  type LibraryState,
  type LibraryView,
} from '@/lib/library-filters';

/** Фильтры и открытый разворот живут, пока открыта вкладка: возврат со страницы карточки их не сбрасывает. */
const SESSION_KEY = 'binder:library';
/** Вид альбома запоминается в этом браузере насовсем. */
const VIEW_KEY = 'binder:library-view';

function load(): LibraryState {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return parseLibraryState(JSON.parse(saved));
  } catch {
    // Испорченная запись или закрытое хранилище: начинаем с чистого альбома
  }
  try {
    return { ...DEFAULT_LIBRARY_STATE, view: parseLibraryState({ view: localStorage.getItem(VIEW_KEY) }).view };
  } catch {
    return DEFAULT_LIBRARY_STATE;
  }
}

export function useLibraryState() {
  const [state, setState] = useState<LibraryState>(load);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
      localStorage.setItem(VIEW_KEY, state.view);
    } catch {
      // Без хранилища альбом работает, только не помнит фильтры
    }
  }, [state]);

  return {
    state,
    // Новый вид, фильтр или сортировка открывают первый разворот
    setView: (view: LibraryView) => setState((previous) => ({ ...previous, view, spread: 0 })),
    setFilters: (patch: Partial<LibraryFilters>) =>
      setState((previous) => ({ ...previous, filters: { ...previous.filters, ...patch }, spread: 0 })),
    resetFilters: () => setState((previous) => ({ ...previous, filters: NO_FILTERS, spread: 0 })),
    setSort: (sort: LibrarySort) => setState((previous) => ({ ...previous, sort, spread: 0 })),
    setSpread: (spread: number) => setState((previous) => ({ ...previous, spread })),
  };
}
