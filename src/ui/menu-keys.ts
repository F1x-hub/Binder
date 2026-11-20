/**
 * Куда перевести фокус в меню по клавише: индекс пункта или null, если клавиша не про переходы.
 * Home и End обрабатываются всегда. Стрелки — только когда `arrows`: в Chrome 150+ их ведёт
 * сам браузер через атрибут focusgroup, и второй обработчик там не нужен.
 * `current` равен -1, если фокус ещё не в меню.
 */
export function menuFocusTarget(key: string, current: number, count: number, arrows: boolean): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown':
      if (!arrows) return null;
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      if (!arrows) return null;
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    default:
      return null;
  }
}
