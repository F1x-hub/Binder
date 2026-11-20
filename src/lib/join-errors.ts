export type JoinFailure = 'format' | 'not-found' | 'used' | 'expired';

/** Отказ, который приложение распознало до записи в Firestore. */
export class JoinError extends Error {
  readonly reason: JoinFailure;

  constructor(reason: JoinFailure) {
    super(reason);
    this.name = 'JoinError';
    this.reason = reason;
  }
}

function firestoreCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

function offline(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return firestoreCode(error) === 'unavailable' || /network|offline|failed to fetch/i.test(text);
}

/** Понятный текст для ошибок вступления в клуб. */
export function joinErrorMessage(error: unknown): string {
  if (error instanceof JoinError) {
    switch (error.reason) {
      case 'format':
        return 'Код выглядит так: XXXX-XXXX, восемь латинских букв и цифр.';
      case 'not-found':
        return 'Такого кода нет. Проверь буквы и цифры.';
      case 'used':
        return 'Этот код уже использован. Попроси у друга новый.';
      case 'expired':
        return 'Срок кода истёк. Попроси у друга новый.';
    }
  }
  // Правила отклонили запись: код успели погасить или он истёк прямо сейчас
  if (firestoreCode(error) === 'permission-denied') return 'Код не подошёл. Попроси у друга новый.';
  if (offline(error)) return 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
  return 'Не получилось вступить. Попробуй ещё раз.';
}

/** Понятный текст для ошибок выпуска кода. */
export function inviteErrorMessage(error: unknown): string {
  if (firestoreCode(error) === 'permission-denied') return 'Приглашения закончились.';
  if (offline(error)) return 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
  return 'Не получилось создать код. Попробуй ещё раз.';
}
