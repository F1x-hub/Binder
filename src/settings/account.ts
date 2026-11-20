const joinedFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** «В клубе с 20 ноября 2026 г.» Без даты вступления (её может не быть у владельца из консоли) — null. */
export function memberSinceLabel(joinedAt: Date | null | undefined): string | null {
  return joinedAt ? `В клубе с ${joinedFormat.format(joinedAt)}` : null;
}
