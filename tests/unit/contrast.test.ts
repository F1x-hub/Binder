import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/theme/themes';

/** Пары «цвет текста — фон», которые встречаются в макетах. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['muted', 'header-field'],
  ['accent', 'bg'],
  ['on-accent', 'accent'],
  ['on-selected', 'selected'],
  ['link', 'bg'],
  ['link', 'surface'],
  ['up', 'bg'],
  ['up', 'surface'],
  ['down', 'bg'],
  ['down', 'surface'],
  ['on-header', 'header'],
  ['header-muted', 'header'],
  ['on-header-field', 'header-field'],
];

/** Токены каждой темы из tokens.css: id темы → (имя токена → значение). */
function readThemes(): Map<string, Map<string, string>> {
  const css = readFileSync(new URL('../../src/theme/tokens.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const themes = new Map<string, Map<string, string>>();
  for (const [, selector = '', body = ''] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const tokens = new Map<string, string>();
    for (const [, name = '', value = ''] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(name, value.trim());
    }
    for (const [, id = ''] of selector.matchAll(/\[data-theme='([\w-]+)'\]/g)) {
      themes.set(id, tokens);
    }
  }
  return themes;
}

/** Относительная яркость по WCAG 2.x. */
function luminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!digits) throw new Error(`Ожидался цвет #rrggbb, а не «${hex}»`);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((start) => {
    const channel = parseInt(digits.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [lighter = 0, darker = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const themes = readThemes();
const reference = [...(themes.get('mono')?.keys() ?? [])].sort();

describe('tokens.css', () => {
  it('описывает все темы из списка', () => {
    expect([...themes.keys()].sort()).toEqual(THEMES.map((theme) => theme.id).sort());
  });

  for (const { id, label } of THEMES) {
    describe(label, () => {
      const tokens = themes.get(id) ?? new Map<string, string>();

      it('задаёт тот же набор токенов, что Монохром', () => {
        expect([...tokens.keys()].sort()).toEqual(reference);
      });

      it.each(TEXT_PAIRS)('контраст --%s на --%s не ниже 4.5:1', (text, background) => {
        expect(contrast(tokens.get(text) ?? '', tokens.get(background) ?? '')).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
