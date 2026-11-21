import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_LENGTH, isOwnPhoto, nameProblem, normalizeName, photoAllowed } from '@/lib/profile-edit';

const own = (body: string) => `data:image/webp;base64,${body}`;

describe('normalizeName', () => {
  it('убирает пробелы по краям и двойные пробелы', () => {
    expect(normalizeName('  Ника   Петрова ')).toBe('Ника Петрова');
  });

  it('пустое и из одних пробелов — null', () => {
    expect(normalizeName('')).toBeNull();
    expect(normalizeName(' \t\n ')).toBeNull();
  });
});

describe('nameProblem', () => {
  it('пропускает обычное имя и ровно 80 символов', () => {
    expect(nameProblem('Алекс')).toBeNull();
    expect(nameProblem('я'.repeat(80))).toBeNull();
  });

  it('объясняет пустое и слишком длинное имя', () => {
    expect(nameProblem('   ')).toMatch(/Напиши имя/);
    expect(nameProblem('я'.repeat(81))).toMatch(/80/);
  });
});

describe('isOwnPhoto и photoAllowed', () => {
  it('своё фото — только WebP data URL', () => {
    expect(isOwnPhoto(own('AAAA'))).toBe(true);
    expect(isOwnPhoto('data:image/png;base64,AAAA')).toBe(false);
    expect(isOwnPhoto('https://lh3.googleusercontent.com/a/x')).toBe(false);
    expect(isOwnPhoto(null)).toBe(false);
  });

  it('пускает отсутствие фото, ссылку Google и своё фото в пределе', () => {
    expect(photoAllowed(null)).toBe(true);
    expect(photoAllowed('https://lh3.googleusercontent.com/a/x=s96-c')).toBe(true);
    expect(photoAllowed(own('A'.repeat(MAX_PHOTO_LENGTH - 23)))).toBe(true);
  });

  it('не пускает длинную ссылку, своё фото сверх предела и чужие символы', () => {
    expect(photoAllowed(`https://example.com/${'a'.repeat(2048)}`)).toBe(false);
    expect(photoAllowed(own('A'.repeat(MAX_PHOTO_LENGTH)))).toBe(false);
    expect(photoAllowed(own('AA"><script>'))).toBe(false);
  });
});
