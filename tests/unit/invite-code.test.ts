import { describe, expect, it } from 'vitest';
import { INVITE_ALPHABET, formatInviteInput, generateInviteCode, isInviteCode } from '@/lib/invite-code';

describe('generateInviteCode', () => {
  it('выдаёт коды правильного вида', () => {
    for (let i = 0; i < 500; i++) expect(isInviteCode(generateInviteCode())).toBe(true);
  });

  it('отбрасывает байты от 248, чтобы не было перекоса', () => {
    const bytes = new Uint8Array([255, 0, 1, 2, 3, 250, 248, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(generateInviteCode(() => bytes)).toBe('2345-6789');
  });

  it('добирает байты, если первых не хватило', () => {
    let call = 0;
    const source = () => (call++ === 0 ? new Uint8Array(16).fill(255) : new Uint8Array(16).fill(30));
    expect(generateInviteCode(source)).toBe('ZZZZ-ZZZZ');
  });
});

describe('formatInviteInput', () => {
  it('переводит в верхний регистр и ставит дефис после четырёх символов', () => {
    expect(formatInviteInput('ab3d7k2q')).toBe('AB3D-7K2Q');
  });

  it('убирает пробелы и лишние знаки', () => {
    expect(formatInviteInput(' ab3d - 7k2q ')).toBe('AB3D-7K2Q');
  });

  it('обрезает ввод до восьми символов', () => {
    expect(formatInviteInput('AB3D7K2QXYZ')).toBe('AB3D-7K2Q');
  });

  it('не оставляет висячий дефис при стирании', () => {
    expect(formatInviteInput('AB3D-')).toBe('AB3D');
  });

  it('отбрасывает кириллицу', () => {
    expect(formatInviteInput('АВ3D')).toBe('3D');
  });
});

describe('isInviteCode', () => {
  it('принимает код из алфавита', () => {
    expect(isInviteCode('AB3D-7K2Q')).toBe(true);
  });

  it('отклоняет похожие символы 0, O, 1, I, L', () => {
    for (const char of '0O1IL') expect(isInviteCode(`AB3D-7K2${char}`)).toBe(false);
  });

  it('отклоняет код без дефиса и неполный код', () => {
    expect(isInviteCode('AB3D7K2Q')).toBe(false);
    expect(isInviteCode('AB3D-7K2')).toBe(false);
  });

  it('в алфавите 31 символ без повторов', () => {
    expect(INVITE_ALPHABET).toHaveLength(31);
    expect(new Set(INVITE_ALPHABET).size).toBe(31);
  });
});
