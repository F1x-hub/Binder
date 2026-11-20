/** Символы кода приглашения: без похожих друг на друга 0/O и 1/I/L. Совпадает с firestore.rules. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const VALID = new RegExp(`^[${INVITE_ALPHABET}]{4}-[${INVITE_ALPHABET}]{4}$`);

/**
 * Приводит ввод к виду XXXX-XXXX: заглавные латинские буквы и цифры,
 * дефис после четвёртого символа, не больше восьми символов.
 */
export function formatInviteInput(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

/** Код целиком из алфавита. Это проверка формы, решение о доступе принимают правила Firestore. */
export function isInviteCode(value: string): boolean {
  return VALID.test(value);
}

type RandomBytes = (count: number) => Uint8Array;

const cryptoBytes: RandomBytes = (count) => crypto.getRandomValues(new Uint8Array(count));

/**
 * Случайный код приглашения. Байты от 248 и выше отбрасываются (248 = 31 × 8),
 * чтобы каждый символ алфавита выпадал одинаково часто.
 */
export function generateInviteCode(randomBytes: RandomBytes = cryptoBytes): string {
  const chars: string[] = [];
  while (chars.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte < 248 && chars.length < 8) chars.push(INVITE_ALPHABET.charAt(byte % INVITE_ALPHABET.length));
    }
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}
